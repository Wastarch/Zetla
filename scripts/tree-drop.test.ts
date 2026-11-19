// 项目树拖拽移动/复制的纯逻辑单测
// 运行：node --experimental-strip-types scripts/tree-drop.test.ts
import {
  dropProblem,
  isSameOrInside,
  parentDir,
  pathKey,
  resolveDropDir,
  uniqueCopyName,
} from "../src/project/treeDrop.ts";

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

console.log("\n[pathKey / isSameOrInside]");
eq(pathKey("E:\\P\\1\\a.tex"), "e:/p/1/a.tex", "斜杠方向与大小写归一等价");
eq(pathKey("E:\\P\\1\\"), "e:/p/1", "尾部分隔符不影响比较");
eq(pathKey("\\\\?\\E:\\P\\1"), "e:/p/1", "UNC 前缀归一");
eq(isSameOrInside("E:/P/1/a/b.tex", "E:\\P\\1"), true, "深层子路径命中父目录");
eq(isSameOrInside("E:/P/1", "E:/P/12"), false, "前缀相同但不是路径层级不误判");
eq(isSameOrInside("E:/P/1", "E:/P/1"), true, "同一路径算命中");

console.log("\n[parentDir / resolveDropDir]");
eq(parentDir("E:\\P\\1\\a.tex"), "E:\\P\\1", "反斜杠路径取父目录");
eq(parentDir("E:/P/a.tex"), "E:/P", "正斜杠路径取父目录");
eq(parentDir("a.tex"), "", "无父目录返回空串");
eq(
  resolveDropDir({ path: "E:/P/1", kind: "dir" }, "E:/P"),
  "E:/P/1",
  "落到目录行 → 该目录",
);
eq(
  resolveDropDir({ path: "E:/P/1/a.tex", kind: "file" }, "E:/P"),
  "E:/P/1",
  "落到文件行 → 文件所在目录",
);
eq(resolveDropDir({ path: "E:/P", kind: "blank" }, "E:/P"), "E:/P", "落到空白区 → 项目根");
eq(resolveDropDir(null, "E:/P"), "E:/P", "无命中 → 项目根");

console.log("\n[uniqueCopyName]");
eq(uniqueCopyName("1.tex", []), "1.tex", "无冲突保留原名");
eq(uniqueCopyName("1.tex", ["1.TEX"]), "1 - 副本.tex", "大小写冲突也避让");
eq(
  uniqueCopyName("1.tex", ["1.tex", "1 - 副本.tex"]),
  "1 - 副本2.tex",
  "二次冲突追加序号",
);
eq(uniqueCopyName("README", ["readme"]), "README - 副本", "无后缀名同样避让");
eq(uniqueCopyName(".gitignore", [".gitignore"]), ".gitignore - 副本", "点文件避让");

console.log("\n[dropProblem]");
eq(
  dropProblem("E:/P/1", "E:/P/1/sub", "move", true),
  "不能把文件夹放进它自己或它的子目录",
  "目录拖入子目录被拒",
);
eq(
  dropProblem("E:/P/1", "E:/P/1", "copy", true),
  "不能把文件夹放进它自己或它的子目录",
  "目录复制到自身被拒",
);
eq(
  dropProblem("E:/P/1/a.tex", "E:/P/1", "move", false),
  "文件已经在这个目录下",
  "移动回原目录视为无操作",
);
eq(dropProblem("E:/P/1/a.tex", "E:/P/1", "copy", false), null, "原地复制生成副本是允许的");
eq(dropProblem("E:/P/1/a.tex", "E:/P/2", "move", false), null, "跨目录移动允许");
eq(dropProblem("E:/P/1", "E:/P/2", "move", true), null, "目录移到兄弟目录允许");

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
