// Zotero 联动 · P1 纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p1.test.ts
// 只 import 无 @/ 别名的 zoteroSync.ts（相对 import 必须带 .ts 后缀）
import type { ZoteroItem, ZoteroKeyMap } from "../src/types/zotero.ts";
import {
  BIB_DEBOUNCE_MS,
  BIB_GENERATED_HEADER,
  PULL_MIN_INTERVAL_MS,
  applyKeyMigration,
  asciiSlug,
  bibKeysFromText,
  buildKeyMap,
  checkBibConsistency,
  citationKeyFromExtra,
  consistencySummary,
  escapeBibValue,
  extractYear,
  isNewChange,
  isPathInsideRoot,
  itemsToBibtex,
  makeCiteKey,
  mergeBibPaths,
  normalizeBibPath,
  parseCollections,
  parseItemKeyNotes,
  parseZoteroItems,
  pathKey,
  planKeyMigration,
  shouldPull,
  syncSummary,
} from "../src/modules/zotero/zoteroSync.ts";

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

function item(over: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    itemKey: "AB12CD34",
    itemType: "journalArticle",
    title: "A Study of Things",
    authors: ["Doe, John"],
    year: "2020",
    publicationTitle: "Journal of Things",
    doi: "10.1000/xyz",
    url: "https://example.org/x",
    extra: "",
    citationKey: "",
    ...over,
  };
}

// ── 1. collection / item JSON 归一化 ──────────────────────────
console.log("\n[1] 本地 API JSON 归一化");
const collJson = JSON.stringify([
  { key: "ZZZZ1111", version: 3, data: { key: "ZZZZ1111", name: "中文分类", parentCollection: false } },
  { key: "AAAA2222", version: 1, data: { key: "AAAA2222", name: "Alpha", parentCollection: "ZZZZ1111" } },
  { key: "BAD", data: {} },
  "not-object",
]);
const colls = parseCollections(collJson);
const collByName = new Map(colls.map((c) => [c.name, c]));
eq(colls.length, 3, "分类：合法条目 + 无名回退 key");
check(collByName.has("Alpha") && collByName.has("BAD") && collByName.has("中文分类"), "三个名称都在且按名称排序");
eq(collByName.get("Alpha")?.parentCollection, "ZZZZ1111", "子分类 parentCollection 保留");
eq(collByName.get("中文分类")?.parentCollection, false, "顶层 parentCollection=false 归一");
eq(collByName.get("BAD")?.name, "BAD", "缺 name 时回落 key");
eq(parseCollections("not json").length, 0, "坏 JSON 返回空数组");
eq(parseCollections("{}").length, 0, "非数组对象返回空数组");
eq(parseCollections(JSON.stringify({ items: [{ key: "K1", data: { name: "Wrapped" } }] })).length, 1, "兼容 {items:[...]} 包装");

const itemJson = JSON.stringify([
  {
    key: "AB12CD34",
    data: {
      itemType: "journalArticle",
      title: "A Study of Things",
      creators: [{ firstName: "John", lastName: "Doe", creatorType: "author" }, { name: "某某研究组" }],
      date: "2020-03-15",
      publicationTitle: "Journal of Things",
      DOI: "10.1000/xyz",
      url: "https://example.org/x",
      extra: "Citation Key: doe2020study\nSome other note",
    },
  },
  { key: "EF56GH78", data: { itemType: "book", title: "Book Title", creators: [], date: "1999", publisher: "Pub" } },
]);
const items = parseZoteroItems(itemJson);
eq(items.length, 2, "题录：两条");
eq(items[0].itemKey, "AB12CD34", "itemKey 取顶层 key");
eq(items[0].itemType, "journalArticle", "itemType 保留");
eq(items[0].authors.length, 2, "creators 两名");
eq(items[0].authors[0], "Doe, John", "lastName, firstName 格式");
eq(items[0].authors[1], "某某研究组", "name 单字段作者");
eq(items[0].year, "2020", "date 抽 4 位年份");
eq(items[0].publicationTitle, "Journal of Things", "publicationTitle");
eq(items[0].doi, "10.1000/xyz", "DOI 大小写字段");
eq(items[0].citationKey, "doe2020study", "Extra 的 Citation Key");
eq(items[1].publicationTitle, "Pub", "publisher 回落到 publicationTitle");
eq(items[1].year, "1999", "1999 年份");
eq(items[1].citationKey, "", "无 Extra 时 citationKey 为空");
eq(parseZoteroItems("[]").length, 0, "空数组");
eq(parseZoteroItems("oops").length, 0, "坏 JSON");

