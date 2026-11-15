// Zotero 联动 · P3-1 反向跳转纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 铁律：URL 里的必须是 Zotero 的 8 位 itemKey，绝不是 LaTeX citekey；
//       证据不足时宁可提示「未找到」，也不猜一个 itemKey 把用户跳到错误条目。
import type { ZoteroItem, ZoteroKeyMap } from "../../types/zotero.ts";
import { citationKeyFor } from "./zoteroPicker.ts";

export const ZOTERO_SELECT_BASE = "zotero://select";
/** 反查可接受的最低分：低于此值一律不跳，避免误定位 */
export const REVERSE_MIN_SCORE = 80;
/** 缺映射时最多发几次只读搜索请求 */
export const REVERSE_MAX_QUERIES = 3;
/** 单次反查取回的题录数（local API 没有默认 limit，必须显式给） */
export const REVERSE_SEARCH_LIMIT = 20;

/** 反查所需的 .bib 条目最小投影（不 import 编辑器 / store 类型） */
export interface ReverseEntry {
  key: string;
  title?: string;
  doi?: string;
  author?: string;
  year?: string;
  /** P3-1b：原始字段表，供「论文网页」目标读取 url / doi */
  fields?: Record<string, string> | null;
}

/** 个人库 / 群组库；本期只生成链接，不接群组库 API */
export type ZoteroLibraryRef = { type: "user" } | { type: "group"; id: number | string };

export interface ReverseMatch {
  itemKey: string;
  score: number;
  reason: "citekey" | "doi" | "title";
}

/** Zotero itemKey 固定 8 位字母数字；citekey 通常不满足，用它做最后一道闸门 */
export function isItemKey(v: unknown): boolean {
  return typeof v === "string" && /^[A-Z0-9]{8}$/i.test(v.trim());
}

/** 有效的 select URL：`zotero://select/library/items/<KEY>`；群组库为 `groups/<id>/items/<KEY>` */
export function zoteroSelectUrl(
  itemKey: string,
  lib: ZoteroLibraryRef = { type: "user" },
): string | null {
  const key = String(itemKey ?? "").trim();
  if (!isItemKey(key)) return null;
  if (lib.type === "user") return `${ZOTERO_SELECT_BASE}/library/items/${key}`;
  const gid = String(lib.id ?? "").trim();
  if (!/^\d+$/.test(gid)) return null;
  return `${ZOTERO_SELECT_BASE}/groups/${gid}/items/${key}`;
}

/** map.json 的 byCiteKey：精确命中 + 大小写不敏感兜底；非法 itemKey 视为未映射 */
export function mappedItemKey(
  citeKey: string,
  keyMap: Pick<ZoteroKeyMap, "byCiteKey"> | null | undefined,
): string | null {
  const k = String(citeKey ?? "").trim();
  const by = keyMap?.byCiteKey;
  if (!k || !by) return null;
  const direct = by[k];
  if (isItemKey(direct)) return direct.trim();
  const lower = k.toLowerCase();
  for (const [ck, ik] of Object.entries(by)) {
    if (ck.toLowerCase() === lower && isItemKey(ik)) return ik.trim();
  }
  return null;
}

/** DOI 归一：去 URL 前缀 / `doi:` 前缀 / 花括号 / 空白，统一小写 */
export function normalizeDoi(v: string): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[{}\s]/g, "");
}

/** 标题归一：去花括号 / LaTeX 命令 / 标点空白，保留中文与字母数字 */
export function normalizeTitle(v: string): string {
  return String(v ?? "")
    .toLowerCase()
    // 先去命令再去花括号：否则 \emph{Learning} 会被连成 \emphLearning 一起吃掉
    .replace(/\\[a-zA-Z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
    .trim();
}

/** 构造反查词：citekey → DOI → 标题，去重、限长、最多 3 条 */
export function buildReverseQueries(entry: ReverseEntry): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = String(v ?? "")
      .trim()
      // 同 normalizeTitle：先剥 LaTeX 命令，再剥花括号，避免参数被并进命令名
      .replace(/\\[a-zA-Z]+\s*/g, " ")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (s.length < 2 || out.includes(s) || out.length >= REVERSE_MAX_QUERIES) return;
    out.push(s);
  };
  push(entry.key);
  push(entry.doi);
  push(entry.title);
  return out;
}

/**
 * 从只读搜索结果里挑可信匹配：
 * citekey 精确命中（复用 P2 三级回退）> DOI 相等 > 标题归一相等。
 * 标题路径若年份不符再扣分；低于 REVERSE_MIN_SCORE 一律返回 null。
 */
export function pickReverseMatch(
  entry: ReverseEntry,
  items: ZoteroItem[],
  keyMap: ZoteroKeyMap | null,
): ReverseMatch | null {
  const targetKey = String(entry.key ?? "").trim();
  const targetDoi = normalizeDoi(entry.doi ?? "");
  const targetTitle = normalizeTitle(entry.title ?? "");
  let best: ReverseMatch | null = null;

  for (const item of items) {
    if (!isItemKey(item.itemKey)) continue;
    const ck = citationKeyFor(item, keyMap).trim();
    let score = 0;
    let reason: ReverseMatch["reason"] | null = null;
    if (targetKey && ck && ck === targetKey) {
      score = 120;
      reason = "citekey";
    } else if (targetDoi && normalizeDoi(item.doi ?? "") === targetDoi) {
      score = 100;
      reason = "doi";
    } else if (targetTitle && normalizeTitle(item.title ?? "") === targetTitle) {
      score = 90;
      reason = "title";
    }
    if (reason === null) continue;
    // 只有标题是弱证据：同年不同版/不同年份的同名条目不跳
    if (reason === "title" && entry.year && item.year && entry.year !== item.year) score -= 20;
    if (score < REVERSE_MIN_SCORE) continue;
    const key = item.itemKey.trim();
    if (!best || score > best.score || (score === best.score && key < best.itemKey)) {
      best = { itemKey: key, score, reason };
    }
  }
  return best;
}
