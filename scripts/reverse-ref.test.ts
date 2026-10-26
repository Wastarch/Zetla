// M1-14g · 反向引用纯逻辑单测（Node 直跑）
// 覆盖 scanCitesForIndex：多命令/多 key/可选参数/空/nocite{*}/多行行号/重复 key。
// 运行：node --experimental-strip-types scripts/reverse-ref.test.ts
import { scanCitesForIndex } from "../src/modules/reference/lintLogic.ts";

let pass = 0;
let fail = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string): void {
  check(JSON.stringify(a) === JSON.stringify(b), `${msg}（got ${JSON.stringify(a)}）`);
}

console.log("== 样本 1：基础 \\cite 与多 key ==");
{
  const c = scanCitesForIndex("正文 \\cite{Peierls1935} 结束\n再来 \\cite{A,B, C}");
  eq(
    c,
    [
      { key: "Peierls1935", line: 1 },
      { key: "A", line: 2 },
      { key: "B", line: 2 },
      { key: "C", line: 2 },
    ],
    "基础 + 多 key（含空格）解析正确",
  );
}

console.log("\n== 样本 2：可选参数 / 各种命令 ==");
{
  const c = scanCitesForIndex(
    [
      "\\citep[see][p.5]{Smith2020}",
      "\\citet{Jones}",
      "\\citeauthor{Brown}",
      "\\citeyearpar{Doe1999}",
      "\\cite*{Starred}",
    ].join("\n"),
  );
  eq(
    c,
    [
      { key: "Smith2020", line: 1 },
      { key: "Jones", line: 2 },
      { key: "Brown", line: 3 },
      { key: "Doe1999", line: 4 },
      { key: "Starred", line: 5 },
    ],
    "多可选参数与各命令变体均命中",
  );
}

console.log("\n== 样本 3：空 / nocite{*} / 通配跳过 ==");
{
  const c = scanCitesForIndex("\\cite{}\n\\nocite{*}\n\\nocite{Key1}");
  eq(c, [{ key: "Key1", line: 3 }], "空与 nocite{*} 跳过，nocite{Key1} 计入");
}

console.log("\n== 样本 4：多行行号（1-based） ==");
{
  const doc = [
    "% 标题",
    "",
    "\\section{引言}",
    "这是 \\cite{L1} 与 \\cite{L2}。",
    "",
    "尾部 \\citep[见]{L3,L4}",
  ].join("\n");
  eq(
    scanCitesForIndex(doc),
    [
      { key: "L1", line: 4 },
      { key: "L2", line: 4 },
      { key: "L3", line: 6 },
      { key: "L4", line: 6 },
    ],
    "行号准确（跨空行）",
  );
}

console.log("\n== 样本 5：同一 key 多次出现均保留 ==");
{
  const c = scanCitesForIndex("\\cite{X} ... \\cite{X}");
  eq(
    c,
    [
      { key: "X", line: 1 },
      { key: "X", line: 1 },
    ],
    "同一行重复引用保留两条（反向引用需全部位置）",
  );
}

console.log("\n== 样本 6：CRLF 换行 ==");
{
  const c = scanCitesForIndex("\\cite{A}\r\n\\cite{B}");
  eq(
    c,
    [
      { key: "A", line: 1 },
      { key: "B", line: 2 },
    ],
    "CRLF 正确分行",
  );
}

console.log("\n== 样本 7：无引用 ==");
{
  eq(scanCitesForIndex("纯文本，没有命令"), [], "无引用返回空数组");
}

// 模拟 store 的聚合逻辑（citesByKey 构建）：多文件 + 多 key
console.log("\n== 样本 8：跨文件聚合（模拟 citesByKey） ==");
{
  const files: Record<string, string> = {
    "a.tex": "\\cite{Shared,OnlyA}",
    "b.tex": "\\cite{Shared}\n\\cite{Shared}",
  };
  const map = new Map<string, { file: string; line: number }[]>();
  for (const [file, content] of Object.entries(files)) {
    for (const c of scanCitesForIndex(content)) {
      const arr = map.get(c.key) ?? [];
      arr.push({ file, line: c.line });
      map.set(c.key, arr);
    }
  }
  eq(
    map.get("Shared"),
    [
      { file: "a.tex", line: 1 },
      { file: "b.tex", line: 1 },
      { file: "b.tex", line: 2 },
    ],
    "Shared 聚合到 3 处（跨文件）",
  );
  eq(map.get("OnlyA"), [{ file: "a.tex", line: 1 }], "OnlyA 仅 1 处");
  eq(map.get("Nope") ?? null, null, "未引用 key 不存在");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
