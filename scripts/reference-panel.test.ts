// M1-14f · 校验汇总纯逻辑单测（Node 直接跑）：node --experimental-strip-types scripts/reference-panel.test.ts
import { Text } from "@codemirror/state";
import type { BibEntry } from "../src/modules/reference/bibParser.ts";
import {
  firstDuplicateEntry,
  summarizeMissingCites,
} from "../src/modules/reference/lintLogic.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// ── firstDuplicateEntry ──────────────────────────────────────
{
  const mk = (key: string, line: number, file = "refs.bib"): BibEntry => ({
    type: "article",
    key,
    fields: {},
    line,
    file,
  });
  const entries = [mk("A", 1), mk("B", 5), mk("A", 9)];

  const hit = firstDuplicateEntry(entries, new Set(["A"]));
  check(!!hit && hit.file === "refs.bib" && hit.line === 1, "首个重复 key 命中第 1 行 A");

  const none = firstDuplicateEntry(entries, new Set(["Z"]));
  check(none === null, "无重复 key 时返回 null");
}

// ── summarizeMissingCites ────────────────────────────────────
const known = new Set(["Smith2020", "Lee2019"]);

function tex(path: string, ...lines: string[]) {
  return { path, doc: Text.of(lines) };
}

{
  // a.tex：全部已定义 → 0 缺失
  const a = tex("a.tex", "intro \\cite{Smith2020}", "see \\citep{Lee2019}");
  // b.tex：两个缺失 + 一个已定义 + 空引用 + nocite{*} 通配
  const b = tex(
    "b.tex",
    "\\cite{Gone2021}",
    "\\citep[见][p.5]{Lost2022, Smith2020}",
    "\\cite{}",
    "\\nocite{*}",
  );
  const files = [a, b].sort((x, y) => (x.path < y.path ? -1 : 1));
  const sum = summarizeMissingCites(files, known);

  // 缺失：Gone2021、Lost2022、空 \cite{} → 共 3 处
  check(sum.count === 3, `缺失引用计数 = 3（实际 ${sum.count}）`);
  // 首个应为 b.tex 第 1 行（Gone2021）
  check(
    !!sum.first && sum.first.file === "b.tex" && sum.first.line === 1,
    "首个缺失定位到 b.tex 第 1 行",
  );
}

{
  // 确定性：顺序无关，首个始终落在排序后首含问题的文件
  const x = tex("z.tex", "\\cite{Nope}");
  const y = tex("a.tex", "\\cite{Smith2020}"); // 无缺失
  const sum = summarizeMissingCites([x, y].sort((p, q) => (p.path < q.path ? -1 : 1)), known);
  check(
    sum.count === 1 && sum.first?.file === "z.tex",
    "仅 z.tex 有缺失，首个定位 z.tex",
  );
}

{
  // 全定义场景
  const c = tex("c.tex", "\\cite{Smith2020}", "\\cite{Lee2019}");
  const sum = summarizeMissingCites([c], known);
  check(sum.count === 0 && sum.first === null, "全定义时 count=0 且 first=null");
}

console.log(`\n引用面板汇总逻辑：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
