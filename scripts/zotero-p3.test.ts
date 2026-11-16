// Zotero 联动 · P3-1 反向跳转纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p3.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 一律带 .ts 后缀）
import type { ZoteroItem, ZoteroKeyMap } from "../src/types/zotero.ts";
import {
  REVERSE_MAX_QUERIES,
  ZOTERO_SELECT_BASE,
  buildReverseQueries,
  isItemKey,
  mappedItemKey,
  normalizeDoi,
  normalizeTitle,
  pickReverseMatch,
  zoteroSelectUrl,
  type ReverseEntry,
} from "../src/modules/zotero/zoteroReverse.ts";
import { itemsToBibtex, parseZoteroItems } from "../src/modules/zotero/zoteroSync.ts";
import {
  DEFAULT_ZOTERO_OPEN_TARGET,
  ZOTERO_PDF_BASE,
  bibFieldUrl,
  paperUrlFromFields,
  pickPdfAttachment,
  plainBibValue,
  safeHttpUrl,
  targetDisabled,
  targetHint,
  zoteroPdfUrl,
} from "../src/modules/zotero/zoteroOpenTargets.ts";
import {
  CSL_STYLES,
  DEFAULT_CSL_STYLE_ID,
  citationCopyMessage,
  citationCopyText,
  citationErrorMessage,
  cslStyleLabel,
  decodeCslEntities,
  normalizeCslStyle,
  parseCitationResponse,
  stripCslHtml,
} from "../src/modules/zotero/zoteroCitation.ts";

let failures = 0;
let total = 0;
function check(cond: boolean, msg: string) {
  total++;
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}
function eq<T>(got: T, want: T, msg: string) {
  check(Object.is(got, want), `${msg}（得到 ${String(got)}，期望 ${String(want)}）`);
}
function eqJson(got: unknown, want: unknown, msg: string) {
  eq(JSON.stringify(got), JSON.stringify(want), msg);
}

function zitem(over: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    itemKey: "AB12CD34",
    itemType: "journalArticle",
    title: "Deep Learning",
    authors: ["A. Doe", "B. Roe"],
    year: "2020",
    publicationTitle: "Nature",
    doi: "10.1000/xyz",
    url: "",
    extra: "",
    citationKey: "",
    ...over,
  };
}
function keymap(over: Partial<ZoteroKeyMap> = {}): ZoteroKeyMap {
  return {
    serverId: "srv",
    updatedAt: "2026-11-15T00:00:00Z",
    byCiteKey: {},
    byItemKey: {},
    unmapped: [],
    ...over,
  };
}
function entry(over: Partial<ReverseEntry> = {}): ReverseEntry {
  return {
    key: "doe2020deep",
    title: "Deep Learning",
    doi: "10.1000/xyz",
    author: "A. Doe and B. Roe",
    year: "2020",
    ...over,
  };
}

console.log("P3-1 · isItemKey：只认 Zotero 8 位 itemKey");
check(isItemKey("AB12CD34"), "8 位大写字母数字通过");
check(isItemKey("abcdefgh"), "8 位小写也通过（Zotero key 可含小写）");
check(isItemKey(" ABC12345 "), "前后空白 trim 后通过");
check(!isItemKey("AB12CD3"), "7 位拒绝");
check(!isItemKey("AB12CD345"), "9 位拒绝");
check(!isItemKey("AB12-D34"), "含连字符拒绝");
check(!isItemKey("doe2020deep"), "典型 citekey 拒绝");
check(!isItemKey(""), "空串拒绝");
check(!isItemKey(null), "null 拒绝");
check(!isItemKey(12345678), "非字符串拒绝");

