// P2 后续 · 子图缩略图：按来源渲染（path/file 走 <img>，PDF 走占位卡）。
// 复用 figurePreviewUrl；PDF 无法用 <img> 渲染，显示文件名徽标占位。
// onNaturalSize 回填空格自然尺寸（供 §4.2 宽度预算 / 裁剪换算；PDF 无自然尺寸，不回调）。
import { FigureCell } from "@/types/figure";
import { cellPreviewUrl, isPdfSource, sourceName } from "./figurePreviewUrl";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

interface Props {
  cell: FigureCell;
  onNaturalSize?: (w: number, h: number) => void;
  className?: string;
}

export default function FigureThumb({ cell, onNaturalSize, className }: Props) {
  const pdf = isPdfSource(cell.source);
  const url = cellPreviewUrl(cell);

  if (pdf || !url) {
    const name = url ?? sourceName(cell.source) ?? cell.path ?? "";
    return (
      <div className={`fig-thumb-pdf ${className ?? ""}`} title={name}>
        <span className="fig-thumb-pdf-ico">PDF</span>
        <span className="fig-thumb-pdf-name">{basename(name)}</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={url}
      alt={basename(cell.path || url)}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          onNaturalSize?.(img.naturalWidth, img.naturalHeight);
        }
      }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}