eq(citationKeyFromExtra("Citation Key: abc123"), "abc123", "Extra 行首 Citation Key");
eq(citationKeyFromExtra("x\nCitation Key: key-2  \n"), "key-2", "Extra 第二行带空格");
eq(citationKeyFromExtra("citation key: lower"), "lower", "大小写不敏感");
eq(citationKeyFromExtra("nothing here"), "", "无 Citation Key");
eq(citationKeyFromExtra("Citation Key: a,b"), "a", "逗号后不并入 key");
eq(extractYear("2026-11-15"), "2026", "年份抽取 ISO 日期");
eq(extractYear("May 1899"), "1899", "19 世纪年份");
eq(extractYear("no date"), "", "无年份");

// ── 2. citekey 生成与 BibTeX 序列化 ────────────────────────────
console.log("\n[2] citekey / BibTeX");
eq(asciiSlug("Doe, J. 中文-2020"), "DoeJ2020", "asciiSlug 去非 ASCII");
const k1 = makeCiteKey(item());
eq(k1, "doe2020things", "citekey = 作者+年+首个实词（跳过 the/a/of/study → things）");
eq(makeCiteKey(item({ title: "The Study" })), "doe2020", "全停用词标题退化为 作者+年");
const taken = new Set(["doe2020things"]);
eq(makeCiteKey(item(), taken), "doe2020thingsa", "冲突追加 a");
eq(makeCiteKey(item(), new Set(["doe2020things", "doe2020thingsa"])), "doe2020thingsb", "冲突追加 b");
eq(makeCiteKey(item({ authors: [], title: "中文标题", year: "" })), "ab12cd34nd", "中文无作者时用 itemKey + nd");
eq(/^[a-z]/.test(makeCiteKey(item({ authors: [], title: "", itemKey: "12345678", year: "2020" }))), true, "key 不以数字开头");
eq(makeCiteKey(item(), taken).length <= 64, true, "key 长度受控");

eq(escapeBibValue("A {B} C"), "A B C", "去花括号");
eq(escapeBibValue("50% & $x #1_a"), "50\\% \\& \\$x \\#1\\_a", "转义 TeX 特殊字符");
eq(escapeBibValue("中文标题"), "中文标题", "中文原样保留");
eq(escapeBibValue("a\\b"), "ab", "去孤立反斜杠");

const bib = itemsToBibtex([item(), item({ itemKey: "EF56GH78", itemType: "book", title: "Book {Title}", authors: ["Smith, A"], year: "1999", citationKey: "smith1999book" })]);
check(bib.startsWith(BIB_GENERATED_HEADER), "生成头注释");
check(bib.includes("@article{doe2020things,"), "journalArticle → article + 生成 key");
check(bib.includes("@book{smith1999book,"), "book → book + BBT key 优先");
check(bib.includes("author = {Doe, John}"), "author 字段");
check(bib.includes("journal = {Journal of Things}"), "article 用 journal");
check(bib.includes("title = {Book Title}"), "book 标题去花括号");
check(bib.includes("zoteroitemkey = {AB12CD34}"), "itemKey 写自定义字段（BibTeX/biber 不渲染）");
check(!/note\s*=/.test(bib), "生成块不含 note 标准字段（不打印进参考文献）");
check(bib.includes("doi = {10.1000/xyz}"), "doi 字段");
const dupBib = itemsToBibtex([item(), item({ itemKey: "ZZ99" })]);
eq(bibKeysFromText(dupBib).length, 2, "相同题录生成两个不冲突的 key");
check(bibKeysFromText(dupBib)[1].endsWith("a"), "第二个 key 追加 a 消歧");
eq(bibKeysFromText("@article{a, title={x}}\n@book{b,\n author={y}}\n@article{a,}").join(","), "a,b", "bibKeysFromText 去重保序");
eq(bibKeysFromText("no entries").length, 0, "无条目时 key 列表为空");
const notes = parseItemKeyNotes(bib);
eq(notes["AB12CD34"], "doe2020things", "自定义字段 → itemKey 映射");
eq(notes["EF56GH78"], "smith1999book", "第二条字段映射");
eq(Object.keys(parseItemKeyNotes("@article{x,\n title={y}}")).length, 0, "无映射字段不误判");
eq(parseItemKeyNotes("@article{legacy2020,\n note = {Zotero itemKey: OLD12345}\n}")["OLD12345"], "legacy2020", "兼容旧式 note 映射");

