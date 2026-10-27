// M1-8 · 表格数据模型（纯函数，无 React / 无 IO 依赖，便于单测与复用）
// 设计口径（开发文档 §4.2 + 计划文档 M1-8 详节）：
//   - 合并只在锚点单元格记录 span（colSpan/rowSpan），被覆盖格置 covered=true 且清空文本；
//   - 增删行列时先做纯结构变换，再按"旧坐标 → 新坐标"映射重建 span，
//     避免出现悬空覆盖格/错位合并（比在遍历中就地修补更不易出错）；
//   - 所有操作返回新模型（不可变更新），UI 侧直接 setState 即可。

/** 水平对齐（对应 tabular 列规格 l/c/r） */
export type HAlign = "l" | "c" | "r";

/** 表格线风格：booktabs 三线表 / grid 全框线 / plain 无线 */
export type TableStyle = "booktabs" | "grid" | "plain";

/** 单元格转义模式（见 tableGen.escapeCellText） */
export type EscapeMode = "smart" | "full" | "off";

/** 表格宽度：auto = 自然宽度；full = tabularx 撑满 \linewidth */
export type TableWidth = "auto" | "full";

export interface Cell {
  text: string;
  /** 横向合并列数（≥2 → \multicolumn） */
  colSpan?: number;
  /** 纵向合并行数（≥2 → \multirow） */
  rowSpan?: number;
  /** 关闭自动转义（本格写原生 LaTeX，如 $\alpha$ / \textbf{粗}） */
  raw?: boolean;
  /** 单元格级对齐覆盖（合并格生成 \multicolumn{n}{<align>} 时使用） */
  align?: HAlign;
  /** 被左侧/上方的合并覆盖（渲染时跳过、不可编辑） */
  covered?: boolean;
}

export interface TableModel {
  rows: number;
  cols: number;
  /** rows × cols；被覆盖位置仍占位（covered=true, text=""） */
  cells: Cell[][];
  /** 每列默认对齐 */
  aligns: HAlign[];
  /** 首行作为表头（三线表在首行后加 \midrule） */
  header: boolean;
  caption: string;
  label: string;
  /** 是否带编号（false → table*，不进入表格目录/编号） */
  numbered: boolean;
  /** 浮动位置参数，默认 "htbp" */
  placement: string;
  style: TableStyle;
  width: TableWidth;
  escape: EscapeMode;
}

/** 行列上限（防误粘贴大表卡死；超限时 UI 禁用增行增列） */
export const TABLE_MAX_ROWS = 100;
export const TABLE_MAX_COLS = 20;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
}

function blankCell(): Cell {
  return { text: "" };
}

function blankRow(cols: number): Cell[] {
  return Array.from({ length: cols }, blankCell);
}

function cloneGrid(m: TableModel): Cell[][] {
  return m.cells.map((row) => row.map((cell) => ({ ...cell })));
}

/** 建表（默认 3×3，与 R6 验收样例一致） */
export function createTable(
  rows = 3,
  cols = 3,
  patch: Partial<TableModel> = {},
): TableModel {
  const r = clamp(rows, 1, TABLE_MAX_ROWS);
  const c = clamp(cols, 1, TABLE_MAX_COLS);
  const base: TableModel = {
    rows: r,
    cols: c,
    cells: Array.from({ length: r }, () => blankRow(c)),
    aligns: Array.from({ length: c }, (): HAlign => "c"),
    header: true,
    caption: "",
    label: "",
    numbered: true,
    placement: "htbp",
    style: "booktabs",
    width: "auto",
    escape: "smart",
  };
  return normalizeModel({ ...base, ...patch, rows: r, cols: c });
}

/**
 * 形状归一：保证 cells 的 rows×cols 维度、aligns 长度、span 不越界。
 * 解析/导入/设置变更后统一走一次，避免 UI 读到越界索引。
 */
