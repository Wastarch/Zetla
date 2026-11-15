import type { ReactNode } from "react";
import { useFigureStore } from "./figureStore";
import FigureApproxPreview from "./FigureApproxPreview";
import FigureRealPreview from "./FigureRealPreview";
import FigureDropZone from "./FigureDropZone";
import "./figure-preview.css";

/**
 * 拼图中心预览 Tab（挂在 `figure://preview` 伪 buffer 上，见 `useBuffers.openFigure`）。
 *
 * v2 架构：渲染模式由侧栏「模式开关」决定，与模式强绑定（不另设独立预览类型开关）：
 *   - 'subfigure' → 近似预览（DOM，FigureApproxPreview，反映 LaTeX 排版决策）
 *   - 'composite' → 合成预览（Canvas，FigureRealPreview，所见即产物）
 *
 * 外层 FigureDropZone 让「预览页本身」也支持粘贴 / 拖入图片（首次新建、再粘贴追加），
 * 与侧栏共用同一套逻辑；截图一次只能截一张，故需多次粘贴累积。
 */
export default function FigurePreviewTab() {
  const mode = useFigureStore((s) => s.layout.mode);
  const cellCount = useFigureStore((s) => s.layout.cells.length);

  let content: ReactNode;
  if (cellCount === 0) {
    content = (
      <div className="fig-preview-placeholder">
        <div>
          <h3 style={{ margin: "0 0 8px" }}>拼图预览</h3>
          <p>尚未载入图片。在此处或侧栏拖入 / 粘贴图片即可开始，多次粘贴可累积多张。</p>
        </div>
      </div>
    );
  } else if (mode === "composite") {
    content = <FigureRealPreview />;
  } else {
    content = <FigureApproxPreview />;
  }

  return <FigureDropZone className="fig-preview-root">{content}</FigureDropZone>;
}
