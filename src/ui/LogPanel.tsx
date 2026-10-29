// M0-9/12 · 底部编译日志面板（对齐 mockup .logpanel）
// 「全部」保留原始输出滚动；「错误/警告」是 M0-11 解析的结构化列表（读 lastResult.errors），
// 点击条目经 src/editor/jump.ts 打开/定位报错行（行号为编译时快照，文件后被改过会钳到实际行）。
// M1-16：VSCode 式停靠 —— 面板挂在右侧主列底部（不横跨侧栏），上边界可拖拽改高度。
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/core/store";
import { base } from "@/project/useProject";
import { jumpToError } from "@/editor/jump";
import { Icon } from "@/ui/Icon";
import type { TexError } from "@/types";

type LogTab = "errors" | "warnings" | "all";
type Status = "idle" | "running" | "ok" | "error" | "cancelled";

/** 面板高度下限 / 上限（上限还会被窗口高度约束，见 maxLogHeight） */
const LOG_MIN_H = 120;
const LOG_MAX_H = 560;
/** 面板至少给编辑区留出的高度 */
const MIN_EDITOR_H = 180;

const TABS: Array<{ key: LogTab; label: string }> = [
  { key: "errors", label: "错误" },
  { key: "warnings", label: "警告" },
  { key: "all", label: "全部" },
];

function maxLogHeight(): number {
  return Math.max(
    LOG_MIN_H,
    Math.min(LOG_MAX_H, window.innerHeight - MIN_EDITOR_H - 140),
  );
}

function filterBy(
  errs: TexError[] | undefined,
  severity: TexError["severity"],
): TexError[] {
  return (errs ?? []).filter((e) => e.severity === severity);
}

function emptyText(tab: LogTab, status: Status): string {
  if (status === "running") return "正在编译…";
  if (status === "cancelled") return "编译已取消";
  if (status === "error") {
    return tab === "warnings"
      ? "编译失败 · 未发现警告"
      : "未解析到结构化错误 · 看「全部」或「帮助 → 查看日志文件」";
  }
  return status === "ok"
    ? tab === "warnings"
      ? "本次编译没有警告"
      : "本次编译没有错误"
    : "尚无编译结果 · 点击工具栏 ▶ 或按 Ctrl+B 开始编译";
}

export function LogPanel() {
  const visible = useAppStore((s) => s.logVisible);
  const toggleLog = useAppStore((s) => s.toggleLog);
  const logTab = useAppStore((s) => s.logTab);
  const setLogTab = useAppStore((s) => s.setLogTab);
  const lines = useAppStore((s) => s.compileLog);
  const clearLog = useAppStore((s) => s.clearLog);
  const status = useAppStore((s) => s.compileStatus);
  const lastResult = useAppStore((s) => s.lastResult);
  const logHeight = useAppStore((s) => s.logHeight);
  const setLogHeight = useAppStore((s) => s.setLogHeight);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // M1-16：拖拽上边界改高度（上拖变高；钳制在 [120, min(560, 窗口可容纳)]）
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ y: number; h: number } | null>(null);
  const onResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { y: e.clientY, h: logHeight };
      setDragging(true);
      document.body.classList.add("row-resizing");
    },
    [logHeight],
  );
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.round(d.h - (e.clientY - d.y));
      setLogHeight(Math.min(maxLogHeight(), Math.max(LOG_MIN_H, next)));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove("row-resizing");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("row-resizing");
    };
  }, [dragging, setLogHeight]);

  // 窗口变小时兜底：记忆/上次拖出的高度不得超过当前窗口可容纳上限
  useEffect(() => {
    const clamped = Math.min(logHeight, maxLogHeight());
    if (clamped !== logHeight) setLogHeight(clamped);
  }, [logHeight, setLogHeight]);

  const errors = filterBy(lastResult?.errors, "error");
  const warnings = filterBy(lastResult?.errors, "warning");

  // 全部页：新行到达时贴底（用户手动上翻后仍会被拉回，P0 可接受；M1 再做「仅在底部时跟随」）
  useEffect(() => {
    const el = bodyRef.current;
    if (el && visible && logTab === "all") el.scrollTop = el.scrollHeight;
  }, [lines, visible, logTab]);

  const list = logTab === "errors" ? errors : warnings;

  return (
    <div
      className={`logpanel${visible ? " open" : ""}${dragging ? " dragging" : ""}`}
      style={{ height: visible ? logHeight : 0 }}
      aria-hidden={!visible}
    >
      <div
        className="log-resizer"
        title="拖拽调整日志面板高度"
        onMouseDown={onResizeDown}
      />
      <div className="log-head">
        <Icon name="terminal" />
        <h2>编译日志</h2>
        <span className="log-count">{lines.length} 行</span>
        <div className="log-spacer" />
        <button
          type="button"
          className="ibtn"
          title="清空日志"
          disabled={lines.length === 0}
          onClick={clearLog}
        >
          <Icon name="trash" />
        </button>
        <button type="button" className="ibtn" title="收起日志面板" onClick={toggleLog}>
          <Icon name="x" />
        </button>
      </div>

      <div className="log-tabs">
        {TABS.map((t) => {
          const n = t.key === "errors" ? errors.length : t.key === "warnings" ? warnings.length : lines.length;
          return (
            <button
              key={t.key}
              type="button"
              className={`log-tab ${logTab === t.key ? "on" : ""}`}
              onClick={() => setLogTab(t.key)}
            >
              {t.label}
              {n > 0 && (
                <b className={`log-tab-cnt ${t.key === "errors" ? "err" : "warn"}`}>
                  {n}
                </b>
              )}
            </button>
          );
        })}
      </div>

      {logTab === "all" ? (
        <div className="log-body" ref={bodyRef}>
          {lines.length === 0 ? (
            <div className="log-empty">
              尚无编译输出 · 点击工具栏 ▶ 或按 Ctrl+B 开始编译
            </div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className="log-line">
                {line}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="log-errlist">
          {list.length === 0 ? (
            <div className="log-empty">{emptyText(logTab, status)}</div>
          ) : (
            list.map((e, i) => <LogErr key={i} e={e} />)
          )}
        </div>
      )}
    </div>
  );
}

/** 结构化条目：文件:行号 + 大白话 + 修复建议 + 原始报错（悬停看全文；可定位才可点） */
function LogErr({ e }: { e: TexError }) {
  const jumpable = e.line > 0 && e.file.toLowerCase().endsWith(".tex");
  return (
    <button
      type="button"
      className="log-err"
      disabled={!jumpable}
      title={jumpable ? "点击定位到报错行" : `无定位信息 · ${e.file}`}
      onClick={() => jumpToError(e.file, e.line, e.col)}
    >
      <span className="log-err-loc">
        <span className={`err-badge ${e.severity === "warning" ? "warn" : ""}`}>
          {e.severity === "warning" ? "W" : "E"}
        </span>
        {e.line > 0 ? `${base(e.file)}:${e.line}` : `${base(e.file)} · 无行号`}
      </span>
      <span className="log-err-msg">{e.readable}</span>
      {e.fix && <span className="log-err-fix">建议：{e.fix}</span>}
      <span className="log-err-raw" title={e.raw}>
        {e.raw}
      </span>
    </button>
  );
}

export default LogPanel;
