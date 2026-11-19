// 顶部菜单栏（M0-13 前移）—— 对齐 docs/UI/code.html .menubar/.drop/.mi
// Windows/Linux：自绘菜单，条目与动作来自共享动作表 src/ui/menuActions.ts。
// macOS（M-macos-menu）：菜单全部迁移到系统原生菜单栏（Rust native_menu.rs），
// 动作经 nativeMenuBridge.ts 事件桥分发到同一份动作表；顶条精简为
// 「交通灯留位 + 居中项目名」（tauri.macos.conf.json 的 Overlay + hiddenTitle）。
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useBuffersStore } from "@/editor/useBuffers";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useProjectStore } from "@/project/useProject";
import { startCompile } from "@/compile/useCompile";
import { useUpdateStore, selectHasUpdate } from "@/modules/updater/updateStore";
import { useModuleViews } from "@/modules/useModuleList";
import { moduleRegistry } from "@/core/moduleRegistry";
import { MENU_GROUPS, toBarItem, type BarItem } from "./menuActions";
import { insertModuleViews } from "./menuOrder";
import { startNativeMenuBridge } from "./nativeMenuBridge";

interface MenuDef {
  label: string;
  items: BarItem[];
  /** 菜单按钮右上角红点（如：有可用更新） */
  dot?: boolean;
}

/** 自定义标题栏边缘缩放方向（Tauri startResizeDragging 的子集） */
type ResizeDir = "East" | "West" | "South" | "SouthEast" | "SouthWest";

/** 原生关闭确认放行标记：确认后再次 close 时不重复弹窗。 */
let closeApproved = false;
let closePromptOpen = false;

async function quitApp() {
  await getCurrentWindow().close();
}

