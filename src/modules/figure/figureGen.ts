// P2 · subfigure 代码生成（A 路径，纯函数，零副作用）。
//
// 算法口径（见 docs/拼图功能实现方案.md §4）：
//   §4.2 整行宽度预算：每格 width_i = scale_i × base，base 由「整行可用宽度 / Σscale」
//        算出，保证 Σwidth_i + 弹性 \hfill ≤ 1.0\textwidth，永不溢出换行。
//        行内子图数 k < 列数时，末尾空槽不占宽度、不生成 subfigure、不占编号。
//   §4.3 裁剪 canonical 原点 = 图片左上角 (0,0)，x 右 y 下；LaTeX trim= L B R T
//        （bottom-up）由归一化 crop 换算：L=l·W R=r·W B=b·H T=t·H（W,H=自然像素，
//        ≈bp，crop 与 DOM/Canvas 三路径同源）；对齐为**行级**属性（同基线混用 [t]/[b]
//        会导致 [b] 上飘/[t] 下垂，整行统一，取该行首格 align），映射 subfigure [t]/[c]/[b]，
//        其中 [t] 需 \raisebox{-\height} 包裹图片（图片基线在底边，裸 [t] 实为底对齐）。
//   §4.4 间距：列间距以弹性 \hfill 均分（避免硬比例溢出）；行间距 \vspace{gapRow\textwidth}。
//
// 同一 `computeRowLayout` 被生成器与 FigureApproxPreview 共用，保证“近似预览所见≈生成所是”。
import { FigureLayout, FigureCell, VAlign, subFigureLetter } from "@/types/figure";
import { INDENT } from "@/core/latexTemplates";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** 两位/三位小数的 textwidth 比例（如 0.482\textwidth） */
const pct = (n: number) => {
  const v = Math.round(clamp(n, 0, 1) * 1000) / 1000;
  return v.toFixed(v < 0.1 ? 3 : 2);
};

export interface RowLayout {
  /** 该行实际参与（非末尾空槽）的 cell 索引（全局索引） */
  indices: number[];
  /** 与 indices 一一对应的 subfigure 宽度（占 \textwidth 比例） */
  widths: number[];
}

/**
 * 计算某一行的子图布局（宽度预算）。供 figureGen 与近似预览共用。
 * - 自动按 cells.length 补足行数（图片数 > 行×列时加行）。
 * - 末尾空槽（行内不足 cols 的部分）直接忽略，不占编号、不占宽度。
 */
export function computeRowLayout(layout: FigureLayout, rowIndex: number): RowLayout {
  const { cells, cols, gapCol } = layout;
  const totalRows = Math.max(layout.rows, Math.ceil(cells.length / cols));
  if (rowIndex < 0 || rowIndex >= totalRows) return { indices: [], widths: [] };

  const start = rowIndex * cols;
  const indices: number[] = [];
  for (let k = 0; k < cols; k++) {
    const gi = start + k;
    if (gi < cells.length) indices.push(gi);
    // 末尾（行内不足 cols）空槽：不 push
  }
  const k = indices.length;
  if (k === 0) return { indices: [], widths: [] };

  const sumScale = indices.reduce((s, gi) => s + clamp(cells[gi]!.scale, 0.1, 3), 0);
  // 预留 (k-1) 个列间距（占列宽比例），再扣 2% 安全余量给 \hfill 弹性吸收，
  // 确保 Σwidth_i + \hfill ≤ 1.0，绝不溢出换行。
  const reserve = (k - 1) * gapCol;
  const avail = Math.max(0.1, 1 - reserve * 0.9) * 0.98;
  const base = avail / sumScale;
  const widths = indices.map((gi) => clamp(cells[gi]!.scale, 0.1, 3) * base);
  return { indices, widths };
}

/** 生成单格的 \includegraphics 选项（含裁剪 trim/clip） */
function graphicsOpts(cell: FigureCell): string {
  const c = cell.crop;
  const anyCrop = c.l || c.b || c.r || c.t;
  const ns = cell.naturalSize;
  if (anyCrop && ns && ns.w > 0 && ns.h > 0) {
    // canonical 原点左上角：L=l·W R=r·W B=b·H T=t·H（像素≈bp）
    const L = Math.round(c.l * ns.w);
    const R = Math.round(c.r * ns.w);
    const B = Math.round(c.b * ns.h);
    const T = Math.round(c.t * ns.h);
    return `width=\\linewidth, trim=${L} ${B} ${R} ${T}, clip`;
  }
  return "width=\\linewidth";
}

/**
 * 行级对齐：LaTeX 中同一行（同一条基线）的子图必须共用一个对齐选项——
 * 混用 [t]/[b] 会让 [b] 盒子整体升到基线上方、[t] 盒子垂到下方（“飘上天”现象）。
 * 约定：整行取该行首个子图的 align；store 的 setAlign 也按整行写入。
 */
