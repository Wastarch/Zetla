// Zotero 联动 · P2 Citation Picker 纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 职责：引用命令格式化、模糊评分、候选合并与状态标记、citekey 三级回退、分页决策。
// 铁律：插入的必须是 **citekey**，绝不是 Zotero 的 8 位 itemKey；
//       候选以「项目 .bib 索引」为主源，Zotero 全库搜索只做增强。
import {
  DEFAULT_PICKER_COLUMNS,
  ZOTERO_PICKER_COLUMN_IDS,
  ZOTERO_COMMANDS,
  type ZoteroCommand,
  type ZoteroItem,
  type ZoteroKeyMap,
} from "../../types/zotero.ts";
import { citationKeyFromExtra, parseZoteroItems } from "./zoteroSync.ts";

/** 远端搜索每页条数（与 Rust PICKER_DEFAULT_LIMIT 一致） */
export const PICKER_PAGE_SIZE = 30;
/** 浮层最多渲染的候选数：大库不用虚拟列表也能保持流畅 */
export const PICKER_MAX_RESULTS = 50;
/** 远端搜索防抖窗口 */
export const PICKER_DEBOUNCE_MS = 250;
/** 触发远端搜索的最小词长；主源（本地 .bib）始终即时过滤 */
export const PICKER_MIN_QUERY = 2;
export const PICKER_DEFAULT_COMMAND: ZoteroCommand = "cite";

/** 从 BibEntry 中挑出 Picker 需要的字段（避免纯逻辑 import 编辑器/store 类型） */
export interface BibLikeEntry {
  key: string;
  author?: string;
  title?: string;
  year?: string;
  publication?: string;
  doi?: string;
}

export interface ZoteroPickerCandidate {
  citeKey: string;
  /** Zotero 8 位 key；本地手写条目为 null */
  itemKey: string | null;
  title: string;
  authors: string;
  year: string;
  publication: string;
  doi: string;
  /** 是否已存在于项目 .bib —— false 时插入会报缺失引用，UI 须警告 */
  inBib: boolean;
  /** 全文被引次数（citesByKey） */
  citedCount: number;
  source: "bib" | "zotero";
}

/** 命令白名单归一：接受 `cite` / `\cite` / 大小写混杂，其余回落默认命令 */
export function normalizeCommand(
  raw: string,
  fallback: ZoteroCommand = PICKER_DEFAULT_COMMAND,
): ZoteroCommand {
  const v = String(raw ?? "").trim().replace(/^\\/, "").toLowerCase();
  return (ZOTERO_COMMANDS as readonly string[]).includes(v)
    ? (v as ZoteroCommand)
    : fallback;
}

/** 清洗 key：去空白、LaTeX 分隔符与花括号，保序去重 */
export function sanitizeKeys(keys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const k = String(raw ?? "")
      .trim()
      .replace(/[{}\[\],]/g, "")
      .replace(/\s+/g, "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** 可选参数里不能有 `]`，否则会提前闭合 LaTeX 可选参数 */
function optionalArg(s: string): string {
  return String(s ?? "").trim().replace(/\]/g, ")");
}

/**
 * 生成引用命令。两个可选参数按「所见即所得」输出：
 * 第一个是前缀（see / cf.），第二个是页码（p.~10）。
 * natbib / biblatex 对两参数的语义不完全一致，故不做静默换算，
 * 由浮层实时预览最终字符串，用户看到的即插入的。
 */
export function formatCitation(opts: {
  command: string;
  keys: string[];
  starred?: boolean;
  prenote?: string;
  postnote?: string;
}): string {
  const keys = sanitizeKeys(opts.keys);
  if (keys.length === 0) return "";
  const cmd = normalizeCommand(opts.command);
  const star = opts.starred ? "*" : "";
  const pre = optionalArg(opts.prenote ?? "");
  const post = optionalArg(opts.postnote ?? "");
  let args = "";
  if (post) args = `[${pre}][${post}]`;
  else if (pre) args = `[${pre}]`;
  return `\\${cmd}${star}${args}{${keys.join(",")}}`;
}

/** 模糊打分：完全 > 前缀 > 子串 > 多词全含 > 字符子序列（权重最低） */
export function fuzzyScore(query: string, text: string): number {
  const q = String(query ?? "").trim().toLowerCase();
  const t = String(text ?? "").toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const idx = t.indexOf(q);
  if (idx >= 0) return Math.max(40, 65 - Math.min(25, idx));
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => t.includes(p))) return 35;
  if (q.length >= 3 && t.length <= 80) {
    let qi = 0;
    for (const ch of t) {
      if (ch === q[qi]) qi++;
      if (qi === q.length) return 12;
    }
  }
  return 0;
}