console.log("P3-1 · zoteroSelectUrl：个人库 / 群组库 / 非法输入");
eq(zoteroSelectUrl("AB12CD34"), `${ZOTERO_SELECT_BASE}/library/items/AB12CD34`, "个人库 URL");
eq(zoteroSelectUrl("abcdefgh"), `${ZOTERO_SELECT_BASE}/library/items/abcdefgh`, "小写 key 原样保留");
eq(zoteroSelectUrl("AB12CD34", { type: "group", id: 123 }), `${ZOTERO_SELECT_BASE}/groups/123/items/AB12CD34`, "群组库 URL");
eq(zoteroSelectUrl("AB12CD34", { type: "group", id: "456" }), `${ZOTERO_SELECT_BASE}/groups/456/items/AB12CD34`, "群组库字符串 id");
eq(zoteroSelectUrl("AB12CD34", { type: "group", id: "abc" }), null, "群组库非数字 id 拒绝");
eq(zoteroSelectUrl("doe2020deep"), null, "citekey 绝不拼进 URL");
eq(zoteroSelectUrl(""), null, "空 key 拒绝");
eq(zoteroSelectUrl(null as unknown as string), null, "null key 拒绝");
eq(String(zoteroSelectUrl("AB12CD34") ?? "").includes("doe2020deep"), false, "URL 不含 citekey 子串");

console.log("P3-1 · mappedItemKey：map.json 精确 + 大小写兜底");
eq(mappedItemKey("doe2020deep", keymap({ byCiteKey: { doe2020deep: "AB12CD34" } })), "AB12CD34", "精确命中");
eq(mappedItemKey("Doe2020Deep", keymap({ byCiteKey: { doe2020deep: "AB12CD34" } })), "AB12CD34", "大小写不敏感兜底");
eq(mappedItemKey("doe2020deep", keymap({ byCiteKey: { doe2020deep: "not-an-item-key" } })), null, "非法 itemKey 视为未映射");
eq(mappedItemKey("doe2020deep", keymap()), null, "空映射返回 null");
eq(mappedItemKey("doe2020deep", null), null, "map 为 null 返回 null");
eq(mappedItemKey("", keymap({ byCiteKey: { doe2020deep: "AB12CD34" } })), null, "空 citeKey 返回 null");
eq(
  mappedItemKey("Doe2020Deep", keymap({ byCiteKey: { Doe2020Deep: "ZZ99ZZ99", doe2020deep: "AB12CD34" } })),
  "ZZ99ZZ99",
  "精确命中优先于大小写兜底",
);

console.log("P3-1 · normalizeDoi / normalizeTitle");
eq(normalizeDoi("10.1000/XYZ"), "10.1000/xyz", "统一小写");
eq(normalizeDoi("https://doi.org/10.1000/xyz"), "10.1000/xyz", "去 https://doi.org 前缀");
eq(normalizeDoi("http://dx.doi.org/10.1000/xyz"), "10.1000/xyz", "去 dx.doi.org 前缀");
eq(normalizeDoi("DOI: 10.1000/xyz"), "10.1000/xyz", "去 doi: 前缀");
eq(normalizeDoi("{10.1000/ xyz}"), "10.1000/xyz", "去花括号与空白");
eq(normalizeDoi(""), "", "空 DOI");
eq(normalizeTitle("{Deep} Learning"), "deeplearning", "去花括号与空白");
eq(normalizeTitle("Deep \\emph{Learning}!"), "deeplearning", "去 LaTeX 命令与标点");
eq(normalizeTitle("深度学习：A Survey"), "深度学习asurvey", "保留中文与字母数字");
eq(normalizeTitle(""), "", "空标题");

console.log("P3-1 · buildReverseQueries：citekey → DOI → 标题");
eqJson(
  buildReverseQueries(entry()),
  ["doe2020deep", "10.1000/xyz", "Deep Learning"],
  "三个查询词按优先级排序",
);
eqJson(buildReverseQueries(entry({ doi: "", title: "" })), ["doe2020deep"], "只有 citekey");
eqJson(buildReverseQueries(entry({ key: "x", doi: "x", title: "" })), [], "短词（<2）被过滤");
eqJson(buildReverseQueries(entry({ doi: "doe2020deep", title: "doe2020deep" })), ["doe2020deep"], "重复查询词去重");
eqJson(buildReverseQueries(entry({ title: "" })), ["doe2020deep", "10.1000/xyz"], "缺标题时仍可反查 DOI");
eq(buildReverseQueries(entry()).length <= REVERSE_MAX_QUERIES, true, "不超过最大查询数");
eqJson(
  buildReverseQueries(entry({ title: "{Deep} \\emph{Learning}" })),
  ["doe2020deep", "10.1000/xyz", "Deep Learning"],
  "标题去花括号 / LaTeX 命令后作为查询词",
);
eq(buildReverseQueries(entry({ title: "T".repeat(120) }))[2]?.length, 80, "查询词截断到 80 字");

