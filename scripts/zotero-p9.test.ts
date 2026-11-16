// Zotero 联动 · P9 BibTeX / biblatex 格式纯逻辑单测
// 运行：node --experimental-strip-types scripts/zotero-p9.test.ts
// 只 import 无 @/ 别名的纯逻辑模块（相对 import 带 .ts 后缀）
import {
  applyEngineSwitch,
  convertBibFormat,
  detectEffectiveFormat,
  mapFieldName,
  needsRename,
  normalizeBibFormat,
  planEngineSwitch,
  type BibFormatConfig,
} from "../src/modules/zotero/zoteroFormat.ts";
import type { BibEngine } from "../src/modules/zotero/zoteroStyleMap.ts";
import { bibtexEntryBlock } from "../src/modules/zotero/zoteroSync.ts";
import { zoteroFieldsFromItem } from "../src/modules/zotero/zoteroMerge.ts";
import type { ZoteroItem } from "../src/types/zotero.ts";

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

// ── [1] 字段别名映射 ─────────────────────────────────────────
console.log("\n[1] mapFieldName / needsRename");
eq(mapFieldName("journal", "biblatex"), "journaltitle", "journal → journaltitle");
eq(mapFieldName("year", "biblatex"), "date", "year → date");
eq(mapFieldName("journaltitle", "bibtex"), "journal", "journaltitle → journal");
eq(mapFieldName("date", "bibtex"), "year", "date → year");
eq(mapFieldName("title", "biblatex"), "title", "同名字段不变");
eq(mapFieldName("JOURNAL", "biblatex"), "journaltitle", "大小写不敏感，返回标准目标名");
eq(mapFieldName("eprint", "biblatex"), "eprint", "独有字段不变");
eq(needsRename("journal", "biblatex"), true, "journal 在 biblatex 需改名");
eq(needsRename("journaltitle", "biblatex"), false, "journaltitle 已是目标名");
eq(needsRename("title", "biblatex"), false, "同名字段不需改名");

// ── [2] 原地转换：BibTeX → biblatex ──────────────────────────
console.log("\n[2] convertBibFormat bibtex → biblatex");
const BIB_BIBTEX = `@article{doe2020,
  title = {Old Title},
  author = {Doe, John},
  year = {2020},
  journal = {J. Test},
  note = {Zotero itemKey: ABCD1234},
  eprint = {1234.5678}
}`;
const conv1 = convertBibFormat(BIB_BIBTEX, "biblatex");
check(conv1.text.includes("journaltitle = {J. Test}"), "journal 改名为 journaltitle");
check(conv1.text.includes("date = {2020}"), "year 改名为 date，值不变");
check(!/\byear\s*=/.test(conv1.text), "旧字段名 year 消失");
check(!/\bjournal\s*=/.test(conv1.text.replace("journaltitle", "")), "旧字段名 journal 消失");
check(conv1.text.includes("note = {Zotero itemKey: ABCD1234}"), "note 映射锚原样保留");
check(conv1.text.includes("eprint = {1234.5678}"), "独有字段 eprint 保留");
check(conv1.text.includes("@article{doe2020,"), "citekey 与条目类型不变");
eq(conv1.renamed["doe2020"]?.length, 2, "记录 2 个字段改名");
eq(Object.keys(conv1.conflicts).length, 0, "无冲突");

// ── [3] 原地转换：biblatex → BibTeX + 幂等 ───────────────────
console.log("\n[3] convertBibFormat biblatex → bibtex + 幂等");
const conv2 = convertBibFormat(conv1.text, "bibtex");
check(conv2.text.includes("journal = {J. Test}"), "journaltitle 改回 journal");
check(conv2.text.includes("year = {2020}"), "date 改回 year");
check(conv2.text === BIB_BIBTEX.replace(/\r?\n/g, "\n"), "双向转换回到原文（除换行归一）");
const conv3 = convertBibFormat(conv1.text, "biblatex");
eq(conv3.text, conv1.text, "已是目标格式 → 幂等不变");
eq(Object.keys(conv3.renamed).length, 0, "幂等时无改名记录");

// ── [4] 冲突保护：目标字段已存在 ─────────────────────────────
console.log("\n[4] 目标字段已存在时不覆盖");
const BIB_CONFLICT = `@article{x2020,
  year = {2020},
  date = {2020-05-01}
}`;
const conv4 = convertBibFormat(BIB_CONFLICT, "biblatex");
check(conv4.text.includes("date = {2020-05-01}"), "已有 date 值保留");
check(conv4.text.includes("year = {2020}"), "源字段 year 保留（不删不覆盖）");
check((conv4.conflicts["x2020"] ?? []).some((s) => s.includes("year")), "冲突记入 conflicts");