export function normalizeModel(m: TableModel): TableModel {
  const rows = clamp(m.rows, 1, TABLE_MAX_ROWS);
  const cols = clamp(m.cols, 1, TABLE_MAX_COLS);
  const cells: Cell[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const src = m.cells[r]?.[c];
      const cell: Cell = src ? { ...src } : blankCell();
      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      cell.colSpan = Math.min(cs, cols - c);
      cell.rowSpan = Math.min(rs, rows - r);
      if (cell.colSpan < 2) delete cell.colSpan;
      if (cell.rowSpan < 2) delete cell.rowSpan;
      if (!cell.text) cell.text = "";
      return cell;
    }),
  );
  const aligns: HAlign[] = Array.from({ length: cols }, (_, i) => m.aligns[i] ?? "c");
  return { ...m, rows, cols, cells, aligns };
}

/** 读单元格（越界返回 undefined） */
export function cellAt(m: TableModel, r: number, c: number): Cell | undefined {
  return m.cells[r]?.[c];
}

/** 改单元格文本（不可变更新） */
export function setCellText(m: TableModel, r: number, c: number, text: string): TableModel {
  if (!m.cells[r]?.[c]) return m;
  const cells = m.cells.map((row, ri) =>
    ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, text } : cell)) : row,
  );
  return { ...m, cells };
}

/** 切换单元格 raw（关闭转义） */
export function toggleCellRaw(m: TableModel, r: number, c: number): TableModel {
  if (!m.cells[r]?.[c]) return m;
  const cells = m.cells.map((row, ri) =>
    ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, raw: !cell.raw } : cell)) : row,
  );
  return { ...m, cells };
}

/** 设列对齐 */
export function setColumnAlign(m: TableModel, col: number, align: HAlign): TableModel {
  if (col < 0 || col >= m.cols) return m;
  const aligns = m.aligns.map((a, i) => (i === col ? align : a));
  return { ...m, aligns };
}

interface SpanInfo {
  r: number;
  c: number;
  rs: number;
  cs: number;
  /** 锚点内容（text/raw/align），建新网格时回填 */
  cell: Cell;
}

/** 收集所有合并锚点（rs/cs ≥ 2） */
function spanAnchors(m: TableModel): SpanInfo[] {
  const out: SpanInfo[] = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const cell = m.cells[r][c];
      if (cell.covered) continue;
      const rs = cell.rowSpan ?? 1;
      const cs = cell.colSpan ?? 1;
      if (rs > 1 || cs > 1) {
        out.push({ r, c, rs, cs, cell: { ...cell } });
      }
    }
  }
  return out;
}

/**
 * 用「无 span 的干净网格 + 目标 span 列表」重建合并标记。
 * 网格维度以 rows/cols 为准；越界的 span 由 normalizeModel 统一收敛。
 */
function applySpans(
  grid: Cell[][],
  rows: number,
  cols: number,
  spans: SpanInfo[],
): Cell[][] {
  // 1) 清空所有 span / covered，只留文本
  const cells: Cell[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const src = grid[r]?.[c] ?? blankCell();
      return { text: src.text ?? "", raw: src.raw, align: src.align };
    }),
  );
  // 2) 按 span 回填锚点并标记覆盖格
  for (const s of spans) {
    if (s.r < 0 || s.r >= rows || s.c < 0 || s.c >= cols) continue;
    if (s.rs < 2 && s.cs < 2) continue;
    const anchor: Cell = { text: s.cell.text, raw: s.cell.raw, align: s.cell.align };
    if (s.rs > 1) anchor.rowSpan = Math.min(s.rs, rows - s.r);
    if (s.cs > 1) anchor.colSpan = Math.min(s.cs, cols - s.c);
    cells[s.r][s.c] = anchor;
    for (let rr = s.r; rr < s.r + s.rs && rr < rows; rr++) {
      for (let cc = s.c; cc < s.c + s.cs && cc < cols; cc++) {
        if (rr === s.r && cc === s.c) continue;
        cells[rr][cc] = { text: "", covered: true };
      }
    }
  }
  return cells;
}

/** 找覆盖 (r,c) 的锚点（自身即锚点则返回自身坐标）；无合并返回 null */
export function findAnchor(m: TableModel, r: number, c: number): { r: number; c: number } | null {
  for (const s of spanAnchors(m)) {
    if (r >= s.r && r < s.r + s.rs && c >= s.c && c < s.c + s.cs) return { r: s.r, c: s.c };
  }
  return null;
}

