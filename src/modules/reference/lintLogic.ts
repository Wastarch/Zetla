// M1-14e · 校验纯逻辑（无 @/ 别名依赖，可在 Node 直接单测）
// 与 lint.ts 分离：本文件只做纯字符串/位置计算；lint.ts 负责 CM6 Diagnostic 接线与读 store。
import type { Text } from "@codemirror/state";
import type { BibEntry } from "./bibParser";

export interface LintDiag {
  from: number;
  to: number;
  message: string;
}

/**
 * 在当前文档里定位某条目 key 的绝对位置（@type{ 之后、逗号/闭括号之前）。
 * 一般在 @type{ 同行的 { 后；若 key 单独成行，向后多扫两行兜底。找不到返回 null。
 */
export function locateKeyInDoc(
  doc: Text,
  entryLine1: number,
  key: string,
): { from: number; to: number } | null {
  if (entryLine1 < 1 || entryLine1 > doc.lines) return null;
  const maxLn = Math.min(entryLine1 + 2, doc.lines);
  for (let ln = entryLine1; ln <= maxLn; ln++) {
    const line = doc.line(ln);
    const atIdx = line.text.search(/@\w+\s*\{/);
    if (atIdx < 0) continue;
    const braceIdx = line.text.indexOf("{", atIdx);
    if (braceIdx < 0) continue;
    let s = braceIdx + 1;
    while (s < line.text.length && /\s/.test(line.text[s])) s++;
    let e = s;
    while (
      e < line.text.length &&
      line.text[e] !== "," &&
      line.text[e] !== "}" &&
      !/\s/.test(line.text[e])
    )
      e++;
    if (line.text.slice(s, e) === key) {
      return { from: line.from + s, to: line.from + e };
    }
  }
  return null;
}

/**
 * 收集当前 .bib 文档中「重复 key」诊断。
 * 重复与否由 store 的 duplicateKeys（项目级）判定；entriesInFile 为当前文件已解析条目（来自 store，不重解）。
 */
export function collectDuplicateKeyDiags(
  doc: Text,
  entriesInFile: BibEntry[],
  duplicateKeys: Set<string>,
  countOf: (key: string) => number,
): LintDiag[] {
  const out: LintDiag[] = [];
  for (const e of entriesInFile) {
    if (!duplicateKeys.has(e.key)) continue;
    const pos = locateKeyInDoc(doc, e.line, e.key);
    if (!pos) continue;
    out.push({
      from: pos.from,
      to: pos.to,
      message: `重复引用 key「${e.key}」（项目中出现 ${countOf(e.key)} 处）`,
    });
  }
  return out;
}

/** 匹配 \cite / \citep / \citet / \citeauthor / \nocite 等，捕获可选 * 与 { } 内 key 串（支持多个 [可选参数]） */
const CITE_SCAN_RE =
  /\\(?:nocite|cite|citep|citet|citeauthor|citeyear|citeyearpar|citetext)(\*)?(?:\[[^\]]*\])*\{([^{}]*)\}/g;

/**
 * 收集当前 .tex 文档中「\cite{key} 引用缺失」诊断：
 * - key 不在 knownKeys（项目 .bib 定义的全部 key）→ 标红；
 * - 空 \cite{} → 标「未引用任何 key」；
 * - \nocite{*} 通配 → 跳过。
 * 逐行扫描（\cite 跨行极罕见，行级已覆盖绝大多数情况），返回绝对位置。
 */
export function collectMissingCiteDiags(
  doc: Text,
  knownKeys: Set<string>,
): LintDiag[] {
  const out: LintDiag[] = [];
  for (let ln = 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln);
    CITE_SCAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_SCAN_RE.exec(line.text))) {
      const keysStr = m[2];
      const braceOpen = m[0].lastIndexOf("{");
      const base = line.from + m.index + braceOpen + 1;
      if (keysStr.trim() === "*") continue; // \nocite{*} 等通配，跳过
      if (keysStr.trim() === "") {
        out.push({
          from: base - 1,
          to: base + 1,
          message: "空的 \\cite{}：未引用任何 key",
        });
        continue;
      }
      let i = 0;
      const len = keysStr.length;
      while (i < len) {
        while (i < len && /\s/.test(keysStr[i])) i++;
        const ks = i;
        while (i < len && keysStr[i] !== "," && !/\s/.test(keysStr[i])) i++;
        const ke = i;
        const key = keysStr.slice(ks, ke).trim();
        if (key && !knownKeys.has(key)) {
          out.push({
            from: base + ks,
            to: base + ke,
            message: `引用缺失：key「${key}」在项目 .bib 中未找到`,
          });
        }
        // 跳过下一个逗号（含其后空白）
        while (i < len && keysStr[i] !== ",") i++;
        if (i < len) i++;
      }
    }
  }
  return out;
}

/** 在已解析条目中找「首个重复 key」的条目位置（供校验汇总条点击跳首个） */
export function firstDuplicateEntry(
  entries: BibEntry[],
  duplicateKeys: Set<string>,
): { file: string; line: number } | null {
  for (const e of entries) {
    if (duplicateKeys.has(e.key)) return { file: e.file, line: e.line };
  }
  return null;
}

export interface MissingCiteSummary {
  /** 缺失引用总数（跨所有 .tex 文件） */
  count: number;
  /** 首个缺失引用的位置（文档顺序，确定性取决于 files 传入顺序） */
  first: { file: string; line: number } | null;
}

/**
 * 汇总项目内全部 .tex 文件的「引用缺失」诊断（复用 collectMissingCiteDiags）。
 * knownKeys = 项目 .bib 定义的所有 key（store.byKey.keys()）。
 * files 需按确定顺序传入（建议按路径排序），保证「首个」稳定。
 */
export function summarizeMissingCites(
  files: { path: string; doc: Text }[],
  knownKeys: Set<string>,
): MissingCiteSummary {
  let count = 0;
  let first: { file: string; line: number } | null = null;
  for (const f of files) {
    const diags = collectMissingCiteDiags(f.doc, knownKeys);
    if (diags.length === 0) continue;
    count += diags.length;
    if (!first) {
      const d = diags[0];
      first = { file: f.path, line: f.doc.lineAt(d.from).number };
    }
  }
  return { count, first };
}
