// Zotero 联动 · P3-5 文献库浏览纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 职责：把本地 API 的 collections / items 原始 JSON 变成可渲染的行与筛选结果。
// 铁律：只读浏览；分类树遇到环/缺失父节点必须自我兜底，绝不递归爆炸；
//       条目字段口径复用 zoteroSync.parseZoteroItems，不另起一套。

import type { ZoteroCollection, ZoteroItem } from "../../types/zotero.ts";
import { parseZoteroItems } from "./zoteroSync.ts";

export interface LibraryItem extends ZoteroItem {
  /** item.data.tags 里的标签名（去重） */
  tags: string[];
}

function asArray(raw: string): unknown[] {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    const wrapped = (data as { items?: unknown } | null)?.items;
    return Array.isArray(wrapped) ? wrapped : [];
  } catch {
    return [];
  }
}

/** itemKey → 标签数组（大小写按 Zotero 原样保留，排序去重） */
export function parseItemTags(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of asArray(raw)) {
    const o = v as { key?: unknown; data?: { tags?: unknown } } | null;
    if (!o) continue;
    const key = typeof o.key === "string" ? o.key : "";
    if (!key) continue;
    const rawTags = o.data?.tags;
    if (!Array.isArray(rawTags)) continue;
    const names: string[] = [];
    for (const t of rawTags) {
      const name =
        typeof t === "string"
          ? t
          : typeof (t as { tag?: unknown })?.tag === "string"
            ? String((t as { tag: string }).tag)
            : "";
      if (name && !names.includes(name)) names.push(name);
    }
    out.set(key, names.sort((a, b) => a.localeCompare(b, "zh-CN")));
  }
  return out;
}

/** 解析题录并补齐标签；字段口径与 P1 同步完全一致 */
export function parseLibraryItems(raw: string): LibraryItem[] {
  const tags = parseItemTags(raw);
  return parseZoteroItems(raw).map((it) => ({ ...it, tags: tags.get(it.itemKey) ?? [] }));
}

/** 翻页合并：按 itemKey 去重，先到的（旧页）优先，避免「加载更多」出现重复行 */
export function mergeLibraryItems(
  existing: LibraryItem[],
  incoming: LibraryItem[],
): LibraryItem[] {
  const seen = new Set(existing.map((i) => i.itemKey));
  const out = [...existing];
  for (const it of incoming) {
    if (seen.has(it.itemKey)) continue;
    seen.add(it.itemKey);
    out.push(it);
  }
  return out;
}

export interface LibraryTag {
  name: string;
  count: number;
}

/** 标签聚合：按出现次数降序、同次数按名称升序（结果稳定，便于 UI 高亮） */
export function collectLibraryTags(items: LibraryItem[]): LibraryTag[] {
  const counter = new Map<string, number>();
  for (const it of items) {
    for (const t of it.tags) counter.set(t, (counter.get(t) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, "zh-CN"));
}

export interface LibraryFilter {
  /** 关键词：标题 / 作者 / 年 / 期刊 / citekey / DOI / 标签 */
  query?: string;
  /** 标签精确匹配（大小写不敏感）；null/空 = 不过滤 */
  tag?: string | null;
}

/** 本地筛选（只作用于已加载条目；Zotero 侧搜索仍走 Picker 的 zotero_search） */
export function filterLibraryItems(
  items: LibraryItem[],
  filter: LibraryFilter,
): LibraryItem[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  const tag = (filter.tag ?? "").trim().toLowerCase();
  if (!q && !tag) return items;
  return items.filter((it) => {
    if (tag && !it.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (!q) return true;
    const hay = [
      it.title,
      it.authors.join(" "),
      it.year,
      it.publicationTitle,
      it.citationKey,
      it.doi,
      it.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export interface CollectionRow {
  key: string;
  name: string;
  /** 0 = 顶层；用于按层缩进 */
  depth: number;
  /** 是否有子分类（UI 用来决定是否显示展开箭头） */
  hasChildren: boolean;
}

/**
 * 分类树拍平成可渲染行（DFS，父在前）。
 * 兜底：父 key 不在集合里（被删/未同步）与成环都按顶层处理，且每个 key 只出现一次。
 */
export function buildCollectionRows(
  collections: ZoteroCollection[],
  collapsed: ReadonlySet<string> = new Set(),
): CollectionRow[] {
  const byKey = new Map<string, ZoteroCollection>();
  for (const c of collections) byKey.set(c.key, c);

  const children = new Map<string, ZoteroCollection[]>();
  const roots: ZoteroCollection[] = [];
  for (const c of collections) {
    const parent = typeof c.parentCollection === "string" ? c.parentCollection : "";
    if (parent && parent !== c.key && byKey.has(parent)) {
      const arr = children.get(parent) ?? [];
      arr.push(c);
      children.set(parent, arr);
    } else {
      roots.push(c);
    }
  }

  const out: CollectionRow[] = [];
  const visited = new Set<string>();
  /** 折叠掉的子树：标记为已处理但不渲染，避免末尾兜底把它们当成环补回来 */
  const hideSubtree = (list: ZoteroCollection[]) => {
    for (const c of list) {
      if (visited.has(c.key)) continue;
      visited.add(c.key);
      hideSubtree(children.get(c.key) ?? []);
    }
  };
  const walk = (list: ZoteroCollection[], depth: number) => {
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    for (const c of sorted) {
      if (visited.has(c.key)) continue;
      visited.add(c.key);
      const kids = (children.get(c.key) ?? []).filter((k) => !visited.has(k.key));
      out.push({ key: c.key, name: c.name, depth, hasChildren: kids.length > 0 });
      if (kids.length > 0) {
        if (collapsed.has(c.key)) hideSubtree(kids);
        else walk(kids, depth + 1);
      }
    }
  };
  walk(roots, 0);

  // 极端情况：剩下的是环（A→B→A），补在末尾，depth 0，保证仍可点击
  for (const c of collections) {
    if (!visited.has(c.key)) {
      out.push({ key: c.key, name: c.name, depth: 0, hasChildren: false });
    }
  }
  return out;
}

/** 当前分类的展示名（顶部面包屑）；null = 全库 */
export function collectionLabel(
  rows: CollectionRow[],
  key: string | null,
): string {
  if (!key) return "全部文献";
  return rows.find((r) => r.key === key)?.name ?? "全部文献";
}

/** 摘要行：作者 · 年 · 期刊 */
export function libraryItemMeta(item: LibraryItem): string {
  const authors = item.authors.length > 0 ? item.authors.slice(0, 2).join("、") : "—";
  const more = item.authors.length > 2 ? " 等" : "";
  return [authors + more, item.year, item.publicationTitle].filter(Boolean).join(" · ");
}
