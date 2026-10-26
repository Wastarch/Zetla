// M1-14e · 校验纯逻辑单测（Node 直接跑，无需别名）：node --experimental-strip-types scripts/lint.test.ts
import { Text } from "@codemirror/state";
import { parseBib } from "../src/modules/reference/bibParser.ts";
import {
  collectDuplicateKeyDiags,
  collectMissingCiteDiags,
  locateKeyInDoc,
} from "../src/modules/reference/lintLogic.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

// ── 1) 重复 key 定位 + 计数 ──────────────────────────────────────────────
console.log("\n== 1) .bib 重复 key 诊断 ==");
const bib = `@article{Smith2020,
  title = {A}
}
@book{Smith2020,
  title = {B}
}
@article{Zhang2019,
  title = {C}
}`;
const bibDoc = Text.of(bib.split("\n"));
const bibEntries = parseBib(bib, "test.bib");
check(bibEntries.length === 3, "解析出 3 个条目");
const dupKeys = new Set(["Smith2020"]);
const countOf = (k: string) => (k === "Smith2020" ? 2 : 1);
const dupDiags = collectDuplicateKeyDiags(bibDoc, bibEntries, dupKeys, countOf);
check(dupDiags.length === 2, "出现 2 条重复 key 诊断（两个 Smith2020）");
check(
  dupDiags.every((d) => d.message.includes("项目中出现 2 处")),
  "诊断含「项目中出现 2 处」计数",
);
const first = dupDiags[0];
const fromText = bibDoc.sliceString(first.from, first.to);
check(fromText === "Smith2020", `首个诊断定位到 key 文本「${fromText}」`);
check(first.from < first.to, "诊断 from < to");

// locateKeyInDoc 边界：key 在 @type{ 同行
const pos = locateKeyInDoc(bibDoc, 4, "Smith2020"); // 第 4 行是第二个 Smith2020
check(!!pos && bibDoc.sliceString(pos.from, pos.to) === "Smith2020", "locateKeyInDoc 命中第二处 Smith2020");

// ── 2) 引用缺失检测（含空 / 通配）──────────────────────────────────────
console.log("\n== 2) .tex 引用缺失诊断 ==");
const tex = [
  "本文引用 \\cite{Defined} 与 \\cite{Missing} 两个文献。",
  "空引用 \\cite{} 应告警，通配 \\nocite{*} 应跳过。",
  "多 key：\\citep[见][p.5]{Defined, AlsoMissing} 与合法 \\cite{Defined}。",
].join("\n");
const texDoc = Text.of(tex.split("\n"));
const known = new Set(["Defined"]);
const missDiags = collectMissingCiteDiags(texDoc, known);
const texts = missDiags.map((d) => texDoc.sliceString(d.from, d.to));
console.log("  命中 key：", JSON.stringify(texts));
check(missDiags.some((d) => texDoc.sliceString(d.from, d.to) === "Missing"), "标红缺失 key Missing");
check(missDiags.some((d) => texDoc.sliceString(d.from, d.to) === "AlsoMissing"), "标红多 key 中的 AlsoMissing");
check(!missDiags.some((d) => texDoc.sliceString(d.from, d.to) === "Defined"), "已定义的 Defined 不被标红");
check(
  missDiags.some((d) => d.message.includes("空的")),
  "空 \\cite{} 被标「未引用任何 key」",
);
check(
  !missDiags.some((d) => texDoc.sliceString(d.from, d.to) === "*"),
  "\\nocite{*} 的通配 * 不被标红",
);
check(
  missDiags.every((d) => d.from < d.to),
  "所有缺失诊断 from < to",
);

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
