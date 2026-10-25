// M1-12a · 输出区域：编写区内容 KaTeX 实时预览 + 动作条
// - \Box 渲染为空心槽，点击 → 编写区光标定位到该槽（MathType 式；M1-11 injectSlots 协议）
// - 动作条：插入编辑器（主，等同 Ctrl+Enter）/ 复制 LaTeX
// - 缩放：预览整体字号（50–200%）；空态显示 LaTeX 水印
// - 2026-10-25：输出区域支持 Ctrl+滚轮缩放（对应右上「差 − 200% +」，步进 25%）
import FormulaKaTeX from "./FormulaKaTeX";
import { useComposeStore } from "./composeStore";
import { boxOffset, serializeSlotsText, slotIdIndex } from "./mathTex";
import { copyCompose, submitCompose } from "./mathInsert";
import { useCtrlWheelZoom } from "./useCtrlWheelZoom";

export default function MathOutput() {
  const text = useComposeStore((s) => s.text);
  const zoom = useComposeStore((s) => s.previewZoom);
  const zoomPreview = useComposeStore((s) => s.zoomPreview);
  const setCursor = useComposeStore((s) => s.setCursor);
  const setMode = useComposeStore((s) => s.setMode);

  // Ctrl+滚轮 → 预览缩放（±25% 一档，与按钮一致）
  const outputZoomRef = useCtrlWheelZoom<HTMLDivElement>((dir) => zoomPreview(dir * 25));

  const empty = text.trim() === "";
  const { tex, slotIds } = serializeSlotsText(text);

  // 点预览空槽 → 编写区选中对应 \Box（并切回源码模式，光标可见）
  const onSlotClick = (id: string) => {
    const idx = slotIdIndex(id);
    if (idx < 0) return;
    const pos = boxOffset(text, idx);
    if (pos < 0) return;
    setMode("source");
    setCursor(pos);
  };

  return (
    <div className="math-region math-output" ref={outputZoomRef}>
      <div className="math-region-head">
        <span className="math-region-title">输出区域 Output</span>
        <div className="math-zoom">
          <button type="button" title="缩小预览（Ctrl+滚轮）" onClick={() => zoomPreview(-25)}>
            −
          </button>
          <span className="math-zoom-val">{zoom}%</span>
          <button type="button" title="放大预览（Ctrl+滚轮）" onClick={() => zoomPreview(25)}>
            +
          </button>
        </div>
      </div>

      <div className="math-output-fx" style={{ fontSize: `${zoom}%` }}>
        {empty ? (
          <div className="math-output-empty">
            <span className="math-output-wm">LaTeX</span>
            编写区内容将实时渲染于此
          </div>
        ) : (
          <FormulaKaTeX
            tex={tex}
            display
            slots={slotIds}
            activeSlot={null}
            onSlotClick={onSlotClick}
          />
        )}
      </div>

      <div className="math-output-actions">
        <button
          type="button"
          className="btn primary"
          disabled={empty}
          title="插入到编辑器光标处（Ctrl+Enter）"
          onClick={() => {
            submitCompose();
          }}
        >
          插入编辑器
        </button>
        <button
          type="button"
          className="btn"
          disabled={empty}
          title="复制 LaTeX 源码"
          onClick={() => void copyCompose()}
        >
          复制 LaTeX
        </button>
      </div>
    </div>
  );
}
