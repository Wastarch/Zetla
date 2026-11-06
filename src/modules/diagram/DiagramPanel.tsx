// M2·绘图工作台主容器（F1-1 脚手架）。
// 布局：左竖工具栏 + 左源码占位 + 右画布占位 + 右坞检查器占位。
// 源码编辑（F1-2 CodeMirror）与画布渲染（F1-3 tikz-editor）在后续切片接入，
// 本文件只搭好结构骨架与占位，保证「活动栏 → 主区工作台」链路打通。
import { useDiagramStore } from "./store";
import { DiagramToolRail } from "./DiagramToolRail";
import { DiagramInspector } from "./DiagramInspector";
import "./diagram.css";

export function DiagramPanel() {
  const source = useDiagramStore((s) => s.source);

  return (
    <div className="dg-root">
      <DiagramToolRail />

      <div className="dg-body">
        <section className="dg-pane dg-source" aria-label="源码编辑器">
          <div className="dg-pane-head">
            <span className="dg-pane-title">源码</span>
            <span className="dg-pane-tag">F1-2 接入 CodeMirror</span>
          </div>
          <pre className="dg-source-pre">{source}</pre>
        </section>

        <section className="dg-pane dg-canvas" aria-label="画布预览">
          <div className="dg-pane-head">
            <span className="dg-pane-title">画布</span>
            <span className="dg-pane-tag">F1-3 接入 tikz-editor 渲染</span>
          </div>
          <div className="dg-canvas-placeholder">
            <div className="dg-canvas-inner">
              <span className="dg-canvas-glyph">▦</span>
              <p className="dg-canvas-title">画布占位区</p>
              <p className="dg-canvas-sub">粘贴标准 TikZ 源码，F1-3 起实时渲染为 SVG</p>
            </div>
          </div>
        </section>
      </div>

      <DiagramInspector />
    </div>
  );
}

export default DiagramPanel;
