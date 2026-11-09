// 日志面板 · 内置终端页（feat/terminal）
// xterm.js ⇄ Rust portable-pty（ConPTY/pty）会话。输入 base64 上行、输出事件下行；
// 会话由后端持有，本组件卸载（面板销毁/应用关闭）时才 kill。
// 主题：跟随 <html data-theme> 从 CSS token 取色（xterm 画布认不了 var()，须解析成具体色值）。
// M1-22：字体/字号/光标/回滚/复制粘贴/默认目录走设置页「编辑器 → 终端」；
// 字体/字号/光标/主题热更新（term.options），回滚行数建会话时生效。
// M1-23：VSCode 式多会话 —— 每个会话独立 xterm 实例（切会话只显隐，不销毁缓冲与 PTY）；
// 会话 ≥2 时在终端区右侧出现竖列表切换；不再显示会话 id。
// M1-24：去掉顶部条与 shell 名标签，操作按钮（+ / ▾ / 清屏 / 关闭）经 portal
// 渲染到日志页签栏右端（仅终端页签激活时可见）。
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useProjectStore } from "@/project/useProject";
import { useSettingsStore } from "@/core/settings";
import { terminalApi } from "@/ipc/invoke";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import { Icon } from "@/ui/Icon";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { editorFontStack, type TerminalSettings } from "@/types/settings";
import type { TerminalExitEvent, TerminalOutputEvent } from "@/types";

/** 键盘输入字节 → base64（上行量小，逐字节拼接即可） */
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** base64 → 输出字节（xterm.write 接受 Uint8Array，保留原始字节流不转字符串） */
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** CSS token → xterm 画布可用色值（带兜底，样式未就绪时不至于黑底黑字） */
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function termTheme(): ITheme {
  return {
    background: cssVar("--bg-2", "#191c21"),
    foreground: cssVar("--txt-2", "#ebebeb"),
    cursor: cssVar("--accent", "#5b9dff"),
    cursorAccent: cssVar("--bg", "#14161a"),
    selectionBackground: cssVar("--sel", "rgba(91, 157, 255, 0.24)"),
  };
}

/** 终端字体栈：终端设置字体优先；空串 = 跟随编辑器字体（editorFontStack 内含去空白与兜底链） */
function termFontStack(t: TerminalSettings, editorFamily: string): string {
  return editorFontStack(t.fontFamily.trim() || editorFamily);
}

/** fire-and-forget 调用：会话可能已被回收（退出/关闭），吞掉 rejection 避免 unhandled 噪音 */
function fire(p: Promise<unknown>): void {
  p.catch(() => {});
}

/** 一个前端侧会话（xterm 实例 + 后端 id + 会话级显示态） */
interface TermTab {
  key: string;
  /** 后端会话 id（创建中为 null） */
  id: number | null;
  /** shell 名（标题基数，如 powershell） */
  baseTitle: string;
  /** 展示标题（同名会话加序号，关闭后重排） */
  title: string;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  exited: boolean;
  starting: boolean;
  /** 会话未就绪时的按键缓存 */
  pending: Uint8Array[];
  /** Ctrl+滚轮缩放后的会话字号（不回写设置） */
  localFontSize: number;
  /** 上次已同步给 pty 的行列（重复尺寸不再发 resize） */
  sentRows: number;
  sentCols: number;
  /** 解除监听 + 移除宿主节点 */
  cleanup: () => void;
}

/** 渲染用的会话元信息（只含 UI 需要的字段，避免把 xterm 实例塞进 state） */
interface TermMeta {
  key: string;
  title: string;
  exited: boolean;
  starting: boolean;
}

