// M0-6 · 全局状态栏（对齐 mockup UI.html .statusbar）
// 左：状态点 + 编译文案 + 进度条 + 日志⛔ + 引擎 chip⛔
// 右（.right 组）：行/列 · LaTeX 语言 · 当前文件/脏 · 编码 · 换行
// M0-13 前移：光标位置从编辑器内部状态行上提到此处；移除设置/主题按钮（设置 M1 · 主题 M3）
// M0-9：编译文案按钮触发编译/取消、日志按钮开合面板、引擎 chip 显示生效引擎
// M1-3：引擎 chip 显示「设置页显式值 ?? 项目 config」的生效引擎，点击打开设置→编译设置切换
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, useProjectStore } from "@/project/useProject";
import { cancelCompile, effectiveEngine, engineLabel, startCompile } from "@/compile/useCompile";
import { openEnvGuide } from "@/env/useEnvCheck";
import { useSettingsStore } from "@/core/settings";

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
  const env = useAppStore((s) => s.env);
  // M1-3：设置页显式引擎覆盖项目 config（"auto" 时跟随项目）
  const engineSetting = useSettingsStore((s) => s.settings.build.engine);
  const activeEngine = tree ? effectiveEngine(engineSetting, tree.engine) : null;

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
        title="当前生效的编译引擎 · 点击在 设置 → 编译设置 中切换（默认跟随项目 .ltex/config.json）"
        onClick={() => useAppStore.getState().openSettings("build")}
      >
        引擎 <span className="engine-chip">{tree ? engineLabel(activeEngine) : "—"}</span>
      </button>

      {/* M0-15a：TeX 环境 chip（点击打开环境引导） */}
      <span className="divider" />
      <button
        type="button"
        className="sbtn"
        title={
          env === null
            ? "尚未检测 TeX 环境 · 点击检测"
            : env.found
              ? `${env.distribution ?? "TeX"}${env.version ? ` · ${env.version}` : ""} · 点击查看详情`
              : "未检测到 TeX 发行版 · 点击打开环境引导"
        }
        onClick={() => void openEnvGuide()}
      >
        <Icon name="tex" />
        {env === null ? "TeX 未检测" : env.found ? env.distribution ?? "TeX" : "无 TeX"}
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
      {/* M0-14a：偏好设置入口（mockup 状态栏右端「设置」按钮） */}
      <button
        type="button"
        className="sbtn"
        title="偏好设置 (Ctrl+,)"
        onClick={() => useAppStore.getState().openSettings()}
      >
        <Icon name="sliders" />
        设置
      </button>
    </footer>
  );
}

export default StatusBar;
