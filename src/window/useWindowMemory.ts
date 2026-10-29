// M0-13 · 窗口几何 / 布局 / 上次项目的记忆与恢复
// M0-13c · 会话恢复扩展：除上次项目外，还记住上次打开的编辑器标签页与活动标签，
//           启动恢复项目后一并重开（只恢复属于该项目的文件）
// 启动（settings 加载完成后）：
//   1) applyLayout：侧栏/预览宽度与显隐 → useAppStore
//   2) applyWindow：LogicalSize/LogicalPosition（DPI 稳定）+ 最大化；位置不在任何显示器内则忽略
//   3) restoreSession：上次项目 openProject → 重开上次的标签页并激活活动项
//      （项目打开失败静默清空 + toast，不阻塞启动）
// 运行期间：
//   - onResized/onMoved 500ms 防抖 → snap 记录 outer 几何（物理坐标 ÷ scaleFactor）
//   - 布局值（显隐/宽度/比例）useAppStore.subscribe 变化后防抖写盘
//   - 会话值（项目根 + 标签页 + 活动标签）变化后防抖写盘
//   - onCloseRequested：关闭前补一次 flush（窗口几何 + 会话记忆；防抖尾巴可能没来得及写）
// 旁路写盘一律走 useSettingsStore.persist（以 persisted 为基底，避免串写设置页预览草稿）；
// 注意 persist 是顶层浅合并，session 为整对象替换——三字段必须始终一起写
import { useEffect } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore, type AppState } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore, type BuffersState } from "@/editor/useBuffers";
import { notify, useProjectStore } from "@/project/useProject";
import type { AppSettings } from "@/types/settings";

/**
 * 窗口最小尺寸（逻辑像素）——与 `src-tauri/tauri.conf.json` 的 `minWidth/minHeight` 保持一致。
 * 恢复几何时兜底钳制：历史记忆里可能存着更小的尺寸（或窗口管理器未按约束收敛），
 * 否则排版会被挤坏（活动栏 + 侧栏 258 + 编辑区 + 预览 300 的下限）。
 */
export const MIN_WINDOW_SIZE = { width: 1024, height: 640 } as const;

/** 防抖写盘（布局/窗口频繁变动时不逐帧写文件） */
function debounce<F extends () => void>(ms: number, fn: F) {
  let t: number | undefined;
  return () => {
    if (t !== undefined) window.clearTimeout(t);
    t = window.setTimeout(() => {
      t = undefined;
      fn();
    }, ms);
  };
}

/** 窗口位置是否落在任一可用显示器内（换显示器/拔屏后防止窗口丢失） */
async function positionVisible(): Promise<boolean> {
  try {
    const pos = await getCurrentWindow().outerPosition();
    const monitors = await availableMonitors();
    return monitors.some((m) => {
      const px = m.position; // 物理坐标
      const sz = m.size;
      return (
        pos.x >= px.x &&
        pos.x < px.x + sz.width &&
        pos.y >= px.y &&
        pos.y < px.y + sz.height
      );
    });
  } catch {
    return false;
  }
}