/** 拆分 (r,c) 所在的合并块（无合并时原样返回） */
export function splitAt(m: TableModel, r: number, c: number): TableModel {
  const anchor = findAnchor(m, r, c);
  if (!anchor) return m;
  const spans = spanAnchors(m).filter((s) => !(s.r === anchor.r && s.c === anchor.c));
  const cells = applySpans(cloneGrid(m), m.rows, m.cols, spans);
  return { ...m, cells };
}

/**
 * 合并矩形区域（自动拆分与之相交的既有合并，保证不产生交叠 span）。
 * 左上角保留文本，其余清空并标 covered。
 */
export function mergeRange(
  m: TableModel,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): TableModel {
  const top = Math.max(0, Math.min(r1, r2));
  const left = Math.max(0, Math.min(c1, c2));
  const bottom = Math.min(m.rows - 1, Math.max(r1, r2));
  const right = Math.min(m.cols - 1, Math.max(c1, c2));
  if (bottom <= top && right <= left) return m;

  // 先剔除与目标矩形相交的既有 span（其余保留）
  const spans = spanAnchors(m).filter(
    (s) => s.r + s.rs - 1 < top || s.r > bottom || s.c + s.cs - 1 < left || s.c > right,
  );
  const grid = cloneGrid(m);
  const anchorText = grid[top][left]?.text ?? "";
  const anchorRaw = grid[top][left]?.raw;
  const anchorAlign = grid[top][left]?.align;
  spans.push({
    r: top,
    c: left,
    rs: bottom - top + 1,
    cs: right - left + 1,
    cell: { text: anchorText, raw: anchorRaw, align: anchorAlign },
  });
  return { ...m, cells: applySpans(grid, m.rows, m.cols, spans) };
}

/** 在 at 处插入一行（at = rows 表示追加到末尾） */
export function insertRow(m: TableModel, at: number): TableModel {
  if (m.rows >= TABLE_MAX_ROWS) return m;
  const idx = clamp(at, 0, m.rows);
  const spans = spanAnchors(m);
  const grid = cloneGrid(m);
  grid.splice(idx, 0, blankRow(m.cols));
  // 旧行坐标 → 新行坐标；跨过插入点的 span 纵向 +1（新行并入该块）
  const mapped: SpanInfo[] = spans.map((s) => ({
    ...s,
    r: s.r >= idx ? s.r + 1 : s.r,
    rs: idx > s.r && idx < s.r + s.rs ? s.rs + 1 : s.rs,
  }));
  const cells = applySpans(grid, m.rows + 1, m.cols, mapped);
  return normalizeModel({ ...m, rows: m.rows + 1, cells });
}

/** 删除第 at 行 */
export function removeRow(m: TableModel, at: number): TableModel {
  if (m.rows <= 1) return m;
  const idx = clamp(at, 0, m.rows - 1);
  const spans = spanAnchors(m);
  const grid = cloneGrid(m);
  grid.splice(idx, 1);
  const mapped: SpanInfo[] = [];
  for (const s of spans) {
    if (s.r === idx) continue; // 锚点行被删 → 合并解除
    const r = s.r > idx ? s.r - 1 : s.r;
    const rs = idx > s.r && idx < s.r + s.rs ? s.rs - 1 : s.rs;
    mapped.push({ ...s, r, rs });
  }
  const cells = applySpans(grid, m.rows - 1, m.cols, mapped);
  return normalizeModel({ ...m, rows: m.rows - 1, cells });
}

