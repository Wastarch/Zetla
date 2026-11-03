// P2 后续 · 子图选择列表（替代原「点格选中」交互）。
// 行优先；编号徽标 + 缩略图 + 文件名 + label；选中行左侧蓝色竖条。
// 缩略图 onLoad 回填空格 naturalSize（供 §4.2 预算 / 裁剪换算）。
import { useFigureStore } from "./figureStore";
import { subFigureLetter, FigureCell } from "@/types/figure";
import FigureThumb from "./FigureThumb";
import { sourceName } from "./figurePreviewUrl";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

interface Props {
  cells: FigureCell[];
  selectedIndex: number;
  onSelect: (i: number) => void;
}

export default function CellList({ cells, selectedIndex, onSelect }: Props) {
  const setNaturalSize = useFigureStore((s) => s.setNaturalSize);

  if (cells.length === 0) return null;

  return (
    <div className="figside-list">
      {cells.map((cell, i) => (
        <div
          key={i}
          className={i === selectedIndex ? "figside-cell is-sel" : "figside-cell"}
          onClick={() => onSelect(i)}
        >
          <span className="figside-badge">{subFigureLetter(i)}</span>
          <span className="figside-thumb">
            <FigureThumb cell={cell} onNaturalSize={(w, h) => setNaturalSize(i, { w, h })} />
          </span>
          <span className="figside-cell-meta">
            <div className="figside-cell-name">
              {basename(sourceName(cell.source) || cell.path)}
            </div>
            <div className="figside-cell-label">{cell.label}</div>
          </span>
        </div>
      ))}
    </div>
  );
}