export function useWindowMemory(): void {
  const loaded = useSettingsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) return;
    const win = getCurrentWindow();
    const st = useSettingsStore.getState();
    const general = st.settings.general;
    const unlisteners: (() => void)[] = [];

    // 1) 布局恢复：把持久化的宽度/显隐灌进运行时 store（App 直接消费）
    if (general.restoreLayout) {
      useAppStore.setState({
        sidebarVisible: st.settings.layout.sidebarVisible,
        sidebarWidth: st.settings.layout.sidebarWidth,
        previewVisible: st.settings.layout.previewVisible,
        previewRatio: st.settings.layout.previewRatio,
        pvSideWidth: st.settings.layout.pvSideWidth,
        logHeight: st.settings.layout.logHeight ?? 212,
      });
    }

    /** 读取当前窗口几何（逻辑坐标） */
    const snapWindow = async (): Promise<Partial<AppSettings> | null> => {
      if (!useSettingsStore.getState().settings.general.rememberWindow) return null;
      try {
        const scale = await win.scaleFactor();
        const size = await win.outerSize();
        const pos = await win.outerPosition();
        const maxed = await win.isMaximized();
        return {
          window: {
            width: Math.round(size.width / scale),
            height: Math.round(size.height / scale),
            x: Math.round(pos.x / scale),
            y: Math.round(pos.y / scale),
            maximized: maxed,
          },
        };
      } catch (e) {
        console.warn("[window-memory] 读取窗口几何失败", e);
        return null;
      }
    };

    if (general.rememberWindow) {
      // 2) 窗口几何恢复
      const w = st.settings.window;
      void (async () => {
        try {
          if (w.width != null && w.height != null) {
            // 最小尺寸兜底：小于下限的记忆值按下限恢复（见 MIN_WINDOW_SIZE）
            await win.setSize(
              new LogicalSize(
                Math.max(MIN_WINDOW_SIZE.width, w.width),
                Math.max(MIN_WINDOW_SIZE.height, w.height),
              ),
            );
          }
          if (w.x != null && w.y != null && (await positionVisible())) {
            await win.setPosition(new LogicalPosition(w.x, w.y));
          }
          if (w.maximized && !(await win.isMaximized())) {
            await win.maximize();
          }
        } catch (e) {
          console.warn("[window-memory] 应用窗口几何失败", e);
        }
      })();

      const debouncedWindowSave = debounce(500, () => {
        void snapWindow().then(
          (patch) => patch && void useSettingsStore.getState().persist(patch),
        );
      });
      void (async () => {
        try {
          unlisteners.push(await win.onResized(() => debouncedWindowSave()));
          unlisteners.push(await win.onMoved(() => debouncedWindowSave()));
        } catch (e) {
          console.warn("[window-memory] 窗口事件监听失败", e);
        }
      })();
    }

    // 3) 布局变化 → 防抖旁路写盘（restoreLayout 关闭时不写，遵守用户设置）
    const layoutKey = (s: AppState): string =>
      `${s.sidebarVisible}|${s.sidebarWidth}|${s.previewVisible}|${s.previewRatio}|${s.pvSideWidth}|${s.logHeight}`;
    const debouncedLayoutSave = debounce(500, () => {
      const s = useAppStore.getState();
      void useSettingsStore.getState().persist({
        layout: {
          sidebarVisible: s.sidebarVisible,
          sidebarWidth: s.sidebarWidth,
          previewVisible: s.previewVisible,
          previewRatio: s.previewRatio,
          pvSideWidth: s.pvSideWidth,
          logHeight: s.logHeight,
        },
      });
    });
    const unsubscribeApp = useAppStore.subscribe((s, prev) => {
      if (layoutKey(s) !== layoutKey(prev)) debouncedLayoutSave();
    });
    // 4) 会话记忆写盘（M0-13c：项目根 + 标签页 + 活动标签；三字段始终一起写，防浅合并丢字段）
    const sessionSnapshot = (): AppSettings["session"] => {
      const bs = useBuffersStore.getState();
      return {
        lastProject: useProjectStore.getState().root,
        openFiles: bs.buffers.map((b) => b.path),
        activeFile: bs.activePath,
      };
    };
    const debouncedSessionSave = debounce(500, () => {
      void useSettingsStore.getState().persist({ session: sessionSnapshot() });
    });
    const unsubscribeProject = useProjectStore.subscribe((s, prev) => {
      if (s.root !== prev.root) debouncedSessionSave();
    });
    // 标签页开/关/切换 → 防抖写盘（仅结构变化进 key，内容编辑不触发）
    const buffersKey = (s: BuffersState): string =>
      `${s.activePath ?? ""}\n${s.buffers.map((b) => b.path).join("\n")}`;
    const unsubscribeBuffers = useBuffersStore.subscribe((s, prev) => {
      if (buffersKey(s) !== buffersKey(prev)) debouncedSessionSave();
    });

    // 4b) 关窗前 flush：窗口几何（rememberWindow 开时）+ 会话记忆（防抖尾巴可能没来得及写）
    // 监听器仅观测、不 preventDefault，X 行为与不注册时一致（M0-13 返修实证）；
    // 不论 rememberWindow 开关都注册——会话记忆独立于窗口记忆
    void (async () => {
      try {
        unlisteners.push(
          await win.onCloseRequested(async () => {
            if (useSettingsStore.getState().settings.general.rememberWindow) {
              const patch = await snapWindow();
              if (patch) await useSettingsStore.getState().persist(patch);
            }
            await useSettingsStore.getState().persist({ session: sessionSnapshot() });
          }),
        );
      } catch (e) {
        console.warn("[window-memory] 关窗监听失败", e);
      }
    })();

    // 5) 启动恢复：上次项目 + 上次打开的标签页（openProject 失败会内部 toast；此处补验并清空坏记忆）
    const restoreSession = async () => {
      const cur = useSettingsStore.getState();
      if (!cur.settings.general.restoreLastProject) return;
      const root = cur.settings.session.lastProject;
      if (!root) return;
      // M1-15a：恢复期间抑制欢迎页（App 依此延后渲染），结束（含失败）务必复位
      useProjectStore.setState({ restoring: true });
      try {
        try {
          await useProjectStore.getState().openProject(root);
        } catch (e) {
          console.warn("[window-memory] 恢复上次项目失败", e);
        }
        if (useProjectStore.getState().root !== root) {
          // 打开失败：清除坏记忆（subscription 已可能写过，这里强制置空）
          void useSettingsStore.getState().persist({
            session: { lastProject: null, openFiles: [], activeFile: null },
          });
          notify("上次项目已不可用（已清空记忆）", "err");
          return;
        }
        // M0-13c：重开上次的编辑器标签页（按上次顺序；只恢复属于本项目的文件，
        // 跨项目残留/已删除的文件自然被过滤或在打开时给出提示）
        const { openFiles, activeFile } = cur.settings.session;
        const under = [...new Set(openFiles)].filter(
          (p) => p.startsWith(`${root}\\`) || p.startsWith(`${root}/`),
        );
        if (under.length > 0) {
          await useBuffersStore.getState().openFiles(under);
          if (activeFile && under.includes(activeFile)) {
            useBuffersStore.getState().setActive(activeFile);
          }
        }
      } finally {
        useProjectStore.setState({ restoring: false });
      }
    };
    void restoreSession();

    return () => {
      unsubscribeApp();
      unsubscribeProject();
      unsubscribeBuffers();
      unlisteners.forEach((fn) => fn());
    };
  }, [loaded]);
}