/** 候选综合分：各字段最高分 + 已在 .bib / 被引次数的小加权（常用条目靠前） */
export function scoreCandidate(query: string, c: ZoteroPickerCandidate): number {
  const q = String(query ?? "").trim();
  if (!q) {
    // 浏览模式（分类内空查询）不能把未同步条目判成 0 分：rankCandidates 会
    // filter(s > 0)，而 Zotero 远端分类条目通常 inBib=false 且 citedCount=0，
    // 会被整批丢掉，表现为「切了分类列表还是只剩本地 .bib 那几条」。
    // 基础分 1 保住它们，优先级仍是 已在 .bib > 被引次数。
    return 1 + (c.inBib ? 10 : 0) + Math.min(c.citedCount, 10);
  }
  const fields: [string, number][] = [
    [c.citeKey, 1],
    [c.title, 0.95],
    [c.authors, 0.9],
    [c.year, 0.8],
    [c.doi, 0.7],
    [c.publication, 0.6],
  ];
  let best = 0;
  for (const [v, w] of fields) best = Math.max(best, fuzzyScore(q, v) * w);
  // 无关候选必须得 0，否则 rankCandidates 的过滤会被「已在 .bib」加权顶破
  if (best === 0) return 0;
  return Math.round(best + (c.inBib ? 3 : 0) + Math.min(c.citedCount, 5));
}

/**
 * citekey 三级回退：P1 的 map.json → 题录 Extra 的 `Citation Key:` →
 * parseZoteroItems 已归一化的 citationKey。取不到返回空串（该条目不可插入）。
 */
export function citationKeyFor(
  item: ZoteroItem,
  keyMap: ZoteroKeyMap | null,
): string {
  const fromMap = keyMap?.byItemKey?.[item.itemKey];
  if (fromMap) return fromMap;
  const fromExtra = citationKeyFromExtra(item.extra ?? "");
  if (fromExtra) return fromExtra;
  return item.citationKey ?? "";
}

/** Zotero 搜索结果里有多少条目无法解析出 citekey（UI 提示用） */
export function unmappedCount(items: ZoteroItem[], keyMap: ZoteroKeyMap | null): number {
  return items.filter((i) => !citationKeyFor(i, keyMap)).length;
}

/** 解析 Rust 拿回的 items JSON（复用 P1 的归一化，避免两套字段口径） */
export function parseSearchItems(raw: string): ZoteroItem[] {
  return parseZoteroItems(raw);
}

/**
 * 合并两路候选：项目 .bib 为主源（inBib=true，离线可用），
 * Zotero 全库搜索为增强（inBib=false）。按 citeKey 去重，bib 源优先保留。
 */
export function mergeCandidates(
  bibEntries: BibLikeEntry[],
  zoteroItems: ZoteroItem[],
  keyMap: ZoteroKeyMap | null,
  citedCounts: Record<string, number> = {},
): ZoteroPickerCandidate[] {
  const out = new Map<string, ZoteroPickerCandidate>();
  for (const e of bibEntries) {
    const key = String(e.key ?? "").trim();
    if (!key) continue;
    out.set(key, {
      citeKey: key,
      itemKey: keyMap?.byCiteKey?.[key] ?? null,
      title: e.title ?? "",
      authors: e.author ?? "",
      year: e.year ?? "",
      publication: e.publication ?? "",
      doi: e.doi ?? "",
      inBib: true,
      citedCount: citedCounts[key] ?? 0,
      source: "bib",
    });
  }
  for (const it of zoteroItems) {
    const key = citationKeyFor(it, keyMap);
    if (!key) continue; // 没有 citekey 的条目无法生成 LaTeX 引用，跳过
    const hit = out.get(key);
    if (hit) {
      // 已在 .bib：只补元数据，不改写 inBib / source
      if (!hit.itemKey) hit.itemKey = it.itemKey;
      if (!hit.doi && it.doi) hit.doi = it.doi;
      if (!hit.title && it.title) hit.title = it.title;
      if (!hit.authors && it.authors.length) hit.authors = it.authors.join(", ");
      continue;
    }
    out.set(key, {
      citeKey: key,
      itemKey: it.itemKey,
      title: it.title ?? "",
      authors: (it.authors ?? []).join(", "),
      year: it.year ?? "",
      publication: it.publicationTitle ?? "",
      doi: it.doi ?? "",
      inBib: false,
      citedCount: citedCounts[key] ?? 0,
      source: "zotero",
    });
  }
  return [...out.values()];
}

