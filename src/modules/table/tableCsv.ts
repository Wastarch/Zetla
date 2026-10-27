// M1-8 · CSV/TSV 解析与导出（纯函数，零依赖）
// 口径（计划文档 M1-8 详节）：MVP 只做 CSV/TSV 文本 + Excel 粘贴（TSV）；
// .xlsx 直读留后续（Rust + calamine）。解析需容忍引号转义、CRLF、BOM 与分隔符嗅探。

/** 候选分隔符（按优先级嗅探）：制表符 → 分号 → 逗号 */
const DELIMITERS = ["\t", ";", ","] as const;

/** 嗅探分隔符：取首行内出现次数最多者（全 0 时回退逗号） */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = countOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

/**
 * 解析分隔文本为二维数组。
 * - 支持双引号包裹（内部 "" 表示一个引号）、字段内换行、CRLF、UTF-8 BOM；
 * - 末尾空行忽略；不补齐列数（由 fromMatrix 统一）。
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === d) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 二维数组 → TSV（回贴 Excel 用；单元格内换行压成空格） */
export function toTSV(matrix: string[][]): string {
  return matrix
    .map((row) => row.map((cell) => (cell ?? "").replace(/\r?\n/g, " ")).join("\t"))
    .join("\n");
}

/** 剪贴板文本是否像表格（含制表符或至少两行多列）——TSV 粘贴入口判定 */
export function looksLikeTable(text: string): boolean {
  if (!text) return false;
  if (text.includes("\t")) return true;
  const rows = parseDelimited(text, detectDelimiter(text));
  return rows.length > 1 && rows.some((r) => r.length > 1);
}
