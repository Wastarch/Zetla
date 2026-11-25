// 项目树拖拽移动/复制的纯逻辑单测
// 运行：node --experimental-strip-types scripts/tree-drop.test.ts
import {
  dropHoverProblem,
  dropProblem,
  externalDropHint,
  filterTopLevel,
  isSameOrInside,
  parentDir,
  pathKey,
  planExternalImport,
  rangeSelect,
  resolveDropDir,
  toggleInList,
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

console.log("\n[M1-40 filterTopLevel 多选层级去重]");
eq(
  JSON.stringify(filterTopLevel(["E:/P/a", "E:/P/a/b.tex"])),
  JSON.stringify(["E:/P/a"]),
  "子项在选中目录内部 → 只留顶层",
);
eq(
  JSON.stringify(filterTopLevel(["E:/P/a/b.tex", "E:/P/a"])),
  JSON.stringify(["E:/P/a"]),
  "顺序颠倒（子项在前）同样只留顶层",
);
eq(
  JSON.stringify(filterTopLevel(["E:/P/a", "E:/Q/b.tex"])),
  JSON.stringify(["E:/P/a", "E:/Q/b.tex"]),
  "无嵌套关系全部保留",
);
eq(
  JSON.stringify(filterTopLevel(["E:/P/a", "E:/p/A", "E:\\P\\a"])),
  JSON.stringify(["E:/P/a"]),
  "pathKey 归一去重复项",
);
eq(JSON.stringify(filterTopLevel([])), "[]", "空集合返回空");

console.log("\n[M1-40 rangeSelect Shift 范围选择]");
eq(
  JSON.stringify(rangeSelect(["a", "b", "c", "d"], "b", "d")),
  JSON.stringify(["b", "c", "d"]),
  "向下取闭区间",
);
eq(
  JSON.stringify(rangeSelect(["a", "b", "c", "d"], "d", "b")),
  JSON.stringify(["b", "c", "d"]),
  "反向 Shift 同一区间",
);
eq(JSON.stringify(rangeSelect(["a", "b"], "a", "a")), JSON.stringify(["a"]), "同一点选自身");
eq(rangeSelect(["a", "b"], "x", "b"), null, "锚点不可见 → null（调用方降级单选）");
eq(rangeSelect(["a", "b"], "a", "y"), null, "目标不可见 → null");

console.log("\n[M1-40 toggleInList Ctrl 加减选]");
eq(
  JSON.stringify(toggleInList(["a", "b"], "c")),
  JSON.stringify(["a", "b", "c"]),
  "未选中 → 追加",
);
eq(JSON.stringify(toggleInList(["a", "b"], "a")), JSON.stringify(["b"]), "已选中 → 移除");

console.log("\n[M1-40 dropHoverProblem 多选拖拽悬停]");
eq(
  dropHoverProblem("E:/P/a", "E:/P/a/sub", true),
  "不能把文件夹放进它自己或它的子目录",
  "目录拖入自身子目录 → 非法",
);
eq(dropHoverProblem("E:/P/a.tex", "E:/P", false), null, "文件拖回父目录 → 悬停合法（原地移动项会被跳过）");
eq(dropHoverProblem("E:/P/a", "E:/Q", true), null, "目录拖到兄弟目录 → 合法");

console.log("\n[M1-48 planExternalImport 系统拖入/外部粘贴]");
{
  // 复制重名 → 追加「 - 副本」；同批第二个同名再顺延
  const a = planExternalImport(
    ["E:/other/a.tex", "E:/another/a.tex"],
    "E:/P/figs",
    "copy",
    ["a.tex"],
  );
  eq(a.skipped.length, 0, "无可跳过项");
  eq(a.steps[0].name, "a - 副本.tex", "复制重名 → 副本名");
  eq(a.steps[1].name, "a - 副本2.tex", "同批第二条同名继续顺延");

  // 不重名时保持原名
  const b = planExternalImport(["E:/other/b.png"], "E:/P/figs", "copy", ["a.tex"]);
  eq(b.steps[0].name, "b.png", "不重名保持原名");

  // 移动重名：不偷偷改名（交给调用方按冲突报错）
  const c = planExternalImport(["E:/other/a.tex"], "E:/P/figs", "move", ["a.tex"]);
  eq(c.steps[0].name, "a.tex", "移动重名沿用原名");
}
eq(
  planExternalImport(["E:/P/figs"], "E:/P/figs/sub", "copy", []).skipped[0]?.why,
  "self",
  "目录放进自己的子目录 → self（复制会无限套娃）",
);
eq(
  planExternalImport(["E:/P"], "E:/P/figs", "copy", []).skipped[0]?.why,
  "self",
  "把项目根拖进项目内 → self",
);
eq(
  planExternalImport(["E:/P/figs/a.tex"], "E:/P/figs", "move", []).skipped[0]?.why,
  "inPlace",
  "原地剪切粘贴 → inPlace（静默空操作）",
);
eq(
  planExternalImport(["E:/P/figs/a.tex"], "E:/P/figs", "copy", []).steps[0]?.name,
  "a.tex",
  "同目录复制不算 inPlace（照常生成副本）",
);
eq(
  planExternalImport(["E:/other/dir/"], "E:/P", "copy", []).steps[0]?.name,
  "dir",
  "尾部带分隔符的目录也能取到名字",
);

console.log("\n[M1-49 系统拖入浮层文案]");
{
  const one = externalDropHint(1, "E:/other/a.png", "E:/P/figures");
  eq(one.title, "a.png", "单条目标题只显示文件名（不带目录）");
  eq(one.hint, "松手复制到 figures", "副标题说明落点目录名");

  const many = externalDropHint(3, "E:/other/a.png", "E:/P");
  eq(many.title, "3 个项目", "多条目标题显示数量");
  eq(many.hint, "松手复制到 P", "落点是项目根时显示根目录名");

  const away = externalDropHint(2, null, null);
  eq(away.title, "2 个项目", "指针不在树上仍显示数量");
  eq(away.hint, "拖到左侧资源管理器内松手", "指针不在树上时提示拖进树");

  eq(externalDropHint(0, null, null).title, "1 个文件", "数量未知按 1 个文件兜底");
  eq(externalDropHint(1, null, null).title, "1 个文件", "无文件名时给「1 个文件」");
  eq(externalDropHint(1, "a.png", "E:/P/figs/").hint, "松手复制到 figs", "尾部带分隔符也能取到目录名");
}

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
