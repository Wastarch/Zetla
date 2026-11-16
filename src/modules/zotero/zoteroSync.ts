// Zotero 联动 · P1 纯逻辑（无 @/ 别名、无 store / Tauri 依赖，Node 可直测）
//
// 职责：本地 API 原始 JSON → 归一化题录 → BibTeX / 键映射 / 键漂移计划 /
//      编译前一致性诊断 / 变更去抖与节流决策。
// 约束：相对 import 一律带 `.ts` 后缀（node --experimental-strip-types 直跑）。
import type {
  ZoteroBibChanged,
  ZoteroCollection,
  ZoteroConsistency,
  ZoteroItem,
  ZoteroKeyMap,
  ZoteroSyncRecord,
} from "../../types/zotero.ts";

/** 窗口获焦 / 编译前主动拉取的最小间隔：本地 API 快，但别每次切窗都拉全库 */
export const PULL_MIN_INTERVAL_MS = 60_000;
/** `.bib` 变更事件的前端合并窗口（Rust 侧已做 300ms，这里再兜一层） */
export const BIB_DEBOUNCE_MS = 300;

type Rec = Record<string, unknown>;

function asRecord(v: unknown): Rec | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Rec)
    : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 本地 API 的 `format=json` 返回数组；也兼容 `{items:[...]}` 包装 */
function jsonArray(raw: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(data)) return data;
  const wrapped = asRecord(data)?.items;
  return Array.isArray(wrapped) ? wrapped : [];
}