export function TerminalPane({
  active,
  actionsSlot,
}: {
  active: boolean;
  /** 操作按钮落点（日志页签栏右端）；null 时按钮不渲染 */
  actionsSlot?: HTMLElement | null;
}) {
  const hostsRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<TermTab[]>([]);
  const seqRef = useRef(0);
  const [metas, setMetas] = useState<TermMeta[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  // 供回调读取最新值，避免把 active 塞进 useCallback 依赖导致函数重建（重建会重挂所有会话）
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
    // 切走页签时收起操作菜单（按钮随页签栏一起隐藏，菜单不该留在屏幕上）
    if (!active) setMenuAt(null);
  }, [active]);

  // 输出按帧批处理：同一会话每帧最多 write 一次，洪泛输出不会把渲染主线程打满
  const writeQueuesRef = useRef(new Map<string, Uint8Array[]>());
  const flushScheduledRef = useRef(false);

  const flushWrites = useCallback(() => {
    flushScheduledRef.current = false;
    const queues = writeQueuesRef.current;
    if (queues.size === 0) return;
    const entries = [...queues];
    queues.clear();
    for (const [key, chunks] of entries) {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab || chunks.length === 0) continue;
      let total = 0;
      for (const c of chunks) total += c.length;
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      try {
        tab.term.write(merged);
      } catch {
        // 实例已销毁（会话刚被关闭），丢弃这一帧
      }
    }
  }, []);

  const enqueueWrite = useCallback(
    (key: string, bytes: Uint8Array) => {
      const q = writeQueuesRef.current.get(key);
      if (q) q.push(bytes);
      else writeQueuesRef.current.set(key, [bytes]);
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        requestAnimationFrame(flushWrites);
      }
    },
    [flushWrites],
  );

  const syncMetas = useCallback(() => {
    setMetas(
      tabsRef.current.map((t) => ({
        key: t.key,
        title: t.title,
        exited: t.exited,
        starting: t.starting,
      })),
    );
  }, []);

  /** 同名会话重新编号：powershell / powershell 2 / powershell 3… */
  const retitle = useCallback(() => {
    const counts = new Map<string, number>();
    for (const t of tabsRef.current) {
      const n = (counts.get(t.baseTitle) ?? 0) + 1;
      counts.set(t.baseTitle, n);
      t.title = n === 1 ? t.baseTitle : `${t.baseTitle} ${n}`;
    }
  }, []);

  /** 按宿主实际尺寸 refit；尺寸没变就不给后端发 resize（拖拽时避免每帧一次） */
  const fitTab = useCallback((tab: TermTab) => {
    if (!tab.host.isConnected || !tab.term.element) return;
    try {
      // FitAddon 在 0 尺寸（面板收起/隐藏）时自带 no-op，不必先测 DOM 尺寸
      tab.fit.fit();
    } catch {
      return; // fit 在极致尺寸下会抛错，忽略本次
    }
    if (tab.id === null || tab.exited) return;
    const { rows, cols } = tab.term;
    if (rows === tab.sentRows && cols === tab.sentCols) return;
    tab.sentRows = rows;
    tab.sentCols = cols;
    fire(terminalApi.resizeTerminal(tab.id, rows, cols));
  }, []);

  /** 上行通道：会话未就绪时缓存（拼进最后一块避免拆散多字节序列），就绪后直写 */
  const sendInput = useCallback((tab: TermTab, data: string) => {
    const bytes = new TextEncoder().encode(data);
    if (tab.id === null || tab.exited) {
      const p = tab.pending;
      const last = p[p.length - 1];
      if (last) {
        const merged = new Uint8Array(last.length + bytes.length);
        merged.set(last, 0);
        merged.set(bytes, last.length);
        p[p.length - 1] = merged;
      } else {
        p.push(bytes);
      }
      return;
    }
    fire(terminalApi.writeTerminal(tab.id, bytesToB64(bytes)));
  }, []);

  /** 起一个后端会话并挂到指定 tab 上（新建 / 重开共用） */
  const startBackend = useCallback(
    (tab: TermTab) => {
      const s = useSettingsStore.getState().settings;
      tab.id = null;
      tab.pending = [];
      writeQueuesRef.current.delete(tab.key);
      tab.exited = false;
      tab.starting = true;
      syncMetas();
      // M1-22：默认工作目录（home 模式传 null，后端回退用户主目录）
      const root =
        s.terminal.defaultCwd === "home" ? null : useProjectStore.getState().root;
      // 建会话用的行列即 pty 初始尺寸，记下来避免立刻多发一次 resize
      const rows = tab.term.rows;
      const cols = tab.term.cols;
      tab.sentRows = rows;
      tab.sentCols = cols;
      // 兜底：后端万一被卡住（ConPTY/conhost 异常），别让界面一直停在「启动中」
      const guard = window.setTimeout(() => {
        if (tab.id !== null || !tabsRef.current.includes(tab)) return;
        tab.starting = false;
        tab.exited = true;
        tab.term.writeln("\x1b[33m[终端启动超时：后端 15 秒未返回，可点「重开终端」重试]\x1b[0m");
        syncMetas();
      }, 15000);
      terminalApi
        .createTerminal(root, rows, cols)
        .then((created) => {
          window.clearTimeout(guard);
          // 创建期间已被关闭：立刻回收后端进程
          if (!tabsRef.current.includes(tab)) {
            fire(terminalApi.killTerminal(created.id));
            return;
          }
          tab.id = created.id;
          tab.baseTitle = created.shell;
          tab.starting = false;
          retitle();
          syncMetas();
          // 创建期间面板可能被拖动过，补齐尺寸
          fitTab(tab);
          for (const chunk of tab.pending) {
            fire(terminalApi.writeTerminal(created.id, bytesToB64(chunk)));
          }
          tab.pending = [];
        })
        .catch((e: unknown) => {
          window.clearTimeout(guard);
          if (!tabsRef.current.includes(tab)) return;
          tab.starting = false;
          tab.exited = true;
          const msg = e instanceof Error ? e.message : String(e);
          tab.term.writeln(`\x1b[31m终端启动失败：${msg}\x1b[0m`);
          syncMetas();
        });
    },
    [fitTab, retitle, syncMetas],
  );

  /** 新建一个会话（DOM 同步可见 → fit → 起后端） */
  const createTab = useCallback(() => {
    const hosts = hostsRef.current;
    if (!hosts) return;
    const s = useSettingsStore.getState().settings;

    const host = document.createElement("div");
    host.className = "term-host";
    hosts.appendChild(host)

    const term = new Terminal({
      fontFamily: termFontStack(s.terminal, s.editor.fontFamily),
      fontSize: s.terminal.fontSize,
      lineHeight: 1.2,
      cursorBlink: s.terminal.cursorBlink,
      cursorStyle: s.terminal.cursorStyle,
      scrollback: s.terminal.scrollback,
      allowProposedApi: true,
      theme: termTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const key = `t${++seqRef.current}`;
    const tab: TermTab = {
      key,
      id: null,
      baseTitle: "terminal",
      title: "terminal",
      term,
      fit,
      host,
      exited: false,
      starting: true,
      pending: [],
      localFontSize: s.terminal.fontSize,
      sentRows: 0,
      sentCols: 0,
      cleanup: () => {},
    };

    // 键盘输入上行
    const dataDisposable = term.onData((d) => sendInput(tab, d));

    // M1-22：选中文本自动复制
    const selDisposable = term.onSelectionChange(() => {
      if (!useSettingsStore.getState().settings.terminal.copyOnSelect) return;
      const sel = term.getSelection();
      if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
    });

    // M1-22：右键粘贴（读剪贴板 → 上行；多行粘贴交给 shell 的括号粘贴模式）
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      if (!useSettingsStore.getState().settings.terminal.rightClickPaste) return;
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) sendInput(tab, text);
        })
        .catch(() => {});
    };
    host.addEventListener("contextmenu", onContextMenu);

    // M1-22：Ctrl+滚轮缩放终端字号（仅本会话显示，不写回设置）
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      tab.localFontSize = Math.min(24, Math.max(8, tab.localFontSize + (ev.deltaY < 0 ? 1 : -1)));
      term.options.fontSize = tab.localFontSize;
      fitTab(tab);
    };
    host.addEventListener("wheel", onWheel, { passive: false });

    // 尺寸自适应（面板拖高 / 窗口缩放 / 会话切回）
    // 用回调给的 contentRect 判断，不在回调里读 clientWidth（会强制同步重排）
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (!box || box.width < 10 || box.height < 10) return;
      fitTab(tab);
    });
    ro.observe(host);

    tab.cleanup = () => {
      dataDisposable.dispose();
      selDisposable.dispose();
      ro.disconnect();
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("wheel", onWheel);
      host.remove();
    };

    tabsRef.current.push(tab);
    retitle();
    // 立即切到新会话（DOM 同步，React effect 随后保持一致）
    for (const t of tabsRef.current) t.host.style.display = t === tab ? "" : "none";
    setActiveKey(key);
    fitTab(tab);
    syncMetas();
    if (activeRef.current) term.focus();
    startBackend(tab);
  }, [fitTab, retitle, sendInput, startBackend, syncMetas]);

  /** 关闭会话（kill 后端 + 销毁 xterm + 移除宿主） */
  const closeTab = useCallback(
    (key: string) => {
      const tabs = tabsRef.current;
      const idx = tabs.findIndex((t) => t.key === key);
      if (idx < 0) return;
      const tab = tabs[idx];
      if (tab.id !== null) fire(terminalApi.killTerminal(tab.id));
      writeQueuesRef.current.delete(key);
      tab.cleanup();
      tab.term.dispose();
      tabs.splice(idx, 1);
      retitle();
      setActiveKey((prev) => {
        if (prev !== key) return prev;
        const next = tabs[Math.min(idx, tabs.length - 1)];
        return next ? next.key : "";
      });
      syncMetas();
    },
    [retitle, syncMetas],
  );

  /** 重开终端（杀旧会话、清屏、起新会话） */
  const restartTab = useCallback(
    (key: string) => {
      const tab = tabsRef.current.find((t) => t.key === key);
      if (!tab) return;
      if (tab.id !== null) fire(terminalApi.killTerminal(tab.id));
      tab.term.reset();
      startBackend(tab);
      tab.term.focus();
    },
    [startBackend],
  );

  const clearTab = useCallback((key: string) => {
    const tab = tabsRef.current.find((t) => t.key === key);
    tab?.term.clear();
    tab?.term.focus();
  }, []);

  const closeAll = useCallback(() => {
    for (const t of [...tabsRef.current]) closeTab(t.key);
  }, [closeTab]);

  // 输出/退出事件：按后端 id 分发到对应会话
  useEffect(() => {
    let disposed = false;
    let unlistenOut: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    void onKernelEvent<TerminalOutputEvent>(RustEvents.terminalOutput, (p) => {
      const tab = tabsRef.current.find((t) => t.id === p.id);
      if (tab) enqueueWrite(tab.key, b64ToBytes(p.data));
    }).then((fn) => {
      if (disposed) fn();
      else unlistenOut = fn;
    });
    void onKernelEvent<TerminalExitEvent>(RustEvents.terminalExit, (p) => {
      const tab = tabsRef.current.find((t) => t.id === p.id);
      if (!tab) return;
      tab.exited = true;
      const code = p.code === null ? "未知" : p.code;
      enqueueWrite(
        tab.key,
        new TextEncoder().encode(`\r\n\x1b[90m[进程已退出 · 代码 ${code}]\x1b[0m`),
      );
      syncMetas();
    }).then((fn) => {
      if (disposed) fn();
      else unlistenExit = fn;
    });

    // 首个会话
    createTab();

    return () => {
      disposed = true;
      unlistenOut?.();
      unlistenExit?.();
      for (const t of [...tabsRef.current]) {
        if (t.id !== null) fire(terminalApi.killTerminal(t.id));
        t.cleanup();
        t.term.dispose();
      }
      tabsRef.current = [];
    };
  }, [createTab, enqueueWrite, syncMetas]);

  // 主题跟随 <html data-theme>：所有会话统一换色（xterm 画布不认 CSS 变量）
  useEffect(() => {
    const mo = new MutationObserver(() => {
      const st = useSettingsStore.getState().settings;
      for (const t of tabsRef.current) {
        t.term.options.theme = termTheme();
        t.term.options.fontFamily = termFontStack(st.terminal, st.editor.fontFamily);
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  // M1-22：设置热更新（字体/字号/光标/回滚），应用到全部会话
  useEffect(() => {
    return useSettingsStore.subscribe((s, prev) => {
      const t = s.settings.terminal;
      const p = prev.settings.terminal;
      const changed =
        t !== p || s.settings.editor.fontFamily !== prev.settings.editor.fontFamily;
      if (!changed) return;
      for (const tab of tabsRef.current) {
        tab.term.options.fontFamily = termFontStack(t, s.settings.editor.fontFamily);
        tab.term.options.fontSize = t.fontSize;
        tab.localFontSize = t.fontSize;
        tab.term.options.cursorBlink = t.cursorBlink;
        tab.term.options.cursorStyle = t.cursorStyle;
        tab.term.options.scrollback = t.scrollback;
        fitTab(tab);
      }
    });
  }, [fitTab]);

  // 活动会话切换 / 页签切回：显隐 + refit + 聚焦
  useEffect(() => {
    for (const t of tabsRef.current) {
      t.host.style.display = t.key === activeKey ? "" : "none";
    }
    const cur = tabsRef.current.find((t) => t.key === activeKey);
    if (!cur) return;
    const raf = requestAnimationFrame(() => {
      fitTab(cur);
      if (activeRef.current) cur.term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeKey, active, fitTab]);

  const activeMeta = metas.find((m) => m.key === activeKey) ?? null;
  const menuActions: CtxAction[] = [
    { label: "新建终端", onClick: createTab },
    {
      label: "清屏",
      disabled: !activeMeta,
      onClick: () => activeMeta && clearTab(activeMeta.key),
    },
    {
      label: "重开终端",
      disabled: !activeMeta,
      onClick: () => activeMeta && restartTab(activeMeta.key),
    },
    {
      label: "关闭终端",
      disabled: !activeMeta,
      onClick: () => activeMeta && closeTab(activeMeta.key),
    },
    {
      label: "关闭所有终端",
      disabled: metas.length === 0,
      onClick: closeAll,
    },
  ];

  return (
    <>
      {/* 操作按钮挂到日志页签栏右端（TerminalPane 拥有状态与动作，LogPanel 只给落点） */}
      {actionsSlot &&
        createPortal(
          <>
            <button type="button" className="term-act" title="新建终端" onClick={createTab}>
              <Icon name="plus" size={13} />
            </button>
            <button
              type="button"
              className={`term-act${menuAt ? " on" : ""}`}
              title="终端操作"
              onClick={(e) => {
                if (menuAt) {
                  setMenuAt(null);
                  return;
                }
                const r = e.currentTarget.getBoundingClientRect();
                // 菜单靠按钮右缘对齐并夹在窗口内（避免贴右端时溢出）
                setMenuAt({ x: Math.max(8, r.right - 206), y: r.bottom + 4 });
              }}
            >
              <Icon name="chev" size={13} />
            </button>
            <span className="term-sep" />
            <button
              type="button"
              className="term-act"
              title="清屏"
              disabled={!activeMeta}
              onClick={() => activeMeta && clearTab(activeMeta.key)}
            >
              <Icon name="eraser" size={13} />
            </button>
            <button
              type="button"
              className="term-act"
              title="关闭终端"
              disabled={!activeMeta}
              onClick={() => activeMeta && closeTab(activeMeta.key)}
            >
              <Icon name="x" size={13} />
            </button>
          </>,
          actionsSlot,
        )}

      <div className="term-slot">
        <div className="term-body">
          <div className="term-hosts" ref={hostsRef} />
          {metas.length > 1 && (
            <div className="term-sessions">
              {metas.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`term-ses${m.key === activeKey ? " on" : ""}${m.exited ? " dead" : ""}`}
                  title={m.title}
                  onClick={() => setActiveKey(m.key)}
                >
                  <Icon name="terminal" size={12} />
                  <span className="term-ses-name">{m.title}</span>
                </button>
              ))}
            </div>
          )}
          {metas.length === 0 && (
            <div className="term-empty">
              <span>没有终端会话</span>
              <button type="button" className="term-empty-btn" onClick={createTab}>
                新建终端
              </button>
            </div>
          )}
        </div>
      </div>

      {menuAt && (
        <InsertCtxMenu
          x={menuAt.x}
          y={menuAt.y}
          actions={menuActions}
          onClose={() => setMenuAt(null)}
        />
      )}
    </>
  );
}

export default TerminalPane;
