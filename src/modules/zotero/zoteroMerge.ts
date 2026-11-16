// Zotero 联动 · P6 字段级增量同步纯逻辑（无 @/ 别名、无 store / Tauri 依赖）
//
// 需求：Zotero 里改了题录字段（作者 / 年份 / 标题 / 期刊 …）→ 同步改项目 .bib 里
// 对应条目的同名字段；.bib 独有字段（如手写 note / eprint / keywords）原样保留；
// citekey 永不变化（它是 .tex 里 \cite 的锚点）。
//
// 设计与 Rust `bib_entry_blocks` 同口径：自己做括号匹配（不依赖正则贪婪），
// 兼容 `{...}` / `(...)` 两种条目定界与嵌套花括号 / 引号值。
import type { ZoteroItem } from "../../types/zotero.ts";
import {
  escapeBibValue,
  isPathInsideRoot,
  normalizeBibPath,
  pathKey,
} from "./zoteroSync.ts";

/** 由 Zotero 托管、允许覆盖 .bib 同名字段的字段集（note 刻意排除：常为用户手写） */
export const ZOTERO_MANAGED_FIELDS = [
  "title", "author", "year", "journal", "booktitle", "publisher",
  "doi", "url", "abstract",
] as const;
export type ZoteroManagedField = (typeof ZOTERO_MANAGED_FIELDS)[number];

export interface BibFieldRaw {
  /** 字段名（小写） */
  name: string;
  /** 原始片段：`name = {value}` / `name = "value"` / `name = bare`（含缩进前的名字） */
  raw: string;
}

export interface ParsedBibEntry {
  /** 原始类型 token（保留大小写，如 `Article`） */
  typeRaw: string;
  type: string;
  open: "{" | "(";
  close: "}" | ")";
  citeKey: string;
  /** 条目块在原文中的 [start, end) */
  start: number;
  end: number;
  fields: BibFieldRaw[];
}

const SKIP_TYPES = new Set(["comment", "preamble", "string"]);

/** 从 openIdx 处的开定界符找到整条目的结束（含闭符）；跳过转义与引号内的定界符 */
function findBlockEnd(text: string, openIdx: number): number {
  let depth = 0;
  let inQuote = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i += 1; continue; } // 转义字符（\{ \} \" 等）
    if (c === '"') { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (c === "{" || c === "(") depth += 1;
    else if (c === "}" || c === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length; // 未闭合：吞到文末，避免误切
}

/** 解析条目体（首逗号之后、闭符之前）的字段列表 */
function parseBibFields(body: string): BibFieldRaw[] {
  const out: BibFieldRaw[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && (/\s/.test(body[i]) || body[i] === ",")) i += 1;
    if (i >= body.length) break;
    const start = i;
    while (i < body.length && body[i] !== "=" && !/[\s,]/.test(body[i])) i += 1;
    const name = body.slice(start, i).trim().toLowerCase();
    while (i < body.length && /\s/.test(body[i])) i += 1;
    if (i >= body.length || body[i] !== "=") {
      // 畸形字段：跳到下一个顶层逗号，不吞掉别的字段
      while (i < body.length && body[i] !== ",") i += 1;
      continue;
    }
    i += 1; // '='
    while (i < body.length && /\s/.test(body[i])) i += 1;
    if (body[i] === "{") {
      let depth = 0;
      while (i < body.length) {
        const c = body[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "{") depth += 1;
        else if (c === "}") {
          depth -= 1;
          i += 1;
          if (depth === 0) break;
          continue;
        }
        i += 1;
      }
    } else if (body[i] === '"') {
      i += 1;
      while (i < body.length) {
        if (body[i] === "\\") { i += 2; continue; }
        if (body[i] === '"') { i += 1; break; }
        i += 1;
      }
    } else {
      while (i < body.length && body[i] !== "," && body[i] !== "\n") i += 1;
    }
    const raw = body.slice(start, i).trim();
    if (name && raw) out.push({ name, raw });
  }
  return out;
}

