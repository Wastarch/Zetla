// 日志面板 · 内置终端页（feat/terminal）
// xterm.js ⇄ Rust portable-pty（ConPTY/pty）会话。输入 base64 上行、输出事件下行；
// 会话由后端持有，本组件卸载（面板销毁/应用关闭）时才 kill。
// 主题：跟随 <html data-theme> 从 CSS token 取色（xterm 画布认不了 var()，须解析成具体色值）。
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useProjectStore } from "@/project/useProject";
import { terminalApi } from "@/ipc/invoke";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import { Icon } from "@/ui/Icon";
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

const FONT_MONO_FALLBACK = "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace";

export function TerminalPane({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const exitedRef = useRef(true);
  // 首次会话创建前的输入先缓存，会话就绪后一次性写入（避免开头几个键丢失）
  const pendingInputRef = useRef<Uint8Array[]>([]);

  const [cwd, setCwd] = useState<string>("");
  const [shell, setShell] = useState<string>("");
  const [starting, setStarting] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  /** 创建后端会话并接上当前 xterm（重启/首次挂载共用） */
  const startSession = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    setStarting(true);
    setErrorMsg("");
    exitedRef.current = false;
    const root = useProjectStore.getState().root;
    if (root) setCwd(root);
    terminalApi
      .createTerminal(root, term.rows, term.cols)
      .then((created) => {
        sessionIdRef.current = created.id;
        setShell(created.shell);
        setStarting(false);
        term.writeln(`\x1b[90m${created.shell} · 会话 #${created.id}\x1b[0m`);
        // 补写会话就绪前缓存的按键
        const pending = pendingInputRef.current;
        pendingInputRef.current = [];
        for (const chunk of pending) {
          void terminalApi.writeTerminal(created.id, bytesToB64(chunk));
        }
      })
      .catch((e: unknown) => {
        setStarting(false);
        exitedRef.current = true;
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg);
        term.writeln(`\x1b[31m终端启动失败：${msg}\x1b[0m`);
      });
  }, []);

  // 挂载：建 xterm 实例 + 订阅输出/退出事件 + 尺寸自适应 + 主题跟随
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: cssVar("--font-mono", FONT_MONO_FALLBACK),
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: termTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // 尺寸自适应：面板拖高 / 窗口缩放 / 页签切回（0→有宽度）都会触发
    const ro = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return; // 隐藏态跳过
      try {
        fit.fit();
        const id = sessionIdRef.current;
        if (id !== null && !exitedRef.current) {
          void terminalApi.resizeTerminal(id, term.rows, term.cols);
        }
      } catch {
        // fit 在极小尺寸下可能抛错，忽略本次
      }
    });
    ro.observe(host);
    try {
      fit.fit();
    } catch {
      /* 首帧尺寸为 0 时忽略 */
    }

    // 键盘输入上行
    const dataDisposable = term.onData((data) => {
      const id = sessionIdRef.current;
      const bytes = new TextEncoder().encode(data);
      if (id === null || exitedRef.current) {
        // 会话未就绪：缓存（拼进最后一个块避免拆散多字节序列）
        const pending = pendingInputRef.current;
        if (pending.length > 0) {
          const last = pending[pending.length - 1];
          const merged = new Uint8Array(last.length + bytes.length);
          merged.set(last, 0);
          merged.set(bytes, last.length);
          pending[pending.length - 1] = merged;
        } else {
          pending.push(bytes);
        }
        return;
      }
      void terminalApi.writeTerminal(id, bytesToB64(bytes));
    });

    // 输出下行（按会话 id 过滤；旧会话残包直接丢弃）
    let disposed = false;
    let unlistenOut: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    void onKernelEvent<TerminalOutputEvent>(RustEvents.terminalOutput, (p) => {
      if (disposed || p.id !== sessionIdRef.current) return;
      term.write(b64ToBytes(p.data));
    }).then((fn) => {
      if (disposed) fn();
      else unlistenOut = fn;
    });
    void onKernelEvent<TerminalExitEvent>(RustEvents.terminalExit, (p) => {
      if (disposed || p.id !== sessionIdRef.current) return;
      exitedRef.current = true;
      const code = p.code === null ? "未知" : p.code;
      term.writeln(`\r\n\x1b[90m[进程已退出 · 代码 ${code}]\x1b[0m`);
    }).then((fn) => {
      if (disposed) fn();
      else unlistenExit = fn;
    });

    // 主题跟随 <html data-theme>
    const themeMo = new MutationObserver(() => {
      term.options.theme = termTheme();
      term.options.fontFamily = cssVar("--font-mono", FONT_MONO_FALLBACK);
    });
    themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // 首个会话
    startSession();

    return () => {
      disposed = true;
      themeMo.disconnect();
      ro.disconnect();
      dataDisposable.dispose();
      unlistenOut?.();
      unlistenExit?.();
      const id = sessionIdRef.current;
      if (id !== null) void terminalApi.killTerminal(id);
      sessionIdRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [startSession]);

  // 页签切到终端时聚焦输入（只聚焦，不重建）
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  /** 重开一个会话（旧会话杀掉，屏幕清空） */
  const restart = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const old = sessionIdRef.current;
    if (old !== null) void terminalApi.killTerminal(old);
    sessionIdRef.current = null;
    pendingInputRef.current = [];
    term.reset();
    startSession();
    term.focus();
  }, [startSession]);

  return (
    <div className="term-slot">
      <div className="term-bar">
        <Icon name="folder" size={12} />
        <span className="term-cwd" title={cwd || "主目录"}>
          {cwd || "主目录"}
        </span>
        <span className="term-meta">
          {starting ? "启动中…" : shell ? shell : ""}
        </span>
        <div className="log-spacer" />
        <button type="button" className="ibtn" title="重开终端" onClick={restart}>
          <Icon name="refresh" />
        </button>
      </div>
      <div className="term-host" ref={hostRef} />
      {errorMsg && <div className="term-error">{errorMsg}</div>}
    </div>
  );
}

export default TerminalPane;