// ── 3. 键映射与漂移 ──────────────────────────────────────────
console.log("\n[3] 键映射 / 键漂移");
const map = buildKeyMap(items, bibKeysFromText(bib), "server-10", "2026-11-15T10:00:00Z", notes);
eq(map.serverId, "server-10", "serverId 分区写入");
eq(map.updatedAt, "2026-11-15T10:00:00Z", "updatedAt 可注入便于测试");
eq(map.byCiteKey["doe2020things"], "AB12CD34", "citeKey → itemKey");
eq(map.byItemKey["AB12CD34"], "doe2020things", "itemKey → citeKey");
eq(map.byItemKey["EF56GH78"], "smith1999book", "第二条双向映射");
eq(map.unmapped.length, 0, "全部 .bib key 均被映射");
const map2 = buildKeyMap(items, ["doe2020things", "handwritten2020"], "s", "t", notes);
eq(map2.unmapped.join(","), "handwritten2020", "手写条目进 unmapped");
const map3 = buildKeyMap(items, [], "s", "t");
eq(Object.keys(map3.byCiteKey).length, 2, "无 bibKeys 时用生成 key 兜底");
eq(buildKeyMap(items, ["totally-different"], "s", "t").unmapped.length, 1, "Extra 与 .bib 不符时不硬凑映射");

const prev: ZoteroKeyMap = {
  serverId: "s",
  updatedAt: "t",
  byCiteKey: { oldkey: "AB12CD34" },
  byItemKey: { AB12CD34: "oldkey" },
  unmapped: [],
};
const next: ZoteroKeyMap = { ...map, byItemKey: { ...map.byItemKey, AB12CD34: "doe2020study" } };
const plan = planKeyMigration(prev, next, ["oldkey", "other"]);
eq(plan.length, 1, "键漂移生成 1 条计划");
eq(plan[0].from, "oldkey", "计划 from");
eq(plan[0].to, "doe2020study", "计划 to");
eq(plan[0].itemKey, "AB12CD34", "计划 itemKey");
eq(planKeyMigration(null, next, ["oldkey"]).length, 0, "无上次映射不生成计划");
eq(planKeyMigration(prev, next, ["other"]).length, 0, "旧 key 未被引用不生成计划");
eq(planKeyMigration(prev, { ...prev, byItemKey: { AB12CD34: "oldkey" } }, ["oldkey"]).length, 0, "key 未变不生成计划");
eq(applyKeyMigration("See \\cite{oldkey} and \\citep[p.~3]{oldkey, other}.", plan),
  "See \\cite{doe2020study} and \\citep[p.~3]{doe2020study, other}.", "迁移改写 cite/citep 内 key");
eq(applyKeyMigration("Text \\cite{other} only.", plan), "Text \\cite{other} only.", "无关 key 不动");
eq(applyKeyMigration("oldkey in prose", plan), "oldkey in prose", "正文里的同名字符串不动");
eq(applyKeyMigration("no cites", []), "no cites", "空计划原样返回");

// ── 4. 一致性诊断 ────────────────────────────────────────────
console.log("\n[4] 编译前一致性诊断");
const c = checkBibConsistency(["a", "b", "b", "c"], ["a", "x", "y"], "T");
eq(c.checkedAt, "T", "checkedAt 可注入");
eq(c.missing.join(","), "x,y", "缺失引用 = cite 有 bib 无");
eq(c.orphaned.join(","), "b,c", "孤儿 = bib 有 cite 无");
eq(c.duplicates.join(","), "b", "重复 key 去重后列出");
eq(c.bibCount, 3, "bibCount 按去重后计");
eq(c.citeCount, 3, "citeCount 按去重后计");
const c2 = checkBibConsistency(["a"], ["a"], "T2");
eq(c2.missing.length + c2.orphaned.length + c2.duplicates.length, 0, "完全一致时三项为空");
eq(checkBibConsistency([], [], "T3").bibCount, 0, "空库空引用");
check(consistencySummary(c).includes("缺失 2"), "摘要含缺失数");
eq(consistencySummary(null), "", "null 摘要为空");

// ── 5. 节流 / 去抖 / 路径 ────────────────────────────────────
console.log("\n[5] 节流 / 去抖 / 路径");
eq(PULL_MIN_INTERVAL_MS, 60000, "拉取最小间隔 60s");
eq(BIB_DEBOUNCE_MS, 300, "防抖窗口 300ms");
eq(shouldPull(null, 1000), true, "从未拉过 → 允许");
eq(shouldPull("2026-11-15T10:00:00Z", Date.parse("2026-11-15T10:00:30Z")), false, "30s 内不重复拉");
eq(shouldPull("2026-11-15T10:00:00Z", Date.parse("2026-11-15T10:01:00Z")), true, "恰好 60s 允许");
eq(shouldPull("bogus", 1000), true, "坏时间戳允许重试");
eq(shouldPull("2026-11-15T10:00:00Z", Date.parse("2026-11-15T10:00:20Z"), 10_000), true, "自定义间隔生效");