/** 解析 .bib 全文为条目列表（跳过 comment/preamble/string，保留原文偏移） */
export function parseBibEntries(text: string): ParsedBibEntry[] {
  const out: ParsedBibEntry[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "@") { i += 1; continue; }
    let j = i + 1;
    while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
    const typeRaw = text.slice(i + 1, j);
    if (!typeRaw) { i += 1; continue; }
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (j >= text.length || (text[j] !== "{" && text[j] !== "(")) { i += 1; continue; }
    const open = text[j] as "{" | "(";
    const close = open === "{" ? "}" : ")";
    const end = findBlockEnd(text, j);
    // citekey：开符之后到首个逗号 / 空白 / 闭符
    let k = j + 1;
    while (k < end && /\s/.test(text[k])) k += 1;
    const keyStart = k;
    while (k < end && !/[\s,}]/.test(text[k]) && text[k] !== ")") k += 1;
    const citeKey = text.slice(keyStart, k).trim();
    let comma = k;
    while (comma < end && text[comma] !== "," && text[comma] !== close) comma += 1;
    const fields = comma < end && text[comma] === ","
      ? parseBibFields(text.slice(comma + 1, end - 1))
      : [];
    const type = typeRaw.toLowerCase();
    if (!SKIP_TYPES.has(type) && citeKey) {
      out.push({ typeRaw, type, open, close, citeKey, start: i, end, fields });
    }
    i = Math.max(end, i + 1);
  }
  return out;
}

