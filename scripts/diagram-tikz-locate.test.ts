// M2 · 源码 ✎ 反向编辑：tikzpicture 环境定位纯逻辑单测（不 import store/editor/DOM）
import { findTikzEnvs } from "../src/modules/diagram/tikzLocate.ts";

let pass = 0;
let fail = 0;
function eq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
  }
}

const BEGIN = "\\begin{tikzpicture}";
const END = "\\end{tikzpicture}";

// 1. 单个环境：markAt 落在 \begin 之后，envText 是完整环境
{
  const doc = `before\n${BEGIN}\n  \\draw (0,0) -- (1,1);\n${END}\nafter`;
  const hits = findTikzEnvs(doc);
  eq(hits.length, 1, "单环境命中数");
  eq(hits[0].startLine, 2, "起始行号");
  eq(hits[0].endLine, 4, "结束行号");
  eq(hits[0].envText.startsWith(BEGIN), true, "envText 含开头定界符");
  eq(hits[0].envText.endsWith(END), true, "envText 含结尾定界符");
  eq(doc.slice(hits[0].markAt).startsWith("\n"), true, "markAt 在 \\begin 之后");
}

// 2. 带 [options]：markAt 落在 ] 之后
{
  const doc = `${BEGIN}[scale=2]\n\\node {A};\n${END}`;
  const hits = findTikzEnvs(doc);
  eq(hits.length, 1, "options 环境命中数");
  eq(doc.slice(hits[0].markAt).startsWith("\n"), true, "markAt 跳过 [options]");
  eq(hits[0].envText.includes("[scale=2]"), true, "envText 保留 options");
}

// 3. 多环境：按出现顺序，各自 markAt
{
  const doc = `${BEGIN}\\draw (0,0);${END}\ntext\n${BEGIN}\\node {B};${END}`;
  const hits = findTikzEnvs(doc);
  eq(hits.length, 2, "多环境命中数");
  if (hits.length === 2) {
    eq(hits[0].from < hits[1].from, true, "按出现顺序");
    eq(hits[0].markAt === hits[1].markAt, false, "两个 markAt 不同");
  }
}

// 4. 嵌套 tikzpicture：算一个环境（内层不单独成命中）
{
  const doc = `${BEGIN}\n${BEGIN}\\draw (0,0);${END}\n${END}`;
  const hits = findTikzEnvs(doc);
  eq(hits.length, 1, "嵌套只算外层一个环境");
  eq(hits[0].envText.endsWith(END), true, "外层 envText 闭合到最后一个 end");
}

// 5. 转义伪命令：前面带反斜杠的 \begin 不算
{
  const doc = `\\verb|${BEGIN}| real\n${BEGIN}\\draw (0,0);${END}`;
  const hits = findTikzEnvs(doc);
  eq(hits.length, 1, "转义的伪命令被跳过");
}

// 6. 残缺环境（无 end）：不成命中
{
  const doc = `${BEGIN}\n\\draw (0,0);\n`;
  eq(findTikzEnvs(doc).length, 0, "残缺环境不成命中");
}

// 7. 库收集：去重保序，写进每个命中
{
  const doc = `\\usetikzlibrary{arrows.meta,positioning}\n\\usetikzlibrary{arrows.meta}\n${BEGIN}\\draw (0,0);${END}`;
  const hits = findTikzEnvs(doc);
  eq(hits.length, 1, "库声明文档命中数");
  eq(hits[0].libraries.join(","), "arrows.meta,positioning", "库去重保序");
}

// 8. 空文档
eq(findTikzEnvs("").length, 0, "空文档无命中");

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
