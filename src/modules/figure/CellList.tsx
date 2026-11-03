// P2 · 子图选择列表（替代原「点格选中」交互）。
// 行优先；编号徽标 + 缩略图 + 文件名 + label；选中行左侧蓝色竖条。
// 缩略图 onLoad 回填空格 naturalSize（供 §4.2 预算 / 裁剪换算）。
import { convertFileSrc } from "@tauri-apps/api/core";
import { useFigureStore } from "./figureStore";
import { subFigureLetter, FigureCell } from "@/types/figure";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const absSrc = (texDir: string, rel: string) =>
  texDir ? convertFileSrc(`${texDir}/${rel}`.replace(/\\/g, "/")) : rel;

interface Props {
  cells: FigureCell[];
  selectedIndex: number;
  texDir: string;
  onSelect: (i: number) => void;
}

export default function CellList({ cells, selectedIndex, texDir, onSelect }: Props) {
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
            <img
              src={absSrc(texDir, cell.path)}
              alt={basename(cell.path)}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setNaturalSize(i, { w: img.naturalWidth, h: img.naturalHeight });
                }
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
          </span>
          <span className="figside-cell-meta">
            <div className="figside-cell-name">{basename(cell.path)}</div>
            <div className="figside-cell-label">{cell.label}</div>
          </span>
        </div>
      ))}
    </div>
  );
}
