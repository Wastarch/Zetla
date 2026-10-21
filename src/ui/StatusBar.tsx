// M0-6 · 全局状态栏（对齐 mockup UI.html .statusbar）
// 左：状态点 + 编译文案 + 进度条 + 日志⛔ + 引擎 chip⛔
// 右（.right 组）：行/列 · LaTeX 语言 · 当前文件/脏 · 编码 · 换行
// M0-13 前移：光标位置从编辑器内部状态行上提到此处；移除设置/主题按钮（设置 M1 · 主题 M3）
// M0-9：编译文案按钮触发编译/取消、日志按钮开合面板、引擎 chip 显示项目真实引擎（切换留 M1）
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, useProjectStore } from "@/project/useProject";
import { cancelCompile, engineLabel, startCompile } from "@/compile/useCompile";

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
  const logVisible = useAppStore((s) => s.logVisible);
  const toggleLog = useAppStore((s) => s.toggleLog);
  const tree = useProjectStore((s) => s.tree);
  const hasMain = !!tree?.mainFile;

  const running = compileStatus === "running";
  const statusText =
    compileStatus === "idle"
      ? "待编译"
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
        disabled={!running && !hasMain}
        title={
          running
            ? "取消编译"
            : hasMain
              ? "开始编译 (Ctrl+B)"
              : "未打开项目或未识别主文件"
        }
        onClick={() => void (running ? cancelCompile() : startCompile())}
      >
        {statusText}
      </button>
      <div className={running ? "bar-progress on" : "bar-progress"}>
        <i />
      </div>

      <span className="divider" />
      <button
        type="button"
        className={logVisible ? "sbtn on" : "sbtn"}
        title={logVisible ? "收起编译日志" : "打开编译日志"}
        onClick={toggleLog}
      >
        <Icon name="terminal" />
        日志
      </button>

      <span className="divider" />
      <button
        type="button"
        className="sbtn"
        disabled
        title="引擎切换（M1 接通）；当前引擎来自 .ltex/config.json"
      >
        引擎{" "}
        <span className="engine-chip">{tree ? engineLabel(tree.engine) : "—"}</span>
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
