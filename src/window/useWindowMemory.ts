// M0-13 · 窗口几何 / 布局 / 上次项目的记忆与恢复
// 启动（settings 加载完成后）：
//   1) applyLayout：侧栏/预览宽度与显隐 → useAppStore
//   2) applyWindow：LogicalSize/LogicalPosition（DPI 稳定）+ 最大化；位置不在任何显示器内则忽略
//   3) restoreSession：上次项目 openProject（失败静默清空 + toast，不阻塞启动）
// 运行期间：
//   - onResized/onMoved 500ms 防抖 → snap 记录 outer 几何（物理坐标 ÷ scaleFactor）
//   - 布局值（显隐/宽度/比例）useAppStore.subscribe 变化后防抖写盘
//   - project.root 变化 → session.lastProject 写盘（打开/切换/关闭项目时）
//   - onCloseRequested：关闭前补一次 flush（防抖尾巴可能没来得及写）
// 旁路写盘一律走 useSettingsStore.persist（以 persisted 为基底，避免串写设置页预览草稿）
import { useEffect } from "react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore, type AppState } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { notify, useProjectStore } from "@/project/useProject";
import type { AppSettings } from "@/types/settings";

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
            await win.setSize(new LogicalSize(w.width, w.height));
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
          unlisteners.push(
            await win.onCloseRequested(async () => {
              const patch = await snapWindow();
              if (patch) await useSettingsStore.getState().persist(patch);
            }),
          );
        } catch (e) {
          console.warn("[window-memory] 窗口事件监听失败", e);
        }
      })();
    }

    // 3) 布局变化 → 防抖旁路写盘（restoreLayout 关闭时不写，遵守用户设置）
    const layoutKey = (s: AppState): string =>
      `${s.sidebarVisible}|${s.sidebarWidth}|${s.previewVisible}|${s.previewRatio}|${s.pvSideWidth}`;
    const debouncedLayoutSave = debounce(500, () => {
      const s = useAppStore.getState();
      void useSettingsStore.getState().persist({
        layout: {
          sidebarVisible: s.sidebarVisible,
          sidebarWidth: s.sidebarWidth,
          previewVisible: s.previewVisible,
          previewRatio: s.previewRatio,
          pvSideWidth: s.pvSideWidth,
        },
      });
    });
    const unsubscribeApp = useAppStore.subscribe((s, prev) => {
      if (layoutKey(s) !== layoutKey(prev)) debouncedLayoutSave();
    });
    // 4) 项目切换 → session.lastProject 写盘（项目 store 的 root 是唯一权威）
    const unsubscribeProject = useProjectStore.subscribe((s, prev) => {
      if (s.root !== prev.root) {
        void useSettingsStore.getState().persist({ session: { lastProject: s.root } });
      }
    });

    // 5) 启动恢复上次项目（openProject 失败会内部 toast；此处补验并清空坏记忆）
    const restoreSession = async () => {
      const cur = useSettingsStore.getState();
      if (!cur.settings.general.restoreLastProject) return;
      const root = cur.settings.session.lastProject;
      if (!root) return;
      try {
        await useProjectStore.getState().openProject(root);
      } catch (e) {
        console.warn("[window-memory] 恢复上次项目失败", e);
      }
      if (useProjectStore.getState().root !== root) {
        // 打开失败：清除坏记忆（subscription 已可能写过，这里强制置空）
        void useSettingsStore.getState().persist({ session: { lastProject: null } });
        notify("上次项目已不可用（已清空记忆）", "err");
      }
    };
    void restoreSession();

    return () => {
      unsubscribeApp();
      unsubscribeProject();
      unlisteners.forEach((fn) => fn());
    };
  }, [loaded]);
}