/** 在 at 处插入一列 */
export function insertCol(m: TableModel, at: number): TableModel {
  if (m.cols >= TABLE_MAX_COLS) return m;
  const idx = clamp(at, 0, m.cols);
  const spans = spanAnchors(m);
  const grid = cloneGrid(m);
  for (const row of grid) row.splice(idx, 0, blankCell());
  const mapped: SpanInfo[] = spans.map((s) => ({
    ...s,
    c: s.c >= idx ? s.c + 1 : s.c,
    cs: idx > s.c && idx < s.c + s.cs ? s.cs + 1 : s.cs,
  }));
  const cells = applySpans(grid, m.rows, m.cols + 1, mapped);
  const aligns = [...m.aligns];
  aligns.splice(idx, 0, m.aligns[idx] ?? m.aligns[idx - 1] ?? "c");
  return normalizeModel({ ...m, cols: m.cols + 1, cells, aligns });
}

/** 删除第 at 列 */
export function removeCol(m: TableModel, at: number): TableModel {
  if (m.cols <= 1) return m;
  const idx = clamp(at, 0, m.cols - 1);
  const spans = spanAnchors(m);
  const grid = cloneGrid(m);
  for (const row of grid) row.splice(idx, 1);
  const mapped: SpanInfo[] = [];
  for (const s of spans) {
    if (s.c === idx) continue; // 锚点列被删 → 合并解除
    const c = s.c > idx ? s.c - 1 : s.c;
    const cs = idx > s.c && idx < s.c + s.cs ? s.cs - 1 : s.cs;
    mapped.push({ ...s, c, cs });
  }
  const cells = applySpans(grid, m.rows, m.cols - 1, mapped);
  const aligns = m.aligns.filter((_, i) => i !== idx);
  return normalizeModel({ ...m, cols: m.cols - 1, cells, aligns });
}

/** 由二维文本矩阵建表（CSV/TSV 导入、剪贴板粘贴共用） */
export function fromMatrix(
  matrix: string[][],
  patch: Partial<TableModel> = {},
): TableModel {
  const rows = Math.max(1, Math.min(TABLE_MAX_ROWS, matrix.length));
  const cols = Math.max(
    1,
    Math.min(TABLE_MAX_COLS, Math.max(...matrix.map((r) => r.length), 1)),
  );
  const cells: Cell[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ text: matrix[r]?.[c] ?? "" })),
  );
  return createTable(rows, cols, { ...patch, cells });
}

/** 导出为二维文本矩阵（合并格只取锚点文本） */
export function toMatrix(m: TableModel): string[][] {
  return m.cells.map((row) => row.map((cell) => (cell.covered ? "" : cell.text)));
}

/** 取矩形区域文本矩阵（选区复制为 TSV 用） */
export function rangeMatrix(
  m: TableModel,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): string[][] {
  const top = Math.max(0, Math.min(r1, r2));
  const bottom = Math.min(m.rows - 1, Math.max(r1, r2));
  const left = Math.max(0, Math.min(c1, c2));
  const right = Math.min(m.cols - 1, Math.max(c1, c2));
  const out: string[][] = [];
  for (let r = top; r <= bottom; r++) {
    const row: string[] = [];
    for (let c = left; c <= right; c++) {
      const cell = m.cells[r][c];
      row.push(cell.covered ? "" : cell.text);
    }
    out.push(row);
  }
  return out;
}

/**
 * 从剪贴板矩阵铺入：以 (r0,c0) 为左上角，按需扩表（受行列上限约束）。
 * 覆盖范围内的既有文本；合并块内部（covered）跳过，不破坏合并结构。
 */
export function pasteMatrix(
  m: TableModel,
  r0: number,
  c0: number,
  matrix: string[][],
): TableModel {
  const rows = Math.min(TABLE_MAX_ROWS, Math.max(m.rows, r0 + matrix.length));
  const cols = Math.min(
    TABLE_MAX_COLS,
    Math.max(m.cols, c0 + Math.max(...matrix.map((r) => r.length), 1)),
  );
  const next = createTable(rows, cols, m);
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      const tr = r0 + r;
      const tc = c0 + c;
      if (tr >= rows || tc >= cols) continue;
      const cell = next.cells[tr][tc];
      if (cell.covered) continue;
      next.cells[tr][tc] = { ...cell, text: matrix[r][c] };
    }
  }
  return next;
}

/** 是否含任何合并（UI 提示用） */
export function hasMerge(m: TableModel): boolean {
  return spanAnchors(m).length > 0;
}
