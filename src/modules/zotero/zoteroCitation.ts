// Zotero 联动 · P3-3 CSL 引文预览纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 只做「预览 / 复制」：Zotero 的本地 API 按 CSL 样式返回两段 XHTML
//   bib      → 参考文献条目（GB/T 7714 等）
//   citation → 文内引文（(张三, 2020) / [1] 等）
// **绝不**当作 LaTeX 样式引擎：最终正文输出仍由 .bst / biblatex 样式决定。
//
// 样式 id 只认 Zotero Style Repository 的文件名（不含 .csl），不接受 URL；
// XHTML 一律剥成纯文本（项目禁用 innerHTML），再统一压平空白。

export interface CslStyleOption {
  /** Style Repository 文件名（不含 .csl），与 Rust `is_csl_style` 闸门同一字符集 */
  id: string;
  label: string;
  /** 一句话说明，用作下拉项的 title */
  note: string;
}

/** 内置常用样式；第一项与 AppSettings.zotero.cslStyle 默认值一致 */
export const CSL_STYLES: CslStyleOption[] = [
  {
    id: "china-national-standard-gb-t-7714-2015-numeric",
    label: "GB/T 7714—2015（顺序编码）",
    note: "中文期刊/学位论文常用",
  },
  { id: "apa", label: "APA 7th（作者-年）", note: "社科、教育、心理学常用" },
  { id: "chicago-author-date", label: "Chicago（作者-年）", note: "人文社科常用" },
  { id: "ieee", label: "IEEE（数字）", note: "工程与计算机常用" },
  { id: "modern-language-association", label: "MLA 9th", note: "语言文学常用" },
  { id: "vancouver", label: "Vancouver（数字）", note: "生物医学常用" },
  { id: "nature", label: "Nature（上标数字）", note: "自然科学期刊常用" },
];

export const DEFAULT_CSL_STYLE_ID = CSL_STYLES[0].id;

/** 与 Rust 同口径：字母数字与连字符，1..=64 位，不以连字符开头 */
const CSL_STYLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/** 任意来源的样式 id 归一：命中内置白名单才采用，否则回落默认样式 */
export function normalizeCslStyle(id: unknown): string {
  const s = String(id ?? "").trim();
  if (!CSL_STYLE_RE.test(s)) return DEFAULT_CSL_STYLE_ID;
  return CSL_STYLES.some((x) => x.id === s) ? s : DEFAULT_CSL_STYLE_ID;
}

/** 下拉展示名；未知 id 原样返回（便于排障时看到真实值） */
export function cslStyleLabel(id: unknown): string {
  const s = String(id ?? "").trim();
  const hit = CSL_STYLES.find((x) => x.id === s);
  return hit ? hit.label : s || DEFAULT_CSL_STYLE_ID;
}

/** 单个码点的安全还原（跳过 0 / 越界 / 代理区，避免 fromCodePoint 抛错） */
function codePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
  if (n >= 0xd800 && n <= 0xdfff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** 实体解码：先数字（&#8211; / &#x2013;），再常见命名实体 */
export function decodeCslEntities(s: unknown): string {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&([a-z]+|#39);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Zotero 返回的 bib / citation 是 XHTML（`<i>`、`<span class="csl-...">`、`&amp;` 等）。
 * 这里剥成纯文本：块级标签换空格、其余标签直接去掉，再解实体、压平空白。
 */
export function stripCslHtml(html: unknown): string {
  const raw = String(html ?? "");
  if (!raw) return "";
  return decodeCslEntities(
    raw
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote)>/gi, " ")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export interface CitationPayload {
  /** 8 位 itemKey（响应里没有或不合法时为空串） */
  itemKey: string;
  /** 参考文献条目（纯文本） */
  bib: string;
  /** 文内引文（纯文本） */
  citation: string;
}

/**
 * 解析单条题录的 CSL 响应（`format=json&include=bib,citation`）。
 * 任何异常、非对象、两段都为空都返回 null —— 调用方据此提示，不抛异常。
 */
export function parseCitationResponse(raw: unknown): CitationPayload | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const data =
    obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : null;
  const key = String(obj.key ?? data?.key ?? "").trim();
  const bib = stripCslHtml(obj.bib);
  const citation = stripCslHtml(obj.citation);
  if (!bib && !citation) return null;
  return {
    itemKey: /^[a-z0-9]{8}$/i.test(key) ? key : "",
    bib,
    citation,
  };
}

/** 复制用文本：已是纯文本，这里只兜底压平与去首尾空白 */
export function citationCopyText(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/** 复制成功的提示文案（区分引文 / 参考文献，便于用户确认复制了什么） */
export function citationCopyMessage(kind: "citation" | "bib", style: unknown): string {
  return kind === "citation"
    ? `已复制引文（${cslStyleLabel(style)}）`
    : `已复制参考文献（${cslStyleLabel(style)}）`;
}

/**
 * 把底层错误转成用户可自助处理的提示。
 *
 * Zotero 首次使用某个 CSL 样式时若本地未缓存，会去 zotero.org 下载；
 * 此时网络不通会返回 400，响应体形如
 *   `Invalid style: ... (HTTP GET https://www.zotero.org/styles/... failed with status code 404:Style not found)`
 * 以前只剩「请求被拒绝（400）」，无法判断是网络还是样式 id 的问题。
 * 这里识别该特征并给出「检查网络 / 换已内置样式 / 稍后重试」的明确指引，
 * 其余错误原样透传（Rust 侧已保留响应体摘要）。
 */
export function citationErrorMessage(err: unknown, style?: unknown): string {
  const raw = String(err ?? "");
  const isStyleLoad =
    /Invalid style/i.test(raw) ||
    /Style not found/i.test(raw) ||
    /zotero\.org\/styles/i.test(raw);
  const label = style === undefined ? "" : cslStyleLabel(style);
  if (isStyleLoad) {
    return (
      `读取格式化引文失败：Zotero 未能加载 CSL 样式${label ? `「${label}」` : ""}。` +
      "首次使用需从 zotero.org 下载，请检查网络后重试，" +
      "或临时切换到「APA 7th」等已缓存样式。"
    );
  }
  return `读取格式化引文失败：${raw}`;
}
