// Zotero 联动 · P6 字段级增量同步纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p6.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 带 .ts 后缀）
import type { ZoteroItem } from "../src/types/zotero.ts";
import {
  ZOTERO_MANAGED_FIELDS,
  itemKeyNotesFromBib,
  mergeBibFields,
  parseBibEntries,
  pickInsertBibPath,
  unwrapBibValue,
  zoteroFieldsFromItem,
} from "../src/modules/zotero/zoteroMerge.ts";

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

const SAMPLE = `@article{doe2020,
  title = {Old Title},
  author = {Doe, John},
  year = {2020},
  journal = {Old Journal},
  note = {我的手写笔记},
  eprint = {arXiv:1234}
}

@inproceedings{roe2021,
  title = {Roe Paper},
  author = {Roe, Jane},
  year = {2021},
  booktitle = {Proc},
  note = {Zotero itemKey: AB12CD34}
}
`;

// ── parseBibEntries ────────────────────────────────────────────
console.log("\n[parseBibEntries]");
{
  const es = parseBibEntries(SAMPLE);
  eq(es.length, 2, "解析出 2 个条目");
  eq(es[0].citeKey, "doe2020", "citekey 正确");
  eq(es[0].fields.length, 6, "doe2020 有 6 个字段");
  eq(es[0].fields[5].name, "eprint", "末字段 eprint 解析正确");
  eq(es[1].fields[4].raw.includes("AB12CD34"), true, "note 值含 itemKey");
  check(es[0].start >= 0 && es[0].end > es[0].start, "偏移区间有效");
  eq(SAMPLE.slice(es[0].start, es[0].start + 8), "@article", "start 指向 @");
}
{
  const nested = `@book{k,
  title = {A {Nested} Title with , comma},
  abstract = {line one
line two}
}`;
  const es = parseBibEntries(nested);
  eq(es.length, 1, "嵌套花括号/换行不误切条目");
  eq(es[0].fields.length, 2, "两个字段都被解析");
  check(es[0].fields[0].raw.includes("{Nested}"), "嵌套花括号值完整保留");
}
{
  const paren = `@misc(key,
  title = {P},
  note = {x})`;
  const es = parseBibEntries(paren);
  eq(es.length, 1, "圆括号定界可解析");
  eq(es[0].open, "(", "open 记录为圆括号");
  eq(es[0].fields[0].name, "title", "圆括号条目字段解析");
}
{
  const skip = `@comment{ignored}
@preamble{"x"}
@string{foo = "bar"}
@article{keep, title = {T}}`;
  const es = parseBibEntries(skip);
  eq(es.length, 1, "comment/preamble/string 被跳过");
  eq(es[0].citeKey, "keep", "只留真实条目");
}
eq(parseBibEntries("").length, 0, "空文本返回空数组");

// ── unwrapBibValue ─────────────────────────────────────────────
console.log("\n[unwrapBibValue]");
eq(unwrapBibValue("  title = {Hello World} "), "Hello World", "花括号值去壳");
eq(unwrapBibValue('title = "Quoted"'), "Quoted", "引号值去壳");
eq(unwrapBibValue("year = 2020"), "2020", "裸值原样");

// ── mergeBibFields ─────────────────────────────────────────────
console.log("\n[mergeBibFields]");
{
  const r = mergeBibFields(SAMPLE, [
    {
      citeKey: "doe2020",
      fields: { title: "New Title", year: "2022", journal: "New Journal", doi: "10.1/x" },
    },
  ]);
  eq(r.changedKeys.join(","), "doe2020", "仅变化条目进入 changedKeys");
  check(r.text.includes("title = {New Title}"), "标题被覆盖");
  check(r.text.includes("year = {2022}"), "年份被覆盖");
  check(r.text.includes("journal = {New Journal}"), "期刊被覆盖");
  check(r.text.includes("doi = {10.1/x}"), "新字段 doi 被追加");
  check(r.text.includes("note = {我的手写笔记}"), "手写 note 原样保留");
  check(r.text.includes("eprint = {arXiv:1234}"), "独有字段 eprint 保留");
  check(!r.text.includes("Old Title"), "旧值消失");
  eq(r.addedFields["doe2020"]?.join(","), "doi", "新增字段登记");
  eq(r.missingKeys.length, 0, "无缺失 key");
}
{
  // Zotero 空值不覆盖：不应清空已有字段，也不应新增
  const r = mergeBibFields(SAMPLE, [
    { citeKey: "doe2020", fields: { title: "", doi: "" } },
  ]);
  eq(r.changedKeys.length, 0, "全空字段不触发变更");
  check(r.text.includes("title = {Old Title}"), "空值未清空标题");
  check(!r.text.includes("doi ="), "空值未新增 doi");
}
{
  // citekey 不在 .bib → missingKeys
  const r = mergeBibFields(SAMPLE, [
    { citeKey: "ghost2020", fields: { title: "X" } },
  ]);
  eq(r.missingKeys.join(","), "ghost2020", "找不到的 key 进入 missingKeys");
  eq(r.changedKeys.length, 0, "缺失 key 不改任何条目");
}
{
  // patch 未给的字段原样保留（roe2021 只改 title）
  const r = mergeBibFields(SAMPLE, [
    { citeKey: "roe2021", fields: { title: "Roe New" } },
  ]);
  check(r.text.includes("author = {Roe, Jane}"), "未改字段保留");
  check(r.text.includes("note = {Zotero itemKey: AB12CD34}"), "itemKey note 保留");
  check(r.text.includes("booktitle = {Proc}"), "booktitle 保留");
}
{
  // 同值不重建（幂等）：再同步一次不应变化
  const once = mergeBibFields(SAMPLE, [
    { citeKey: "doe2020", fields: { title: "Same", year: "2020" } },
  ]).text;
  const twice = mergeBibFields(once, [
    { citeKey: "doe2020", fields: { title: "Same", year: "2020" } },
  ]);
  eq(twice.changedKeys.length, 0, "同值二次同步无变化（幂等）");
  eq(twice.text, once, "文本完全一致");
}
{
  // 多条目一次合并 + 偏移从后往前不串位
  const r = mergeBibFields(SAMPLE, [
    { citeKey: "doe2020", fields: { title: "D2" } },
    { citeKey: "roe2021", fields: { title: "R2" } },
  ]);
  eq(r.changedKeys.join(","), "doe2020,roe2021", "两个条目都变化");
  check(r.text.includes("title = {D2}") && r.text.includes("title = {R2}"), "两处都写入");
}
{
  // 托管字段集：note 不在其中
  check(!(ZOTERO_MANAGED_FIELDS as readonly string[]).includes("note"), "note 不被 Zotero 托管");
  check((ZOTERO_MANAGED_FIELDS as readonly string[]).includes("abstract"), "abstract 被托管");
}