/** 取 `name = {value}` 里的 value（去定界符），用于比对是否真的变化 */
export function unwrapBibValue(raw: string): string {
  const r = raw.trim();
  const eq = r.indexOf("=");
  const v = (eq >= 0 ? r.slice(eq + 1) : r).trim();
  if (v.startsWith("{") && v.endsWith("}")) return v.slice(1, -1);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

export interface MergePatch {
  citeKey: string;
  /** 字段名 → 已转义的值（不含花括号）；空串表示「Zotero 该项为空」，不覆盖也不新增 */
  fields: Record<string, string>;
}

export interface BibMergeResult {
  /** 合并后的完整 .bib 文本 */
  text: string;
  /** 实际发生字段变更的 citekey */
  changedKeys: string[];
  /** patch 里给了但 .bib 中找不到对应条目的 citekey */
  missingKeys: string[];
  /** 每个变化条目新增的字段名（UI 摘要用） */
  addedFields: Record<string, string[]>;
}

/**
 * 把 Zotero 最新字段合并进现有 .bib：
 * - 仅 ZOTERO_MANAGED_FIELDS / patch 中出现的字段参与覆盖；patch 未给的字段原样保留；
 * - Zotero 值为空 → 不动（不会清空用户已有内容）；
 * - .bib 独有字段（note / eprint / keywords / pages …）原样保留；
 * - citekey / 条目类型 / 定界符保持不变；只重建真正变化的条目块。
 */
export function mergeBibFields(text: string, patches: MergePatch[]): BibMergeResult {
  const byKey = new Map<string, Record<string, string>>();
  for (const p of patches) {
    const k = String(p.citeKey ?? "").trim();
    if (!k) continue;
    byKey.set(k, { ...(byKey.get(k) ?? {}), ...(p.fields ?? {}) });
  }
  const entries = parseBibEntries(text);
  const found = new Set<string>();
  const changedKeys: string[] = [];
  const addedFields: Record<string, string[]> = {};
  const parts: { start: number; end: number; text: string }[] = [];

  for (const e of entries) {
    const patch = byKey.get(e.citeKey);
    if (!patch) continue;
    found.add(e.citeKey);
    const have = new Set<string>();
    const lines: string[] = [];
    const added: string[] = [];
    let changed = false;
    for (const f of e.fields) {
      have.add(f.name);
      const want = patch[f.name];
      if (want === undefined || want === "") { lines.push(f.raw); continue; }
      const cur = unwrapBibValue(f.raw);
      if (cur === want) {
        lines.push(f.raw);
      } else {
        lines.push(`  ${f.name} = {${want}}`);
        changed = true;
      }
    }
    for (const [name, value] of Object.entries(patch)) {
      if (!value || have.has(name)) continue;
      lines.push(`  ${name} = {${value}}`);
      added.push(name);
      changed = true;
    }
    if (!changed) continue;
    changedKeys.push(e.citeKey);
    if (added.length) addedFields[e.citeKey] = added;
    const rebuilt = `@${e.typeRaw}${e.open}${e.citeKey},\n${lines.join(",\n")}\n${e.close}`;
    parts.push({ start: e.start, end: e.end, text: rebuilt });
  }

  // 从后往前拼接，避免偏移失效
  let merged = text;
  for (const p of parts.sort((a, b) => b.start - a.start)) {
    merged = merged.slice(0, p.start) + p.text + merged.slice(p.end);
  }
  const missingKeys = [...byKey.keys()].filter((k) => !found.has(k));
  return { text: merged, changedKeys, missingKeys, addedFields };
}

/** Zotero 题录 → 托管字段表（值与 `bibtexEntryBlock` 同口径；note 刻意不产出） */
export function zoteroFieldsFromItem(item: ZoteroItem): Record<string, string> {
  const out: Record<string, string> = {};
  const push = (name: ZoteroManagedField, value: string) => {
    const v = escapeBibValue(value);
    if (v) out[name] = v;
  };
  push("title", item.title);
  push("author", item.authors.join(" and "));
  push("year", item.year);
  // 与 bibtexEntryBlock 一致：按条目标题类型选择出版字段
  const t = item.itemType;
  if (t === "journalArticle" || t === "magazineArticle" || t === "newspaperArticle") {
    push("journal", item.publicationTitle);
  } else if (t === "conferencePaper") {
    push("booktitle", item.publicationTitle);
  } else if (t === "bookSection") {
    push("booktitle", item.publicationTitle);
  } else if (t === "book" || t === "report" || t === "thesis") {
    push("publisher", item.publicationTitle);
  }
  push("doi", item.doi);
  push("url", item.url);
  if (item.abstract) push("abstract", item.abstract.replace(/\s+/g, " "));
  return out;
}

/** 从 .bib 文本里抽 note 里的 `Zotero itemKey: XXXX`（映射缓存丢失时的兜底） */
export function itemKeyNotesFromBib(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = parseBibEntries(text);
  for (const e of entries) {
    for (const f of e.fields) {
      const m = f.raw.match(/Zotero\s+itemKey:\s*([A-Za-z0-9]+)/i);
      if (m) out[m[1]] = e.citeKey;
    }
  }
  return out;
}

// ── 「插入即写入」目标 .bib 自动推断 ─────────────────────────────
// 用户决策：不要求先配置受管绑定 —— 插入浮层里点一条尚未进 .bib 的 Zotero 条目时，
// 自动写进项目内最合适的 .bib。优先级：
//   1) 已启用的受管绑定且在项目内 → 用它（用户显式指定最高优先）；
//   2) 否则从项目内候选 .bib 里挑「主库」：Zotero 映射条目多 > 总条目多 > 路径升序；
//   3) 没有任何候选 → null（调用方只提示、不阻断插入）。

/** 项目内一个候选 .bib 的画像（由调用方从 reference store 汇总） */
export interface BibWriteCandidate {
  /** 项目内 .bib 绝对路径（写法任意，内部用 pathKey 归一比较） */
  file: string;
  /** 该文件里带 `Zotero itemKey:` note 的条目数（Zotero 托管程度信号） */
  zoteroCount: number;
  /** 该文件里的条目总数 */
  entryCount: number;
}

/**
 * 推断「插入即写入」的目标 .bib 绝对路径。
 * @param root 项目根
 * @param managed 受管绑定（enabled + bibPath）；为空/未启用/越界时走自动推断
 * @param candidates 项目内候选 .bib 画像
 */
export function pickInsertBibPath(
  root: string,
  managed: { enabled: boolean; bibPath: string } | null,
  candidates: BibWriteCandidate[],
): string | null {
  if (managed?.enabled && managed.bibPath.trim()) {
    const abs = normalizeBibPath(root, managed.bibPath);
    if (isPathInsideRoot(root, abs)) return abs;
  }
  const inside = candidates.filter((c) => c.file && isPathInsideRoot(root, c.file));
  if (inside.length === 0) return null;
  const sorted = [...inside].sort((a, b) => {
    if (b.zoteroCount !== a.zoteroCount) return b.zoteroCount - a.zoteroCount;
    if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
    return pathKey(a.file).localeCompare(pathKey(b.file));
  });
  return normalizeBibPath(root, sorted[0].file);
}
