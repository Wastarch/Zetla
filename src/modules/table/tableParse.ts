// M1-8 · 表格反向解析（纯函数）
// 目标：从光标处已有的 tabular/tabularx/tabular* 环境还原 TableModel，供「编辑当前表格」回填。
// 只做表格子集的稳健切分，不追求通用 LaTeX 解析器：
//   - 顶层 `\\` 切行、顶层 `&` 切格（跳过花括号内与 `\&`）；
//   - 剥离 \toprule/\midrule/\bottomrule/\hline/\cline/\cmidrule；
//   - 识别 \multicolumn / \multirow 反推 colSpan/rowSpan；
//   - 外层 \begin{table} 的 caption/label/placement/numbered 一并取出。
// 还原后 escape 固定为 "off"：保留源码原样（避免二次转义），由面板提示该口径。
import {
  createTable,
  type Cell,
  type EscapeMode,
  type HAlign,
  type TableModel,
} from "./tableModel";

const TABULAR_BEGIN = /\\begin\{(tabular\*?|tabularx)\}/g;

/** djb2 指纹（用于「更新表格」前校验源码是否被手改） */
export function fingerprintOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 读一个平衡花括号组（s[i] 必须是 '{'）；返回组内文本与结束位置 */
export function readGroup(s: string, i: number): { text: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === "\\") {
      j++; // 跳过转义字符（\{ \} 不参与配对）
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** 列规格 → 每列对齐（支持 l/c/r/X/p{..}/m{..}/b{..}、@{} >{} <{} 与 *{n}{spec}） */
export function parseColSpec(spec: string): HAlign[] {
  const aligns: HAlign[] = [];
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === "l" || ch === "c" || ch === "r") {
      aligns.push(ch);
      continue;
    }
    if (ch === "X") {
      aligns.push("c");
      continue;
    }
    if (ch === "p" || ch === "m" || ch === "b") {
      aligns.push("l");
      const g = readGroup(spec, i + 1);
      if (g) i = g.end - 1;
      continue;
    }
    if (ch === "@" || ch === ">" || ch === "<") {
      const g = readGroup(spec, i + 1);
      if (g) i = g.end - 1;
      continue;
    }
    if (ch === "*") {
      const cnt = readGroup(spec, i + 1);
      if (!cnt) continue;
      const inner = readGroup(spec, cnt.end);
      if (!inner) {
        i = cnt.end - 1;
        continue;
      }
      const n = Math.min(64, Math.max(0, parseInt(cnt.text.trim(), 10) || 0));
      const sub = parseColSpec(inner.text);
      for (let k = 0; k < n; k++) aligns.push(...sub);
      i = inner.end - 1;
    }
  }
  return aligns;
}

/** 按顶层 `\\` 切行（花括号内与转义命令不切） */
function splitRows(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      if (s[i + 1] === "\\" && depth === 0) {
        out.push(buf);
        buf = "";
        i++;
        continue;
      }
      buf += ch + (s[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    buf += ch;
  }
  out.push(buf);
  return out;
}

/** 按顶层 `&` 切格（花括号内与 `\&` 不切） */
function splitCells(row: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "\\") {
      buf += ch + (row[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "&" && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

/** 剥掉规则线与行内排版噪声（保留单元格文本） */
function stripRules(body: string): string {
  return body
    .replace(/\\(toprule|midrule|bottomrule|hline)\b(\[[^\]]*\])?/g, " ")
    .replace(/\\cline\{[^}]*\}/g, " ")
    .replace(/\\cmidrule(\([^)]*\))?\{[^}]*\}/g, " ");
}

/** 解析单元格文本 → Cell（识别 multicolumn / multirow 包裹，逐组读取避免正则歧义） */
function parseCell(text: string): Cell {
  let body = text.trim();
  let colSpan = 1;
  let rowSpan = 1;
  let align: HAlign | undefined;

  // \multicolumn{n}{spec}{text} —— 可能在外层，先剥
  if (body.startsWith("\\multicolumn")) {
    const g1 = readGroup(body, "\\multicolumn".length);
    const g2 = g1 && readGroup(body, g1.end);
    const g3 = g2 && readGroup(body, g2.end);
    if (g1 && g2 && g3) {
      colSpan = Math.max(1, parseInt(g1.text.trim(), 10) || 1);
      const spec = g2.text;
      if (spec.includes("l")) align = "l";
      else if (spec.includes("r")) align = "r";
      else if (spec.includes("c")) align = "c";
      body = g3.text.trim();
    }
  }
  // \multirow{m}{width}{text}
  if (body.startsWith("\\multirow")) {
    const g1 = readGroup(body, "\\multirow".length);
    const g2 = g1 && readGroup(body, g1.end);
    const g3 = g2 && readGroup(body, g2.end);
    if (g1 && g2 && g3) {
      rowSpan = Math.max(1, parseInt(g1.text.trim(), 10) || 1);
      body = g3.text.trim();
    }
  }
  // 清掉单元格首尾可能残留的规则线
  body = stripRules(body).trim();
  const cell: Cell = { text: body };
  if (colSpan > 1) cell.colSpan = colSpan;
  if (rowSpan > 1) cell.rowSpan = rowSpan;
  if (align) cell.align = align;
  return cell;
}

export interface ParsedTable {
  model: TableModel;
  from: number;
  to: number;
  fingerprint: string;
}

