import { useFigureStore } from "./figureStore";

/**
 * 拼图中心预览 Tab（P1 占位）。
 *
 * v2 架构：侧栏 = 控制面板，Tab = 渲染画布。本组件挂在 `figure://preview`
 * 伪 buffer 上（见 `useBuffers.openFigure`），由 mode 决定渲染：
 *   - 'subfigure' → 近似预览（DOM，P2 接入 FigureApproxPreview）
 *   - 'composite' → 合成预览（Canvas，P3 接入 FigureRealPreview）
 *
 * P1 仅建好 Tab 基础设施与占位，真实渲染在 P2/P3 填充。
 */
export default function FigurePreviewTab() {
  const cellCount = useFigureStore((s) => s.layout.cells.length);
  const mode = useFigureStore((s) => s.layout.mode);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "var(--txt-2)",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h3 style={{ margin: "0 0 8px", color: "var(--txt-1)" }}>
          拼图预览（P1 占位）
        </h3>
        <p style={{ margin: "4px 0" }}>
          中心画布 Tab 已就绪，渲染模式将在 P2 / P3 接入。
        </p>
        <p style={{ margin: "4px 0" }}>
          当前画布已载入 <b>{cellCount}</b> 张图片（数据来自侧栏拼图面板）。
        </p>
        <p style={{ margin: "4px 0" }}>
          当前模式：<b>{mode === "composite" ? "合成单张图片" : "subfigure"}</b>
          。在侧栏切换模式后，此处将渲染对应预览。
        </p>
      </div>
    </div>
  );
}
