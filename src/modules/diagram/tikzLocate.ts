// M2 · 绘图模块：在 LaTeX 源码中定位 tikzpicture 环境，供「源码里的 ✎ → 绘图工作台」反向编辑。
// 移植自 Rust src-tauri/src/commands/tikz_source.rs 的 find_environments / matching_end /
// is_escaped / collect_libraries，保持两端口径一致（支持 \begin{tikzpicture}[options]、嵌套
// tikzpicture、反斜杠转义的伪命令）。纯字符串逻辑，无运行时依赖，便于单独测试。
//
// 这是「编辑器内未保存文档」的定位器；Rust scan_tikz_sources 面向磁盘文件，两者互不替代。

const BEGIN = "\\begin{tikzpicture}";
const END = "\\end{tikzpicture}";
const LIB_KEY = "\\usetikzlibrary{";

/** 一处 tikzpicture 命中区间 */
export interface TikzEnvSpan {
  /** \begin{tikzpicture} 起点 */
  from: number;
  /** \end{tikzpicture} 之后（环境整体终点） */
  to: number;
  /** ✎ 标记位置：\begin{tikzpicture} 或其 [options] 之后 */
  markAt: number;
  /** 环境完整原文（from..to），可直接作为绘图源码 */
  envText: string;
  startLine: number;
  endLine: number;
  libraries: string[];
}

/** 反斜杠转义判定：命令起点前一个字符是 \ 则视为伪命令（如 \verb|\begin{tikzpicture}|） */
function isEscaped(text: string, index: number): boolean {
  return index > 0 && text[index - 1] === "\\";
}

/** 行号（1-based）：byte/char 索引之前有多少个换行 */
function lineOf(text: string, index: number): number {
  const upto = Math.max(0, Math.min(index, text.length));
  let n = 1;
  for (let i = 0; i < upto; i++) if (text[i] === "\n") n++;
  return n;
}

/** 从 bodyStart 找匹配的 \end{tikzpicture}，支持嵌套 depth */
function matchingEnd(text: string, from: number): number {
  let depth = 1;
  let pos = from;
  while (pos < text.length) {
    const nextBegin = text.indexOf(BEGIN, pos);
    const nextEnd = text.indexOf(END, pos);
    if (nextBegin !== -1 && (nextEnd === -1 || nextBegin < nextEnd)) {
      if (isEscaped(text, nextBegin)) pos = nextBegin + 1;
      else {
        depth++;
        pos = nextBegin + BEGIN.length;
      }
    } else if (nextEnd !== -1) {
      if (isEscaped(text, nextEnd)) pos = nextEnd + 1;
      else {
        depth--;
        if (depth === 0) return nextEnd + END.length;
        pos = nextEnd + END.length;
      }
    } else {
      return -1;
    }
  }
  return -1;
}

/** 收集 \usetikzlibrary{a,b} 的库名，去重保序（与 Rust collect_libraries 同口径） */
function collectLibraries(text: string): string[] {
  const out: string[] = [];
  let search = 0;
  while (search < text.length) {
    const rel = text.indexOf(LIB_KEY, search);
    if (rel < 0) break;
    const begin = rel + LIB_KEY.length;
    const close = text.indexOf("}", begin);
    if (close < 0) break;
    for (const lib of text.slice(begin, close).split(",")) {
      const name = lib.trim();
      if (name && !out.includes(name)) out.push(name);
    }
    search = close + 1;
  }
  return out;
}

/** 全文定位所有完整 tikzpicture 环境，按出现顺序返回 */
export function findTikzEnvs(doc: string): TikzEnvSpan[] {
  const libraries = collectLibraries(doc);
  const out: TikzEnvSpan[] = [];
  let search = 0;
  while (search < doc.length) {
    const rel = doc.indexOf(BEGIN, search);
    if (rel < 0) break;
    const from = rel;
    if (isEscaped(doc, from)) {
      search = from + 1;
      continue;
    }
    const afterBegin = from + BEGIN.length;
    // \begin{tikzpicture}[scale=2] → markAt 放在 ] 之后
    let markAt = afterBegin;
    if (doc[afterBegin] === "[") {
      const close = doc.indexOf("]", afterBegin);
      if (close !== -1) markAt = close + 1;
    }
    const to = matchingEnd(doc, markAt);
    if (to < 0) {
      search = afterBegin;
      continue;
    }
    out.push({
      from,
      to,
      markAt,
      envText: doc.slice(from, to),
      startLine: lineOf(doc, from),
      endLine: lineOf(doc, to),
      libraries: [...libraries],
    });
    search = to;
  }
  return out;
}
