// Zotero 联动 · P3-1 反向跳转运行时
//
// 只读：只发 GET 搜索 + 打开 `zotero://select` 本地协议，零写请求、零授权弹窗。
// 反查结果只放内存（不回写 map.json、不写盘）；模块级单例缓存，HMR 时清理。
import { openUrl } from "@tauri-apps/plugin-opener";
import { zoteroApi } from "@/ipc/invoke";
import { useSettingsStore } from "@/core/settings";
import { DEFAULT_ZOTERO_SETTINGS, type ZoteroKeyMap, type ZoteroSettings } from "@/types/zotero";
import { useZoteroStore } from "./useZoteroStore";
import { normalizePort } from "./zoteroDiagnostics";
import { parseSearchItems } from "./zoteroPicker";
import {
  REVERSE_SEARCH_LIMIT,
  buildReverseQueries,
  mappedItemKey,
  pickReverseMatch,
  zoteroSelectUrl,
  type ReverseEntry,
} from "./zoteroReverse";

export interface ZoteroOpenResult {
  ok: boolean;
  message: string;
  itemKey: string | null;
  /** map = 命中 .ltex/zotero/map.json；search = 本地 API 反查；null = 未定位 */
  source: "map" | "search" | null;
}

const reverseCache = new Map<string, string>();

/** 换项目 / HMR / 测试时清空反查缓存 */
export function clearReverseCache(): void {
  reverseCache.clear();
}

if (import.meta.hot) {
  import.meta.hot.dispose(clearReverseCache);
}

function cacheKey(serverId: string | null, citeKey: string): string {
  return `${serverId ?? "local"}\u0000${citeKey}`;
}

function currentSettings(): ZoteroSettings {
  return useSettingsStore.getState().settings.zotero ?? DEFAULT_ZOTERO_SETTINGS;
}

/** 明确离线 / 403 / 400 时省掉一次必然失败的超时；其余状态（含未自检）仍尝试 */
function searchBlocked(): boolean {
  const cfg = currentSettings();
  if (!cfg.enabled) return true;
  const state = useZoteroStore.getState().health?.state;
  return state === "offline" || state === "api-disabled" || state === "bad-request";
}

async function lookupBySearch(
  entry: ReverseEntry,
  keyMap: ZoteroKeyMap | null,
): Promise<{ itemKey: string; reason: string } | null> {
  if (searchBlocked()) return null;
  const cfg = currentSettings();
  const port = normalizePort(cfg.port);
  for (const q of buildReverseQueries(entry)) {
    try {
      const r = await zoteroApi.search(port, q, REVERSE_SEARCH_LIMIT, 0);
      const m = pickReverseMatch(entry, parseSearchItems(r.items), keyMap);
      if (m) return { itemKey: m.itemKey, reason: m.reason };
    } catch {
      // 单次失败继续下一个查询词；全部失败由调用方给统一提示，不打断编译/编辑
    }
  }
  return null;
}

/**
 * 由引用条目在 Zotero 中定位并高亮对应题录。
 * 顺序：map.json → 内存缓存 → 只读全库反查 → 打开 URL；任何失败都返回结构化结果，不抛异常。
 */
export async function openZoteroItem(entry: ReverseEntry): Promise<ZoteroOpenResult> {
  const citeKey = String(entry.key ?? "").trim();
  if (!citeKey) {
    return { ok: false, message: "该条目没有 citekey，无法定位 Zotero 条目", itemKey: null, source: null };
  }

  const store = useZoteroStore.getState();
  const keyMap = store.keyMap;
  const serverId = keyMap?.serverId ?? store.health?.serverId ?? null;
  let itemKey = mappedItemKey(citeKey, keyMap);
  let source: ZoteroOpenResult["source"] = itemKey ? "map" : null;
  let reason = "";

  if (!itemKey) {
    const cached = reverseCache.get(cacheKey(serverId, citeKey));
    if (cached) {
      itemKey = cached;
      source = "search";
    }
  }
  if (!itemKey) {
    const hit = await lookupBySearch(entry, keyMap);
    if (hit) {
      itemKey = hit.itemKey;
      reason = hit.reason;
      source = "search";
      reverseCache.set(cacheKey(serverId, citeKey), itemKey);
    }
  }

  if (!itemKey) {
    const cfg = currentSettings();
    const why = !cfg.enabled
      ? "Zotero 联动未启用，且没有 citekey → itemKey 映射"
      : "本地 API 离线或未找到可确信匹配的题录";
    return {
      ok: false,
      message: `「${citeKey}」无法定位到 Zotero：${why}。可在设置页开启联动并同步一次绑定分类。`,
      itemKey: null,
      source: null,
    };
  }

  const url = zoteroSelectUrl(itemKey);
  if (!url) {
    return {
      ok: false,
      message: `「${citeKey}」映射到的 itemKey 非法（${itemKey}），已拒绝跳转`,
      itemKey,
      source,
    };
  }

  try {
    await openUrl(url);
    const via = source === "map" ? "键映射" : `全库反查（${reason || "缓存"}）`;
    return { ok: true, message: `已在 Zotero 中打开「${citeKey}」· ${via}`, itemKey, source };
  } catch (e) {
    return {
      ok: false,
      message: `打开 ${url} 失败：${String(e)}；请确认 Zotero 已安装并运行`,
      itemKey,
      source,
    };
  }
}