eq(pathKey("E:\\Proj\\Refs.bib"), "e:/proj/refs.bib", "Windows 反斜杠归一");
eq(pathKey("//?/E:/Proj/Refs.bib"), "e:/proj/refs.bib", "剥 verbatim 前缀");
eq(pathKey("/home/u/Refs.bib"), "/home/u/refs.bib", "POSIX 路径");
eq(normalizeBibPath("E:/Proj", "references.bib"), "E:/Proj/references.bib", "相对路径拼项目根");
eq(normalizeBibPath("E:/Proj/", "./refs/a.bib"), "E:/Proj/refs/a.bib", "去 ./ 与尾斜杠");
eq(normalizeBibPath("E:/Proj", "D:/Other/a.bib"), "D:/Other/a.bib", "绝对路径原样");
eq(normalizeBibPath("/home/u", "figures\\x.bib"), "/home/u/figures/x.bib", "POSIX 相对路径反斜杠归一");
eq(isPathInsideRoot("E:/Proj", "E:/Proj/references.bib"), true, "项目内路径");
eq(isPathInsideRoot("E:/Proj", "e:/proj/sub/A.BIB"), true, "大小写不敏感");
eq(isPathInsideRoot("E:/Proj", "E:/ProjectElsewhere/a.bib"), false, "同前缀不同目录不误判");
eq(isPathInsideRoot("E:/Proj", "D:/Other/a.bib"), false, "跨盘符拒绝");
// 回归：引用面板出现两个同名 references.bib 分组 + 18 个重复 key
// 根因 = 项目树反斜杠路径与绑定正斜杠路径只做了 toLowerCase 比对
eq(pathKey("E:\\Proj\\.\\refs\\a.bib"), "e:/proj/refs/a.bib", "折叠 . 段");
eq(pathKey("E:/Proj//sub/../refs.bib"), "e:/proj/refs.bib", "折叠重复斜杠与 .. 段");
eq(pathKey("//srv/share/Refs.bib"), "//srv/share/refs.bib", "UNC 前导 // 保留");
eq(pathKey("\\\\?\\E:\\Proj\\Refs.bib"), "e:/proj/refs.bib", "反斜杠 verbatim 前缀也可剥离");
const merged = mergeBibPaths(
  ["E:\\Proj\\references.bib"],
  ["E:/Proj/references.bib", "E:/Proj/./references.bib"],
);
eq(merged.length, 1, "同一 .bib 的项目树写法与绑定写法合并为一条");
eq(merged[0], "E:\\Proj\\references.bib", "优先保留项目树写法，保证跳转可定位");
const merged2 = mergeBibPaths(
  ["E:\\Proj\\ref.bib"],
  ["D:/Other/a.bib", "d:\\other\\A.bib", ""],
);
eq(merged2.length, 2, "外部路径自身也按规范化去重，空路径丢弃");
eq(merged2[1], "D:/Other/a.bib", "保留外部路径首次写法");
eq(mergeBibPaths([], []).length, 0, "空输入返回空数组");
eq(isNewChange(null, { path: "a", hash: "h", reason: "external" }), true, "首条变更必发");
eq(isNewChange({ path: "a", hash: "h" }, { path: "A", hash: "h", reason: "sync" }), false, "同路径同 hash 去重（大小写）");
eq(isNewChange({ path: "a", hash: "h1" }, { path: "a", hash: "h2", reason: "external" }), true, "hash 变化视为新变更");
eq(isNewChange({ path: "a", hash: "h" }, { path: "b", hash: "h", reason: "external" }), true, "换文件视为新变更");

// ── 6. 同步结果文案 ──────────────────────────────────────────
console.log("\n[6] 同步结果文案");
eq(syncSummary(null), "尚未同步", "无记录文案");
const recOk = {
  at: "2026-11-15T10:30:00Z", ok: true, source: "bbt" as const, written: true,
  hash: "h", entryCount: 12, mappedCount: 10, message: "", bibPath: "E:/p/refs.bib",
};
check(syncSummary(recOk).includes("同步成功"), "成功文案");
check(syncSummary(recOk).includes("BBT 导出"), "来源文案");
check(syncSummary(recOk).includes("12 条"), "条目数文案");
check(syncSummary(recOk).includes("已写盘"), "写盘文案");
check(syncSummary({ ...recOk, written: false }).includes("无变化"), "未写盘文案");
check(syncSummary({ ...recOk, ok: false, source: "local-api" }).includes("同步失败"), "失败文案");
check(syncSummary({ ...recOk, source: "skipped" }).includes("跳过"), "跳过文案");

console.log(`\n${failures === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${total - failures}/${total}`);
if (failures > 0) process.exitCode = 1;
