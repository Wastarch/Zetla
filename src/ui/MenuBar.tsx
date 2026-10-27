// 顶部菜单栏（M0-13 前移）—— 对齐 docs/UI/code.html .menubar/.drop/.mi
// 只接通已有能力；未到切片的功能置灰并在 tooltip 标注接通切片（编译 M0-9 已接、
// 日志解析 M0-11、PDF M0-10、设置/偏好 M0-14a 已接、明暗主题 M1-2 已接、
// Synctex 双向跳转 M1-4 已接）。撤销/重做/注释经
// 命令桥 src/editor/activeView.ts 派发 CM6 命令（复制/粘贴为 WebView 原生键盘能力）。
import { useEffect, useRef, useState } from "react";
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { redo, toggleComment, undo } from "@codemirror/commands";
import { getActiveView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { EXT_IMG, useProjectStore, notify } from "@/project/useProject";
import { cancelCompile, startCompile } from "@/compile/useCompile";
import { openEnvGuide } from "@/env/useEnvCheck";
import { jumpToPdfFromSource } from "@/preview/syncTex";
import { useUpdateStore, selectHasUpdate } from "@/modules/updater/updateStore";
import { useModuleViews } from "@/modules/useModuleList";
import { moduleRegistry } from "@/core/moduleRegistry";
import { importImageFromPaths } from "@/editor/image/importImage";
import { projectApi } from "@/ipc/invoke";

/** 菜单项：enabled=false 置灰并在 hover 时以 title 提示 */
interface MenuItemDef {
  label: string;
  /** 快捷键提示（仅真实已绑定/本切片新绑定的键才显示） */
  sc?: string;
  enabled?: boolean;
  /** 置灰原因（title 提示） */
  hint?: string;
  onClick?: () => void;
  sep?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItemDef[];
  /** 菜单按钮右上角红点（如：有可用更新） */
  dot?: boolean;
}

/** 有活动编辑器时才可执行编辑类命令 */
function withView(fn: (view: NonNullable<ReturnType<typeof getActiveView>>) => void) {
  const v = getActiveView();
  if (v) fn(v);
}

async function quitApp() {
  const bs = useBuffersStore.getState();
  const dirty = bs.dirtyCount();
  if (dirty > 0) {
    const ok = await confirm(`有 ${dirty} 个文件尚未保存，仍要退出吗？`, {
      title: "退出 Zetla",
      kind: "warning",
    });
    if (!ok) return;
  }
  await getCurrentWindow().close();
}

export function MenuBar() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 状态驱动菜单可用性（re-render 由 zustand 订阅触发）
  const activePath = useBuffersStore((s) => s.activePath);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  // M1-5a：侧栏视图（驱动菜单勾选与切换项）
  const sidebarView = useAppStore((s) => s.sidebarView);
  const logVisible = useAppStore((s) => s.logVisible);
  const previewVisible = useAppStore((s) => s.previewVisible);
  const running = useAppStore((s) => s.compileStatus === "running");
  const logPath = useAppStore((s) => s.lastResult?.logPath);
  const hasMain = useProjectStore((s) => !!s.tree?.mainFile);
  const hasProject = useProjectStore((s) => !!s.root);
  // M1-2b：主题设置值（是否 auto）与生效主题（驱动菜单标签/勾选）
  const themeSetting = useSettingsStore((s) => s.settings.general.theme);
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme);

  const canEdit = activePath !== null;
  // 当前活动标签是否为可编辑文本（图片/PDF 查看器时禁用编辑类命令，但「关闭标签」仍可用）
  const activeKind = useBuffersStore(
    (s) => s.buffers.find((b) => b.path === s.activePath)?.kind ?? null,
  );
  const canEditText = activeKind === "text";
  // M1-13：有可用更新时，帮助菜单按钮显示红点
  const hasUpdate = useUpdateStore(selectHasUpdate);
  // M1-8：模块自带视图（视图菜单动态项，Ctrl+B 5/6/7… 与其顺序对应）
  const moduleViews = useModuleViews();

  const menus: MenuDef[] = [
    {
      label: "文件",
      items: [
        {
          label: "新建项目…",
          sc: "Ctrl+Shift+N",
          onClick: () => useProjectStore.getState().openWizard(),
        },
        {
          label: "打开项目…",
          sc: "Ctrl+Shift+O",
          onClick: () => void useProjectStore.getState().openProjectDialog(),
        },
        {
          label: "打开图片 / PDF…",
          onClick: async () => {
            const picked = await openFileDialog({
              multiple: true,
              filters: [
                { name: "图片与 PDF", extensions: [...EXT_IMG, "pdf"] },
                { name: "图片", extensions: [...EXT_IMG] },
                { name: "PDF", extensions: ["pdf"] },
              ],
            });
            if (!picked) return;
            const paths = typeof picked === "string" ? [picked] : picked;
            // 图片/PDF 进入代码标签页查看器（不抢占右侧预览）
            await useBuffersStore.getState().openFiles(paths);
          },
        },
        {
          label: "关闭项目",
          enabled: hasProject,
          hint: "未打开项目",
          onClick: () => void useProjectStore.getState().closeProject(),
        },
        { sep: true, label: "" },
        {
          label: "保存",
          sc: "Ctrl+S",
          enabled: canEditText,
          hint: canEdit ? "当前标签为查看器，不可保存" : "未打开文档",
          onClick: () => {
            const p = useBuffersStore.getState().activePath;
            if (p) void useBuffersStore.getState().saveBuffer(p);
          },
        },
        {
          label: "全部保存",
          sc: "Ctrl+Shift+S",
          onClick: () => void useBuffersStore.getState().saveAllBuffers(),
        },
        { sep: true, label: "" },
        {
          label: "关闭标签",
          sc: "Ctrl+W",
          enabled: canEdit,
          hint: "未打开文档",
          onClick: () => {
            const p = useBuffersStore.getState().activePath;
            if (p) void useBuffersStore.getState().closeBuffer(p);
          },
        },
        { label: "退出", sc: "Alt+F4", onClick: () => void quitApp() },
      ],
    },
    {
      label: "编辑",
      items: [
        {
          label: "撤销",
          sc: "Ctrl+Z",
          enabled: canEditText,
          hint: canEdit ? "当前标签为查看器，不可编辑" : "未打开文档",
          onClick: () => withView((v) => undo(v)),
        },
        {
          label: "重做",
          sc: "Ctrl+Y",
          enabled: canEditText,
          hint: canEdit ? "当前标签为查看器，不可编辑" : "未打开文档",
          onClick: () => withView((v) => redo(v)),
        },
        { sep: true, label: "" },
        {
          label: "复制",
          sc: "Ctrl+C",
          enabled: false,
          hint: "编辑区内已由键盘接管",
        },
        {
          label: "粘贴",
          sc: "Ctrl+V",
          enabled: false,
          hint: "编辑区内已由键盘接管",
        },
        { sep: true, label: "" },
        {
          label: "查找",
          sc: "Ctrl+F",
          enabled: false,
          hint: "查找面板另做（M1）",
        },
        {
          label: "替换",
          sc: "Ctrl+H",
          enabled: false,
          hint: "查找面板另做（M1）",
        },
        {
          label: "切换注释",
          sc: "Ctrl+/",
          enabled: canEditText,
          hint: canEdit ? "当前标签为查看器，不可编辑" : "未打开文档",
          onClick: () => withView((v) => toggleComment(v)),
        },
      ],
    },
    {
      label: "插入",
      items: [
        {
          label: "插入图片…",
          enabled: canEditText,
          hint: canEdit ? "当前标签为查看器，无法插入" : "未打开文档",
          onClick: async () => {
            const picked = await openFileDialog({
              multiple: true,
              filters: [{ name: "图片", extensions: [...EXT_IMG] }],
            });
            if (!picked) return;
            const paths = typeof picked === "string" ? [picked] : picked;
            await importImageFromPaths(paths);
          },
        },
        {
          // M1-8：表格编辑器（打开侧栏「表格」视图；模块停用时置灰）
          label: "表格编辑器…",
          sc: "Ctrl+B 5",
          enabled: moduleViews.some((mv) => mv.view.id === "table"),
          hint: "表格模块已停用（设置 → 模块）",
          onClick: () => useAppStore.getState().setSidebarView("table"),
        },
      ],
    },
    {
      label: "构建",
      items: [
        {
          label: "开始编译",
          sc: "Ctrl+B",
          enabled: hasMain && !running,
          hint: running
            ? "编译进行中"
            : "未打开项目或未识别主文件（.ltex/config.json）",
          onClick: () => void startCompile(),
        },
        {
          label: "终止编译",
          enabled: running,
          hint: "当前没有编译任务",
          onClick: () => void cancelCompile(),
        },
        { sep: true, label: "" },
        {
          // M1-9：清理 LaTeX 辅助文件（.aux/.log/.bbl/.blg/.toc/.out/.synctex.gz 等）
          label: "清理辅助文件",
          enabled: hasProject,
          hint: "未打开项目",
          onClick: async () => {
            const root = useProjectStore.getState().root;
            if (!root) return;
            try {
              const res = await projectApi.cleanAux(root);
              // 清理绕过 store，notify 刷新有时序延迟/编译态丢弃风险 → 先主动刷新资源树
              if (res.removed > 0) {
                await useProjectStore.getState().refresh(true);
              }
              notify(
                res.removed > 0
                  ? `已清理 ${res.removed} 个辅助文件`
                  : "没有需要清理的辅助文件",
                "ok",
              );
            } catch (e) {
              notify(String(e), "err");
            }
          },
        },
        {
          label: "编译并查看 PDF",
          enabled: hasMain && !running,
          hint: running ? "编译进行中" : "未打开项目或未识别主文件",
          onClick: () => {
            // 与「开始编译」的区别：先展开预览，编译成功后自动加载
            useAppStore.setState({ previewVisible: true });
            void startCompile();
          },
        },
      ],
    },
    {
      label: "视图",
      items: [
        {
          label: `${sidebarVisible ? "隐藏" : "显示"}侧栏`,
          sc: "Ctrl+B 0",
          onClick: () => useAppStore.getState().toggleSidebar(),
        },
        {
          // M1-5a：活动栏视图切换（等同点击左侧图标，但不会折叠）
          label: `${sidebarVisible && sidebarView === "explorer" ? "✓ " : ""}资源管理器`,
          sc: "Ctrl+B 1",
          onClick: () => useAppStore.getState().setSidebarView("explorer"),
        },
        {
          label: `${sidebarVisible && sidebarView === "outline" ? "✓ " : ""}大纲`,
          sc: "Ctrl+B 2",
          onClick: () => useAppStore.getState().setSidebarView("outline"),
        },
        {
          // M1-12a：符号面板与公式合并为「公式」单视图（内部 符号/公式库 两页签）
          label: `${sidebarVisible && sidebarView === "math" ? "✓ " : ""}公式`,
          sc: "Ctrl+B 3",
          onClick: () => useAppStore.getState().setSidebarView("math"),
        },
        {
          // M1-14f：引用管理面板
          label: `${sidebarVisible && sidebarView === "references" ? "✓ " : ""}引用`,
          sc: "Ctrl+B 4",
          onClick: () => useAppStore.getState().setSidebarView("references"),
        },
        // M1-8：模块自带视图动态项（表格等）；编号 5 起与 Ctrl+B 5/6/7… 顺序一致
        ...moduleViews.map((mv, i) => ({
          label: `${sidebarVisible && sidebarView === mv.view.id ? "✓ " : ""}${mv.view.label}`,
          sc: `Ctrl+B ${5 + i}`,
          onClick: () => useAppStore.getState().setSidebarView(mv.view.id),
        })),
        {
          label: `${previewVisible ? "隐藏" : "显示"} PDF 预览`,
          onClick: () => useAppStore.getState().togglePreview(),
        },
        {
          label: `${logVisible ? "隐藏" : "显示"}日志面板`,
          onClick: () => useAppStore.getState().toggleLog(),
        },
        { sep: true, label: "" },
        {
          // M1-4：synctex 正向跳转（也可在编辑器里 Ctrl/⌘+点击源码行）
          label: "跳到 PDF 中的位置",
          sc: "Ctrl+点击源码",
          enabled: hasMain,
          hint: "未打开项目或未识别主文件",
          onClick: () => {
            const bs = useBuffersStore.getState();
            if (!bs.activePath) return;
            void jumpToPdfFromSource(bs.activePath, bs.cursor.line, bs.cursor.col);
          },
        },
        { sep: true, label: "" },
        { label: "放大", enabled: false, hint: "缩放 M1" },
        { label: "缩小", enabled: false, hint: "缩放 M1" },
        { sep: true, label: "" },
        {
          // M1-2b：跟随系统（✓ 标记当前是否为 auto；点击从固定亮/暗切回跟随）
          label: `${themeSetting === "auto" ? "✓ " : ""}主题跟随系统`,
          hint:
            themeSetting === "auto"
              ? "当前跟随系统明暗，点击无变化"
              : "点击后跟随系统明暗（prefers-color-scheme）",
          onClick: () => useSettingsStore.getState().setTheme("auto"),
        },
        {
          // 切换项按生效主题取反：auto 时点击 = 固定为当前外观（退出跟随）
          label: effectiveTheme === "dark" ? "切换到亮色主题" : "切换到暗色主题",
          hint: themeSetting === "auto" ? "当前跟随系统，点击后固定外观" : undefined,
          onClick: () =>
            useSettingsStore.getState().setTheme(effectiveTheme === "dark" ? "light" : "dark"),
        },
      ],
    },
    {
      label: "模板",
      items: [
        {
          label: "从模板新建…",
          onClick: () => useProjectStore.getState().openWizard(),
        },
        { label: "管理本地模板", enabled: false, hint: "用户模板目录 M1" },
        { label: "导入模板包…", enabled: false, hint: "模板导入 M1" },
      ],
    },
    {
      label: "设置",
      items: [
        {
          label: "偏好设置",
          sc: "Ctrl+,",
          onClick: () => useAppStore.getState().openSettings("build"),
        },
        {
          label: "项目设置…",
          enabled: hasProject,
          hint: "未打开项目",
          onClick: () => useProjectStore.getState().openProjectSettings(),
        },
      ],
    },
    {
      label: "帮助",
      dot: hasUpdate,
      items: [
        {
          label: "检查更新",
          hint: "检测 GitHub / Gitee 上的新版本",
          onClick: () => {
            const st = useUpdateStore.getState();
            if (
              st.status === "update" ||
              st.status === "downloading" ||
              st.status === "downloaded"
            ) {
              useAppStore.getState().openSettings("about");
            } else {
              void st.check();
            }
          },
        },
        {
          label: "TeX 环境检测…",
          hint: "检测 TeX 发行版 / 打开环境引导",
          onClick: () => void openEnvGuide(),
        },
        { label: "编译快捷键速查", enabled: false, hint: "M1" },
        {
          label: "查看日志文件",
          enabled: !!logPath,
          hint: logPath ? "用默认程序打开本次编译的 .log" : "尚无编译日志（先编译一次）",
          onClick: () => {
            if (!logPath) return;
            void openPath(logPath).catch((e) => notify(String(e), "err"));
          },
        },
        { sep: true, label: "" },
        { label: "关于 Zetla", onClick: () => useAppStore.getState().openSettings("about") },
      ],
    },
  ];

  // 点击栏外 / Esc 关闭
  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openIdx]);

  // 全局快捷键（编辑器外也生效；编辑器内 Mod-s 由 CM 先行处理）
  useEffect(() => {
    // Ctrl+B 0 chord：Ctrl+B 后 1.2s 内按 0 → 切换资源树（VS Code 风格）
    let chordB = false;
    let chordTimer: number | undefined;
    const clearChord = () => {
      chordB = false;
      if (chordTimer !== undefined) window.clearTimeout(chordTimer);
    };

    const onKey = (e: KeyboardEvent) => {
      if (chordB) {
        const kb = e.key.toLowerCase();
        // 二次 Ctrl+B 视为「直接编译」，不等 chord 超时
        if ((e.ctrlKey || e.metaKey) && kb === "b") {
          e.preventDefault();
          clearChord();
          void startCompile();
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          clearChord();
          useAppStore.getState().toggleSidebar();
          return;
        }
        // M1-12a：Ctrl+B 1/2/3/4 直达活动栏视图（资源管理器 / 大纲 / 公式 / 引用）
        if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
          e.preventDefault();
          clearChord();
          const v =
            e.key === "1"
              ? "explorer"
              : e.key === "2"
                ? "outline"
                : e.key === "3"
                  ? "math"
                  : "references";
          useAppStore.getState().setSidebarView(v);
          return;
        }
        // M1-8：Ctrl+B 5/6/7… 直达模块自带视图（顺序与「视图」菜单动态项一致）
        if (e.key >= "5" && e.key <= "9") {
          const mv = moduleRegistry.listViews()[Number(e.key) - 5];
          if (mv) {
            e.preventDefault();
            clearChord();
            useAppStore.getState().setSidebarView(mv.view.id);
            return;
          }
        }
        // 其它键：取消 chord，继续按普通快捷键处理
        clearChord();
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey) {
        if (k === "n") {
          e.preventDefault();
          useProjectStore.getState().openWizard();
        } else if (k === "o") {
          e.preventDefault();
          void useProjectStore.getState().openProjectDialog();
        } else if (k === "s") {
          e.preventDefault();
          void useBuffersStore.getState().saveAllBuffers();
        }
        return;
      }
      if (k === "b") {
        // Ctrl+B 单键 → 编译；1.2s 内接 0 → 切资源树（VS Code 风格 chord）
        e.preventDefault();
        chordB = true;
        chordTimer = window.setTimeout(() => {
          chordB = false;
          chordTimer = undefined;
          void startCompile();
        }, 1200);
        return;
      }
      if (k === "w") {
        e.preventDefault();
        const p = useBuffersStore.getState().activePath;
        if (p) void useBuffersStore.getState().closeBuffer(p);
      }
      if (k === ",") {
        // M0-14a：偏好设置（mockup 快捷键 Ctrl+,）
        e.preventDefault();
        useAppStore.getState().openSettings("build");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearChord();
    };
  }, []);

  function runItem(it: MenuItemDef) {
    setOpenIdx(null);
    if (it.enabled === false) return;
    it.onClick?.();
  }

  return (
    <>
      <div className="menubar" ref={barRef} role="menubar">
        {menus.map((m, i) => (
          <div
            key={m.label}
            className={openIdx === i ? "menu open" : "menu"}
            onMouseEnter={() => {
              if (openIdx !== null) setOpenIdx(i); // 已展开时 hover 切换
            }}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openIdx === i}
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
            >
              {m.label}
              {m.dot && <span className="menu-dot" aria-label="有可用更新" />}
            </button>
            <div className="drop" role="menu">
              {m.items.map((it, j) =>
                it.sep ? (
                  <div key={j} className="msep" />
                ) : (
                  <button
                    key={j}
                    type="button"
                    role="menuitem"
                    className={it.enabled === false ? "mi off" : "mi"}
                    title={it.enabled === false ? it.hint : undefined}
                    onClick={() => runItem(it)}
                  >
                    <span>{it.label}</span>
                    {it.sc && <span className="sc">{it.sc}</span>}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default MenuBar;