/** 定位光标所在的 table/tabular 环境边界 */
function findEnv(
  doc: string,
  pos: number,
): { name: string; from: number; to: number } | null {
  let from = -1;
  let name = "";
  TABULAR_BEGIN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABULAR_BEGIN.exec(doc))) {
    if (m.index > pos) break;
    from = m.index;
    name = m[1];
  }
  if (from < 0) return null;
  const endTag = `\\end{${name}}`;
  const endIdx = doc.indexOf(endTag, from);
  if (endIdx < 0) return null;
  const to = endIdx + endTag.length;
  if (pos > to) return null;
  return { name, from, to };
}

/** 从光标处解析表格；失败返回 null（面板据此提示"未找到可编辑的表格"） */
export function parseTableAt(doc: string, pos: number): ParsedTable | null {
  const env = findEnv(doc, pos);
  if (!env) return null;

  const source = doc.slice(env.from, env.to);
  // 1) 头部：\begin{env} 之后读宽度组（tabularx/tabular*）与列规格组
  const head = `\\begin{${env.name}}`;
  let i = head.length;
  if (env.name === "tabularx" || env.name === "tabular*") {
    const w = readGroup(source, i);
    if (!w) return null;
    i = w.end;
  }
  const specGroup = readGroup(source, i);
  if (!specGroup) return null;
  const spec = specGroup.text;
  const bodyStart = specGroup.end;
  const bodyEnd = source.length - `\\end{${env.name}}`.length;
  if (bodyEnd <= bodyStart) return null;
  const rawBody = source.slice(bodyStart, bodyEnd);

  // 2) 表头判定：首行结束（第一个 \\）之后、第二行结束之前出现 \midrule/\hline
  const firstBreak = rawBody.indexOf("\\\\");
  let hasHeaderRule = false;
  if (firstBreak >= 0) {
    const afterFirst = rawBody.slice(firstBreak + 2);
    const rule = /\\(midrule|hline)\b/.exec(afterFirst);
    const nextBreak = afterFirst.indexOf("\\\\");
    hasHeaderRule = !!rule && (nextBreak < 0 || rule.index < nextBreak);
  }

  // 3) 行/格切分：先按顶层 \\ 切段（规则线落在段内，随后剥离），
  //    仅去掉首/尾"纯规则"空段；中间的空段是"整行被合并覆盖"的真实行，必须保留。
  const segments = splitRows(rawBody);
  const rowTexts: string[] = [];
  segments.forEach((seg, i) => {
    const stripped = stripRules(seg).trim();
    const isFirst = i === 0;
    const isLast = i === segments.length - 1;
    if (stripped === "" && (isFirst || isLast)) return;
    rowTexts.push(stripped);
  });
  const parsedRows = rowTexts.map((r) => splitCells(r).map((c) => parseCell(c)));
  if (parsedRows.length === 0) return null;

  const aligns = parseColSpec(spec);
  const cols = Math.max(
    aligns.length,
    ...parsedRows.map((r) => r.reduce((n, c) => n + (c.colSpan ?? 1), 0)),
  );
  const rows = parsedRows.length;
  if (rows > 100 || cols > 20) return null; // 超出面板上限（防大表卡死）

  // 4) 铺格 + 标记 covered
  const cells: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): Cell => ({ text: "" })),
  );
  parsedRows.forEach((rowCells, r) => {
    let c = 0;
    for (const cell of rowCells) {
      while (c < cols && cells[r][c].covered) c++;
      if (c >= cols) break;
      cells[r][c] = cell;
      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      for (let rr = r; rr < r + rs && rr < rows; rr++) {
        for (let cc = c; cc < c + cs && cc < cols; cc++) {
          if (rr === r && cc === c) continue;
          cells[rr][cc] = { text: "", covered: true };
        }
      }
      c += cs;
    }
  });

  // 5) 外层 table 环境的 caption/label/placement/numbered
  let caption = "";
  let label = "";
  let placement = "";
  let numbered = true;
  const outerBegin = doc.lastIndexOf("\\begin{table", env.from);
  if (outerBegin >= 0) {
    const isStar = doc.startsWith("\\begin{table*}", outerBegin);
    numbered = !isStar;
    const headEnd = doc.indexOf("}", outerBegin) + 1;
    const pl = /^\[([^\]]*)\]/.exec(doc.slice(headEnd));
    if (pl) placement = pl[1];
    const outerEnd = doc.indexOf(isStar ? "\\end{table*}" : "\\end{table}", env.to);
    if (outerEnd > 0) {
      const outer = doc.slice(outerBegin, outerEnd);
      const capIdx = outer.indexOf("\\caption");
      if (capIdx >= 0) {
        const braceIdx = outer.indexOf("{", capIdx);
        const g = readGroup(outer, braceIdx);
        if (g) caption = g.text;
      }
      const labIdx = outer.indexOf("\\label");
      if (labIdx >= 0) {
        const braceIdx = outer.indexOf("{", labIdx);
        const g = readGroup(outer, braceIdx);
        if (g) label = g.text;
      }
    }
  }

  // 6) 组装模型（escape 固定 off：保源码原样，避免二次转义）
  const escape: EscapeMode = "off";
  const patch: Partial<TableModel> = {
    cells,
    header: hasHeaderRule,
    caption,
    label,
    numbered,
    placement: placement || "htbp",
    width: env.name === "tabularx" || env.name === "tabular*" ? "full" : "auto",
    style: /\\toprule|\\midrule|\\bottomrule/.test(rawBody)
      ? "booktabs"
      : /\\(hline|cline)\b/.test(rawBody)
        ? "grid"
        : "plain",
    escape,
  };
  if (aligns.length) patch.aligns = aligns;
  const model = createTable(rows, cols, patch);

  return { model, from: env.from, to: env.to, fingerprint: fingerprintOf(source) };
}
