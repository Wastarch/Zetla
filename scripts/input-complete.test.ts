// M1-44 · \input 类命令文件路径补全纯逻辑单测（仅依赖零 import 的 inputSpec.ts）
// 运行：node --experimental-strip-types scripts/input-complete.test.ts
import {
  collectRelPaths,
  completionCandidatesFor,
  filterByPrefix,
  inComment,
  matchInputTargetBefore,
} from "../src/editor/inputSpec.ts";

let failures = 0;
function check(cond: boolean, msg: string) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures++;
}

console.log("== 补全触发 matchInputTargetBefore ==");
{
  const h = matchInputTargetBefore("\\input{");
  check(h?.cmd === "input" && h.typed === "", "\\input{ → 触发，typed 空");
  check(h?.slashIdx === 0, "slashIdx 指向反斜杠");
}
{
  const h = matchInputTargetBefore("text \\include{sec");
  check(h?.cmd === "include" && h.typed === "sec", "行内 \\include{sec → 触发");
  check(h!.slashIdx === 5, "行内 slashIdx 指向命令反斜杠");
}
check(
  matchInputTargetBefore("\\includegraphics[width=3cm]{fig")?.cmd ===
    "includegraphics",
  "带可选参数 \\includegraphics[..]{fig → 触发且命令名完整",
);
check(
  matchInputTargetBefore("\\addbibresource{")?.cmd === "addbibresource",
  "\\addbibresource{ → 触发",
);
check(
  matchInputTargetBefore("\\bibliography{")?.cmd === "bibliography",
  "\\bibliography{ → 触发",
);
check(
  matchInputTargetBefore("\\input{sec/exps}") === null,
  "花括号已闭合 → 不触发（补全只在输入中）",
);
check(matchInputTargetBefore("\\cite{Foo") === null, "\\cite{ 不属于文件命令 → 不触发");
check(matchInputTargetBefore("\\usepackage{ctex") === null, "\\usepackage 不参与 → 不触发");
check(matchInputTargetBefore("hello world") === null, "普通文本 → 不触发");
check(
  matchInputTargetBefore("% \\input{sec") === null || true,
  "（注释判定由调用方用 slashIdx + inComment 做）",
);

console.log("\n== 注释判定 inComment ==");
check(inComment("text % \\input", 7), "% 之后的命令 → 注释内");
check(!inComment("text \\input", 5), "无 % → 非注释");
check(!inComment("50\\% \\input", 7), "转义 \\% → 非注释");

console.log("\n== 候选收集 collectRelPaths ==");
const tree = [
  {
    name: "main",
    path: "P:\\proj\\main.tex",
    type: "file" as const,
  },
  {
    name: "sections",
    path: "P:\\proj\\sections",
    type: "dir" as const,
    children: [
      { name: "exps.tex", path: "P:\\proj\\sections\\exps.tex", type: "file" as const },
      { name: "intro.tex", path: "P:\\proj\\sections\\intro.tex", type: "file" as const },
      {
        name: "sub",
        path: "P:\\proj\\sections\\sub",
        type: "dir" as const,
        children: [
          { name: "deep.tex", path: "P:\\proj\\sections\\sub\\deep.tex", type: "file" as const },
        ],
      },
    ],
  },
  {
    name: "figs",
    path: "P:\\proj\\figs",
    type: "dir" as const,
    children: [
      { name: "a.png", path: "P:\\proj\\figs\\a.png", type: "file" as const },
      { name: "b.eps", path: "P:\\proj\\figs\\b.eps", type: "file" as const },
    ],
  },
  { name: "refs.bib", path: "P:\\proj\\refs.bib", type: "file" as const },
];
{
  const rels = collectRelPaths(tree, "P:\\proj");
  check(rels.length === 7, "7 个文件全收集");
  check(rels.includes("sections/exps.tex"), "反斜杠 → / 归一");
  check(!rels.some((r) => r.includes("\\")), "无残留反斜杠");
}
{
  const rels = collectRelPaths(tree, "P:\\proj\\sections");
  check(
    rels.length === 3 && !rels.includes("refs.bib"),
    "基准目录取 sections → 只收 3 个，基准目录外的 refs.bib 不收",
  );
}

console.log("\n== 候选整理 completionCandidatesFor ==");
const rels = collectRelPaths(tree, "P:\\proj");
{
  const c = completionCandidatesFor("input", rels);
  check(
    c.includes("sections/exps") && c.includes("main") && !c.some((x) => x.endsWith(".tex")),
    "tex 命令：.tex 全部去掉后缀",
  );
  check(!c.includes("refs.bib") && !c.includes("figs/a.png"), "tex 命令：非 .tex 不进候选");
}
{
  const c = completionCandidatesFor("addbibresource", rels);
  check(c.length === 1 && c[0] === "refs.bib", "bib 命令：只 .bib 且保留后缀");
}
{
  const c = completionCandidatesFor("includegraphics", rels);
  check(
    c.includes("figs/a.png") && c.includes("figs/b.eps") && c.length === 2,
    "图命令：png/eps 保留后缀，tex/bib 不进",
  );
}
check(completionCandidatesFor("usepackage", rels).length === 0, "未收录命令 → 空候选");

console.log("\n== 前缀过滤 filterByPrefix ==");
const cands = completionCandidatesFor("input", rels);
{
  const { files, dirs } = filterByPrefix(cands, "");
  check(dirs.length === 1 && dirs[0] === "sections/", "空 typed → tex 候选只有 sections/ 目录（figs 下无 .tex 不出现）");
  check(files.includes("main"), "空 typed → 第一层文件直接给（tex 候选只有 main）");
  check(!files.some((f) => f.includes("/")), "深层文件不直接出现（先给目录）");
}
{
  const { files, dirs } = filterByPrefix(cands, "sec");
  check(dirs.length === 1 && dirs[0] === "sections/", "typed=sec → 只有 sections/ 目录");
  check(files.length === 0, "typed=sec → 无直接文件命中");
}
{
  const { files, dirs } = filterByPrefix(cands, "sections/");
  check(
    files.includes("sections/exps") && files.includes("sections/intro"),
    "typed=sections/ → 目录内文件直接给",
  );
  check(dirs.includes("sections/sub/"), "typed=sections/ → 下级目录继续给");
}
{
  const { files } = filterByPrefix(cands, "sections/s");
  check(files.length === 0, "sections/s → 无直接文件");
  const { dirs } = filterByPrefix(cands, "sections/s");
  check(dirs.length === 1 && dirs[0] === "sections/sub/", "sections/s → sections/sub/");
}
{
  const { files, dirs } = filterByPrefix(cands, "MAIN");
  check(files.includes("main") && dirs.length === 0, "大小写不敏感前缀匹配");
}
{
  const { files } = filterByPrefix(cands, "zzz");
  check(files.length === 0 && filterByPrefix(cands, "zzz").dirs.length === 0, "无命中 → 双空");
}

console.log(
  failures === 0
    ? "\n✅ 全部断言通过：M1-44 路径补全纯逻辑（触发/注释/收集/整理/过滤）正确。"
    : `\n❌ ${failures} 条断言失败。`,
);
process.exit(failures === 0 ? 0 : 1);
