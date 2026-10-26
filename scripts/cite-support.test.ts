// M1-14c · \cite 补全/悬浮纯逻辑单测（仅依赖无 @/ 别名的 citeLogic.ts，可在 Node 直接跑）
// 运行：node --experimental-strip-types scripts/cite-support.test.ts
import { EditorState } from "@codemirror/state";
import type { BibEntry } from "../src/modules/reference/bibParser.ts";
import {
  matchCitePrefix,
  citeCompletionFrom,
  findCiteKeyAt,
  citeTooltipHtml,
} from "../src/modules/reference/citeLogic.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}

const sampleEntry: BibEntry = {
  type: "article",
  key: "Landau1937",
  fields: {},
  author: "Landau, L. D. and Lifshitz, E. M.",
  title: "Quantum Mechanics",
  year: "1937",
  line: 1,
  file: "refs.bib",
};

console.log("== 补全前缀匹配 matchCitePrefix ==");
check(matchCitePrefix("\\cite{"), "\\cite{ → 触发补全");
check(matchCitePrefix("text \\cite{"), "行内 \\cite{ → 触发");
check(matchCitePrefix("\\citep[pp. 1-10]{"), "带可选参数 \\citep[..]{ → 触发");
check(matchCitePrefix("\\citet{"), "\\citet{ → 触发");
check(!matchCitePrefix("\\section{"), "\\section{ → 不触发");
check(!matchCitePrefix("hello world"), "普通文本 → 不触发");
check(!matchCitePrefix("\\cite"), "无左括号 \\cite → 不触发");

console.log("\n== 补全起点 citeCompletionFrom ==");
{
  const tb = "\\cite{";
  check(
    citeCompletionFrom(tb, 0, tb.length) === tb.length,
    "光标注 { 后 → from 落在 { 之后（空前缀）",
  );
}
{
  const tb = "\\cite{La";
  check(
    citeCompletionFrom(tb, 0, tb.length) === tb.indexOf("L"),
    "已输入 La → from 落在 L",
  );
}
{
  const tb = "\\cite{Foo, Bar2020";
  const expect = tb.lastIndexOf("B");
  check(
    citeCompletionFrom(tb, 0, tb.length) === expect,
    "多 key 逗号后 → from 跳过逗号与空格落在 B",
  );
}

console.log("\n== 悬浮定位 findCiteKeyAt ==");
function citeAt(lineText: string, atKey: string): string | null {
  const pos = lineText.indexOf(atKey) + 2; // 命中 key 中段
  const doc = EditorState.create({ doc: lineText }).doc;
  const r = findCiteKeyAt(doc, pos);
  return r ? r.key : null;
}
check(citeAt("See \\cite{Landau1937} for details", "Landau1937") === "Landau1937", "单行 \\cite{Landau1937} 命中 key");
check(citeAt("\\cite{Foo, Bar2020, Baz}", "Bar2020") === "Bar2020", "多 key 逗号分隔命中中间 key");
check(citeAt("\\citep[opt]{KeyA}", "KeyA") === "KeyA", "带可选参数 \\citep[opt]{KeyA} 命中 key");
check(citeAt("hello world", "world") === null, "非 cite 文本 → 不命中");
check(citeAt("\\cite{Unk}", "Unk") === "Unk", "未知 key 也能定位（存在性由悬浮源判断）");

console.log("\n== 悬浮 HTML citeTooltipHtml ==");
{
  const html = citeTooltipHtml("Landau1937", sampleEntry, 1);
  check(html.includes("@article"), "已定义条目 → 含类型 @article");
  check(html.includes("Quantum Mechanics"), "已定义条目 → 含标题");
  check(html.includes("Landau, L. D."), "已定义条目 → 含作者");
  check(html.includes("refs.bib"), "已定义条目 → 含来源文件");
}
{
  const html = citeTooltipHtml("Nope", undefined, 0);
  check(html.includes("引用缺失") && html.includes("Nope"), "缺失 key → 标「引用缺失」");
}
{
  const html = citeTooltipHtml("Dup", sampleEntry, 2);
  check(html.includes("重复 key（2 处）"), "重复 key → 提示重复处数");
}

console.log(
  failures === 0
    ? "\n✅ 全部断言通过：M1-14c 纯逻辑（前缀匹配/补全起点/悬浮定位/HTML）正确。"
    : `\n❌ ${failures} 条断言失败。`,
);
process.exit(failures === 0 ? 0 : 1);
