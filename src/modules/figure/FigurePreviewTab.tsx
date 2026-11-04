import { useFigureStore } from "./figureStore";
import FigureApproxPreview from "./FigureApproxPreview";
import FigureRealPreview from "./FigureRealPreview";
import "./figure-preview.css";

/**
 * 拼图中心预览 Tab（挂在 `figure://preview` 伪 buffer 上，见 `useBuffers.openFigure`）。
 *
 * v2 架构：渲染模式由侧栏「模式开关」决定，与模式强绑定（不另设独立预览类型开关）：
 *   - 'subfigure' → 近似预览（DOM，FigureApproxPreview，反映 LaTeX 排版决策）
 *   - 'composite' → 合成预览（Canvas，FigureRealPreview，所见即产物）
 */
export default function FigurePreviewTab() {
  const mode = useFigureStore((s) => s.layout.mode);
  const cellCount = useFigureStore((s) => s.layout.cells.length);

  if (cellCount === 0) {
    return (
      <div className="fig-preview-placeholder">
        <div>
          <h3 style={{ margin: "0 0 8px" }}>拼图预览</h3>
          <p>尚未载入图片。在侧栏「插图」面板选择 / 拖入多张图片后，此处显示预览。</p>
        </div>
      </div>
    );
  }

  if (mode === "composite") {
    return <FigureRealPreview />;
  }

  return <FigureApproxPreview />;
}
