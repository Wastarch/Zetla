// Zotero 联动 · P4 双模式同步（on-demand「插一篇写一篇」/ full 全量）纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p4.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 一律带 .ts 后缀）
import type { ZoteroItem, ZoteroKeyMap } from "../src/types/zotero.ts";
import {
  appendKeyMap,
  bibKeysFromText,
  bibtexEntryBlock,
  buildKeyMap,
  makeCiteKey,
  missingCiteKeys,
  normalizeSyncMode,
  parseSingleItem,
  type KeyMapEntry,
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
function deepEq(got: unknown, want: unknown, msg: string) {
  check(JSON.stringify(got) === JSON.stringify(want), `${msg}（得到 ${JSON.stringify(got)}）`);
}

function zitem(over: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    itemKey: "AB12CD34",
    itemType: "journalArticle",
    title: "Deep Learning",
    authors: ["Goodfellow, Ian"],
    year: "2016",
    publicationTitle: "Nature",
    doi: "10.1/x",
    url: "",
    extra: "",
    citationKey: "",
    ...over,
  };
}

// ── normalizeSyncMode ─────────────────────────────────────────
console.log("\n[1] normalizeSyncMode");
eq(normalizeSyncMode("on-demand"), "on-demand", "合法值原样返回");
eq(normalizeSyncMode("full"), "full", "full 原样返回");
eq(normalizeSyncMode(undefined), "full", "旧配置缺失回落 full");
eq(normalizeSyncMode(null), "full", "null 回落 full");
eq(normalizeSyncMode("ON-DEMAND"), "full", "大小写敏感：未知值回落 full");
eq(normalizeSyncMode(42), "full", "非字符串回落 full");

// ── missingCiteKeys ───────────────────────────────────────────
console.log("\n[2] missingCiteKeys");
deepEq(missingCiteKeys(["a", "b", "c"], ["b"]), ["a", "c"], "过滤已有 key，保序");
deepEq(missingCiteKeys(["a", "a", "b"], []), ["a", "b"], "wanted 去重");
deepEq(missingCiteKeys([" a ", ""], ["a"]), [], "trim 与空串过滤");
deepEq(missingCiteKeys([], ["x"]), [], "空 wanted → 空");

// ── bibtexEntryBlock（强制 key，无文件头）────────────────────
console.log("\n[3] bibtexEntryBlock");
const forced = bibtexEntryBlock(zitem(), "myKey2026");
check(forced.startsWith("@article{myKey2026,"), "强制 citekey 生效");
check(!forced.includes("Zetla · Zotero managed"), "单条块不带受管文件头");
check(forced.includes("note = {Zotero itemKey: AB12CD34}"), "note 保留 itemKey 供映射");
check(forced.includes("journal = {Nature}"), "article 落 journal 字段");
check(!forced.endsWith("\n"), "块尾无多余换行（拼接方负责分隔）");
// 不传 key 时走 BBT/citationKey → makeCiteKey 回退
const auto = bibtexEntryBlock(zitem({ citationKey: "" }));
check(auto.startsWith(`@article{${makeCiteKey(zitem({ citationKey: "" }))},`), "无强制 key 时自动生成");
// 与整批生成的一致性：同一条目两条路径产出的 key 相同
const batch = bibKeysFromText(
  bibtexEntryBlock(zitem({ citationKey: "" })) + "\n",
);
eq(batch[0], makeCiteKey(zitem({ citationKey: "" })), "单条与整批 key 口径一致");

// ── appendKeyMap（增量并入，不覆盖既有指向）──────────────────
console.log("\n[4] appendKeyMap");
const prev: ZoteroKeyMap = {
  serverId: "srv1",
  updatedAt: "2026-11-16T00:00:00Z",
  byCiteKey: { old1: "IT1", handKey: "" },
  byItemKey: { IT1: "old1" },
  unmapped: ["handKey", "ghost"],
};
const entries: KeyMapEntry[] = [
  { citeKey: "new1", itemKey: "IT2" },
  { citeKey: "ghost", itemKey: "IT3" },
];
const m1 = appendKeyMap(prev, entries, "2026-11-16T07:00:00Z");
eq(m1.byCiteKey.new1, "IT2", "新增映射");
eq(m1.byItemKey.IT2, "new1", "反向映射同步");
eq(m1.serverId, "srv1", "沿用旧 serverId");
eq(m1.updatedAt, "2026-11-16T07:00:00Z", "更新时间戳");
check(!m1.unmapped.includes("ghost"), "写入的 key 移出 unmapped");
check(m1.unmapped.includes("handKey"), "未写入的手写 key 留在 unmapped");
// 冲突保护
const m2 = appendKeyMap(prev, [{ citeKey: "old1", itemKey: "IT9" }]);
eq(m2.byCiteKey.old1, "IT1", "同 key 指向另一条 itemKey：不覆盖");
const m3 = appendKeyMap(prev, [{ citeKey: "other", itemKey: "IT1" }]);
eq(m3.byItemKey.IT1, "old1", "同 itemKey 换 key：不覆盖（交给漂移检测）");
// 无旧映射
const m4 = appendKeyMap(null, [{ citeKey: "k", itemKey: "IT" }]);
eq(m4.byCiteKey.k, "IT", "prev=null 也能建映射");
eq(m4.serverId, null, "prev=null 时 serverId 为 null");
// 坏条目过滤
const m5 = appendKeyMap(prev, [{ citeKey: "", itemKey: "IT" }, { citeKey: "x", itemKey: "" }]);
check(!("x" in m5.byCiteKey) && !m5.byCiteKey[""], "空 citeKey / itemKey 被忽略");

// ── parseSingleItem ───────────────────────────────────────────
console.log("\n[5] parseSingleItem");
const single = parseSingleItem(
  JSON.stringify({ key: "XY987654", data: { itemType: "book", title: "T", creators: [{ lastName: "Doe", firstName: "J" }], date: "2001" } }),
);
check(!!single, "单对象 JSON 解析成功");
eq(single?.itemKey, "XY987654", "取顶层 key");
eq(single?.year, "2001", "date 抽年");
eq(parseSingleItem("not json"), null, "坏 JSON → null");
eq(parseSingleItem("{}"), null, "无 key 的对象 → null");
const arr = parseSingleItem(JSON.stringify([{ key: "AA111111", data: { itemType: "misc", title: "a" } }]));
eq(arr?.itemKey, "AA111111", "数组包装也兼容");

// ── buildKeyMap × on-demand 全量映射口径 ──────────────────────
console.log("\n[6] on-demand 映射口径（无 BBT 时也可解析 citekey）");
const items = [
  zitem({ itemKey: "IT1", citationKey: "" }),
  zitem({ itemKey: "IT2", title: "Another Work", authors: ["Smith, A"], year: "2020" }),
];
const fullMap = buildKeyMap(items, [], "srv1", "now", {});
check(Object.keys(fullMap.byCiteKey).length === 2, "bibKeys=[] → 全部题录都有映射（on-demand 口径）");
const k1 = fullMap.byItemKey.IT1;
check(!!k1, "IT1 解析出 citekey");
// 该 key 与 bibtexEntryBlock 自动生成的 key 一致 → 写入的条目可被 \cite 命中
eq(bibKeysFromText(bibtexEntryBlock(items[0], k1))[0], k1, "写入时强制用映射 key");

console.log(`\n${total - failures}/${total} 通过`);
if (failures > 0) process.exit(1);
