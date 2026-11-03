// F2/F3 · 拼图画布（侧栏视图）：网格布局 + 行优先编号 + 每格控件。
// F3 新增：点击选中某格 → 下方「当前子图」编辑器（缩放/裁剪/对齐/子标题 + KaTeX 预览）。
// 编号规则（方案 §3.1）：行优先；编号 (a)(b)(c)… 对应实际子图（填充格），
// 图片数 < 网格格数时末尾留空、不占编号。
import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useFigureStore } from "./figureStore";
import { pickImagesToCanvas } from "./figureImport";
import { subFigureLetter, VAlign, FigureCell } from "@/types/figure";
import { useBuffersStore } from "@/editor/useBuffers";
import { parentOf } from "@/project/useProject";
import SubCaptionPreview from "./SubCaptionPreview";
import "./figure.css";

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export default function FigureCanvas() {
  const layout = useFigureStore((s) => s.layout);
  const setGrid = useFigureStore((s) => s.setGrid);
  const reset = useFigureStore((s) => s.reset);
  const updateCell = useFigureStore((s) => s.updateCell);
  const setAlign = useFigureStore((s) => s.setAlign);
  const setCrop = useFigureStore((s) => s.setCrop);
  // 画布预览需要绝对路径：cell.path 是相对 .tex 的相对路径（给 LaTeX 用），
  // 需还原为绝对路径并转成 webview 可加载的 asset 协议 URL（同 ImageViewer）。
  const activePath = useBuffersStore((s) => s.activePath);
  const texDir = useMemo(() => (activePath ? parentOf(activePath) : ""), [activePath]);

  // F3 · 选中态（纯 UI，不进 store；cells 变化时被 clamp）
  const [selected, setSelected] = useState(-1);
  useEffect(() => {
    if (selected >= layout.cells.length) setSelected(layout.cells.length - 1);
  }, [layout.cells.length, selected]);

  const total = layout.rows * layout.cols;
  const sel = selected >= 0 && selected < layout.cells.length ? layout.cells[selected] : null;

  const clampCrop = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const cropKeys: (keyof FigureCell["crop"])[] = ["l", "b", "r", "t"];
  const cropLabels: Record<keyof FigureCell["crop"], string> = { l: "左", b: "下", r: "右", t: "上" };
  const alignLabels: Record<VAlign, string> = { t: "顶", c: "中", b: "底" };

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
        <>
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
              const isSel = idx === selected;
              return (
                <div
                  key={idx}
                  className={isSel ? "fig-cell fig-cell--selected" : "fig-cell"}
                  onClick={() => setSelected(idx)}
                >
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

          {sel && (
            <div className="fig-editor">
              <div className="fig-editor-head">
                当前子图 ({subFigureLetter(selected)}) · {basename(sel.path)}
              </div>

              <label className="fig-edit-row fig-edit-col">
                <span className="fig-edit-label">子标题</span>
                <input
                  type="text"
                  className="fig-edit-input"
                  value={sel.subCaption}
                  placeholder="如：示意图 $x+y=z$"
                  onChange={(e) => updateCell(selected, { subCaption: e.target.value })}
                />
              </label>
              <SubCaptionPreview text={sel.subCaption} />

              <div className="fig-edit-row">
                <span className="fig-edit-label">缩放</span>
                <input
                  type="number"
                  className="fig-edit-num"
                  step={0.1}
                  min={0.1}
                  max={3}
                  value={sel.scale}
                  onChange={(e) =>
                    updateCell(selected, {
                      scale: Math.max(0.1, Number(e.target.value) || 1),
                    })
                  }
                />
                <span className="fig-edit-hint">微调系数（×统一基准，F5 生成时应用）</span>
              </div>

              <div className="fig-edit-row">
                <span className="fig-edit-label">对齐</span>
                <div className="fig-seg">
                  {(Object.keys(alignLabels) as VAlign[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={sel.align === a ? "fig-seg-btn is-on" : "fig-seg-btn"}
                      onClick={() => setAlign(selected, a)}
                    >
                      {alignLabels[a]}
                    </button>
                  ))}
                </div>
                <span className="fig-edit-hint">顶/中/底 → subfigure [t]/[c]/[b]</span>
              </div>

              <div className="fig-edit-row fig-edit-col">
                <span className="fig-edit-label">裁剪（归一化 0–1）</span>
                <div className="fig-crop-grid">
                  {cropKeys.map((k) => (
                    <label key={k} className="fig-crop-field">
                      {cropLabels[k]}
                      <input
                        type="number"
                        className="fig-edit-num"
                        step={0.05}
                        min={0}
                        max={1}
                        value={sel.crop[k]}
                        onChange={(e) =>
                          setCrop(selected, {
                            ...sel.crop,
                            [k]: clampCrop(Number(e.target.value)),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <span className="fig-edit-hint">左/下/右/上，三导出路径语义一致（§3.4）</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