// ── [5] 多条目 + 引号值 + 嵌套花括号 ─────────────────────────
console.log("\n[5] 多条目 / 引号 / 嵌套花括号");
const BIB_MULTI = `@article{a2020,
  journal = "A {Journal} Name",
  year = {2020}
}

@inproceedings{b2021,
  title = {B {Nested {Title}}},
  journal = {B Journal}
}`;
const conv5 = convertBibFormat(BIB_MULTI, "biblatex");
check(conv5.text.includes('journaltitle = "A {Journal} Name"'), "引号+嵌套花括号值原样保留，只改字段名");
check(conv5.text.includes("title = {B {Nested {Title}}}"), "嵌套花括号的 title 不受影响");
eq(conv5.renamed["a2020"]?.length, 2, "条目 a 两字段改名");
eq(conv5.renamed["b2021"]?.length, 1, "条目 b 一字段改名");

// ── [6] effective 格式解析 ───────────────────────────────────
console.log("\n[6] detectEffectiveFormat");
type Eff = ReturnType<typeof detectEffectiveFormat>;
function eff(configured: BibFormatConfig, detected: BibEngine) {
  return detectEffectiveFormat(configured, detected) as Eff;
}
eq(eff("auto", "biblatex").effective, "biblatex", "auto 跟随检测 biblatex");
eq(eff("auto", "bibtex").effective, "bibtex", "auto 跟随检测 bibtex");
eq(eff("auto", "none").effective, null, "auto + none → 无生效格式");
eq(eff("auto", "none").needsChoice, true, "auto + none → 需用户选一次");
eq(eff("bibtex", "biblatex").effective, "bibtex", "锁定值优先于检测");
eq(eff("biblatex", "none").needsChoice, false, "锁定值即使检测不到也不提示");
eq(normalizeBibFormat("biblatex"), "biblatex", "归一合法值");
eq(normalizeBibFormat("weird"), "auto", "未知值回落 auto");
eq(normalizeBibFormat(undefined), "auto", "缺失值回落 auto");

// ── [7] 导言区引擎互转 ───────────────────────────────────────
console.log("\n[7] planEngineSwitch / applyEngineSwitch");
const TEX_BIBTEX = `\\documentclass{article}
\\usepackage{amsmath}
\\bibliographystyle{plain}

\\begin{document}
\\cite{doe2020}
\\bibliography{refs}
\\end{document}`;
const plan1 = planEngineSwitch(TEX_BIBTEX, "bibtex", "biblatex");
eq(plan1.ok, true, "bibtex → biblatex 规划成功");
eq(plan1.convertBib, true, "需同时转换 .bib");
check(plan1.edits.length >= 2, "至少两处补丁（移除 bst + 插入 usepackage）");
const tex1 = applyEngineSwitch(TEX_BIBTEX, plan1);
check(tex1.includes("\\usepackage{biblatex}"), "插入了 biblatex 宏包");
check(!tex1.includes("\\bibliographystyle"), "移除了 bibliographystyle");
check(tex1.includes("\\usepackage{amsmath}"), "其它宏包保留");
check(tex1.includes("\\begin{document}"), "document 环境保留");
check(tex1.includes("\\addbibresource{refs.bib}"), "\\bibliography{refs} 转为 \\addbibresource{refs.bib}");
check(tex1.includes("\\printbibliography"), "正文输出命令转为 \\printbibliography");
check(!tex1.includes("\\bibliography{refs}"), "旧 \\bibliography 命令消失");

const TEX_BIBLATEX = `\\documentclass{article}
\\usepackage[style=gb7714-2015]{biblatex}
\\addbibresource{refs.bib}

\\begin{document}
\\cite{doe2020}
\\end{document}`;
const plan2 = planEngineSwitch(TEX_BIBLATEX, "biblatex", "bibtex");
eq(plan2.ok, true, "biblatex → bibtex 规划成功");
const tex2 = applyEngineSwitch(TEX_BIBLATEX, plan2);
check(tex2.includes("\\bibliographystyle{plain}"), "插入了 bibliographystyle");
check(!/\\usepackage[^}]*biblatex/.test(tex2), "移除了 biblatex 宏包");
check(!tex2.includes("\\addbibresource"), "移除了 addbibresource");
check(tex2.includes("\\bibliography{refs}"), "\\addbibresource{refs.bib} 转为 \\bibliography{refs}");

