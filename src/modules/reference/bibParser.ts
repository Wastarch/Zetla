// M1-14a · BibTeX 解析器（纯前端，零依赖）
// 职责：从 .bib 文本提取 @type{key, fields}，记录 key / 字段 / 行号 / 来源文件。
// 设计取舍：不构造完整 AST，只取引用补全/校验所需字段（author/title/year 等原文），
// 足够支撑 ② 补全、③ 跳转、④ 校验；大文件解析为一次性、可防抖，不进编辑器热路径。

export interface BibEntry {
  /** 条目类型（article / book / inproceedings …，小写） */
  type: string;
  /** 引用 key（\cite{key} 用） */
  key: string;
  /** 全部字段（name → raw value，name 已小写） */
  fields: Record<string, string>;
  author?: string;
  title?: string;
  year?: string;
  /** 1-based 行号（@type{ 所在行），用于 ③ Ctrl+点击跳转 */
  line: number;
  /** 来源 .bib 绝对路径 */
  file: string;
}

/** 非真实引用条目的类型（无 cite key），跳过解析 */
const SKIP_TYPES = new Set(["comment", "preamble", "string"]);

/** 预计算换行位置，支持 O(log n) 行号查询 */
function makeLineAt(text: string): (pos: number) => number {
  const offsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return (pos: number) => {
    let lo = 0;
    let hi = offsets.length - 1;
    let ans = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= pos) {
        ans = mid + 1;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };
}

/** 找到与 openIdx 处的开括号匹配的闭括号下标（从开括号自身开始计深度） */
function matchClose(
  text: string,
  openIdx: number,
  openChar: string,
  closeChar: string,
  n: number,
): number {
  let depth = 0;
  for (let i = openIdx; i < n; i++) {
    const c = text[i];
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return n - 1;
}

const isIdentChar = (c: string) => /[A-Za-z0-9_:.+-]/.test(c);
const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

/**
 * 解析单个 .bib 文件内容。
 * @param text 文件全文
 * @param file 来源绝对路径（写入每条 entry.file）
 */
export function parseBib(text: string, file: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const n = text.length;
  const lineAt = makeLineAt(text);
  let i = 0;

  while (i < n) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    i = at + 1;

    // 类型名
    const tStart = i;
    while (i < n && isIdentChar(text[i])) i++;
    const type = text.slice(tStart, i).trim().toLowerCase();
    while (i < n && isWs(text[i])) i++;
    const opener = text[i];
    const openChar = opener;
    const closeChar = opener === "(" ? ")" : "}";
    if (opener !== "{" && opener !== "(") continue; // 非标准，跳过
    const entryOpen = i; // 开括号位置（matchClose 起点）
    i++; // 越过 opener
    const entryLine = lineAt(at);

    // key：到逗号 / 闭括号 / 空白为止
    while (i < n && isWs(text[i])) i++;
    const kStart = i;
    while (i < n && text[i] !== "," && text[i] !== closeChar && !isWs(text[i])) i++;
    const key = text.slice(kStart, i).trim();

    if (SKIP_TYPES.has(type)) {
      // 跳到匹配闭括号之后
      i = matchClose(text, entryOpen, openChar, closeChar, n) + 1;
      continue;
    }

    const fields: Record<string, string> = {};
    if (text[i] === ",") i++;
    while (i < n) {
      while (i < n && (isWs(text[i]) || text[i] === ",")) i++;
      if (text[i] === closeChar || i >= n) break;
      // 字段名（到 '=' 或空白）
      const fStart = i;
      while (i < n && text[i] !== "=" && !isWs(text[i]) && text[i] !== closeChar) i++;
      const fname = text.slice(fStart, i).trim().toLowerCase();
      while (i < n && isWs(text[i])) i++;
      if (text[i] !== "=") {
        // 形态异常：跳到匹配闭括号收尾，避免误吞后续条目
        i = matchClose(text, entryOpen, openChar, closeChar, n) + 1;
        break;
      }
      i++; // 越过 '='
      while (i < n && isWs(text[i])) i++;
      let val = "";
      const v = text[i];
      if (v === "{") {
        const end = matchClose(text, i, "{", "}", n); // 从开括号自身起匹配
        val = text.slice(i + 1, end).trim();
        i = end + 1;
      } else if (v === '"') {
        const qStart = i + 1;
        let j = qStart;
        while (j < n && text[j] !== '"') j++;
        val = text.slice(qStart, j).trim();
        i = j + 1;
      } else {
        const bStart = i;
        while (i < n && text[i] !== "," && text[i] !== closeChar && !isWs(text[i])) i++;
        val = text.slice(bStart, i).trim();
      }
      if (fname) fields[fname] = val;
      while (i < n && (isWs(text[i]) || text[i] === ",")) i++;
    }

    if (key) {
      entries.push({
        type,
        key,
        fields,
        author: fields["author"],
        title: fields["title"],
        year: fields["year"],
        line: entryLine,
        file,
      });
    }
  }

  return entries;
}

/** 计算重复 key 集合（供 ④ bib 内重复 key 告警） */
export function findDuplicateKeys(entries: BibEntry[]): Set<string> {
  const seen = new Map<string, number>();
  const dup = new Set<string>();
  for (const e of entries) {
    const c = (seen.get(e.key) ?? 0) + 1;
    seen.set(e.key, c);
    if (c > 1) dup.add(e.key);
  }
  return dup;
}