console.log("P3-1 · pickReverseMatch：证据分级与误跳防护");
eq(pickReverseMatch(entry(), [], keymap()), null, "空结果不跳");
eqJson(
  pickReverseMatch(entry(), [zitem()], keymap({ byItemKey: { AB12CD34: "doe2020deep" } })),
  { itemKey: "AB12CD34", score: 120, reason: "citekey" },
  "byItemKey 反查 citekey 精确命中",
);
eqJson(
  pickReverseMatch(entry(), [zitem({ extra: "Citation Key: doe2020deep" })], keymap()),
  { itemKey: "AB12CD34", score: 120, reason: "citekey" },
  "BBT Extra 的 Citation Key 命中",
);
eqJson(
  pickReverseMatch(entry(), [zitem({ citationKey: "doe2020deep" })], keymap()),
  { itemKey: "AB12CD34", score: 120, reason: "citekey" },
  "归一化字段 citationKey 命中",
);
eqJson(
  pickReverseMatch(entry({ key: "unknownKey" }), [zitem()], keymap()),
  { itemKey: "AB12CD34", score: 100, reason: "doi" },
  "citekey 不命中时按 DOI 命中",
);
eqJson(
  pickReverseMatch(entry({ key: "unknownKey", doi: "" }), [zitem()], keymap()),
  { itemKey: "AB12CD34", score: 90, reason: "title" },
  "仅标题完全相等时命中",
);
eq(
  pickReverseMatch(entry({ key: "unknownKey", doi: "", year: "1999" }), [zitem()], keymap()),
  null,
  "标题相同但年份不符 → 拒绝（防误跳）",
);
eqJson(
  pickReverseMatch(entry({ key: "unknownKey", doi: "", year: undefined }), [zitem()], keymap()),
  { itemKey: "AB12CD34", score: 90, reason: "title" },
  "entry 无年份时标题路径仍可命中",
);
eq(
  pickReverseMatch(entry({ key: "unknownKey", doi: "" }), [zitem({ title: "Shallow Learning" })], keymap()),
  null,
  "仅模糊相似不跳",
);
eq(pickReverseMatch(entry(), [zitem({ itemKey: "bad-key" })], keymap({ byItemKey: { "bad-key": "doe2020deep" } })), null, "非法 itemKey 的候选项被跳过");
eqJson(
  pickReverseMatch(
    entry(),
    [zitem({ itemKey: "ZZ99ZZ99", doi: "10.1000/xyz" }), zitem({ itemKey: "AA00AA00", extra: "Citation Key: doe2020deep" })],
    keymap(),
  ),
  { itemKey: "AA00AA00", score: 120, reason: "citekey" },
  "多候选取最高分（citekey > DOI）",
);
eqJson(
  pickReverseMatch(
    entry({ key: "unknownKey" }),
    [zitem({ itemKey: "ZZ99ZZ99" }), zitem({ itemKey: "AA00AA00" })],
    keymap(),
  ),
  { itemKey: "AA00AA00", score: 100, reason: "doi" },
  "同分时按 itemKey 字典序稳定取值",
);
const fromJson = parseZoteroItems(
  JSON.stringify([
    {
      key: "CD34EF56",
      data: {
        itemType: "journalArticle",
        title: "Deep Learning",
        date: "2020",
        DOI: "10.1000/xyz",
        extra: "Citation Key: doe2020deep",
        creators: [{ firstName: "A.", lastName: "Doe" }],
      },
    },
  ]),
);
eqJson(
  pickReverseMatch(entry(), fromJson, keymap()),
  { itemKey: "CD34EF56", score: 120, reason: "citekey" },
  "真实本地 API JSON 经 parseZoteroItems 归一化后可命中",
);

