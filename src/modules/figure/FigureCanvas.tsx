// F2 · 拼图画布（侧栏视图）：网格布局 UI + 行优先自动填充 + 编号实时预览。
// 仅展示与布局控制；子标题/裁剪/对齐/间距/代码生成在 F3–F5 接通。
// 编号规则（方案 §3.1）：行优先；编号 (a)(b)(c)… 对应实际子图（填充格），
// 图片数 < 网格格数时末尾留空、不占编号。
import { useFigureStore } from "./figureStore";
import { subFigureLetter } from "@/types/figure";
import "./figure.css";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export default function FigureCanvas() {
  const layout = useFigureStore((s) => s.layout);
  const setGrid = useFigureStore((s) => s.setGrid);
  const initFromImages = useFigureStore((s) => s.initFromImages);
  const reset = useFigureStore((s) => s.reset);

  const total = layout.rows * layout.cols;

  return (
    <div className="fig-canvas">
      <div className="fig-toolbar">
        <label className="fig-field">
          行
          <input
            type="number"
            min={1}
            value={layout.rows}
            onChange={(e) =>
              setGrid(Math.max(1, Number(e.target.value) || 1), layout.cols)
            }
          />
        </label>
        <label className="fig-field">
          列
          <input
            type="number"
            min={1}
            value={layout.cols}
            onChange={(e) =>
              setGrid(layout.rows, Math.max(1, Number(e.target.value) || 1))
            }
          />
        </label>
        <span className="fig-meta">
          共 {layout.cells.length} 图 · 网格 {total} 格
        </span>
        <button type="button" className="btn" onClick={reset}>
          清空
        </button>
      </div>

      {layout.cells.length === 0 ? (
        <div className="fig-empty">
          <p>尚未载入图片。多图导入将自动进入画布（F6）。</p>
          <button
            type="button"
            className="btn"
            onClick={() =>
              initFromImages(["fig/a.png", "fig/b.png", "fig/c.png", "fig/d.png"])
            }
          >
            载入示例图片（测试）
          </button>
        </div>
      ) : (
        <div
          className="fig-grid"
          style={{
            gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
            gridTemplateRows: `repeat(${layout.rows}, auto)`,
          }}
        >
          {Array.from({ length: total }, (_, idx) => {
            const cell = layout.cells[idx];
            if (!cell) {
              return (
                <div key={idx} className="fig-cell fig-cell--empty">
                  <span className="fig-empty-hint">空</span>
                </div>
              );
            }
            return (
              <div key={idx} className="fig-cell">
                <span className="fig-letter">{subFigureLetter(idx)}</span>
                <div className="fig-thumb">
                  <img
                    src={cell.path}
                    alt={basename(cell.path)}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility =
                        "hidden";
                    }}
                  />
                </div>
                <span className="fig-name">{basename(cell.path)}</span>
                <code className="fig-label">{cell.label}</code>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