/** 排序 + 截断；query 为空时按「已在 .bib / 被引次数」排 */
export function rankCandidates(
  candidates: ZoteroPickerCandidate[],
  query: string,
  max: number = PICKER_MAX_RESULTS,
): ZoteroPickerCandidate[] {
  const scored = candidates
    .map((c) => ({ c, s: scoreCandidate(query, c) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) =>
      b.s !== a.s
        ? b.s - a.s
        : b.c.citedCount !== a.c.citedCount
          ? b.c.citedCount - a.c.citedCount
          : a.c.citeKey.localeCompare(b.c.citeKey),
    );
  return scored.slice(0, Math.max(0, max)).map(({ c }) => c);
}

/** 选中项里不在 .bib 的 key：允许插入，但必须给出明确警告（用户决策） */
export function pickerWarning(selected: ZoteroPickerCandidate[]): string | null {
  const missing = selected.filter((c) => !c.inBib).map((c) => c.citeKey);
  if (missing.length === 0) return null;
  const head = missing.slice(0, 3).join(", ");
  const tail = missing.length > 3 ? ` 等 ${missing.length} 个` : "";
  return `${head}${tail} 尚未同步到项目 .bib，编译会报「引用缺失」；仍可插入，建议先点「立即同步」。`;
}

/** 是否还有下一页（total 未知时按本页是否满额判断） */
export function nextPageStart(
  start: number,
  received: number,
  total: number | null,
  pageSize: number = PICKER_PAGE_SIZE,
): number | null {
  const next = start + pageSize;
  if (total != null && next >= total) return null;
  if (received < pageSize) return null;
  return next;
}

// ── P5 · 分类选择（connector getSelectedCollection → 本地 API key 匹配）────────
//
// 实测（2026-11-16）：POST /connector/getSelectedCollection 返回
//   { id: 30 | null, name, targets: [{ id: "C30"|"L1", name, level, recent? }] }
// 注意：顶层 `id` 在选中分类时是**数字**（分类数字 id），只有 targets[] 里才是
// "C30"/"L1" 字符串；选中文库根时 id = null。解析时把数字归一成 `C<数字>`，
// 才能与 targets / API 分类树对齐。数字 id 在本地 API JSON 里不存在，
// 无法直接换算成 8 位 key → 用「名称 + 祖先路径」匹配 API 分类树。

/** targets 里的一条目标（文库根是 "L<id>"，分类是 "C<id>"） */
export interface PickerCollectionTarget {
  id: string;
  name: string;
  level: number;
}

export interface PickerSelectedCollection {
  /** 选中分类为 "C<数字id>"（connector 顶层 id 可能是数字，解析时补 C 前缀）；
   *  文库根 / 已保存搜索等为 null 或其它前缀 */
  id: string | null;
  /** 选中目标名（分类名或文库名） */
  name: string;
  targets: PickerCollectionTarget[];
}

/** 解析 getSelectedCollection 原始 JSON；坏 JSON / 结构不符返回 null（离线降级用） */
export function parseSelectedCollection(raw: string): PickerSelectedCollection | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  // 顶层 id 实测是数字（选中分类，如 30）、null（文库根），旧版也可能是 "C…"/"L…" 字符串。
  // 数字统一补 C 前缀，与 targets[].id、matchCollectionKey 的判定口径对齐。
  let id: string | null;
  if (o.id === null) {
    id = null;
  } else if (typeof o.id === "number" && Number.isFinite(o.id) && o.id > 0) {
    id = `C${Math.floor(o.id)}`;
  } else if (typeof o.id === "string" && o.id) {
    id = o.id;
  } else {
    return null; // 缺失 / 布尔 / 对象 / 0 / 负数 = 结构不符
  }
  const name = typeof o.name === "string" ? o.name : "";
  const rawTargets = Array.isArray(o.targets) ? o.targets : [];
  const targets: PickerCollectionTarget[] = [];
  for (const t of rawTargets) {
    if (typeof t !== "object" || t === null) continue;
    const r = t as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.name !== "string" || !r.name) continue;
    const level = typeof r.level === "number" && Number.isFinite(r.level) && r.level >= 0
      ? Math.floor(r.level)
      : 0;
    targets.push({ id: r.id, name: r.name, level });
  }
  return { id, name, targets };
}

/** 由 targets 的 level 序列重建每个目标的祖先名链（DFS 缩进 → 路径） */
export function targetPaths(targets: PickerCollectionTarget[]): string[][] {
  const stack: string[] = [];
  const out: string[][] = [];
  for (const t of targets) {
    if (t.id.startsWith("L")) {
      // 文库根：清空路径（它只是树的顶点，不参与分类路径匹配）
      stack.length = 0;
      out.push([]);
      continue;
    }
    // level = 1 起步（0 是文库根）；回退到 level-1 层的父级
    stack.length = Math.max(0, t.level - 1);
    const path = [...stack, t.name];
    stack.push(t.name);
    out.push(path);
  }
  return out;
}