console.log("P3-1 · 铁律回归：不把 itemKey 当 citekey 用");
eq(isItemKey("CD34EF56"), true, "搜索结果里的 8 位 key 是合法 itemKey");
eq(zoteroSelectUrl("doe2020deep"), null, "citekey 无法生成 select URL");
eq(
  `${ZOTERO_SELECT_BASE}/library/items/`.startsWith("zotero://select/library/items/"),
  true,
  "URL 采用官方 zotero://select 格式",
);

// ── P3-1b · 打开目标下拉（纯逻辑） ────────────────────────────────────────
console.log("P3-1b · 默认动作与 open-pdf URL");
eq(DEFAULT_ZOTERO_OPEN_TARGET, "pdf", "主按钮默认目标是打开全文");
eq(
  zoteroPdfUrl("AB12CD34"),
  `${ZOTERO_PDF_BASE}/library/items/AB12CD34`,
  "个人库 open-pdf URL 用附件 itemKey",
);
eq(
  zoteroPdfUrl("AB12CD34", { type: "group", id: 123 }),
  `${ZOTERO_PDF_BASE}/groups/123/items/AB12CD34`,
  "群组库 open-pdf URL",
);
eq(zoteroPdfUrl("doe2020deep"), null, "citekey 绝不拼进 open-pdf URL");
eq(zoteroPdfUrl("AB12CD3"), null, "7 位 key 拒绝");
eq(zoteroPdfUrl(null as unknown as string), null, "null key 拒绝");
eq(
  String(zoteroPdfUrl("AB12CD34") ?? "").startsWith("zotero://open-pdf/"),
  true,
  "协议是 Zotero 原生 open-pdf",
);

console.log("P3-1b · plainBibValue：LaTeX 值清洗");
eq(plainBibValue("{Deep Learning}"), "Deep Learning", "剥花括号");
eq(
  plainBibValue("\\url{https://example.org/paper}"),
  "https://example.org/paper",
  "\\url{} 取内容",
);
eq(plainBibValue("\\doi{10.1000/xyz}"), "10.1000/xyz", "\\doi{} 取内容");
eq(
  plainBibValue("https://x.org/?a=1\\&b=2"),
  "https://x.org/?a=1&b=2",
  "\\& 还原成查询串分隔符",
);
eq(plainBibValue("\\emph{Deep}  Learning"), "Deep Learning", "剥 emph 命令并压平空白");
eq(plainBibValue(null), "", "null 返回空串");

console.log("P3-1b · paperUrlFromFields：只放行 http(s)，DOI 兜底");
eq(
  paperUrlFromFields({ url: "https://example.org/paper" }),
  "https://example.org/paper",
  "https url 原样可用",
);
eq(
  paperUrlFromFields({ url: "\\url{http://example.org/p}" }),
  "http://example.org/p",
  "http + \\url{} 可用",
);
eq(
  paperUrlFromFields({ url: "https://x.org/?a=1\\&b=2" }),
  "https://x.org/?a=1&b=2",
  "LaTeX 转义的查询串可用",
);
eq(
  paperUrlFromFields({ url: "https://example.org/p", doi: "10.1000/xyz" }),
  "https://example.org/p",
  "url 优先于 doi",
);
eq(
  paperUrlFromFields({ doi: "10.1000/xyz" }),
  "https://doi.org/10.1000/xyz",
  "无 url 时由 DOI 生成 doi.org 链接",
);
eq(
  paperUrlFromFields({ doi: "https://doi.org/10.1000/xyz" }),
  "https://doi.org/10.1000/xyz",
  "DOI 带 doi.org 前缀不重复拼接",
);
eq(
  paperUrlFromFields({ doi: "\\doi{10.1000/{xyz}}" }),
  "https://doi.org/10.1000/xyz",
  "DOI 里的 LaTeX 命令与花括号先被剥掉",
);
eq(paperUrlFromFields({}), null, "无字段返回 null");
eq(paperUrlFromFields(null), null, "null 字段表返回 null");
eq(paperUrlFromFields({ doi: "" }), null, "空 DOI 返回 null");
eq(paperUrlFromFields({ doi: "not-a-doi" }), null, "非法 DOI 返回 null");
eq(paperUrlFromFields({ url: "javascript:alert(1)" }), null, "javascript: 协议拒绝");
eq(paperUrlFromFields({ url: "file:///C:/secret.pdf" }), null, "file: 协议拒绝");
eq(paperUrlFromFields({ url: "zotero://select/library/items/AB12CD34" }), null, "zotero: 协议拒绝");
eq(paperUrlFromFields({ url: "ftp://example.org/p" }), null, "ftp: 协议拒绝");
eq(paperUrlFromFields({ url: "https://" }), null, "缺 host 的 URL 拒绝");

