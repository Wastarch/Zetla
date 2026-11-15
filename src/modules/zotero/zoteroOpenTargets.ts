// Zotero 联动 · P3-1b「打开目标」三选一纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 三个目标：
//   pdf  → zotero://open-pdf/<库>/items/<附件 itemKey>（Zotero 内置阅读器）
//   item → zotero://select/<库>/items/<父条目 itemKey>（P3-1 原行为）
//   web  → .bib 的 url / doi → https 网页（零 API、离线可用）
//
// 铁律：URL 里只能是 8 位 itemKey；论文网页只放行 http/https，绝不把 .bib
//       里的任意字符串直接交给 openUrl；打不开时宁可回退，不猜一个键。
import { isItemKey, normalizeDoi, type ZoteroLibraryRef } from "./zoteroReverse.ts";

export type ZoteroOpenTarget = "pdf" | "item" | "web";

/** 主按钮默认动作：打开全文（失败由运行时自动回退到 item） */
export const DEFAULT_ZOTERO_OPEN_TARGET: ZoteroOpenTarget = "pdf";
export const ZOTERO_PDF_BASE = "zotero://open-pdf";

/** .bib 条目字段的最小投影（不 import 编辑器 / BibEntry 类型） */
export type OpenEntryFields = Record<string, string> | null | undefined;

/** 剥 BibTeX 值：花括号、\url{}/\href{}/常用转义、压平空白 */
export function plainBibValue(v: unknown): string {
  return String(v ?? "")
    .replace(/\\url\s*\{([^}]*)\}/gi, "$1")
    .replace(/\\doi\s*\{([^}]*)\}/gi, "$1")
    .replace(/\\href\s*\{([^}]*)\}\{[^}]*\}/gi, "$1")
    .replace(/\\(?:textbf|textit|texttt|emph|mbox)\s*\{([^}]*)\}/gi, "$1")
    .replace(/\\([&%_#$~^{}])/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normUrl(v: string): string {
  return plainBibValue(v).replace(/\/+$/, "").toLowerCase();
}

/** 只放行 http(s) 且能解析出 host 的 URL */
function httpUrl(v: string): string | null {
  const s = plainBibValue(v);
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (!u.hostname || (u.protocol !== "http:" && u.protocol !== "https:")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** 供悬浮卡片单字段链接复用：输入任意 BibTeX 值，只返回安全的 http(s) URL */
export function safeHttpUrl(v: unknown): string | null {
  return httpUrl(String(v ?? ""));
}

/** 单个字段的可点链接：url 字段按原值，doi 字段拼 doi.org；其余返回 null */
export function bibFieldUrl(name: string, value: unknown): string | null {
  if (name === "url") return safeHttpUrl(value);
  if (name === "doi") {
    const doi = normalizeDoi(plainBibValue(value));
    return /^10\.\d{4,9}\/\S+$/i.test(doi) ? `https://doi.org/${doi}` : null;
  }
  return null;
}

/**
 * 论文网页：优先 .bib 的 url 字段，其次 doi → https://doi.org/<DOI>。
 * 拒绝 javascript: / file: / zotero: 等非 http(s) 协议，返回 null 表示该项不可用。
 */
export function paperUrlFromFields(fields: OpenEntryFields): string | null {
  const direct = bibFieldUrl("url", fields?.url);
  if (direct) return direct;
  return bibFieldUrl("doi", fields?.doi);
}

/** open-pdf URL：这里必须是「附件」itemKey，不是父条目 itemKey */
export function zoteroPdfUrl(
  attachmentKey: string,
  lib: ZoteroLibraryRef = { type: "user" },
): string | null {
  const key = String(attachmentKey ?? "").trim();
  if (!isItemKey(key)) return null;
  if (lib.type === "user") return `${ZOTERO_PDF_BASE}/library/items/${key}`;
  const gid = String(lib.id ?? "").trim();
  if (!/^\d+$/.test(gid)) return null;
  return `${ZOTERO_PDF_BASE}/groups/${gid}/items/${key}`;
}

export interface PdfAttachment {
  itemKey: string;
  filename: string;
  dateAdded: string;
  url: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

/**
 * 从 /children 原始 JSON 里挑「最可能就是正文」的 PDF 附件。
 * 排序口径贴近 Zotero getBestAttachments：url 与父条目相同优先 → dateAdded 最早 → key 稳定兜底。
 * linked_url（纯网页链接）、回收站条目、非法 key 一律排除；解析失败返回 null。
 */
export function pickPdfAttachment(raw: string, parentUrl = ""): PdfAttachment | null {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const parent = normUrl(parentUrl);
  const candidates: PdfAttachment[] = [];
  for (const v of arr) {
    const item = asRecord(v);
    if (!item) continue;
    const data = asRecord(item.data) ?? item;
    const key = str(item.key) || str(data.key);
    if (!isItemKey(key)) continue;
    if (str(data.itemType).toLowerCase() !== "attachment") continue;
    if (!str(data.contentType).toLowerCase().startsWith("application/pdf")) continue;
    if (data.deleted === true || data.trashed === true) continue;
    if (str(data.linkMode).toLowerCase() === "linked_url") continue;
    candidates.push({
      itemKey: key.trim(),
      filename: str(data.filename),
      dateAdded: str(data.dateAdded),
      url: str(data.url),
    });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const au = parent !== "" && normUrl(a.url) === parent ? 0 : 1;
    const bu = parent !== "" && normUrl(b.url) === parent ? 0 : 1;
    if (au !== bu) return au - bu;
    if (a.dateAdded !== b.dateAdded) {
      // 空日期排最后；ISO 字符串字典序即时间序
      if (!a.dateAdded) return 1;
      if (!b.dateAdded) return -1;
      return a.dateAdded < b.dateAdded ? -1 : 1;
    }
    return a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0;
  });
  return candidates[0];
}

/** 下拉项的说明文案（也用于 title，避免菜单里塞长 URL） */
export function targetHint(target: ZoteroOpenTarget, fields: OpenEntryFields): string {
  if (target === "pdf") return "默认动作 · Zotero 阅读器打开 PDF 全文；无附件时自动回退到条目";
  if (target === "item") return "在 Zotero 中定位并高亮题录；有映射时离线也可用";
  const url = paperUrlFromFields(fields);
  return url ? `打开 ${url}` : "该条目没有可用的 http(s) URL 或 DOI";
}

/** 下拉项是否置灰：目前只有「论文网页」会因缺字段不可用 */
export function targetDisabled(target: ZoteroOpenTarget, fields: OpenEntryFields): boolean {
  return target === "web" && paperUrlFromFields(fields) === null;
}