/** Zotero 的 `data.parentCollection` 顶层为 false；空串也按顶层处理 */
export function parseCollections(raw: string): ZoteroCollection[] {
  const out: ZoteroCollection[] = [];
  for (const v of jsonArray(raw)) {
    const o = asRecord(v);
    if (!o) continue;
    const d = asRecord(o.data) ?? o;
    const key = str(o.key) || str(d.key);
    if (!key) continue;
    const parent = d.parentCollection;
    out.push({
      key,
      name: str(d.name) || str(o.name) || key,
      parentCollection: typeof parent === "string" && parent ? parent : false,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

/** BBT 把稳定 citekey 写在 Extra 的 `Citation Key: xxx` 行 */
export function citationKeyFromExtra(extra: string): string {
  const m = /(?:^|\r?\n)\s*Citation Key:\s*([^\s,;]+)/i.exec(extra);
  return m ? m[1] : "";
}

export function extractYear(date: string): string {
  const m = /(1[89]\d{2}|20\d{2}|21\d{2})/.exec(date);
  return m ? m[1] : "";
}

function creatorName(v: unknown): string {
  const c = asRecord(v);
  if (!c) return "";
  const last = str(c.lastName);
  const first = str(c.firstName);
  const single = str(c.name);
  return single || [last, first].filter(Boolean).join(", ");
}

/** 归一化题录：本地 API item JSON → 同步所需字段 */
export function parseZoteroItems(raw: string): ZoteroItem[] {
  const out: ZoteroItem[] = [];
  for (const v of jsonArray(raw)) {
    const o = asRecord(v);
    if (!o) continue;
    const d = asRecord(o.data) ?? o;
    const itemKey = str(o.key) || str(d.key);
    if (!itemKey) continue;
    const creators = Array.isArray(d.creators) ? d.creators : [];
    const extra = str(d.extra);
    out.push({
      itemKey,
      itemType: str(d.itemType) || "misc",
      title: str(d.title),
      authors: creators.map(creatorName).filter(Boolean),
      year: extractYear(str(d.date) || str(d.year)),
      publicationTitle: str(d.publicationTitle) || str(d.journal) || str(d.bookTitle) || str(d.publisher),
      doi: str(d.DOI) || str(d.doi),
      url: str(d.url),
      abstract: str(d.abstractNote),
      extra,
      citationKey: citationKeyFromExtra(extra) || str(d.citationKey),
    });
  }
  return out;
}

/** 只保留 ASCII 字母数字，用于拼 LaTeX key（中文标题会退化，由 itemKey 兜底） */
export function asciiSlug(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "");
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "on", "in", "and", "for", "to", "with", "from",
  "by", "is", "are", "at", "as", "study", "using", "based",
]);

/** 稳定 citekey：`作者姓 + 年份 + 首个实词`，冲突追加 a/b/c；永不随排序变化 */
export function makeCiteKey(item: ZoteroItem, taken: ReadonlySet<string> = new Set()): string {
  const author = asciiSlug((item.authors[0] ?? "").split(",")[0]);
  const words = item.title.split(/\s+/).map(asciiSlug).filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
  const head = (author || words[0] || asciiSlug(item.itemKey) || "ref").toLowerCase();
  const year = /^\d{4}$/.test(item.year) ? item.year : "nd";
  const word = (words.find((w) => w.toLowerCase() !== head.toLowerCase()) ?? "").toLowerCase();
  let base = `${head}${year}${word}`;
  if (!/^[a-z]/.test(base)) base = `ref${base}`;
  base = base.slice(0, 64);
  let key = base;
  let n = 0;
  while (taken.has(key)) {
    n += 1;
    key = `${base}${String.fromCharCode(96 + n)}`;
  }
  return key;
}

/** BibTeX 值转义：去花括号与孤立反斜杠，转义 `% & $ # _`，中文原样保留（UTF-8 + biber） */
export function escapeBibValue(s: string): string {
  return s
    .replace(/[{}]/g, "")
    .replace(/\\/g, "")
    .replace(/([%&$#_])/g, "\\$1")
    .trim();
}

const BIB_TYPES: Record<string, string> = {
  journalArticle: "article",
  magazineArticle: "article",
  newspaperArticle: "article",
  book: "book",
  bookSection: "incollection",
  conferencePaper: "inproceedings",
  thesis: "phdthesis",
  report: "techreport",
  webpage: "misc",
  blogPost: "misc",
  preprint: "misc",
  manuscript: "unpublished",
  patent: "misc",
  dataset: "misc",
};

export const BIB_GENERATED_HEADER =
  "% Zetla · Zotero managed .bib — 自动同步生成，请勿手工编辑（会被下次同步覆盖）";

/** 无 BBT 降级：本地 API 题录 → BibTeX 条目块（不带文件头；P4 单条写入也用它） */
export function bibtexEntryBlock(item: ZoteroItem, forcedKey?: string): string {
  const type = BIB_TYPES[item.itemType] ?? "misc";
  const key = forcedKey || item.citationKey || makeCiteKey(item);
  const fields: [string, string][] = [];
  const push = (name: string, value: string) => {
    const v = escapeBibValue(value);
    if (v) fields.push([name, v]);
  };
  push("title", item.title);
  push("author", item.authors.join(" and "));
  push("year", item.year);
  if (type === "article") push("journal", item.publicationTitle);
  else if (type === "inproceedings" || type === "incollection") push("booktitle", item.publicationTitle);
  else if (type === "book" || type === "techreport") push("publisher", item.publicationTitle);
  push("doi", item.doi);
  push("url", item.url);
  if (item.abstract) push("abstract", item.abstract.replace(/\s+/g, " "));
  if (item.itemKey) fields.push(["note", `Zotero itemKey: ${item.itemKey}`]);
  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

/** 无 BBT 降级：本地 API 题录 → BibTeX 文本（note 里带 itemKey，便于精确键映射） */
export function itemsToBibtex(items: ZoteroItem[]): string {
  const taken = new Set<string>();
  const blocks = items.map((item) => {
    // 整批生成时保持既有冲突后缀口径：key 冲突按顺序追加 a/b/c
    const key = item.citationKey || makeCiteKey(item, taken);
    taken.add(key);
    return bibtexEntryBlock(item, key);
  });
  return [BIB_GENERATED_HEADER, "", ...blocks, ""].join("\n");
}

/** 抽取 BibTeX 文本中的 key（去重、保持出现顺序） */
export function bibKeysFromText(text: string): string[] {
  const re = /@[A-Za-z]+\s*\{\s*([^,\s}]+)/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const k = m[1].trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** 从生成的 BibTeX 里读 `note = {Zotero itemKey: XXXX}` → itemKey → citeKey */
export function parseItemKeyNotes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /@[A-Za-z]+\s*\{\s*([^,\s}]+)[^@]*?note\s*=\s*\{[^}]*Zotero itemKey:\s*([A-Za-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out[m[2]] = m[1];
  return out;
}

/**
 * 构建 citekey ↔ itemKey 映射。
 * 优先级：生成的 note 精确匹配（无 BBT） > BBT Extra 的 Citation Key > Zetla 自生成。
 * unmapped = .bib 里没对上任何 Zotero 题录的 key（通常是用户手写条目）。
 */
export function buildKeyMap(
  items: ZoteroItem[],
  bibKeys: string[],
  serverId: string | null,
  now: string = new Date().toISOString(),
  notes: Record<string, string> = {},
): ZoteroKeyMap {
  const byCiteKey: Record<string, string> = {};
  const byItemKey: Record<string, string> = {};
  const taken = new Set<string>();
  const known = new Set(bibKeys);
  for (const item of items) {
    if (!item.itemKey) continue;
    const noted = notes[item.itemKey];
    const generated = makeCiteKey(item, taken);
    // 有 .bib 时只认确实存在的 key，避免凭空造映射
    const candidates = [noted, item.citationKey, generated];
    const key = bibKeys.length === 0
      ? (noted || item.citationKey || generated)
      : candidates.find((k) => !!k && known.has(k));
    taken.add(generated);
    if (!key) continue;
    byCiteKey[key] = item.itemKey;
    byItemKey[item.itemKey] = key;
  }
  return {
    serverId,
    updatedAt: now,
    byCiteKey,
    byItemKey,
    unmapped: bibKeys.filter((k) => !byCiteKey[k]).sort(),
  };
}

export interface KeyMigration {
  from: string;
  to: string;
  itemKey: string;
}

// ── P4 · on-demand「插一篇写一篇」纯逻辑 ───────────────────────

/**
 * wanted 里不在 bibKeys 的 key（保序、去重）。
 * 只是快速预判：真正的去重由 Rust `plan_bib_append` 按目标文件判定。
 */
export function missingCiteKeys(wanted: string[], bibKeys: string[]): string[] {
  const have = new Set(bibKeys);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of wanted) {
    const k = String(raw ?? "").trim();
    if (!k || seen.has(k) || have.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * `zotero_fetch_item` 返回单对象 JSON（不是数组）；坏 JSON / 非题录返回 null。
 */
export function parseSingleItem(raw: string): ZoteroItem | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const items = parseZoteroItems(JSON.stringify(Array.isArray(data) ? data : [data]));
  return items.length > 0 ? items[0] : null;
}

export interface KeyMapEntry {
  citeKey: string;
  itemKey: string;
}

/**
 * 增量并入键映射（on-demand 单条写入后同步 map.json，不等下一轮全量同步）：
 * - 已有的 citeKey / itemKey 不覆盖（冲突保留旧指向）；
 * - 新增的 key 从 unmapped 里移除；
 * - serverId 沿用旧的（同一代际）。
 */
export function appendKeyMap(
  prev: ZoteroKeyMap | null,
  entries: KeyMapEntry[],
  now: string = new Date().toISOString(),
): ZoteroKeyMap {
  const byCiteKey: Record<string, string> = { ...(prev?.byCiteKey ?? {}) };
  const byItemKey: Record<string, string> = { ...(prev?.byItemKey ?? {}) };
  for (const { citeKey, itemKey } of entries) {
    if (!citeKey || !itemKey) continue;
    if (byItemKey[itemKey] && byItemKey[itemKey] !== citeKey) continue; // 同条目换 key：交给漂移检测
    if (byCiteKey[citeKey] && byCiteKey[citeKey] !== itemKey) continue; // 同 key 指向另一条：不覆盖
    byCiteKey[citeKey] = itemKey;
    byItemKey[itemKey] = citeKey;
  }
  const unmapped = new Set(prev?.unmapped ?? []);
  for (const { citeKey } of entries) unmapped.delete(citeKey);
  return {
    serverId: prev?.serverId ?? null,
    updatedAt: now,
    byCiteKey,
    byItemKey,
    unmapped: [...unmapped].sort(),
  };
}

/** 键漂移计划：同一 itemKey 的 citekey 变了、且旧 key 仍被 \cite 引用 */
export function planKeyMigration(
  previous: ZoteroKeyMap | null,
  next: ZoteroKeyMap,
  citedKeys: string[],
): KeyMigration[] {
  if (!previous) return [];
  const cited = new Set(citedKeys);
  const out: KeyMigration[] = [];
  for (const [itemKey, oldKey] of Object.entries(previous.byItemKey)) {
    const newKey = next.byItemKey[itemKey];
    if (newKey && newKey !== oldKey && cited.has(oldKey)) {
      out.push({ from: oldKey, to: newKey, itemKey });
    }
  }
  return out;
}

/** 按迁移计划改写 \cite 系列命令里的 key（P1 只生成计划、不自动改文档） */
export function applyKeyMigration(text: string, migrations: KeyMigration[]): string {
  if (migrations.length === 0) return text;
  const map = new Map(migrations.map((m) => [m.from, m.to]));
  return text.replace(
    /(\\(?:nocite|cite|citep|citet|citeauthor|citeyear|citeyearpar|citetext|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{)([^{}]*)(\})/g,
    (_all, prefix: string, keys: string, suffix: string) =>
      prefix +
      keys
        .split(",")
        .map((k) => {
          const t = k.trim();
          const hit = map.get(t);
          return hit ? k.replace(t, hit) : k;
        })
        .join(",") +
      suffix,
  );
}

/** 编译前一致性诊断：只读，永不阻断编译 */
export function checkBibConsistency(
  bibKeys: string[],
  citeKeys: string[],
  checkedAt: string = new Date().toISOString(),
): ZoteroConsistency {
  const bib = new Set(bibKeys);
  const cites = new Set(citeKeys);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const k of bibKeys) {
    if (seen.has(k)) duplicates.push(k);
    else seen.add(k);
  }
  return {
    checkedAt,
    missing: [...cites].filter((k) => !bib.has(k)).sort(),
    orphaned: [...bib].filter((k) => !cites.has(k)).sort(),
    duplicates: [...new Set(duplicates)].sort(),
    bibCount: bib.size,
    citeCount: cites.size,
  };
}

/** 距上次拉取是否足够久（离线/异常时间一律允许重试） */
export function shouldPull(
  lastAt: string | null,
  now: number,
  minIntervalMs: number = PULL_MIN_INTERVAL_MS,
): boolean {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  return !Number.isFinite(t) || now - t >= minIntervalMs;
}

/**
 * 路径归一化（仅用于比对）：统一分隔符、剥 Windows verbatim 前缀、
 * 折叠重复斜杠 / `.` / `..`、大小写折叠。
 *
 * 必要性：项目树里的 `ProjectNode.path` 是 Windows 反斜杠写法，而绑定路径
 * `normalizeBibPath()` 统一输出正斜杠（还可能带 `./`）；若只做 toLowerCase
 * 比对，同一个 .bib 会被当成两个文件解析两遍 → 引用面板出现重复分组、
 * 重复 key 告警。UNC / POSIX 前导斜杠与盘符必须保留。
 */
export function pathKey(s: string): string {
  const raw = s.replace(/\\/g, "/").replace(/^\/\/\?\//, "");
  const unc = raw.startsWith("//");
  const absolute = raw.startsWith("/");
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute && !unc) parts.push("..");
      continue;
    }
    parts.push(seg.toLowerCase());
  }
  const body = parts.join("/");
  if (unc) return `//${body}`;
  if (absolute) return `/${body}`;
  return body;
}

/**
 * 合并「项目树内的 .bib」与「Zotero 绑定的外部 .bib」，按规范化路径去重。
 * 顺序保证：项目树路径优先保留 —— `BibEntry.file` 必须与 `ProjectNode.path`
 * 的写法一致，否则 Ctrl+点击跳转与资源树定位会匹配不上。
 */
export function mergeBibPaths(treePaths: string[], externalPaths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...treePaths, ...externalPaths]) {
    if (!p || !p.trim()) continue;
    const k = pathKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** 相对项目根 → 绝对路径；已是绝对路径原样返回（纯字符串，不依赖 node:path） */
export function normalizeBibPath(root: string, input: string): string {
  const p = input.trim().replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(p) || p.startsWith("//")) return p;
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${r}/${p.replace(/^\.\//, "")}`;
}

export function isPathInsideRoot(root: string, abs: string): boolean {
  const r = pathKey(root.replace(/\/+$/, ""));
  const a = pathKey(abs);
  return a === r || a.startsWith(`${r}/`);
}

/** 事件去重：同路径同 hash 视为重复（Rust 已去重，这里防重复挂载 / 双通道） */
export function isNewChange(
  previous: Pick<ZoteroBibChanged, "path" | "hash"> | null,
  next: ZoteroBibChanged,
): boolean {
  if (!previous) return true;
  return pathKey(previous.path) !== pathKey(next.path) || previous.hash !== next.hash;
}

/** 设置页同步结果文案 */
export function syncSummary(r: ZoteroSyncRecord | null): string {
  if (!r) return "尚未同步";
  const head = r.ok ? "同步成功" : "同步失败";
  const src = r.source === "bbt" ? "BBT 导出" : r.source === "local-api" ? "本地 API" : "跳过";
  const when = r.at.slice(11, 19) || r.at;
  return `${head} · ${src} · ${r.entryCount} 条 · 映射 ${r.mappedCount} · ${r.written ? "已写盘" : "无变化"} · ${when}${r.message ? ` · ${r.message}` : ""}`;
}

/** 编译前一致性摘要（写日志一行，不弹 toast，避免与既有 lint 重复打扰） */
export function consistencySummary(c: ZoteroConsistency | null): string {
  if (!c) return "";
  return `Zotero 引用一致性：.bib ${c.bibCount} 键 / \\cite ${c.citeCount} 键，缺失 ${c.missing.length}、未引用 ${c.orphaned.length}、重复 ${c.duplicates.length}`;
}