console.log("P3-1b · pickPdfAttachment：附件筛选与 best 排序");
function child(over: Record<string, unknown> = {}) {
  // key 属于 Zotero JSON 的外层；其余覆盖项落在 data 里
  const { key, ...dataOver } = over;
  return {
    key: key ?? "AT12CD34",
    data: {
      itemType: "attachment",
      contentType: "application/pdf",
      filename: "paper.pdf",
      dateAdded: "2026-01-01T00:00:00Z",
      linkMode: "imported_file",
      url: "",
      ...dataOver,
    },
  };
}
eq(
  pickPdfAttachment(JSON.stringify([child()]))?.itemKey,
  "AT12CD34",
  "单个 PDF 附件命中",
);
eq(
  pickPdfAttachment(JSON.stringify([child({ filename: "a.pdf" })]))?.filename,
  "a.pdf",
  "返回附件文件名用于 toast",
);
eq(pickPdfAttachment("[]"), null, "空子项返回 null");
eq(pickPdfAttachment("not json"), null, "垃圾 JSON 返回 null");
eq(pickPdfAttachment("{}"), null, "非数组返回 null");
eq(
  pickPdfAttachment(JSON.stringify([{ key: "NOTE1234", data: { itemType: "note" } }])),
  null,
  "笔记不是附件，排除",
);
eq(
  pickPdfAttachment(JSON.stringify([child({ contentType: "text/html" })])),
  null,
  "非 PDF 附件排除",
);
eq(
  pickPdfAttachment(JSON.stringify([child({ linkMode: "linked_url" })])),
  null,
  "纯网页链接附件排除",
);
eq(
  pickPdfAttachment(JSON.stringify([child({ deleted: true })])),
  null,
  "回收站条目排除",
);
eq(
  pickPdfAttachment(JSON.stringify([child({ trashed: true })])),
  null,
  "trashed 标记排除",
);
eq(
  pickPdfAttachment(JSON.stringify([{ ...child(), key: "citekey" }])),
  null,
  "非法附件 key 排除",
);
eq(
  pickPdfAttachment(JSON.stringify([{ key: "AT12CD34", itemType: "attachment", contentType: "application/pdf" }]))?.itemKey,
  "AT12CD34",
  "兼容字段在顶层的扁平 JSON",
);
eq(
  pickPdfAttachment(
    JSON.stringify([
      child({ key: "ZZ99ZZ99", dateAdded: "2026-03-01T00:00:00Z" }),
      child({ key: "AA11AA11", dateAdded: "2026-01-01T00:00:00Z" }),
    ]),
  )?.itemKey,
  "AA11AA11",
  "多 PDF 时取 dateAdded 最早的（贴近 Zotero best attachment）",
);
eq(
  pickPdfAttachment(
    JSON.stringify([
      child({ key: "AA11AA11", dateAdded: "2026-01-01T00:00:00Z" }),
      child({ key: "ZZ99ZZ99", dateAdded: "2026-02-01T00:00:00Z", url: "https://x.org/p" }),
    ]),
    "https://x.org/p",
  )?.itemKey,
  "ZZ99ZZ99",
  "url 与父条目一致优先于更早的 dateAdded",
);
eq(
  pickPdfAttachment(
    JSON.stringify([
      child({ key: "ZZ99ZZ99", dateAdded: "" }),
      child({ key: "AA11AA11", dateAdded: "2026-01-01T00:00:00Z" }),
    ]),
  )?.itemKey,
  "AA11AA11",
  "空 dateAdded 排最后",
);
eq(
  pickPdfAttachment(
    JSON.stringify([
      child({ key: "ZZ99ZZ99", dateAdded: "2026-01-01T00:00:00Z" }),
      child({ key: "AA11AA11", dateAdded: "2026-01-01T00:00:00Z" }),
    ]),
  )?.itemKey,
  "AA11AA11",
  "同日期用 key 字典序稳定兜底",
);

