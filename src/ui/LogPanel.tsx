// M0-9 · 底部编译日志面板（对齐 mockup .logpanel）
// 当前只做原始输出滚动；M0-11 再在同一面板内加「错误 / 警告 / 全部」筛选与结构化列表。
import { useEffect, useRef } from "react";
import { useAppStore } from "@/core/store";
import { Icon } from "@/ui/Icon";

export function LogPanel() {
  const visible = useAppStore((s) => s.logVisible);
  const toggleLog = useAppStore((s) => s.toggleLog);
  const lines = useAppStore((s) => s.compileLog);
  const clearLog = useAppStore((s) => s.clearLog);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 新行到达时贴底（用户手动上翻后仍会被拉回，P0 可接受；M1 再做「仅在底部时跟随」）
  useEffect(() => {
    const el = bodyRef.current;
    if (el && visible) el.scrollTop = el.scrollHeight;
  }, [lines, visible]);

  return (
    <div className={visible ? "logpanel open" : "logpanel"} aria-hidden={!visible}>
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
    </div>
  );
}

export default LogPanel;