/** API 分类树：key → 祖先名链（含自身）；父分类成环时环内节点返回到环入口为止的路径 */
export function apiCollectionPaths(
  collections: { key: string; name: string; parentCollection: string | false }[],
): Map<string, string[]> {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const cache = new Map<string, string[]>();
  const pathOf = (key: string, visiting: Set<string>): string[] => {
    const cached = cache.get(key);
    if (cached) return cached;
    if (visiting.has(key)) return []; // 环：断开，不继续向上
    const c = byKey.get(key);
    if (!c) return [];
    visiting.add(key);
    const parent = typeof c.parentCollection === "string" && c.parentCollection
      ? pathOf(c.parentCollection, visiting)
      : [];
    visiting.delete(key);
    const path = [...parent, c.name];
    cache.set(key, path);
    return path;
  };
  for (const c of collections) pathOf(c.key, new Set());
  return cache;
}

/**
 * 匹配「Zotero 当前打开的分类」→ 本地 API key。
 * - `sel.id` 不以 "C" 开头（文库根等）→ null（默认「全部文献」）；
 * - 名称唯一命中 → 直接用；重名时用完整祖先路径区分；路径也判不出 → 取第一个同名（可接受降级）。
 */
export function matchCollectionKey(
  sel: PickerSelectedCollection | null,
  collections: { key: string; name: string; parentCollection: string | false }[],
): string | null {
  if (!sel || !sel.id || !sel.id.startsWith("C") || !sel.name.trim()) return null;
  const want = sel.name.trim();
  const hits = collections.filter((c) => c.name.trim() === want);
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0].key;
  // 重名：用祖先路径区分；路径取 sel.id 对应的 target（而非第一个同名）
  const paths = targetPaths(sel.targets);
  const selfIdx = sel.targets.findIndex((t) => t.id === sel.id);
  const selPath = selfIdx >= 0 ? paths[selfIdx] : undefined;
  const apiPaths = apiCollectionPaths(collections);
  if (selPath) {
    const exact = hits.find((c) => {
      const p = apiPaths.get(c.key) ?? [];
      return p.length === selPath.length && p.every((seg, i) => seg === selPath[i]);
    });
    if (exact) return exact.key;
  }
  return hits[0].key;
}

// ── M1-34 · 列表表头与自定义显示列 ──────────────────────────────
// title 列恒显（不参与配置），其余列由设置 zotero.pickerColumns 决定；
// 白名单与 Rust ZOTERO_PICKER_COLUMN_IDS / normalize_zotero 同规则。

/** Picker 列表列定义（label 供表头与列菜单，width 供 grid-template-columns） */
export interface PickerColumnDef {
  id: string;
  label: string;
  width: string;
}

export const PICKER_COLUMN_DEFS: readonly PickerColumnDef[] = [
  { id: "title", label: "标题", width: "minmax(0, 1.6fr)" },
  { id: "authors", label: "作者", width: "minmax(0, 1.3fr)" },
  { id: "year", label: "年份", width: "46px" },
  { id: "publication", label: "出版物", width: "minmax(0, 1fr)" },
  { id: "citeKey", label: "citekey", width: "minmax(110px, 0.9fr)" },
  { id: "status", label: "状态", width: "96px" },
];

/** 归一化列配置：白名单过滤 + 去重 + 空表回退默认（与 Rust normalize_zotero 一致） */
export function normalizePickerColumns(cols: unknown): string[] {
  if (!Array.isArray(cols)) return [...DEFAULT_PICKER_COLUMNS];
  const seen = new Set<string>();
  for (const c of cols) {
    if (
      typeof c === "string" &&
      ZOTERO_PICKER_COLUMN_IDS.includes(c as (typeof ZOTERO_PICKER_COLUMN_IDS)[number]) &&
      !seen.has(c)
    ) {
      seen.add(c);
    }
  }
  return seen.size > 0 ? [...seen] : [...DEFAULT_PICKER_COLUMNS];
}

/**
 * 由列配置拼 grid-template-columns（表头与数据行共用同一模板保证对齐）：
 * 首列固定 18px 勾选框列，第二列固定 title，其后按 PICKER_COLUMN_DEFS
 * 顺序拼接被勾选的列宽。
 */
export function pickerGridTemplate(configured: string[]): string {
  const on = new Set(normalizePickerColumns(configured));
  const parts = ["18px"];
  for (const def of PICKER_COLUMN_DEFS) {
    if (def.id === "title" || on.has(def.id)) parts.push(def.width);
  }
  return parts.join(" ");
}