console.log("P3-1b · 下拉项可用性");
eq(targetDisabled("web", { doi: "10.1000/xyz" }), false, "有 DOI 时论文网页可用");
eq(targetDisabled("web", {}), true, "无 URL/DOI 时论文网页置灰");
eq(targetDisabled("pdf", {}), false, "打开全文不因字段缺失置灰（失败走回退）");
eq(targetDisabled("item", {}), false, "打开条目不因字段缺失置灰");
eq(String(targetHint("web", { doi: "10.1000/xyz" })).includes("doi.org"), true, "网页项 hint 含目标 URL");
eq(String(targetHint("web", {})).includes("没有"), true, "网页项不可用时 hint 说明原因");
eq(String(targetHint("pdf", {})).includes("回退"), true, "全文项 hint 说明失败自动回退");

console.log("P3-2 · 摘要字段与可点链接");
eq(
  parseZoteroItems(
    JSON.stringify([
      {
        key: "AB12CD34",
        data: { itemType: "journalArticle", title: "T", abstractNote: "A \\emph{deep} study" },
      },
    ]),
  )[0]?.abstract,
  "A \\emph{deep} study",
  "parseZoteroItems 读取 abstractNote",
);
const absBib = itemsToBibtex([zitem({ abstract: "Line one\nLine   two" })]);
check(absBib.includes("abstract = {Line one Line two}"), "无 BBT 降级把摘要压成单行写入 .bib");
check(!absBib.includes("Line one\nLine"), "摘要中的换行不会破坏 BibTeX 字段结构");
eq(bibFieldUrl("doi", "\\doi{10.1000/xyz}"), "https://doi.org/10.1000/xyz", "DOI 字段可转安全链接");
eq(bibFieldUrl("url", "\\url{https://example.org/a}"), "https://example.org/a", "URL 字段剥 \\url{} 后可点");
eq(bibFieldUrl("url", "javascript:alert(1)"), null, "javascript: 伪协议被拒绝");
eq(bibFieldUrl("doi", "not-a-doi"), null, "非法 DOI 不生成链接");
eq(safeHttpUrl("file:///C:/x.pdf"), null, "file: 本地路径不作为网页打开");
eq(safeHttpUrl("{https://example.org/path}"), "https://example.org/path", "花括号包裹的 URL 可点");

console.log("P3-3 · CSL 样式白名单");
eq(normalizeCslStyle("apa"), "apa", "内置样式保留原值");
eq(normalizeCslStyle(" IEEE "), DEFAULT_CSL_STYLE_ID, "大小写/空白不匹配白名单时回落默认");
eq(normalizeCslStyle("https://example.org/apa.csl"), DEFAULT_CSL_STYLE_ID, "URL 不作为样式 id");
eq(normalizeCslStyle("apa&linkwrap=1"), DEFAULT_CSL_STYLE_ID, "查询串注入被拒");
eq(normalizeCslStyle(undefined), DEFAULT_CSL_STYLE_ID, "空值回落默认样式");
eq(normalizeCslStyle("nature"), "nature", "nature 在白名单内");
check(CSL_STYLES.length >= 5, `内置样式至少 5 种（当前 ${CSL_STYLES.length}）`);
eq(CSL_STYLES[0].id, DEFAULT_CSL_STYLE_ID, "首项与默认样式一致");
eq(cslStyleLabel("apa"), "APA 7th（作者-年）", "样式显示名可查");
eq(cslStyleLabel("unknown-style"), "unknown-style", "未知 id 原样显示便于排障");
eq(
  CSL_STYLES.every((s) => /^[a-z0-9][a-z0-9-]{0,63}$/i.test(s.id)),
  true,
  "所有内置 id 通过 Rust 同口径闸门",
);

