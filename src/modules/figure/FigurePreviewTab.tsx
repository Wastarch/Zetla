import { useFigureStore } from "./figureStore";
import FigureApproxPreview from "./FigureApproxPreview";
import "./figure-preview.css";

/**
 * 拼图中心预览 Tab（挂在 `figure://preview` 伪 buffer 上，见 `useBuffers.openFigure`）。
 *
 * v2 架构：渲染模式由侧栏「模式开关」决定，与模式强绑定（不另设独立预览类型开关）：
 *   - 'subfigure' → 近似预览（DOM，P2 接入 FigureApproxPreview）
 *   - 'composite' → 合成预览（Canvas，P3 接入 FigureRealPreview，此处暂占位）
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
    return (
      <div className="fig-preview-placeholder">
        <div>
          <h3 style={{ margin: "0 0 8px" }}>合成预览（P3 实现）</h3>
          <p>
            合成单张图片模式：此处将用 Canvas 实时合成，所见即产物（零漂移）。
            <br />
            当前已载入 <b>{cellCount}</b> 张图片，P3 接通后即可预览与导出。
          </p>
        </div>
      </div>
    );
  }

  return <FigureApproxPreview />;
}
