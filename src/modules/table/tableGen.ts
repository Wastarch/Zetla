// M1-8 · LaTeX 表格代码生成（纯函数）
// 输出口径（计划文档 M1-8 详节）：booktabs 三线表为默认；固定顺序
//   table 环境 → \centering → \caption → \label → tabular 体。
// 转义：smart 默认只转义 & % # _（且在 $...$ 内不转义），保留 $ ^ ~ \ 与花括号，
//   使单元格里可直接写 $\alpha$ / \textbf{粗体}；full 全转义；off 原样。
import type { EscapeMode, HAlign, TableModel } from "./tableModel";

/** smart 模式转义集：文本段内把这些字符转义（数学段内不动） */
const SMART_SET = new Set<string>(["&", "%", "#", "_"]);
/** full 模式转义集：LaTeX 特殊字符全转义 */
const FULL_SET = new Set<string>(["&", "%", "#", "_", "{", "}", "$", "^", "~", "\\"]);

function escapeWith(s: string, set: Set<string>): string {
  let out = "";
  for (const ch of s) out += set.has(ch) ? `\\${ch}` : ch;
  return out;
}

/** smart：按 $ 切分数学/文本段，只转义文本段（$ 本身保留） */
function escapeSmart(s: string): string {
  let out = "";
  let buf = "";
  let inMath = false;
  for (const ch of s) {
    if (ch === "$") {
      out += inMath ? buf : escapeWith(buf, SMART_SET);
      out += "$";
      buf = "";
      inMath = !inMath;
      continue;
    }
    buf += ch;
  }
  out += inMath ? buf : escapeWith(buf, SMART_SET);
  return out;
}

/** 单元格文本转义（导出给面板预览/单测用） */
export function escapeCellText(text: string, mode: EscapeMode): string {
  // 单元格内换行 MVP 合并为空格（\makecell 后置）
  const flat = text.replace(/\r?\n/g, " ");
  if (mode === "off") return flat;
  if (mode === "full") return escapeWith(flat, FULL_SET);
  return escapeSmart(flat);
}

/** 列规格：auto → lcr 拼接；full → 末列换 X（tabularx 弹性列） */
export function columnSpec(m: TableModel): string {
  const aligns: HAlign[] = Array.from({ length: m.cols }, (_, i) => m.aligns[i] ?? "c");
  let spec: string;
  if (m.width === "full") {
    spec = aligns.slice(0, -1).join("") + "X";
  } else {
    spec = aligns.join("");
  }
  return m.style === "grid" ? `|${spec.split("").join("|")}|` : spec;
}

/** 单个单元格 → LaTeX 片段（处理 \multicolumn / \multirow 包裹，顺序：先 multirow 再 multicolumn） */
function renderCell(m: TableModel, text: string, r: number, c: number): string {
  const cell = m.cells[r][c];
  const body = cell.raw ? text.replace(/\r?\n/g, " ") : escapeCellText(text, m.escape);
  const cs = cell.colSpan ?? 1;
  const rs = cell.rowSpan ?? 1;
  let out = body;
  if (rs > 1) out = `\\multirow{${rs}}{*}{${out}}`;
  if (cs > 1) out = `\\multicolumn{${cs}}{${cell.align ?? m.aligns[c] ?? "c"}}{${out}}`;
  return out;
}

/** 生成整段 LaTeX（含 table 浮动体；空 caption/无编号时按需省略 \caption） */
export function generateTable(m: TableModel): string {
  const env = m.numbered ? "table" : "table*";
  const tabEnv = m.width === "full" ? "tabularx" : "tabular";
  const tabArg = m.width === "full" ? "{\\linewidth}" : "";
  const placement = m.placement.trim() ? `[${m.placement.trim()}]` : "";

  const rules = {
    booktabs: { top: "\\toprule", mid: "\\midrule", bottom: "\\bottomrule" },
    grid: { top: "\\hline", mid: "\\hline", bottom: "\\hline" },
    plain: { top: "", mid: "", bottom: "" },
  }[m.style];

  const body: string[] = [];
  if (rules.top) body.push(`    ${rules.top}`);
  for (let r = 0; r < m.rows; r++) {
    const parts: string[] = [];
    for (let c = 0; c < m.cols; c++) {
      const cell = m.cells[r][c];
      if (cell?.covered) continue;
      const cs = cell ? (cell.colSpan ?? 1) : 1;
      parts.push(renderCell(m, cell?.text ?? "", r, c));
      c += cs - 1;
    }
    body.push(`    ${parts.join(" & ")} \\\\`);
    if (m.header && r === 0 && rules.mid) body.push(`    ${rules.mid}`);
  }
  if (rules.bottom) body.push(`    ${rules.bottom}`);

  const lines: string[] = [];
  lines.push(`\\begin{${env}}${placement}`);
  lines.push("  \\centering");
  if (m.caption || m.numbered) lines.push(`  \\caption{${m.caption}}`);
  if (m.label) lines.push(`  \\label{${m.label}}`);
  lines.push(`  \\begin{${tabEnv}}${tabArg}{${columnSpec(m)}}`);
  lines.push(...body);
  lines.push(`  \\end{${tabEnv}}`);
  lines.push(`\\end{${env}}`);
  return lines.join("\n");
}

/** 生成片段时 \caption{} 花括号内相对偏移（供 insertSnippetSelect 落光标） */
export function captionSelection(m: TableModel): { from: number; to: number } | null {
  if (!m.caption && !m.numbered) return null;
  const code = generateTable(m);
  const idx = code.indexOf("\\caption{");
  if (idx < 0) return null;
  const from = idx + "\\caption{".length;
  return { from, to: from + m.caption.length };
}
