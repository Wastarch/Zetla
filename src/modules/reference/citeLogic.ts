// M1-14c · \cite 补全/悬浮的纯逻辑（无 @/ 别名依赖，可在 Node 直接单测）
// 与 citeSupport.ts 分离：后者负责 CM6 接线与读 useReferenceStore 缓存，本文件只做纯计算/字符串。
import type { Text } from "@codemirror/state";
import type { BibEntry } from "./bibParser";

/** 匹配 \cite / \citep / \citet / \citeauthor / \citeyear 等，且光标处于 { 之后（仍在 key 列表内） */
export const CITE_PREFIX_RE =
  /\\(?:nocite|cite|citep|citet|citeauthor|citeyear|citeyearpar|citetext)(\*)?(?:\[[^\]]*\])?\{[^}]*$/;

/** 完整 \cite[key]{k1, k2} 命令（用于悬浮定位） */
export const CITE_FULL_RE =
  /\\(?:nocite|cite|citep|citet|citeauthor|citeyear|citeyearpar|citetext)(\*)?(?:\[[^\]]*\])?\{([^}]*)\}/g;

export function authorYear(e: BibEntry): string {
  const a = e.author ?? "";
  const y = e.year ? ` (${e.year})` : "";
  return `${a}${y}`.trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 光标前的文本是否处于 \cite{ 上下文（可触发补全） */
export function matchCitePrefix(textBefore: string): boolean {
  return CITE_PREFIX_RE.test(textBefore);
}

/**
 * 计算当前正在输入的 key 起点（绝对位置）：最后一个 { 之后、跳过最后一个逗号及其后的空格。
 * textBefore = 行首到光标的文本；lineFrom = 行首绝对位置；pos = 光标绝对位置。
 */
export function citeCompletionFrom(
  textBefore: string,
  lineFrom: number,
  pos: number,
): number {
  const braceIdx = textBefore.lastIndexOf("{");
  const afterBrace = textBefore.slice(braceIdx + 1);
  const commaIdx = afterBrace.lastIndexOf(",");
  let start =
    lineFrom + braceIdx + 1 + (commaIdx >= 0 ? commaIdx + 1 : 0);
  while (start < pos && /\s/.test(textBefore[start - lineFrom])) start++;
  return start;
}

/**
 * 定位光标处所在的 \cite{...} 单个 key（逗号分隔），返回 key 文本与绝对范围。
 * 注意：返回 from/to 为「文档绝对位置」（已加 line.from），与传入的 pos 同一坐标系；
 * 早期版本返回的是行内相对列号，在多行文档上会导致悬浮锚点错位，此处已修正。
 */
export function findCiteKeyAt(
  doc: Text,
  pos: number,
): { key: string; from: number; to: number } | null {
  const line = doc.lineAt(pos);
  const text = line.text;
  const base = line.from;
  const rel = pos - base; // pos 相对该行起点的列号
  CITE_FULL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_FULL_RE.exec(text))) {
    const open = m.index + m[0].indexOf("{"); // 首个 { 即 key 列表开头
    const close = m.index + m[0].length - 1; // 末尾 } 即 key 列表结尾
    let i = open + 1;
    while (i < close) {
      while (i < close && /\s/.test(text[i])) i++;
      const keyStart = i;
      while (i < close && text[i] !== "," && !/\s/.test(text[i])) i++;
      const keyEnd = i;
      const key = text.slice(keyStart, keyEnd);
      if (key && rel >= keyStart && rel <= keyEnd) {
        return { key, from: base + keyStart, to: base + keyEnd };
      }
      while (i < close && text[i] !== ",") i++; // 跳到逗号
      if (i < close) i++; // 跳过逗号
    }
  }
  return null;
}

/**
 * M1-14d · Ctrl+点击跳转用：若 pos 落在某 \cite{...} 命令范围内，返回应跳转的 key。
 * - 优先返回光标恰处的 key（精确到被点的那个引用）；
 * - 若点在命令内但不在具体 key 上（如落在 \cite、{ 、} 或逗号上）→ 返回该命令首个 key；
 * - 命不中返回 null。
 * 返回的 from/to 为文档绝对位置。
 */
export function findCiteKeyForJump(
  doc: Text,
  pos: number,
): { key: string; from: number; to: number } | null {
  const line = doc.lineAt(pos);
  const text = line.text;
  const base = line.from;
  const rel = pos - base;
  CITE_FULL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_FULL_RE.exec(text))) {
    const open = m.index + m[0].indexOf("{");
    const close = m.index + m[0].length - 1;
    const cmdStart = m.index;
    const cmdEnd = m.index + m[0].length; // 命令末位 } 的下一个位置（含点在其后）
    if (rel < cmdStart || rel > cmdEnd) continue; // 不在本命令范围内

    let i = open + 1;
    let firstKey: { key: string; from: number; to: number } | null = null;
    while (i < close) {
      while (i < close && /\s/.test(text[i])) i++;
      const keyStart = i;
      while (i < close && text[i] !== "," && !/\s/.test(text[i])) i++;
      const keyEnd = i;
      const key = text.slice(keyStart, keyEnd);
      if (!key) break;
      if (!firstKey) firstKey = { key, from: base + keyStart, to: base + keyEnd };
      if (rel >= keyStart && rel <= keyEnd) {
        return { key, from: base + keyStart, to: base + keyEnd };
      }
      while (i < close && text[i] !== ",") i++; // 跳到逗号
      if (i < close) i++; // 跳过逗号
    }
    if (firstKey) return firstKey; // 点在命令内但不在具体 key 上 → 跳首个 key
  }
  return null;
}

/** 生成悬浮卡片 HTML（纯字符串，无 DOM 依赖；key 缺失时 entry 为 undefined） */
export function citeTooltipHtml(
  key: string,
  entry: BibEntry | undefined,
  dupCount: number,
): string {
  if (entry) {
    const dup =
      dupCount > 1
        ? `<div class="cm-cite-warn">⚠ 重复 key（${dupCount} 处）</div>`
        : "";
    const file = entry.file
      ? `<div class="cm-cite-file">${escapeHtml(entry.file)} · L${entry.line}</div>`
      : "";
    return (
      `<div class="cm-cite-type">@${escapeHtml(entry.type)}</div>` +
      `<div class="cm-cite-title">${escapeHtml(entry.title ?? "(无标题)")}</div>` +
      `<div class="cm-cite-meta">${escapeHtml(authorYear(entry))}</div>` +
      file +
      dup
    );
  }
  return `<div class="cm-cite-missing">⚠ 引用缺失：<code>${escapeHtml(
    key,
  )}</code> 在项目 .bib 中未找到</div>`;
}