console.log("P3-3 · XHTML 剥除与实体解码");
eq(stripCslHtml("<i>Nature</i> 2020"), "Nature 2020", "标签剥除保留文本");
eq(
  stripCslHtml('<span class="csl-left-margin">1. </span><span>Doe A.</span>'),
  "1. Doe A.",
  "CSL span 结构被剥成纯文本",
);
eq(stripCslHtml("A<br/>B"), "A B", "br 转为空格");
eq(stripCslHtml("<p>One</p><p>Two</p>"), "One Two", "块级标签之间保留分隔");
eq(stripCslHtml("Smith &amp; Jones"), "Smith & Jones", "命名实体解码");
eq(stripCslHtml("pp. 1&#8211;10"), "pp. 1\u201310", "十进制实体解码为短横");
eq(stripCslHtml("A&#x2013;B"), "A\u2013B", "十六进制实体解码");
eq(stripCslHtml("  a\n\n  b  "), "a b", "空白压平");
eq(stripCslHtml(""), "", "空串返回空串");
eq(decodeCslEntities("&unknown;"), "&unknown;", "未知实体原样保留");
eq(stripCslHtml("<script>alert(1)</script>x"), "alert(1)x", "无标签执行：脚本只当文本（不渲染 HTML）");

console.log("P3-3 · 响应解析");
const singleItem = JSON.stringify({
  key: "AB12CD34",
  version: 120,
  data: { key: "AB12CD34", itemType: "journalArticle", title: "Deep Learning" },
  bib: "Doe, A. <i>Deep Learning</i>. Nature, 2020.",
  citation: "(Doe, 2020)",
});
const parsedOk = parseCitationResponse(singleItem);
eq(parsedOk?.itemKey, "AB12CD34", "解析出 8 位 itemKey");
eq(parsedOk?.citation, "(Doe, 2020)", "文内引文取 citation 字段");
eq(
  parsedOk?.bib,
  "Doe, A. Deep Learning. Nature, 2020.",
  "参考文献去掉斜体标签但保留文字",
);
eq(parseCitationResponse("not json"), null, "非 JSON 返回 null");
eq(parseCitationResponse("[]"), null, "数组响应返回 null");
eq(parseCitationResponse("{}"), null, "两段都为空返回 null");
eq(
  parseCitationResponse(JSON.stringify({ key: "AB12CD34", bib: "", citation: "" })),
  null,
  "空 bib/citation 视为无可用引文",
);
eq(
  parseCitationResponse(JSON.stringify({ key: "doe2020", citation: "(Doe, 2020)" }))?.itemKey,
  "",
  "非 8 位 key 不写入 itemKey（只用于展示，不拼 URL）",
);
eq(
  parseCitationResponse(JSON.stringify({ data: { key: "EF56GH78" }, bib: "B." }))?.itemKey,
  "EF56GH78",
  "顶层无 key 时回落 data.key",
);
eq(citationCopyText("  (Doe,\n 2020) "), "(Doe, 2020)", "复制文本压平空白");
eq(citationCopyMessage("citation", "apa").includes("APA"), true, "复制提示带样式名");
eq(citationCopyMessage("bib", "apa").includes("参考文献"), true, "复制提示区分参考文献");

// ── P3-3 修复：400 响应体保留 + CSL 加载失败的可操作提示 ──
{
  const gb = "china-national-standard-gb-t-7714-2015-numeric";
  const styleFail = `读取 Zotero 格式化引文：请求被 Zotero 拒绝（400）：Invalid style: ${gb} (HTTP GET https://www.zotero.org/styles/${gb} failed with status code 404:Style not found)`;
  const hint = citationErrorMessage(styleFail, gb);
  check(hint.includes("未能加载 CSL 样式"), "Invalid style 被识别为样式加载失败");
  check(hint.includes("检查网络"), "给出检查网络的明确指引");
  check(hint.includes("GB/T"), "提示里带当前样式展示名");
  check(hint.includes("APA"), "引导切换到已缓存样式");
  check(!hint.includes("Style not found"), "对用户隐藏冗长的原始响应体");
  const offline = "读取 Zotero 格式化引文请求失败：error sending request";
  eq(citationErrorMessage(offline), `读取格式化引文失败：${offline}`, "非样式错误原样透传");
  const noStyle = citationErrorMessage(styleFail);
  check(!noStyle.includes("样式「」"), "未传样式名时提示不出现空样式名");
}

console.log(`\n${total - failures}/${total} 通过`);
if (failures > 0) process.exitCode = 1;
