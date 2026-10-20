// M0-6 · 全局状态栏（对齐 mockup UI.html .statusbar）
// 左：状态点 + 编译文案 + 进度条 + 日志⛔ + 引擎 chip⛔
// 右（.right 组）：行/列 · LaTeX 语言 · 当前文件/脏 · 编码 · 换行
// M0-12 前移：光标位置从编辑器内部状态行上提到此处；移除设置/主题按钮（设置 M1 · 主题 M3）
// 接通节奏：M0-9 编译状态与引擎 · M0-10 日志 · M0-11 错误定位
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { base } from "@/project/useProject";

const DOT_CLASS: Record<string, string> = {
  running: "run",
  ok: "ok",
  error: "err",
};

export function StatusBar() {
  const compileStatus = useAppStore((s) => s.compileStatus);
  const active = useBuffersStore((s) =>
    s.activePath ? s.buffers.find((b) => b.path === s.activePath) ?? null : null,
  );
  const cursor = useBuffersStore((s) => s.cursor);

  const running = compileStatus === "running";
  const statusText =
    compileStatus === "idle"
      ? "待编译（M0-9 接通）"
      : compileStatus === "running"
        ? "编译中…"
        : compileStatus === "ok"
          ? "编译通过"
          : compileStatus === "error"
            ? "编译失败"
            : "已取消";
  const dirty = !!active && active.content !== active.savedContent;

  return (
    <footer className="statusbar">
      {/* 编译状态（占位） */}
      <span className="stat-ico">
        <span className={`dot ${DOT_CLASS[compileStatus] ?? ""}`} />
      </span>
      <button
        type="button"
        className="sbtn"
        disabled
        title="一键编译（M0-9 接通）"
      >
        {statusText}
      </button>
      <div className={running ? "bar-progress on" : "bar-progress"}>
        <i />
      </div>

      <span className="divider" />
      <button
        type="button"
        className="sbtn"
        disabled
        title="编译日志（M0-10 接通）"
      >
        <Icon name="terminal" />
        日志
      </button>

      <span className="divider" />
      <button
        type="button"
        className="sbtn"
        disabled
        title="引擎切换（M0-9 接通）"
      >
        引擎 <span className="engine-chip">XeLaTeX</span>
      </button>

      {/* 右侧：光标 / 语言 / 文件 / 编码 / 换行 */}
      {active && (
        <>
          <span className="divider" />
          <div className="sbtn right caret-info" title="光标位置">
            行 {cursor.line}，列 {cursor.col}
          </div>
          <span className="sbtn" title="文档语言">
            LaTeX
          </span>
          <span className="divider" />
          <button
            type="button"
            className="sbtn"
            disabled
            title={active.path}
          >
            <span className="sfile">{base(active.path)}</span>
            {dirty && <span className="sdirty">● 未保存</span>}
          </button>
          <button type="button" className="sbtn" disabled title="文件编码">
            {active.encoding.toUpperCase()}
          </button>
          <button type="button" className="sbtn" disabled title="换行符">
            {active.eol === "crlf" ? "CRLF" : "LF"}
          </button>
        </>
      )}
    </footer>
  );
}

export default StatusBar;