// ── zoteroFieldsFromItem ───────────────────────────────────────
console.log("\n[zoteroFieldsFromItem]");
const item = (over: Partial<ZoteroItem> = {}): ZoteroItem => ({
  itemKey: "AB12CD34",
  itemType: "journalArticle",
  title: "Deep Learning",
  authors: ["A. Doe", "B. Roe"],
  year: "2020",
  publicationTitle: "Nature",
  doi: "10.1000/x",
  url: "https://x.example",
  extra: "",
  citationKey: "doe2020deep",
  ...over,
});
{
  const f = zoteroFieldsFromItem(item());
  eq(f.title, "Deep Learning", "标题映射");
  eq(f.author, "A. Doe and B. Roe", "作者用 and 连接");
  eq(f.year, "2020", "年份映射");
  eq(f.journal, "Nature", "期刊 → journal");
  eq(f.doi, "10.1000/x", "doi 映射");
  eq(f.url, "https://x.example", "url 映射");
  eq(f.note, undefined, "不产出 note（保护手写）");
}
{
  eq(zoteroFieldsFromItem(item({ itemType: "conferencePaper" })).booktitle, "Nature", "会议论文 → booktitle");
  eq(zoteroFieldsFromItem(item({ itemType: "book" })).publisher, "Nature", "图书 → publisher");
  eq(zoteroFieldsFromItem(item({ title: "", doi: "", year: "2020" })).title, undefined, "空字段不产出");
}
{
  // 端到端：题录 → 字段 → 合并
  const r = mergeBibFields(SAMPLE, [{ citeKey: "doe2020", fields: zoteroFieldsFromItem(item({ title: "New Title" })) }]);
  check(r.text.includes("title = {New Title}"), "端到端：题录标题写入 .bib");
  check(r.text.includes("note = {我的手写笔记}"), "端到端：手写 note 保留");
}

// ── itemKeyNotesFromBib ────────────────────────────────────────
console.log("\n[itemKeyNotesFromBib]");
{
  const notes = itemKeyNotesFromBib(SAMPLE);
  eq(notes["AB12CD34"], "roe2021", "从 note 抽出 itemKey → citekey");
  eq(notes["NOPE"], undefined, "不存在的 key 返回 undefined");
}

// ── pickInsertBibPath（插入即写入目标推断） ────────────────────
console.log("\n[pickInsertBibPath]");
{
  const root = "E:/Project/Demo";
  const cands = [
    { file: "E:\\Project\\Demo\\refs.bib", zoteroCount: 0, entryCount: 2 },
    { file: "E:/Project/Demo/figures/zotero.bib", zoteroCount: 5, entryCount: 9 },
    { file: "E:/Project/Demo/other.bib", zoteroCount: 0, entryCount: 20 },
  ];
  eq(
    pickInsertBibPath(root, null, cands),
    "E:/Project/Demo/figures/zotero.bib",
    "无绑定：Zotero 条目多的主库优先",
  );
  eq(
    pickInsertBibPath(root, null, cands.slice(0, 1).concat(cands.slice(2))),
    "E:/Project/Demo/other.bib",
    "Zotero 条目数打平：总条目多者优先",
  );
  eq(
    pickInsertBibPath(root, null, [
      { file: "E:/Project/Demo/b.bib", zoteroCount: 1, entryCount: 1 },
      { file: "E:/Project/Demo/a.bib", zoteroCount: 1, entryCount: 1 },
    ]),
    "E:/Project/Demo/a.bib",
    "完全打平：路径升序稳定",
  );
  eq(
    pickInsertBibPath(root, { enabled: true, bibPath: "refs.bib" }, cands),
    "E:/Project/Demo/refs.bib",
    "受管绑定优先且相对路径归一为绝对",
  );
  eq(
    pickInsertBibPath(root, { enabled: false, bibPath: "refs.bib" }, cands),
    "E:/Project/Demo/figures/zotero.bib",
    "未启用的绑定忽略，回落自动推断",
  );
  eq(
    pickInsertBibPath(root, { enabled: true, bibPath: "../outside.bib" }, cands),
    "E:/Project/Demo/figures/zotero.bib",
    "越界绑定忽略，回落项目内推断",
  );
  eq(pickInsertBibPath(root, null, []), null, "无任何候选 → null");
  eq(
    pickInsertBibPath(root, null, [{ file: "E:/Elsewhere/x.bib", zoteroCount: 9, entryCount: 9 }]),
    null,
    "项目外候选不计入",
  );
}

console.log(`\n${total - failures}/${total} 通过`);
process.exit(failures === 0 ? 0 : 1);