// 已是目标引擎 → noop
const plan3 = planEngineSwitch(TEX_BIBLATEX, "biblatex", "biblatex");
eq(plan3.noop, true, "已是目标引擎 → noop");
eq(plan3.edits.length, 0, "noop 无补丁");
eq(applyEngineSwitch(TEX_BIBLATEX, plan3), TEX_BIBLATEX, "noop 应用后不变");

// none → 失败但标记需转 .bib
const plan4 = planEngineSwitch(TEX_BIBTEX, "none", "biblatex");
eq(plan4.ok, false, "引擎 none → 规划失败（不猜）");
eq(plan4.convertBib, true, "失败仍标记需转 .bib（字段可独立转换）");

// 多包并列时只移除 biblatex
const TEX_MULTI_PKG = `\\documentclass{article}
\\usepackage{amsmath,biblatex,graphicx}
\\begin{document}
\\end{document}`;
const plan5 = planEngineSwitch(TEX_MULTI_PKG, "biblatex", "bibtex");
const tex5 = applyEngineSwitch(TEX_MULTI_PKG, plan5);
check(tex5.includes("\\usepackage{amsmath,graphicx}"), "并列宏包只删 biblatex，其它保留");
check(!/\{[^}]*biblatex/.test(tex5), "biblatex 名字彻底移除");

// 正文已有 \printbibliography：切回 bibtex 时应就地替换，不再重复插入
const TEX_WITH_PRINT = `\\documentclass{article}
\\usepackage[style=apa]{biblatex}
\\begin{document}
\\printbibliography
\\end{document}`;
const plan6 = planEngineSwitch(TEX_WITH_PRINT, "biblatex", "bibtex");
const tex6 = applyEngineSwitch(TEX_WITH_PRINT, plan6);
check(tex6.includes("\\bibliography{refs}"), "printbibliography 转为 bibliography（默认 refs）");
eq((tex6.match(/\\bibliography\{/g) ?? []).length, 1, "只出一个 bibliography，不重复插入");
// 再切回 biblatex：bibliography 转 printbibliography + addbibresource
const plan7 = planEngineSwitch(tex6, "bibtex", "biblatex");
const tex7 = applyEngineSwitch(tex6, plan7);
check(tex7.includes("\\printbibliography"), "往返后回到 printbibliography");
check(tex7.includes("\\addbibresource{refs.bib}"), "往返后 addbibresource 恢复");

// ── [8] 导出按格式产出字段（P9-3 接线） ──────────────────────
console.log("\n[8] bibtexEntryBlock / zoteroFieldsFromItem 按格式产出");
const ITEM: ZoteroItem = {
  itemKey: "ABCD1234",
  itemType: "journalArticle",
  title: "A Title",
  authors: ["Doe, John"],
  year: "2020",
  publicationTitle: "J. Test",
  doi: "10.1/x",
  url: "",
  abstract: "",
  citationKey: "doe2020",
  dateAdded: "",
  dateModified: "",
};
const blockBtx = bibtexEntryBlock(ITEM, "doe2020", "bibtex");
const blockBlx = bibtexEntryBlock(ITEM, "doe2020", "biblatex");
check(blockBtx.includes("year = {2020}") && blockBtx.includes("journal = {J. Test}"), "bibtex 产出 year/journal");
check(blockBlx.includes("date = {2020}") && blockBlx.includes("journaltitle = {J. Test}"), "biblatex 产出 date/journaltitle");
check(!/year\s*=/.test(blockBlx) && !/journal\s*=/.test(blockBlx.replace("journaltitle", "")), "biblatex 块无旧字段名");
const fieldsBlx = zoteroFieldsFromItem(ITEM, "biblatex");
eq(fieldsBlx["date"], "2020", "字段表 biblatex date");
eq(fieldsBlx["journaltitle"], "J. Test", "字段表 biblatex journaltitle");
eq(fieldsBlx["year"], undefined, "字段表 biblatex 无 year");
const fieldsBtx = zoteroFieldsFromItem(ITEM, "bibtex");
eq(fieldsBtx["year"], "2020", "字段表 bibtex year");
eq(fieldsBtx["journal"], "J. Test", "字段表 bibtex journal");

console.log(`\n${total - failures}/${total} 通过`);
process.exit(failures === 0 ? 0 : 1);
