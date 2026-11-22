// 大纲扫描纯逻辑单测（注释跳过 + \input 就地递归排序）
// 运行：node --experimental-strip-types scripts/outline-scan.test.ts
import {
  cleanTitle,
  isCommented,
  resolveInput,
  scanOutlineDocs,
  type OutlineItem,
} from "../src/outline/outlineScan.ts";

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

// 内存文件系统
function vfs(files: Record<string, string>) {
  return async (p: string) =>
    p in files ? { content: files[p] } : null;
}

console.log("\n[isCommented]");
eq(isCommented("% \\part{X}", 2), true, "行首注释内的下标判为注释");
eq(isCommented("text % \\section{Y}", 7), true, "同行 % 之后的下标判为注释");
eq(isCommented("a\\%b \\section{Y}", 5), false, "转义 \\% 不算注释起点");
eq(isCommented("plain \\section{Y}", 6), false, "无注释不误判");
eq(isCommented("ok\n% c\n\\section{Z}", 11), false, "跨行后新行不受上行注释影响");

console.log("\n[resolveInput]");
eq(resolveInput("E:\\p", "chapters/chapter0"), "E:\\p\\chapters\\chapter0.tex", "缺后缀补 .tex（Windows 分隔）");
eq(resolveInput("E:\\p", "refs.bib"), "E:\\p\\refs.bib", "已有后缀不补");
eq(resolveInput("E:\\p", "a/../b"), "E:\\p\\b.tex", ".. 归一后仍按缺后缀补 .tex（既有口径）");

console.log("\n[cleanTitle]");
eq(cleanTitle("\\textbf{现代}宇宙学"), "现代宇宙学", "字体命令展平");
eq(cleanTitle("引言\\label{sec:intro}"), "引言", "\\label 去除");
eq(cleanTitle("A\\%B"), "A%B", "转义 % 保留");

console.log("\n[scanOutlineDocs · 注释跳过]");
{
  const main = [
    "% \\section{被注释的章节}",
    "\\section{真章节}",
    "text % \\subsection{行尾注释小节}",
    "\\part{真部分}",
  ].join("\n");
  const items = await scanOutlineDocs("E:\\m\\main.tex", vfs({ "E:\\m\\main.tex": main }));
  eq(items.length, 2, "注释里的章节命令不收录（3 个假条目被跳过）");
  eq(items[0]?.title, "真章节", "第一条为真章节");
  eq(items[1]?.title, "真部分", "第二条为真部分");
}

console.log("\n[scanOutlineDocs · 注释里的 \\input 不递归]");
{
  const main = [
    "% \\input{ghost}",
    "\\input{real}",
  ].join("\n");
  const items = await scanOutlineDocs(
    "E:\\m\\main.tex",
    vfs({
      "E:\\m\\main.tex": main,
      "E:\\m\\ghost.tex": "\\section{幽灵}",
      "E:\\m\\real.tex": "\\section{真实}",
    }),
  );
  eq(items.length, 1, "只有 real.tex 被递归");
  eq(items[0]?.title, "真实", "ghost.tex 未进大纲");
}

console.log("\n[scanOutlineDocs · 文档位置交错排序（用户反馈 bug 2）]");
{
  // 模拟截图场景：主文件 \part 夹在多个 \input 之间
  const main = [
    "\\documentclass{book}",
    "\\begin{document}",
    "\\input{chapters/chapter0}",
    "\\part{数学基础}",
    "\\input{chapters/chapter1}",
    "\\input{chapters/chapter2}",
    "\\part{现代宇宙学}",
    "\\input{chapters/chapter3}",
    "\\end{document}",
  ].join("\n");
  const files: Record<string, string> = { "E:\\m\\main.tex": main };
  for (let i = 0; i <= 3; i++) {
    files[`E:\\m\\chapters\\chapter${i}.tex`] = `\\section{第${i}章标题}`;
  }
  const items = await scanOutlineDocs("E:\\m\\main.tex", vfs(files));
  const seq = items.map((it: OutlineItem) => it.title);
  eq(seq.length, 6, "4 章 + 2 part 共 6 条");
  // 文档真实顺序：chapter0 → part数学基础 → chapter1 → chapter2 → part现代宇宙学 → chapter3
  eq(
    seq.join("|"),
    "第0章标题|数学基础|第1章标题|第2章标题|现代宇宙学|第3章标题",
    "\\part 按文档位置与章节内容交错（不再整体前置于子文件条目）",
  );
  eq(items[1]?.file, "E:\\m\\main.tex", "part 条目归属主文件");
  eq(items[1]?.level, 0, "part 层级 0");
  eq(items[0]?.line, 1, "chapter0 条目行号在其自身文件内为 1");
}

console.log("\n[scanOutlineDocs · 同文件去重 + include 花括号形式]");
{
  const main = "\\include{dup}\n\\input{dup}";
  const items = await scanOutlineDocs(
    "E:\\m\\main.tex",
    vfs({
      "E:\\m\\main.tex": main,
      "E:\\m\\dup.tex": "\\section{只来一次}",
    }),
  );
  eq(items.length, 1, "同一文件重复引用只扫一次（visited）");
}

console.log("\n[scanOutlineDocs · 花括号形式整体消费，spec 内文字不当命令]");
{
  const main = "\\input{weird}\n\\section{真章节}";
  const items = await scanOutlineDocs(
    "E:\\m\\main.tex",
    vfs({
      "E:\\m\\main.tex": main,
      "E:\\m\\weird.tex": "\\section{weird 章节}",
    }),
  );
  eq(items.length, 2, "weird 递归 + 主文件章节");
  eq(items[0]?.title, "weird 章节", "花括号形式的 \\input 正常递归");
  eq(items[1]?.title, "真章节", "主文件章节照常收录");
}

console.log("\n[scanOutlineDocs · 空格形式 \\input foo]");
{
  const items = await scanOutlineDocs(
    "E:\\m\\main.tex",
    vfs({
      "E:\\m\\main.tex": "\\input plain",
      "E:\\m\\plain.tex": "\\section{plain 章}",
    }),
  );
  eq(items.length, 1, "空格形式 \\input 仍可解析");
  eq(items[0]?.title, "plain 章", "空格形式递归正确");
}

console.log(`\n${failures === 0 ? "✅" : "❌"} 全部断言${failures === 0 ? "通过" : `失败 ${failures}/${total}`}：大纲扫描纯逻辑（注释跳过/注释 input 不递归/文档交错排序/去重/清洗）。`);
if (failures > 0) process.exit(1);
