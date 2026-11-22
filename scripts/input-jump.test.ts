// M1-43 引入文件命令规格表纯逻辑单测
// 运行：node --experimental-strip-types scripts/input-jump.test.ts
import {
  createTargetFor,
  inputCmdKeys,
  inputCmdSpec,
  splitTargetDir,
  type InputCmdSpec,
} from "../src/editor/inputSpec.ts";

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

console.log("\n[inputCmdSpec 命令规格]");
eq(inputCmdSpec("input")?.createable, true, "\\input 可创建");
eq(inputCmdSpec("include")?.createable, true, "\\include 可创建");
eq(inputCmdSpec("subfile")?.createable, true, "\\subfile 可创建");
eq(inputCmdSpec("lstinputlisting")?.createable, true, "\\lstinputlisting 可创建");
eq(inputCmdSpec("verbatiminput")?.createable, true, "\\verbatiminput 可创建");
eq(inputCmdSpec("bibliography")?.createExt, ".bib", "\\bibliography 补 .bib");
eq(inputCmdSpec("addbibresource")?.createable, true, "\\addbibresource 可创建");
eq(inputCmdSpec("includegraphics")?.createable, false, "\\includegraphics 不可创建");
eq(inputCmdSpec("documentclass")?.createable, false, "\\documentclass 不可创建");
eq(inputCmdSpec("usepackage"), null, "\\usepackage 不参与跳转（用户指令去除）");
eq(inputCmdSpec("unknowncmd"), null, "未收录命令返回 null");
eq(inputCmdSpec("INPUT")?.createable, true, "命令名大小写不敏感");
eq(
  JSON.stringify(inputCmdSpec("includegraphics")?.suffixes),
  JSON.stringify(["", ".png", ".jpg", ".jpeg", ".pdf", ".eps"]),
  "图片命令后缀候选序列",
);

console.log("\n[inputCmdKeys 正则安全性]");
const keys = inputCmdKeys();
check(keys.includes("includegraphics") && keys.includes("include"), "include 与 includegraphics 都在表中");
check(
  keys.length === new Set(keys.map((k) => k.toLowerCase())).size,
  "键无大小写冲突",
);

const TEX: InputCmdSpec = inputCmdSpec("input")!;
const BIB: InputCmdSpec = inputCmdSpec("bibliography")!;
const IMG: InputCmdSpec = inputCmdSpec("includegraphics")!;

console.log("\n[createTargetFor 创建目标整理]");
eq(createTargetFor("sections/exps", TEX), "sections/exps.tex", "无后缀 tex 目标补 .tex");
eq(createTargetFor("sections/exps.tex", TEX), "sections/exps.tex", "已带后缀原样保留");
eq(createTargetFor(".\\sections\\exps", TEX), "sections/exps.tex", "反斜杠与 ./ 前缀归一");
eq(createTargetFor(" sections/exps ", TEX), "sections/exps.tex", "首尾空白 trim");
eq(createTargetFor("refs", BIB), "refs.bib", "bibliography 无后缀补 .bib");
eq(createTargetFor("refs.bib", BIB), "refs.bib", "addbibresource 已带 .bib 原样");
eq(createTargetFor("figures/fig", IMG), null, "图片命令不可创建");
eq(createTargetFor("a,b", BIB), null, "多目标（逗号）不可创建");
eq(createTargetFor("dir/", TEX), null, "以 / 结尾不可创建");
eq(createTargetFor("", TEX), null, "空目标不可创建");
eq(createTargetFor("exps.", TEX), null, "终段以点结尾不可创建（validateName 必拒）");
eq(createTargetFor("data/list.txt", TEX), "data/list.txt", "lstinputlisting 任意后缀目标原样创建");
eq(createTargetFor("chap 01", TEX), "chap 01.tex", "名字中间空格允许（创建时由 validateName 把关）");

console.log("\n[splitTargetDir 目录拆分]");
eq(splitTargetDir("sections/exps.tex").dirRel, "sections", "拆出父目录");
eq(splitTargetDir("sections/exps.tex").name, "exps.tex", "拆出最终段名");
eq(splitTargetDir("exps.tex").dirRel, "", "无父目录返回空串");
eq(splitTargetDir("exps.tex").name, "exps.tex", "无父目录时名字即全路径");

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
