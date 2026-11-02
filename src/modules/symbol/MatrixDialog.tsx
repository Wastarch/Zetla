// M1-12b 追加 · 矩阵生成浮层（点击矩阵图标就地展开，替代居中模态）
// 选环境 / 行 / 列（上限 10），cases 强制锁列=2；确认生成带 \Box 的 LaTeX，
// 经 onApply 交由 SymbolPanel 按触发方式（写入编写区 / 直插编辑器）落位。
// 定位：锚定触发图标（优先右侧=侧栏旁），视口夹取；点击浮层外/矩阵图标外/Esc/失焦关闭。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import FormulaKaTeX from "@/modules/formula/FormulaKaTeX";
import { MATRIX_ENVS, makeMatrixLatex } from "@/modules/formula/builderTypes";

const MIN = 1;
const MAX = 10;

export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function MatrixDialog({
  mode,
  initialEnv,
  anchor,
  onApply,
  onClose,
}: {
  /** 触发方式：write = 单击（写入编写区）；direct = 右键（直插编辑器） */
  mode: "write" | "direct";
  /** 初始环境（点击某括号样式图标时预选；缺省取首个） */
  initialEnv?: string;
  /** 触发图标的视口矩形，用于定位浮层 */
  anchor: AnchorRect;
  /** 确认：回传生成的带 \Box 矩阵 LaTeX */
  onApply: (latex: string) => void;
  onClose: () => void;
}) {
  const envKeys = Object.keys(MATRIX_ENVS);
  const [env, setEnv] = useState<string>(initialEnv ?? envKeys[0]);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x + anchor.w + 8, top: anchor.y });

  const isCases = env === "cases";
  const effCols = isCases ? 2 : cols;
  const clampN = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v) || MIN));
  const previewTex = makeMatrixLatex(env, rows, effCols);

  // 关闭：点击浮层内不关；点击其他矩阵图标（.is-tpl）不关（用于切换重定位）；其余外部=关
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (ref.current?.contains(t)) return;
      if (t?.closest?.(".symbol-btn.is-tpl")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // 定位：优先放在图标右侧（侧栏旁），放不下则左侧；上下夹取到视口
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const gap = 8;
    let left = anchor.x + anchor.w + gap;
    if (left + r.width > window.innerWidth - 8) left = anchor.x - r.width - gap; // 右侧放不下→左侧
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(anchor.y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [anchor, env, rows, cols]); // 内容（行/列/环境）变化可能改高度，重新夹取

  return (
    <div
      ref={ref}
      className="matrix-pop"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="矩阵设置"
    >
      <div className="mp-head">
        <h3>{MATRIX_ENVS[env]} · 行列表</h3>
        <button type="button" className="btn icon x" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="mp-body">
        <label className="entry-label" htmlFor="matrix-env">
          类型
        </label>
        <select
          id="matrix-env"
          className="entry-input"
          value={env}
          onChange={(e) => setEnv(e.target.value)}
        >
          {envKeys.map((k) => (
            <option key={k} value={k}>
              {MATRIX_ENVS[k]}
            </option>
          ))}
        </select>

        <div className="matrix-grid">
          <div className="matrix-field">
            <label className="entry-label" htmlFor="matrix-rows">
              行数
            </label>
            <div className="matrix-stepper">
              <button
                type="button"
                className="btn"
                onClick={() => setRows((r) => clampN(r - 1))}
                aria-label="行数减一"
              >
                −
              </button>
              <input
                id="matrix-rows"
                type="number"
                min={MIN}
                max={MAX}
                value={rows}
                onChange={(e) => setRows(clampN(Number(e.target.value)))}
              />
              <button
                type="button"
                className="btn"
                onClick={() => setRows((r) => clampN(r + 1))}
                aria-label="行数加一"
              >
                +
              </button>
            </div>
          </div>

          <div className="matrix-field">
            <label className="entry-label" htmlFor="matrix-cols">
              列数
            </label>
            <div className="matrix-stepper">
              <button
                type="button"
                className="btn"
                disabled={isCases}
                onClick={() => setCols((c) => clampN(c - 1))}
                aria-label="列数减一"
              >
                −
              </button>
              <input
                id="matrix-cols"
                type="number"
                min={MIN}
                max={MAX}
                value={effCols}
                disabled={isCases}
                onChange={(e) => setCols(clampN(Number(e.target.value)))}
              />
              <button
                type="button"
                className="btn"
                disabled={isCases}
                onClick={() => setCols((c) => clampN(c + 1))}
                aria-label="列数加一"
              >
                +
              </button>
            </div>
            {isCases && <span className="matrix-hint">cases 固定 2 列</span>}
          </div>
        </div>

        <label className="entry-label">预览</label>
        <div className="matrix-preview">
          <FormulaKaTeX tex={previewTex} />
        </div>
      </div>

      <div className="mp-foot">
        <button type="button" className="btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="btn primary" onClick={() => onApply(previewTex)}>
          {mode === "direct" ? "直接插入编辑器" : "写入编写区"}
        </button>
      </div>
    </div>
  );
}
