// 标签页右键菜单纯逻辑单测（M1-45）
// 运行：node --experimental-strip-types scripts/tab-ctx.test.ts
import {
  isRealFileTab,
  relativePathOf,
  tabCloseSets,
} from "../src/editor/tabCtx.ts";

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

console.log("\n[isRealFileTab]");
check(isRealFileTab("text") && isRealFileTab("image") && isRealFileTab("pdf"), "text/image/pdf 为真实文件 Tab");
check(!isRealFileTab("figure") && !isRealFileTab("diagram") && !isRealFileTab("settings"), "三个伪 buffer 非真实文件 Tab");

console.log("\n[relativePathOf]");
eq(relativePathOf("P:\\proj\\sections\\a.tex", "P:\\proj"), "sections\\a.tex", "根之下取相对（保留原分隔符）");
eq(relativePathOf("P:/proj/sections/a.tex", "P:\\proj\\"), "sections/a.tex", "根尾分隔符归一后仍命中");
eq(relativePathOf("p:\\PROJ\\a.tex", "P:\\proj"), "a.tex", "大小写不敏感判定、保留原样");
eq(relativePathOf("D:\\other\\a.tex", "P:\\proj"), "D:\\other\\a.tex", "根之外原样返回绝对路径");
eq(relativePathOf("P:\\proj\\a.tex", null), "P:\\proj\\a.tex", "无项目根原样返回");

console.log("\n[tabCloseSets]");
const tabs = [
  { path: "a", dirty: false },
  { path: "b", dirty: true },
  { path: "c", dirty: false },
  { path: "d", dirty: true },
  { path: "e", dirty: false },
];
{
  const s = tabCloseSets(tabs, "c");
  eq(s.others.join("|"), "a|b|d|e", "关闭其他 = 除目标外全部");
  eq(s.right.join("|"), "d|e", "关闭右侧 = 目标之后全部");
  eq(s.saved.join("|"), "a|c|e", "关闭已保存 = 非脏集合");
  eq(s.all.join("|"), "a|b|c|d|e", "全部关闭 = 全部");
}
{
  const s = tabCloseSets(tabs, "e");
  eq(s.right.length, 0, "目标在末位 → 右侧为空（菜单禁用）");
}
{
  const s = tabCloseSets(tabs, "a");
  eq(s.others.length, 4, "首项的关闭其他 = 其余 4 个");
}
{
  const s = tabCloseSets([], "a");
  check(
    s.others.length === 0 && s.right.length === 0 && s.saved.length === 0 && s.all.length === 0,
    "目标不在集合中 → 四组全空",
  );
}

console.log(`\n${failures === 0 ? "✅" : "❌"} 全部断言${failures === 0 ? "通过" : `失败 ${failures}/${total}`}：标签右键菜单纯逻辑（伪 Tab 判定/相对路径/关闭集合）。`);
if (failures > 0) process.exit(1);
