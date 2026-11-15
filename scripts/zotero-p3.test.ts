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
import { parseZoteroItems } from "../src/modules/zotero/zoteroSync.ts";

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

console.log(`\n${total - failures}/${total} 通过`);
if (failures > 0) process.exitCode = 1;