export function rowAlignOf(layout: FigureLayout, indices: number[]): VAlign {
  const first = indices.length > 0 ? layout.cells[indices[0]!] : undefined;
  return first?.align ?? "t";
}

/** 生成一行的 subfigure 串联（含行内 \hfill 与行级对齐选项） */
function renderRow(layout: FigureLayout, rowIndex: number): string {
  const { indices, widths } = computeRowLayout(layout, rowIndex);
  if (indices.length === 0) return "";
  const rowAlign = rowAlignOf(layout, indices);
  const alignOpt = rowAlign === "c" ? "[c]" : rowAlign === "b" ? "[b]" : "[t]";
  const parts = indices.map((gi, i) => {
    const cell = layout.cells[gi]!;
    const w = pct(widths[i]!);
    // [t] 真顶对齐：\includegraphics 的基线在图片底边，裸用 [t] 实际是底边对齐
    // （高图向上伸、顶边反而更高）。\raisebox{-\height} 把图片下移自身高度，
    // 使图片顶边落在基线上，subfigure[t] 才是真·顶对齐（与预览 flex-start 一致）。
    // [c] 盒子垂直中心对齐、[b] 按 caption 基线底对齐，均与预览一致，不需处理。
    // 对齐为行级属性：整行所有子图用同一 rowAlign。
    const gfx = `\\includegraphics[${graphicsOpts(cell)}]{${cell.path}}`;
    const gfxLine =
      rowAlign === "t"
        ? `\\raisebox{-\\height}{${gfx}}`
        : gfx;
    const caption = cell.subCaption.trim();
    const inner = [
      `${INDENT}${INDENT}\\centering`,
      `${INDENT}${INDENT}${gfxLine}`,
      `${INDENT}${INDENT}\\caption{${caption}}`,
      `${INDENT}${INDENT}\\label{${cell.label}}`,
    ].join("\n");
    return [
      `${INDENT}\\begin{subfigure}${alignOpt}{${w}\\textwidth}`,
      inner,
      `${INDENT}\\end{subfigure}`,
    ].join("\n");
  });
  // 行内子图之间用 \hfill 弹性均分剩余（避免硬比例溢出换行）
  return parts.join(`\n${INDENT}\\hfill\n`);
}

export interface GenResult {
  /** 完整 figure 环境代码 */
  code: string;
  /** 是否存在（防御性）超宽行（预算已保证不存在，仅作自检标记） */
  overwide: boolean;
}

/**
 * 生成 subfigure 拼图代码：外层 figure 环境（顺序固定 centering→各行→caption→label），
 * 内部按宽度预算拼 subfigure 网格；空槽留空、超网格自动加行。
 */
export function generateSubfigure(layout: FigureLayout): GenResult {
  const { cells, cols, gapRow, caption, label } = layout;
  const totalRows = Math.max(layout.rows, Math.ceil(cells.length / cols));

  const rows: string[] = [];
  let overwide = false;
  for (let r = 0; r < totalRows; r++) {
    const rl = computeRowLayout(layout, r);
    const rowWidthSum = rl.widths.reduce((s, w) => s + w, 0) + (rl.indices.length - 1) * gapRow;
    if (rowWidthSum > 1.0001) overwide = true;
    if (rl.indices.length === 0) continue;
    rows.push(renderRow(layout, r));
  }

  // 行间先插一个空行（段落换行）再放 \vspace：保证第二行另起一段，
  // 使 [t] 子图真正按“行顶”对齐，与预览“每行独立 margin-top”一致（修复渲染错位）。
  const body = rows.join(`\n\n${INDENT}\\vspace{${pct(gapRow)}\\textwidth}\n`);
  const cap = caption.trim();
  const lab = label.trim();

  const lines = [
    "\\begin{figure}[htbp]",
    `${INDENT}\\centering`,
    body,
    cap ? `${INDENT}\\caption{${cap}}` : `${INDENT}\\caption{}`,
    lab ? `${INDENT}\\label{${lab}}` : `${INDENT}\\label{fig:}`,
    "\\end{figure}",
  ];
  return { code: lines.join("\n"), overwide };
}

/** 仅用于调试/单测：返回 (行数, 每行 cell 字母) 便于肉眼核查编号 */
export function describeLayout(layout: FigureLayout): string {
  const totalRows = Math.max(layout.rows, Math.ceil(layout.cells.length / layout.cols));
  const out: string[] = [];
  for (let r = 0; r < totalRows; r++) {
    const rl = computeRowLayout(layout, r);
    out.push(`row${r}: ${rl.indices.map((gi) => subFigureLetter(gi)).join(" ")}`);
  }
  return out.join(" | ");
}
