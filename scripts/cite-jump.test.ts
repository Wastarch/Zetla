// M1-14d · \cite 点击跳转纯逻辑单测（仅依赖无 @/ 别名的 citeLogic.ts，可在 Node 直接跑）
// 重点验证：① 多行文档上 findCiteKeyAt 返回「绝对位置」（早期相对列号 bug 已修）
//          ② findCiteKeyForJump 在点击 key / 命令前缀 / 括号 时分别命中正确
// 运行：node --experimental-strip-types scripts/cite-jump.test.ts
import { EditorState } from "@codemirror/state";
import { findCiteKeyAt, findCiteKeyForJump } from "../src/modules/reference/citeLogic.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}

// 多行文档：cite 在第 3 行，用于验证绝对位置（line.from > 0）
const docText = "Line 1 text\nLine 2 text\nSee \\cite{Foo, Bar2020, Baz} end";
const editorDoc = EditorState.create({ doc: docText }).doc;
const line3 = editorDoc.line(3);
const base = line3.from;

console.log("== 多行文档 findCiteKeyAt 返回绝对位置 ==");
{
  const at = line3.text.indexOf("Bar2020") + 2; // 命中中间 key 中段
  const pos = base + at;
  const r = findCiteKeyAt(editorDoc, pos);
  check(r?.key === "Bar2020", "多行上命中中间 key Bar2020");
  check(
    r != null && r.from === base + line3.text.indexOf("Bar2020"),
    "from 为绝对位置（含 line.from 偏移）",
  );
  check(
    r != null && r.to === base + line3.text.indexOf("Bar2020") + "Bar2020".length,
    "to 为绝对位置",
  );
}
{
  // 把同一 pos 误当成相对列号会比较失败（早期 bug 复现：用 line 1 的 from=0 时的列号）
  const at = line3.text.indexOf("Foo") + 1;
  const pos = base + at;
  const r = findCiteKeyAt(editorDoc, pos);
  check(r?.key === "Foo", "多行上命中首个 key Foo（非被相对列号误判）");
}

console.log("\n== findCiteKeyForJump：点击点不同位置 ==");
// 1) 点击在具体 key 上 → 精确该 key
{
  const at = line3.text.indexOf("Baz") + 1;
  const r = findCiteKeyForJump(editorDoc, base + at);
  check(r?.key === "Baz", "点在 Baz 上 → 精确命中 Baz");
}
// 2) 点在 \cite 前缀上 → 取首个 key
{
  const at = line3.text.indexOf("\\cite") + 2;
  const r = findCiteKeyForJump(editorDoc, base + at);
  check(r?.key === "Foo", "点在 \\cite 前缀上 → 取首个 key Foo");
}
// 3) 点在开括号 { 上 → 取首个 key
{
  const at = line3.text.indexOf("{") + 1;
  const r = findCiteKeyForJump(editorDoc, base + at);
  check(r?.key === "Foo", "点在 { 上 → 取首个 key Foo");
}
// 4) 点在 key 之间的逗号上（命令内、不在具体 key 上）→ 取首个 key
{
  const at = line3.text.indexOf(",");
  const r = findCiteKeyForJump(editorDoc, base + at);
  check(r?.key === "Foo", "点在 key 间逗号上 → 取首个 key Foo");
}
// 5) 点在命令外（行首 "See "）→ null
{
  const r = findCiteKeyForJump(editorDoc, base + 1);
  check(r === null, "点在命令外 → 不命中（回落 synctex）");
}
// 6) 另一个 doc：\citep[opt]{KeyA} 点击前缀跳 KeyA
{
  const d2 = EditorState.create({ doc: "x \\citep[opt]{KeyA} y" }).doc;
  const at = d2.line(1).text.indexOf("\\citep") + 3;
  const r = findCiteKeyForJump(d2, at);
  check(r?.key === "KeyA", "带可选参数 \\citep[opt]{KeyA} 点击前缀 → KeyA");
}

console.log(
  failures === 0
    ? "\n✅ 全部断言通过：M1-14d 跳转定位（绝对位置 + 命令内任意点命中）正确。"
    : `\n❌ ${failures} 条断言失败。`,
);
process.exit(failures === 0 ? 0 : 1);
