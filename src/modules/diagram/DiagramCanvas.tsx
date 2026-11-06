// M2·F1-2：TikZ 画布占位。F1-3 在此接入 vendored @tikz-editor/core 的
// renderTikzToSvg（按 source 变化 debounce 重渲染 + 源码 hash 缓存），F4 起叠加拖拽层。
// 当前阶段保留真实容器（三布局切换、分隔条拖拽都以此为准），显示源码摘要与状态。
import { useDiagramStore } from "./store";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

const PREVIEW_LINES = 14;

export function DiagramCanvas() {
  const source = useDiagramStore((s) => s.source);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const lines = source.split("\n");
  const preview = lines.slice(0, PREVIEW_LINES).join("\n");

  return (
    <div className="dg-canvas">
      <div className="dg-canvas-head">
        <span className="dg-canvas-badge">画布预览</span>
        <span className="dg-canvas-hint">F1-3 接入 tikz-editor SVG 渲染</span>
      </div>
      <div className="dg-canvas-body">
        {source.trim() ? (
          <div className="dg-canvas-card">
            <span className="dg-canvas-card-label">当前 TikZ 源码（只读摘要）</span>
            <pre className="dg-canvas-source">
              {preview}
              {lines.length > PREVIEW_LINES ? "\n…" : ""}
            </pre>
          </div>
        ) : (
          <p className="dg-canvas-empty">
            源码为空。请切到「仅源码」或「分屏」布局编写 TikZ 代码。
          </p>
        )}
      </div>
      <div className="dg-canvas-foot">
        <span>v1 画布为只读预览，拖拽编辑属 F4</span>
        <span>插入目标：{targetTex ? basename(targetTex) : "未锁定"}</span>
      </div>
    </div>
  );
}