export function MenuBar() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // ── 状态订阅：驱动菜单置灰/动态标签重渲染（动作表用 getState() 取快照，
  //    这些订阅保证状态变化时组件重渲染、菜单求值刷新）。 ──
  // M1-13：有可用更新时，帮助菜单按钮显示红点
  const hasUpdate = useUpdateStore(selectHasUpdate);
  // M1-8：模块自带视图（视图菜单动态项，Ctrl+B 5/6/7… 与其顺序对应）
  const moduleViews = useModuleViews();
  // 自定义标题栏：追踪最大化状态以切换金刚键图标（decorations:false 后无系统键）
  const [maximized, setMaximized] = useState(false);
  // macOS 进入系统全屏后原生交通灯会隐藏，此时菜单无需继续预留左侧空间。
  const [fullscreen, setFullscreen] = useState(false);

  // 纯驱动重渲染的订阅（不再直接读取值；见 menuActions.ts 置灰/标签求值）
  useBuffersStore((s) => s.activePath);
  useBuffersStore((s) => s.buffers.find((b) => b.path === s.activePath)?.kind ?? null);
  useAppStore((s) => s.sidebarVisible);
  useAppStore((s) => s.sidebarView);
  useAppStore((s) => s.logVisible);
  useAppStore((s) => s.previewVisible);
  useAppStore((s) => s.compileStatus);
  useAppStore((s) => s.lastResult?.logPath);
  useProjectStore((s) => !!s.tree?.mainFile);
  const root = useProjectStore((s) => s.root);
  useSettingsStore((s) => s.settings.general.theme);
  useSettingsStore((s) => s.effectiveTheme);
  // 模块视图变化（useModuleViews 内部订阅注册表）
  const sidebarVisible = useAppStore.getState().sidebarVisible;
  const sidebarView = useAppStore.getState().sidebarView;

  // M-macos-menu：macOS 顶条精简形态（交通灯留位 + 居中项目名；菜单在系统菜单栏）
  const isMac = __TAURI_PLATFORM__ === "darwin";
  const projectName = root
    ? (root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? null)
    : null;

  // 统一接管窗口关闭请求：macOS 原生红色按钮、系统快捷键和自绘关闭键均走同一保护。
  useEffect(() => {
    const w = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;
    void w
      .onCloseRequested(async (event) => {
        if (closeApproved) return;
        const dirty = useBuffersStore.getState().dirtyCount();
        if (dirty === 0) return;

        event.preventDefault();
        if (closePromptOpen) return;
        closePromptOpen = true;
        try {
          const ok = await confirm(`有 ${dirty} 个文件尚未保存，仍要退出吗？`, {
            title: "退出 Zetla",
            kind: "warning",
          });
          if (!ok) return;
          closeApproved = true;
          try {
            await w.close();
          } catch (e) {
            closeApproved = false;
            throw e;
          }
        } finally {
          closePromptOpen = false;
        }
      })
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const refreshWindowState = () => {
      void Promise.all([w.isMaximized(), w.isFullscreen()]).then(
        ([nextMaximized, nextFullscreen]) => {
          setMaximized(nextMaximized);
          setFullscreen(nextFullscreen);
        },
      );
    };
    refreshWindowState();
    void w
      .onResized(() => {
        refreshWindowState();
      })
      .then((u) => {
        unlisten = u;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  // M-macos-menu：macOS 专属 —— 原生菜单事件桥 + 系统级窗口标题（Mission Control /
  // 窗口列表显示「项目名 — Zetla」；顶条内可见的项目名由 darwin-title 自绘）
  useEffect(() => {
    if (__TAURI_PLATFORM__ !== "darwin") return;
    startNativeMenuBridge();
    const w = getCurrentWindow();
    const syncTitle = () => {
      const root = useProjectStore.getState().root;
      const name = root
        ? root.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
        : null;
      void w.setTitle(name ? `${name} — Zetla` : "Zetla");
    };
    syncTitle();
    let prevRoot: string | null = useProjectStore.getState().root;
    return useProjectStore.subscribe((s) => {
      if (s.root !== prevRoot) {
        prevRoot = s.root;
        syncTitle();
      }
    });
  }, []);


  // M-macos-menu：菜单结构来自共享动作表（menuActions.ts，与 macOS 原生菜单同源）
  const menus: MenuDef[] = MENU_GROUPS.map((g) => {
    const staticItems: BarItem[] = g.items.map((e) =>
      e === "sep" ? { sep: true, label: "" } : toBarItem(e),
    );
    // M1-8 / M1-30：模块视图编号 5 起，插在静态视图项之后、第一个分隔线之前；
    // 顺序与 Ctrl+B 5/6/7… 的 moduleRegistry.listViews() 映射同源。
    const moduleItems: BarItem[] =
      g.id === "view"
        ? moduleViews.map((mv, i) => ({
            label: `${
              sidebarVisible && sidebarView === mv.view.id ? "✓ " : ""
            }${mv.view.label}`,
            sc: `Ctrl+B ${5 + i}`,
            onClick: () => useAppStore.getState().setSidebarView(mv.view.id),
          }))
        : [];
    return {
      label: g.label,
      dot: g.id === "help" && hasUpdate,
      items: insertModuleViews(staticItems, moduleItems),
    };
  });

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
        // M1-28：Ctrl+B 1/3/4 直达活动栏视图（资源管理器 / 公式 / 引用）；2 原为大纲，已移除
        if (e.key === "1" || e.key === "3" || e.key === "4") {
          e.preventDefault();
          clearChord();
          const v = e.key === "1" ? "explorer" : e.key === "3" ? "math" : "references";
          useAppStore.getState().setSidebarView(v);
          return;
        }
        // 保留 2 空缺：按了不做事，但要取消 chord 状态（否则后续按键像仍在 Ctrl+B 连招中）
        if (e.key === "2") {
          e.preventDefault();
          clearChord();
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
      if (k === "r") {
        // M1-15b：项目切换器（Ctrl+R 开关；阻止 WebView 默认刷新）
        e.preventDefault();
        const st = useProjectStore.getState();
        if (st.switcherOpen) st.closeSwitcher();
        else st.openSwitcher();
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

  function runItem(it: BarItem) {
    setOpenIdx(null);
    if (it.enabled === false) return;
    it.onClick?.();
  }

  // ── 自定义窗口控制（替代系统标题栏的金刚键） ──
  const appWindow = getCurrentWindow();

  function minimizeWindow() {
    void appWindow.minimize();
  }

  function toggleMaximizeWindow() {
    if (maximized) void appWindow.unmaximize();
    else void appWindow.maximize();
  }

  /** 自定义窗口缩放边：在 decorations:false 下补足系统边缘缩放 */
  function startResizeDragging(e: ReactMouseEvent, dir: ResizeDir) {
    e.preventDefault();
    void appWindow.startResizeDragging(dir);
  }

  /** 中区拖拽：按下并移动超过阈值才发起窗口移动（避免与双击最大化冲突） */
  function onSpacerMouseDown(e: ReactMouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const onMove = (ev: MouseEvent) => {
      if (started) return;
      if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
        started = true;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        void appWindow.startDragging();
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <>
      <div
        className={fullscreen ? "menubar is-fullscreen" : "menubar"}
        ref={barRef}
        role={isMac ? undefined : "menubar"}
      >
        {isMac ? (
          <>
            {/* 左区：交通灯留位（Overlay 交通灯由系统绘制在 (14,16)） */}
            <div className="darwin-tl-spacer" aria-hidden="true" />
            {/* 中区：项目名居中（hiddenTitle:true，系统不绘制原生标题） */}
            <div
              className="darwin-title"
              onMouseDown={onSpacerMouseDown}
              onDoubleClick={toggleMaximizeWindow}
              title={projectName ?? "Zetla"}
            >
              {projectName ?? "Zetla"}
            </div>
          </>
        ) : (
          <>
            {/* 左区：logo + 菜单 */}
            <img className="nav-logo" src="/logo.svg" alt="Zetla" draggable={false} />
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
          </>
        )}
        {/* 中区：空白拖拽区（仅此区可拖动窗口，避免误触按钮；双击切换最大化） */}
        <div
          className="nav-spacer"
          onMouseDown={onSpacerMouseDown}
          onDoubleClick={toggleMaximizeWindow}
          title={isMac ? undefined : "拖动移动窗口 · 双击最大化 / 还原"}
        />
        {/* 右区：金刚键（macOS 用原生交通灯，不渲染） */}
        {!isMac && (
          <div className="win-ctl-group">
          <button
            type="button"
            className="win-ctl"
            title="最小化"
            aria-label="最小化"
            onClick={minimizeWindow}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1 9 H9" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            type="button"
            className="win-ctl"
            title={maximized ? "向下还原" : "最大化"}
            aria-label={maximized ? "向下还原" : "最大化"}
            onClick={toggleMaximizeWindow}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="2.5" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="win-ctl win-ctl-close"
            title="关闭"
            aria-label="关闭"
            onClick={() => void quitApp()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          </div>
        )}
      </div>
      {/* 自定义窗口缩放边（decorations:false 后系统边缘缩放失效，用 Tauri 原生拖拽缩放补足） */}
      <div className="resize-frame" aria-hidden="true">
        <div className="rz rz-w" onMouseDown={(e) => startResizeDragging(e, "West")} />
        <div className="rz rz-e" onMouseDown={(e) => startResizeDragging(e, "East")} />
        <div className="rz rz-s" onMouseDown={(e) => startResizeDragging(e, "South")} />
        <div className="rz rz-sw" onMouseDown={(e) => startResizeDragging(e, "SouthWest")} />
        <div className="rz rz-se" onMouseDown={(e) => startResizeDragging(e, "SouthEast")} />
      </div>
    </>
  );
}

export default MenuBar;
