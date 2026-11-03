// P2 · 选中子图编辑器（迁自 F3）：子标题 + KaTeX 预览 / 缩放 / 对齐 / crop。
// 仅当选中某格时由 FigureSidebar 渲染；与 GapControls 互斥。
import { useFigureStore } from "./figureStore";
import { VAlign, FigureCell, subFigureLetter } from "@/types/figure";
import SubCaptionPreview from "./SubCaptionPreview";
import { sourceName } from "./figurePreviewUrl";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const clampCrop = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const clampScale = (n: number) => Math.min(3, Math.max(0.1, Number.isFinite(n) ? n : 1));
const cropKeys: (keyof FigureCell["crop"])[] = ["l", "b", "r", "t"];
const cropLabels: Record<keyof FigureCell["crop"], string> = { l: "左", b: "下", r: "右", t: "上" };
const alignLabels: Record<VAlign, string> = { t: "顶", c: "中", b: "底" };

interface Props {
  cell: FigureCell;
  index: number;
}

export default function CellEditor({ cell, index }: Props) {
  const updateCell = useFigureStore((s) => s.updateCell);
  const setAlign = useFigureStore((s) => s.setAlign);
  const setCrop = useFigureStore((s) => s.setCrop);
  const removeCell = useFigureStore((s) => s.removeCell);

  return (
    <div className="figside-card">
      <div className="figside-card-head">
        当前子图 ({subFigureLetter(index)}) · {basename(sourceName(cell.source) || cell.path)}
        <button
          type="button"
          className="figside-card-del"
          title="移除这张图"
          onClick={() => removeCell(index)}
        >
          移除
        </button>
      </div>

      <label className="figside-edit-col figside-edit-row">
        <span className="figside-label">子标题</span>
        <input
          type="text"
          className="figside-input"
          value={cell.subCaption}
          placeholder="如：示意图 $x+y=z$"
          onChange={(e) => updateCell(index, { subCaption: e.target.value })}
        />
      </label>
      <SubCaptionPreview text={cell.subCaption} />

      <div className="figside-edit-row">
        <span className="figside-label">缩放</span>
        <input
          type="number"
          className="figside-num"
          step={0.1}
          min={0.1}
          max={3}
          value={cell.scale}
          onChange={(e) => updateCell(index, { scale: clampScale(Number(e.target.value)) })}
        />
        <span className="figside-hint">微调系数（× 统一基准）</span>
      </div>

      <div className="figside-edit-row">
        <span className="figside-label">对齐</span>
        <div className="figside-seg">
          {(Object.keys(alignLabels) as VAlign[]).map((a) => (
            <button
              key={a}
              type="button"
              className={cell.align === a ? "figside-seg-btn is-on" : "figside-seg-btn"}
              onClick={() => setAlign(index, a)}
            >
              {alignLabels[a]}
            </button>
          ))}
        </div>
        <span className="figside-hint">顶/中/底 → subfigure [t]/[c]/[b]</span>
      </div>

      <div className="figside-edit-col figside-edit-row">
        <span className="figside-label">裁剪（归一化 0–1，左上角原点）</span>
        <div className="figside-crop-grid">
          {cropKeys.map((k) => (
            <label key={k} className="figside-crop-field">
              {cropLabels[k]}
              <input
                type="number"
                className="figside-num"
                step={0.05}
                min={0}
                max={1}
                value={cell.crop[k]}
                onChange={(e) =>
                  setCrop(index, { ...cell.crop, [k]: clampCrop(Number(e.target.value)) })
                }
              />
            </label>
          ))}
        </div>
        <span className="figside-hint">左/下/右/上，DOM / Canvas / LaTeX 三路径同源</span>
      </div>
    </div>
  );
}
