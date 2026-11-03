// F2 · 拼图画布（侧栏视图）：网格布局 UI + 行优先自动填充 + 编号实时预览。
// 仅展示与布局控制；子标题/裁剪/对齐/间距/代码生成在 F3–F5 接通。
// 编号规则（方案 §3.1）：行优先；编号 (a)(b)(c)… 对应实际子图（填充格），
// 图片数 < 网格格数时末尾留空、不占编号。
import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useFigureStore } from "./figureStore";
import { pickImagesToCanvas } from "./figureImport";
import { subFigureLetter } from "@/types/figure";
import { useBuffersStore } from "@/editor/useBuffers";
import { parentOf } from "@/project/useProject";
import "./figure.css";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export default function FigureCanvas() {
  const layout = useFigureStore((s) => s.layout);
  const setGrid = useFigureStore((s) => s.setGrid);
  const reset = useFigureStore((s) => s.reset);
  // 画布预览需要绝对路径：cell.path 是相对 .tex 的相对路径（给 LaTeX 用），
  // 需还原为绝对路径并转成 webview 可加载的 asset 协议 URL（同 ImageViewer）。
  const activePath = useBuffersStore((s) => s.activePath);
  const texDir = useMemo(() => (activePath ? parentOf(activePath) : ""), [activePath]);

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
        <button
          type="button"
          className="btn"
          onClick={() => void pickImagesToCanvas(true)}
          disabled={layout.cells.length === 0}
        >
          添加图片…
        </button>
        <button type="button" className="btn" onClick={reset}>
          清空
        </button>
      </div>

      {layout.cells.length === 0 ? (
        <div className="fig-empty">
          <p>尚未载入图片。点击下方按钮选择本地图片，或拖入 / 粘贴多张图片时自动进入画布。</p>
          <button
            type="button"
            className="btn"
            onClick={() => void pickImagesToCanvas(false)}
          >
            选择图片…
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
                    src={
                      texDir
                        ? convertFileSrc(`${texDir}/${cell.path}`.replace(/\\/g, "/"))
                        : cell.path
                    }
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
