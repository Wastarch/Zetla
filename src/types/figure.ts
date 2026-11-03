// F1 · 拼图功能数据模型（FigureLayout）
// 前端会话级状态；阶段一无 IPC 落盘需求，故暂不与 Rust struct 一一对应
// （后续若需跨 IPC，再补 src-tauri/src/commands/figure.rs + lib.rs + ipc/invoke.ts 三处）。
// 主产物为 subfigure 代码（生成器见 modules/figure/figureGen.ts，F5）。
//
// 设计口径（详见 docs/拼图功能实现方案.md）：
//   - cells.length === 1 即单图：数据层共用，交互层分离（单图走 importImage 直插，不进画布）。
//   - 间距内部以「占列宽比例」建模，绕开画布像素 → LaTeX 相对单位的换算糊涂账（§3.3）。
//   - crop 统一为归一化 0–1 四边 trim，三导出路径（subfigure / PNG / PDF）语义一致（§3.4）。

/** 垂直对齐：映射到 subfigure 环境的 [t]/[c]/[b]（§3.4） */
export type VAlign = "t" | "c" | "b";

/** 统一尺寸模式（§3.4）：统一高度 / 统一宽度 / 保持原比例 */
export type UniformMode = "height" | "width" | "none";

/** 单个子图格（对应一个 \includegraphics + \subcaption） */
export interface FigureCell {
  /** 相对 .tex 的图片路径（slugify 命名，复用 editor/image/pathUtils.relativePath） */
  path: string;
  /** 统一模式之外的微调缩放系数（1 = 不调） */
  scale: number;
  /** 裁剪区域：归一化 0–1 四边 trim（左/下/右/上），全 0 表示不裁 */
  crop: { l: number; b: number; r: number; t: number };
  /** 垂直对齐 */
  align: VAlign;
  /** 子标题（可含 $...$，KaTeX 预览；F3 接通） */
  subCaption: string;
  /** 自动生成的 \label，如 fig:sub-a（行优先，详见 subLabel） */
  label: string;
}

/** 整体拼图布局 */
export interface FigureLayout {
  /** 子图格（行优先填充） */
  cells: FigureCell[];
  /** 网格行数 */
  rows: number;
  /** 网格列数 */
  cols: number;
  /** 列间距：占列宽比例 [0,1]（F5 映射为 \hfill 或 \hspace{g\textwidth}） */
  gapCol: number;
  /** 行间距：占列宽比例 [0,1]（映射为 \vspace 或 \medskip） */
  gapRow: number;
  /** 统一尺寸模式 */
  uniform: UniformMode;
  /** 外层 figure 标题（可选） */
  caption: string;
  /** 外层 figure \label（含 fig: 前缀） */
  label: string;
}

/** 默认列/行间距（占列宽 3%） */
export const DEFAULT_GAP = 0.03;
/** 默认网格（1 行 2 列，论文并排双图最常见） */
export const DEFAULT_ROWS = 1;
export const DEFAULT_COLS = 2;

/**
 * 由索引生成子图字母标签（行优先）：0->a … 25->z 26->aa …
 * 论文极少超 26 子图，bijective base-26 足够。
 */
export function subFigureLetter(i: number): string {
  let s = "";
  let n = i + 1; // 1-based：0 -> a
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(97 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 生成子图 \label（fig:sub-<letter>） */
export function subLabel(i: number): string {
  return `fig:sub-${subFigureLetter(i)}`;
}

/** 创建一个空 cell（给定路径与索引，索引决定自动 label） */
export function makeCell(path: string, index: number): FigureCell {
  return {
    path,
    scale: 1,
    crop: { l: 0, b: 0, r: 0, t: 0 },
    align: "t",
    subCaption: "",
    label: subLabel(index),
  };
}

/** 默认布局（供 store 初始化与重置） */
export function defaultLayout(): FigureLayout {
  return {
    cells: [],
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
    gapCol: DEFAULT_GAP,
    gapRow: DEFAULT_GAP,
    uniform: "none",
    caption: "",
    label: "fig:",
  };
}
