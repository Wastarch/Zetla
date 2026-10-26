// M1-14b · 自写 BibTeX StreamLanguage 词法真实管线测试
// 用 CM6 真实解析管线：EditorState + ensureSyntaxTree 把示例 .bib 喂进 bibtexLanguage，
// 读出每个 token 的节点名，断言分词结果是否正确。
// 运行：node --experimental-strip-types scripts/bibtex-lexer.test.ts
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { bibtexLanguage, BIB_HIGHLIGHT } from "../src/editor/bibtex.ts";

interface Tok {
  from: number;
  to: number;
  name: string;
  text: string;
}

function tokenize(doc: string): Tok[] {
  const state = EditorState.create({ doc, extensions: [bibtexLanguage] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000_000) ?? syntaxTree(state);
  const top = tree.topNode.name;
  const toks: Tok[] = [];
  tree.iterate({
    enter(node) {
      const name = node.name;
      if (!name || name === "Document" || name === top) return;
      toks.push({ from: node.from, to: node.to, name, text: doc.slice(node.from, node.to) });
    },
  });
  return toks;
}

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log("  ✓ " + msg);
  } else {
    console.log("  ✗ " + msg);
    failures++;
  }
}

// 1) 基础单字段样本
const sample1 = `% a comment line
@article{Landau1937,
  author = {Landau, L. D. and Lifshitz, E. M.},
  title = "Quantum Mechanics",
  year = {1937},
  note = {See \\cite{Other} for details}
}`;

console.log("== 样本 1：标准条目分词 ==");
const t1 = tokenize(sample1);
console.log(
  t1
    .map((x) => `[${x.from}-${x.to}] ${x.name.padEnd(12)} ${JSON.stringify(x.text)}`)
    .join("\n"),
);

const has = (text: string, name: string) =>
  t1.some((x) => x.text === text && x.name === name);

check(has("article".length ? "% a comment line" : "", "comment"), "注释行 → comment");
check(has("@article", "keyword"), "@type → keyword");
check(has("Landau1937", "atom"), "引用 key → atom");
check(has("author", "variableName"), "字段名 author → variableName");
check(has("title", "variableName"), "字段名 title → variableName");
check(has("year", "variableName"), "字段名 year → variableName");
check(has("note", "variableName"), "字段名 note → variableName");
check(has("=", "operator"), "等号 → operator");
check(has("{Landau, L. D. and Lifshitz, E. M.}", "string"), "花括号值 → string");
check(has('"Quantum Mechanics"', "string"), '引号值 → string');
check(has("{1937}", "string"), "数字花括号值 → string");
check(has("{See \\cite{Other} for details}", "string"), "嵌套花括号值 → string");
check(has("{", "meta"), "开括号 → meta");
check(has("}", "meta"), "闭括号 → meta");

// 2) 跨行值 + 同页嵌套括号（验证 braceDepth 跨行/嵌套）
const sample2 = `@book{CrossLine2024,
  title = {A very long title that
    spans multiple lines of the source},
  editor = {First {Nested} Last}
}`;

console.log("\n== 样本 2：跨行 & 嵌套值 ==");
const t2 = tokenize(sample2);
console.log(
  t2
    .map((x) => `[${x.from}-${x.to}] ${x.name.padEnd(12)} ${JSON.stringify(x.text)}`)
    .join("\n"),
);

const valLine1 = t2.find(
  (x) => x.name === "string" && x.text.startsWith("{A very long title"),
);
const valLine2 = t2.find((x) => x.name === "string" && x.text.includes("source"));
check(!!valLine1, "跨行值首行整行识别为 string（含左花括号）");
check(!!valLine2, "跨行值续行整行识别为 string");
check(
  t2.some((x) => x.name === "meta" && x.text === "}"),
  "条目闭合右括号 } 正确识别为 meta（未被值吞掉）",
);

const nested = t2.find((x) => x.name === "string" && x.text.startsWith("{First"));
check(
  !!nested && nested.text === "{First {Nested} Last}",
  "嵌套花括号值 {First {Nested} Last} 整体识别为 string",
);

// 3) 跨行 + 跨行嵌套花括号（验证续行逐字符跟踪 braceDepth）
const sample3 = `@misc{NestedX,
  note = {outer {inner
    still inner} outer}
}`;

console.log("\n== 样本 3：跨行嵌套花括号 ==");
const t3 = tokenize(sample3);
console.log(
  t3
    .map((x) => `[${x.from}-${x.to}] ${x.name.padEnd(12)} ${JSON.stringify(x.text)}`)
    .join("\n"),
);

check(
  t3.some((x) => x.name === "string" && x.text.includes("outer {inner")),
  "跨行嵌套值首行整行为 string",
);
check(
  t3.some((x) => x.name === "string" && x.text.includes("still inner} outer}")),
  "跨行嵌套值续行整行为 string（含中途闭合的内层括号）",
);
// 关键：条目最后的 } 必须是 meta，而非被误判为值的一部分
const last = t3[t3.length - 1];
check(
  last.name === "meta" && last.text === "}",
  "条目闭合右括号 } 为 meta（跨行嵌套后 value 已正确闭合）",
);

// 3) 高亮配置健全性
console.log("\n== BIB_HIGHLIGHT 配置 ==");
check(!!BIB_HIGHLIGHT.light, "存在 light 高亮样式");
check(!!BIB_HIGHLIGHT.dark, "存在 dark 高亮样式");

console.log(
  failures === 0
    ? "\n✅ 全部断言通过：BibTeX 自写词法分词正确。"
    : `\n❌ ${failures} 条断言失败。`,
);
process.exit(failures === 0 ? 0 : 1);
