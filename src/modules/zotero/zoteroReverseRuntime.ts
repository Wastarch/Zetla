// Zotero 联动 · P3-1 / P3-1b 反向跳转运行时
//
// 只读：只发 GET（搜索 / children）+ 打开本地协议或 http(s) 链接，零写请求、零授权弹窗。
// 反查结果只放内存（不回写 map.json、不写盘）；模块级单例缓存，HMR 时清理。
//
// 三个打开目标（见 zoteroOpenTargets.ts）：
//   pdf  → 父 itemKey → /children → 附件 itemKey → zotero://open-pdf（失败自动回退 item）
//   item → zotero://select（P3-1 原行为，离线 / 关闭联动仍可用）
//   web  → .bib 的 url / doi → https 网页（零 API）
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
import {
  DEFAULT_ZOTERO_OPEN_TARGET,
  pickPdfAttachment,
  plainBibValue,
  paperUrlFromFields,
  zoteroPdfUrl,
  type ZoteroOpenTarget,
} from "./zoteroOpenTargets";
import { cslStyleLabel, normalizeCslStyle, parseCitationResponse } from "./zoteroCitation";

export interface ZoteroOpenResult {
  ok: boolean;
  message: string;
  itemKey: string | null;
  /** map = 命中 .ltex/zotero/map.json；search = 本地 API 反查；web = 论文网页（不解析 itemKey） */
  source: "map" | "search" | "web" | null;
  /** 本次实际执行的打开目标 */
  target: ZoteroOpenTarget;
  /** pdf 失败后是否回退到了 item */
  fallback: boolean;
  /** 实际交给 openUrl 的链接（失败时为 null），便于真机排障 */
  url: string | null;
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
function apiBlocked(): boolean {
  const cfg = currentSettings();
  if (!cfg.enabled) return true;
  const state = useZoteroStore.getState().health?.state;
  return state === "offline" || state === "api-disabled" || state === "bad-request";
}

interface Resolved {
  itemKey: string;
  source: "map" | "search";
  reason: string;
}

/** citekey → 父条目 itemKey：map.json → 内存缓存 → 最多 3 次只读全库反查 */
async function resolveItemKey(entry: ReverseEntry): Promise<Resolved | null> {
  const citeKey = String(entry.key ?? "").trim();
  const store = useZoteroStore.getState();
  const keyMap: ZoteroKeyMap | null = store.keyMap;
  const serverId = keyMap?.serverId ?? store.health?.serverId ?? null;

  const mapped = mappedItemKey(citeKey, keyMap);
  if (mapped) return { itemKey: mapped, source: "map", reason: "" };

  const cached = reverseCache.get(cacheKey(serverId, citeKey));
  if (cached) return { itemKey: cached, source: "search", reason: "缓存" };

  if (!apiBlocked()) {
    const cfg = currentSettings();
    const port = normalizePort(cfg.port);
    for (const q of buildReverseQueries(entry)) {
      try {
        const r = await zoteroApi.search(port, q, REVERSE_SEARCH_LIMIT, 0);
        const m = pickReverseMatch(entry, parseSearchItems(r.items), keyMap);
        if (m) {
          reverseCache.set(cacheKey(serverId, citeKey), m.itemKey);
          return { itemKey: m.itemKey, source: "search", reason: m.reason };
        }
      } catch {
        // 单次失败继续下一个查询词；全部失败由调用方统一提示，不打断编译/编辑
      }
    }
  }
  return null;
}

async function tryOpen(url: string): Promise<string | null> {
  try {
    await openUrl(url);
    return null;
  } catch (e) {
    return String(e);
  }
}

function fail(
  message: string,
  target: ZoteroOpenTarget,
  itemKey: string | null = null,
): ZoteroOpenResult {
  return { ok: false, message, itemKey, source: null, target, fallback: false, url: null };
}

/**
 * 按目标打开引用条目。任何失败都返回结构化结果，不抛异常。
 * 默认 pdf：拿不到 PDF 附件 / API 不可用 / open-pdf 被系统拒收时，自动回退到 select。
 */
export async function openZoteroItem(
  entry: ReverseEntry,
  target: ZoteroOpenTarget = DEFAULT_ZOTERO_OPEN_TARGET,
): Promise<ZoteroOpenResult> {
  const citeKey = String(entry.key ?? "").trim();
  if (!citeKey) return fail("该条目没有 citekey，无法定位 Zotero 条目", target);

  // ① 论文网页：不需要 itemKey、不需要本地 API
  if (target === "web") {
    const url = paperUrlFromFields(entry.fields);
    if (!url) return fail(`「${citeKey}」没有可用的 http(s) URL 或 DOI`, target);
    const err = await tryOpen(url);
    if (err) return { ...fail(`打开论文网页失败：${err}`, target), url };
    return {
      ok: true,
      message: `已打开论文网页「${citeKey}」· ${url}`,
      itemKey: null,
      source: "web",
      target,
      fallback: false,
      url,
    };
  }

  // ② 解析父条目 itemKey（pdf / item 共用同一条链路）
  const resolved = await resolveItemKey(entry);
  if (!resolved) {
    const cfg = currentSettings();
    const why = !cfg.enabled
      ? "Zotero 联动未启用，且没有 citekey → itemKey 映射"
      : "本地 API 离线或未找到可确信匹配的题录";
    return fail(
      `「${citeKey}」无法定位到 Zotero：${why}。可在设置页开启联动并同步一次绑定分类；也可选择「论文网页」。`,
      target,
    );
  }

  const via = resolved.source === "map" ? "键映射" : `全库反查（${resolved.reason || "缓存"}）`;
  const selectUrl = zoteroSelectUrl(resolved.itemKey);
  if (!selectUrl) {
    return fail(
      `「${citeKey}」映射到的 itemKey 非法（${resolved.itemKey}），已拒绝跳转`,
      target,
      resolved.itemKey,
    );
  }

  // ③ 只定位题录（原 P3-1 行为）
  if (target === "item") {
    const err = await tryOpen(selectUrl);
    if (err) {
      return {
        ...fail(`打开 ${selectUrl} 失败：${err}；请确认 Zotero 已安装并运行`, target, resolved.itemKey),
        url: selectUrl,
      };
    }
    return {
      ok: true,
      message: `已在 Zotero 中打开「${citeKey}」· ${via}`,
      itemKey: resolved.itemKey,
      source: resolved.source,
      target,
      fallback: false,
      url: selectUrl,
    };
  }

  // ④ 打开 PDF 全文：children → 附件 itemKey → open-pdf
  let pdfFailure = "";
  let pdfUrl: string | null = null;
  try {
    if (apiBlocked()) throw new Error("Zotero 联动未启用或本地 API 不可用");
    const port = normalizePort(currentSettings().port);
    const raw = await zoteroApi.fetchChildren(port, resolved.itemKey, 50);
    const parentUrl = plainBibValue(entry.fields?.url ?? "");
    const att = pickPdfAttachment(raw, parentUrl);
    if (!att) throw new Error("该条目没有可打开的 PDF 附件");
    pdfUrl = zoteroPdfUrl(att.itemKey);
    if (!pdfUrl) throw new Error("附件 itemKey 非法");
    const err = await tryOpen(pdfUrl);
    if (err) throw new Error(err);
    return {
      ok: true,
      message: `已打开 PDF 全文「${att.filename || citeKey}」· ${via}`,
      itemKey: resolved.itemKey,
      source: resolved.source,
      target,
      fallback: false,
      url: pdfUrl,
    };
  } catch (e) {
    pdfFailure = String(e);
  }

  // ⑤ 主按钮兜底：全文打不开就回退到条目，绝不静默失败
  const fallbackErr = await tryOpen(selectUrl);
  if (fallbackErr) {
    return {
      ...fail(
        `打开全文失败（${pdfFailure}）；回退到条目也失败：${fallbackErr}；请确认 Zotero 已安装并运行`,
        target,
        resolved.itemKey,
      ),
      url: selectUrl,
    };
  }
  return {
    ok: true,
    message: `未打开全文（${pdfFailure}），已回退到 Zotero 条目「${citeKey}」· ${via}`,
    itemKey: resolved.itemKey,
    source: resolved.source,
    target,
    fallback: true,
    url: selectUrl,
  };
}

export interface ZoteroPdfPreviewResult {
  ok: boolean;
  message: string;
  /** asset 协议可直接读取的本地绝对路径 */
  path: string | null;
  filename: string | null;
}

function previewFail(message: string): ZoteroPdfPreviewResult {
  return { ok: false, message, path: null, filename: null };
}

/**
 * P3-2：解析citekey → 父条目 → PDF 附件 → 本地路径，供 Zetla 内嵌 PdfPreview 使用。
 * 与 P3-1b 不同，这里**不做** zotero:// 回退：拿不到本地文件就明确提示，
 * 用户仍可用分体按钮在 Zotero 阅读器里打开。永不抛异常。
 */
export async function resolveZoteroPdfPreview(
  entry: ReverseEntry,
): Promise<ZoteroPdfPreviewResult> {
  const citeKey = String(entry.key ?? "").trim();
  if (!citeKey) return previewFail("该条目没有 citekey，无法定位 Zotero 附件");
  if (apiBlocked()) {
    return previewFail("Zotero 联动未启用或本地 API 不可用，无法读取附件本地路径");
  }

  try {
    const resolved = await resolveItemKey(entry);
    if (!resolved) {
      return previewFail(`「${citeKey}」无法定位到 Zotero 题录（无映射且反查失败）`);
    }
    const port = normalizePort(currentSettings().port);
    const raw = await zoteroApi.fetchChildren(port, resolved.itemKey, 50);
    const att = pickPdfAttachment(raw, plainBibValue(entry.fields?.url ?? ""));
    if (!att) return previewFail("该条目没有可预览的 PDF 附件（链接式 / 回收站附件已排除）");
    const path = await zoteroApi.fetchAttachmentPath(port, att.itemKey);
    return {
      ok: true,
      message: `已读取 PDF 附件「${att.filename || citeKey}」`,
      path,
      filename: att.filename || `${citeKey}.pdf`,
    };
  } catch (e) {
    return previewFail(`读取 Zotero PDF 附件失败：${String(e)}`);
  }
}

// ── P3-3 · CSL 格式化引文（只读 include=bib,citation） ─────────────────────

export interface ZoteroCitationResult {
  ok: boolean;
  message: string;
  itemKey: string | null;
  /** 本次实际请求的样式 id（已归一） */
  style: string;
  /** 参考文献条目（纯文本） */
  bib: string;
  /** 文内引文（纯文本） */
  citation: string;
}

/** 引文缓存：key = itemKey + style；只放内存，不回写 map.json、不落盘 */
const citationCache = new Map<string, { bib: string; citation: string }>();
const CITATION_CACHE_MAX = 40;

/** 换项目 / HMR / 测试时清空引文缓存 */
export function clearCitationCache(): void {
  citationCache.clear();
}

if (import.meta.hot) {
  import.meta.hot.dispose(clearCitationCache);
}

/**
 * P3-3：citekey → itemKey → CSL 引文 + 参考文献。
 * 只读、永不抛异常；失败给结构化 message，由 UI 提示（不阻断编辑/编译）。
 * 风格：样式切换会走缓存，避免反复点下拉时重复打本地 API。
 */
export async function resolveZoteroCitation(
  entry: ReverseEntry,
  style: unknown,
): Promise<ZoteroCitationResult> {
  const s = normalizeCslStyle(style);
  const citeKey = String(entry.key ?? "").trim();
  const fail = (message: string): ZoteroCitationResult => ({
    ok: false,
    message,
    itemKey: null,
    style: s,
    bib: "",
    citation: "",
  });

  if (!citeKey) return fail("该条目没有 citekey，无法定位 Zotero 题录");
  if (apiBlocked()) {
    return fail("Zotero 联动未启用或本地 API 不可用，无法格式化引文");
  }

  try {
    const resolved = await resolveItemKey(entry);
    if (!resolved) {
      return fail(`「${citeKey}」无法定位到 Zotero 题录（无映射且反查失败）`);
    }
    const hitKey = `${resolved.itemKey}\u0000${s}`;
    const cached = citationCache.get(hitKey);
    if (cached) {
      return {
        ok: true,
        message: `引文已就绪（${cslStyleLabel(s)}）`,
        itemKey: resolved.itemKey,
        style: s,
        ...cached,
      };
    }
    const port = normalizePort(currentSettings().port);
    const raw = await zoteroApi.citation(port, resolved.itemKey, s);
    const parsed = parseCitationResponse(raw);
    if (!parsed) {
      return fail("Zotero 未返回可用引文（样式 id 可能不被识别）");
    }
    const payload = { bib: parsed.bib, citation: parsed.citation };
    citationCache.set(hitKey, payload);
    if (citationCache.size > CITATION_CACHE_MAX) {
      const oldest = citationCache.keys().next().value;
      if (oldest) citationCache.delete(oldest);
    }
    return {
      ok: true,
      message: `引文已就绪（${cslStyleLabel(s)}）`,
      itemKey: resolved.itemKey,
      style: s,
      ...payload,
    };
  } catch (e) {
    return fail(`读取格式化引文失败：${String(e)}`);
  }
}
