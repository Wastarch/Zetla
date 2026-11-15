// Zotero 联动 · P2 Citation Picker 纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p2.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 一律带 .ts 后缀）
import type { ZoteroItem, ZoteroKeyMap } from "../src/types/zotero.ts";
import {
  PICKER_DEFAULT_COMMAND,
  PICKER_MAX_RESULTS,
  citationKeyFor,
  formatCitation,
  fuzzyScore,
  mergeCandidates,
  nextPageStart,
  normalizeCommand,
  parseSearchItems,
  pickerWarning,
  rankCandidates,
  sanitizeKeys,
  scoreCandidate,
  unmappedCount,
  type BibLikeEntry,
  type ZoteroPickerCandidate,
} from "../src/modules/zotero/zoteroPicker.ts";
// P2-0 地基回归：新命令与双可选参数必须被补全 / 悬浮 / lint 看见
import { CITE_FULL_RE, matchCitePrefix } from "../src/modules/reference/citeLogic.ts";
import { scanCitesForIndex } from "../src/modules/reference/lintLogic.ts";

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
function bib(over: Partial<BibLikeEntry> = {}): BibLikeEntry {
  return {
    key: "doe2020deep",
    author: "A. Doe and B. Roe",
    title: "Deep Learning",
    year: "2020",
    publication: "Nature",
    doi: "10.1000/xyz",
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
function cand(over: Partial<ZoteroPickerCandidate> = {}): ZoteroPickerCandidate {
  return {
    citeKey: "doe2020deep",
    itemKey: "AB12CD34",
    title: "Deep Learning",
    authors: "A. Doe, B. Roe",
    year: "2020",
    publication: "Nature",
    doi: "10.1000/xyz",
    inBib: true,
    citedCount: 0,
    source: "bib",
    ...over,
  };
}

// ── 命令归一 ──────────────────────────────────────────────────
eq(PICKER_DEFAULT_COMMAND, "cite", "默认命令为 \\cite");
eq(normalizeCommand("cite"), "cite", "普通命令");
eq(normalizeCommand("\\CiteP"), "citep", "带反斜杠 + 大小写混杂");
eq(normalizeCommand("autocite"), "autocite", "biblatex autocite");
eq(normalizeCommand("parencite"), "parencite", "biblatex parencite");
eq(normalizeCommand("textcite"), "textcite", "biblatex textcite");
eq(normalizeCommand("bogus"), "cite", "白名单外回落默认命令");
eq(normalizeCommand("bogus", "citet"), "citet", "白名单外回落指定命令");
eq(normalizeCommand(""), "cite", "空串回落默认命令");
eq(normalizeCommand("  \\AUTOCITE  "), "autocite", "空白与反斜杠归一");

// ── key 清洗 ──────────────────────────────────────────────────
eq(sanitizeKeys(["a", "b"]).join(","), "a,b", "普通多 key");
eq(sanitizeKeys([" a ", "a", "", "b,c"]).join(","), "a,bc", "去空白/去重/去非法字符");
eq(sanitizeKeys(["{x}", "[y]", "z"]).join(","), "x,y,z", "去花括号与方括号");
eq(sanitizeKeys([]).length, 0, "空 key 列表");

// ── 引用命令格式化 ────────────────────────────────────────────
eq(formatCitation({ command: "cite", keys: ["doe2020deep"] }), "\\cite{doe2020deep}", "最简 \\cite");
eq(
  formatCitation({ command: "citep", keys: ["a", "b"] }),
  "\\citep{a,b}",
  "多 key 命令",
);
eq(
  formatCitation({ command: "cite", keys: ["a"], prenote: "see", postnote: "p.~10" }),
  "\\cite[see][p.~10]{a}",
  "前缀 + 页码两个可选参数（用户示例）",
);
eq(
  formatCitation({ command: "autocite", keys: ["a"], prenote: "see", postnote: "p.~10" }),
  "\\autocite[see][p.~10]{a}",
  "biblatex 命令同样支持两参数",
);
eq(
  formatCitation({ command: "cite", keys: ["a"], postnote: "p.~10" }),
  "\\cite[][p.~10]{a}",
  "只有页码时补空前缀占位",
);
eq(
  formatCitation({ command: "cite", keys: ["a"], prenote: "see" }),
  "\\cite[see]{a}",
  "只有前缀时单参数",
);
eq(formatCitation({ command: "cite", keys: ["a"], starred: true }), "\\cite*{a}", "星号变体");
eq(
  formatCitation({ command: "parencite", keys: ["a"], starred: true, prenote: "cf." }),
  "\\parencite*[cf.]{a}",
  "星号 + 命令 + 参数组合",
);
eq(formatCitation({ command: "bogus", keys: ["a"] }), "\\cite{a}", "非法命令回落");
eq(formatCitation({ command: "cite", keys: [] }), "", "无 key 返回空串（不可插入）");
eq(
  formatCitation({ command: "cite", keys: ["a"], prenote: "see ] x", postnote: "p. 1" }),
  "\\cite[see ) x][p. 1]{a}",
  "可选参数里的 ] 被替换，避免提前闭合",
);

// ── 模糊评分 ──────────────────────────────────────────────────
eq(fuzzyScore("deep", "deep"), 100, "完全匹配最高分");
eq(fuzzyScore("deep", "Deep Learning"), 80, "前缀匹配");
check(fuzzyScore("learning", "Deep Learning") > 0, "子串匹配命中");
check(fuzzyScore("deep 2020", "Deep Learning 2020") > 0, "多词全含命中");
eq(fuzzyScore("", "anything"), 0, "空查询零分");
eq(fuzzyScore("zzzz", "Deep Learning"), 0, "无关词零分");
eq(fuzzyScore("deep", ""), 0, "空文本零分");
check(fuzzyScore("dee", "Deep Learning") > fuzzyScore("zzz", "Deep Learning"), "相关词排在无关词前");

const cBib = cand();
const cRemote = cand({ inBib: false, source: "zotero", citedCount: 0 });
check(scoreCandidate("deep", cBib) > scoreCandidate("deep", cRemote), "同分时已在 .bib 的优先");
check(scoreCandidate("", cand({ citedCount: 7 })) > scoreCandidate("", cBib), "空查询按被引次数排");
check(scoreCandidate("zzzz", cBib) === 0, "无关词整条候选得 0 分");

// ── citekey 三级回退 ──────────────────────────────────────────
eq(citationKeyFor(zitem(), null), "", "无映射无 Extra → 不可插入");
eq(
  citationKeyFor(zitem({ extra: "Citation Key: bbtKey2020\n某公司" }), null),
  "bbtKey2020",
  "Extra 回退",
);
eq(
  citationKeyFor(zitem({ citationKey: "alreadyParsed" }), null),
  "alreadyParsed",
  "归一化字段回退",
);
eq(
  citationKeyFor(zitem({ extra: "Citation Key: fromExtra", citationKey: "fromParsed" }),
    keymap({ byItemKey: { AB12CD34: "fromMap" } })),
  "fromMap",
  "map.json 优先级最高",
);
eq(unmappedCount([zitem(), zitem({ extra: "Citation Key: ok" })], null), 1, "统计无 citekey 的条目");

// ── 搜索结果解析 ──────────────────────────────────────────────
const raw = JSON.stringify([
  { key: "AB12CD34", data: { itemType: "journalArticle", title: "Deep Learning", creators: [{ firstName: "A.", lastName: "Doe" }], date: "2020", extra: "Citation Key: doe2020deep" } },
  { key: "EF56GH78", data: { itemType: "book", title: "Other Book", creators: [], date: "2019" } },
]);
const parsed = parseSearchItems(raw);
eq(parsed.length, 2, "items JSON 归一化条数");
eq(parsed[0].itemKey, "AB12CD34", "itemKey 取自顶层 key");
eq(parsed[0].citationKey, "doe2020deep", "Extra 的 Citation Key 被解析");
eq(parsed[1].citationKey, "", "无 Extra 时 citationKey 为空");
eq(parseSearchItems("not json").length, 0, "坏 JSON 返回空数组不抛异常");

// ── 候选合并 ──────────────────────────────────────────────────
const km = keymap({
  byCiteKey: { doe2020deep: "AB12CD34" },
  byItemKey: { AB12CD34: "doe2020deep", ZZ99YY88: "remote2021" },
});
const merged = mergeCandidates(
  [bib(), bib({ key: "handwritten2020", title: "手写条目" })],
  [zitem(), zitem({ itemKey: "ZZ99YY88", title: "Remote Paper" }), zitem({ itemKey: "NOKEY00" })],
  km,
  { doe2020deep: 3 },
);
eq(merged.length, 3, "两路合并按 citeKey 去重，跳过无 citekey 条目");
const mDoe = merged.find((c) => c.citeKey === "doe2020deep")!;
eq(mDoe.inBib, true, "同名条目保留项目 .bib 源");
eq(mDoe.source, "bib", "来源标记为 bib");
eq(mDoe.citedCount, 3, "被引次数带入");
eq(mDoe.itemKey, "AB12CD34", "从 map.json 补 itemKey");
const mHand = merged.find((c) => c.citeKey === "handwritten2020")!;
eq(mHand.itemKey, null, "手写条目无 itemKey");
const mRemote = merged.find((c) => c.citeKey === "remote2021")!;
eq(mRemote.inBib, false, "全库独有条目标记未同步");
eq(mRemote.source, "zotero", "来源标记为 zotero");
eq(mRemote.title, "Remote Paper", "远端元数据保留");
const merged2 = mergeCandidates(
  [bib({ doi: "", title: "" })],
  [zitem({ doi: "10.1000/xyz", title: "Deep Learning" })],
  km,
);
eq(merged2[0].doi, "10.1000/xyz", "已在 .bib 的条目由远端补 DOI");
eq(merged2[0].title, "Deep Learning", "已在 .bib 的条目由远端补题名");
eq(merged2[0].inBib, true, "补元数据不改写 inBib");
eq(mergeCandidates([], [], null).length, 0, "空输入返回空数组");

// ── 排序 / 截断 ───────────────────────────────────────────────
const unrelated = {
  title: "Quantum Optics", authors: "X. Nemo", year: "1900",
  publication: "Elsewhere", doi: "10.9/other",
};
const ranked = rankCandidates(
  [
    cand({ citeKey: "zzz2020", ...unrelated }),
    cand(),
    cand({ citeKey: "aaa2019", inBib: false, ...unrelated }),
  ],
  "deep",
);
eq(ranked.length, 1, "无关候选被过滤（inBib 加权不顶破零分）");
eq(ranked[0].citeKey, "doe2020deep", "命中候选排前");
const rankedEmpty = rankCandidates(
  [cand({ citeKey: "a", citedCount: 0 }), cand({ citeKey: "b", citedCount: 5 })],
  "",
);
eq(rankedEmpty[0].citeKey, "b", "空查询按被引次数降序");
eq(rankCandidates(Array.from({ length: 80 }, (_, i) => cand({ citeKey: `k${i}` })), "", 10).length, 10, "截断到指定上限");
eq(rankCandidates([], "").length, 0, "空候选数组");
check(PICKER_MAX_RESULTS >= 30, "渲染上限不小于一页");

// ── 警告（允许插入但必须提示） ─────────────────────────────────
eq(pickerWarning([cand()]), null, "全部已在 .bib 时无警告");
const warn = pickerWarning([cand(), cand({ citeKey: "remote2021", inBib: false })]);
check(warn !== null && warn.includes("remote2021"), "未同步条目出现在警告里");
check(warn !== null && warn.includes("引用缺失"), "警告说明编译后果");
check(warn !== null && warn.includes("仍可插入"), "警告明确仍允许插入（用户决策）");
eq(pickerWarning([]), null, "未选任何条目时无警告");

// ── 分页 ──────────────────────────────────────────────────────
eq(nextPageStart(0, 30, 100), 30, "满页且总数未到 → 下一页");
eq(nextPageStart(90, 10, 100), null, "未满页 → 停止");
eq(nextPageStart(90, 30, 100), null, "next 已达 total → 停止");
eq(nextPageStart(0, 30, null), 30, "total 未知且满页 → 继续尝试");
eq(nextPageStart(0, 5, null), null, "total 未知但未满页 → 停止");

// ── P2-0 地基：命令集与双可选参数回归 ───────────────────────────
eq(matchCitePrefix("\\autocite[see][p.~10]{doe"), true, "autocite 双参数内可触发补全");
eq(matchCitePrefix("\\parencite{x"), true, "parencite 可触发补全");
eq(matchCitePrefix("\\textcite*{x"), true, "textcite 星号变体可触发补全");
eq(matchCitePrefix("\\cite{x"), true, "原有 \\cite 不退化");
eq(matchCitePrefix("plain text"), false, "普通文本不误判");
CITE_FULL_RE.lastIndex = 0;
const m1 = CITE_FULL_RE.exec("\\autocite[see][p.~10]{doe2020deep,smith2021}");
eq(m1?.[2], "doe2020deep,smith2021", "完整命令捕获组 2 = key 列表（双参数）");
CITE_FULL_RE.lastIndex = 0;
const m2 = CITE_FULL_RE.exec("\\textcite*{roe2019}");
eq(m2?.[1], "*", "星号捕获组 1 保留");
CITE_FULL_RE.lastIndex = 0;
const scanned = scanCitesForIndex(
  "\\cite{a}\n\\autocite[see][p.~10]{b,c}\n\\parencite*{d}\n\\nocite{*}\n\\textcite{e}",
);
eq(scanned.length, 5, "lint/反向引用扫描覆盖新旧命令与多 key");
eq(scanned.map((x) => x.key).join(","), "a,b,c,d,e", "跳过 \\nocite{*} 通配");
eq(scanned[1].line, 2, "行号正确");

console.log(`\n${failures === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${total - failures}/${total}`);
if (failures > 0) process.exit(1);
