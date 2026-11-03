// P2 后续 · 子图选择列表（替代原「点格选中」交互）。
// 行优先；编号徽标 + 缩略图 + 文件名 + label；选中行左侧蓝色竖条。
// 再次点击已选中项取消选择（回到间距控制页）；每行带 × 删除按钮。
// 拖拽排序：用指针事件（pointerdown/move/up）实现，而非 HTML5 draggable——
//   Tauri v2 在 Windows 默认 dragDropEnabled=true 会拦截网页内 HTML5 拖放（显示禁放光标），
//   而项目编辑器仍依赖原生文件拖入，不能全局关闭，故此处自行实现指针拖拽。
// 缩略图 onLoad 回填空格 naturalSize（供 §4.2 预算 / 裁剪换算）。
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useFigureStore } from "./figureStore";
import { subFigureLetter, FigureCell } from "@/types/figure";
import FigureThumb from "./FigureThumb";
import { sourceName } from "./figurePreviewUrl";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;
/** 指针位移超过该值才视为拖拽（否则按点击选中处理） */
const DRAG_THRESHOLD = 4;

interface Props {
  cells: FigureCell[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  /** 拖拽排序：(from,to) → 移动子图（store.reorder 负责重排 label 与选中索引） */
  onReorder: (from: number, to: number) => void;
}

export default function CellList({ cells, selectedIndex, onSelect, onReorder }: Props) {
  const setNaturalSize = useFigureStore((s) => s.setNaturalSize);
  const removeCell = useFigureStore((s) => s.removeCell);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const suppressClick = useRef(false);
  // 拖拽中的源索引 / 当前悬停目标索引（用于插入指示高亮）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (cells.length === 0) return null;

  /** 指针 Y 命中哪一行（无命中时按上下边界取首/末行） */
  const hitTest = (clientY: number): number | null => {
    const rects = rowRefs.current
      .slice(0, cells.length)
      .map((el) => (el ? el.getBoundingClientRect() : null));
    if (rects.length === 0) return null;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r && clientY >= r.top && clientY <= r.bottom) return i;
    }
    const first = rects[0];
    const last = rects[rects.length - 1];
    if (first && clientY < first.top) return 0;
    if (last && clientY > last.bottom) return rects.length - 1;
    return null;
  };

  const startDrag = (e: ReactPointerEvent, i: number) => {
    if (e.button !== 0) return;
    // 点在删除按钮上不启动拖拽，交给按钮自身处理
    if ((e.target as HTMLElement).closest(".figside-cell-del")) return;

    const startY = e.clientY;
    let active = false;

    const onMove = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientY - startY) >= DRAG_THRESHOLD) {
        active = true;
        setDragIndex(i);
      }
      if (!active) return;
      ev.preventDefault();
      setOverIndex(hitTest(ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (active) {
        const to = hitTest(ev.clientY);
        if (to != null && to !== i) onReorder(i, to);
        // 拖拽结束后的 click 不应再触发选中切换
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
      }
      setDragIndex(null);
      setOverIndex(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="figside-list">
      {cells.map((cell, i) => {
        const isOver = dragIndex !== null && overIndex === i && dragIndex !== i;
        const cls = [
          "figside-cell",
          i === selectedIndex ? "is-sel" : "",
          dragIndex === i ? "is-dragging" : "",
          isOver ? "is-over" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={i}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            className={cls}
            onPointerDown={(e) => startDrag(e, i)}
            onClick={() => {
              if (suppressClick.current) return;
              onSelect(i === selectedIndex ? -1 : i);
            }}
          >
            <span className="figside-grip" title="拖动调整顺序" aria-hidden>
              ⋮⋮
            </span>
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
            <button
              type="button"
              className="figside-cell-del"
              title="移除这张图"
              onClick={(e) => {
                e.stopPropagation();
                removeCell(i);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
