// P2 · 间距控件（未选中任何子图时显示，与 CellEditor 互斥）。
// 行/列间距滑块，写 gapCol / gapRow（占列宽比例 [0,1]）。
import { useFigureStore } from "./figureStore";

interface Props {
  gapCol: number;
  gapRow: number;
}

export default function GapControls({ gapCol, gapRow }: Props) {
  const setGaps = useFigureStore((s) => s.setGaps);

  return (
    <div className="figside-card">
      <div className="figside-card-head">间距（占列宽比例）</div>

      <div className="figside-slider-row">
        <span className="figside-label">列间距</span>
        <input
          type="range"
          min={0}
          max={0.2}
          step={0.005}
          value={gapCol}
          onChange={(e) => setGaps(Number(e.target.value), gapRow)}
        />
        <span className="figside-hint">{Math.round(gapCol * 100)}%</span>
      </div>

      <div className="figside-slider-row">
        <span className="figside-label">行间距</span>
        <input
          type="range"
          min={0}
          max={0.2}
          step={0.005}
          value={gapRow}
          onChange={(e) => setGaps(gapCol, Number(e.target.value))}
        />
        <span className="figside-hint">{Math.round(gapRow * 100)}%</span>
      </div>

      <span className="figside-hint">
        内部以“占列宽比例”建模，不暴露像素；subfigure 以 \hfill 均分、合成以像素换算。
      </span>
    </div>
  );
}
