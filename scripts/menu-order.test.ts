// 「查看」菜单动态视图项插入位置纯逻辑单测
// 运行：node --experimental-strip-types scripts/menu-order.test.ts
import { insertModuleViews } from "../src/ui/menuOrder.ts";

let failures = 0;
let total = 0;
function eq(got: string[], want: string[], msg: string) {
  total++;
  const ok = got.join("|") === want.join("|");
  console.log((ok ? "  ✓ " : "  ✗ ") + msg);
  if (!ok) {
    failures++;
    console.log(`      得到 ${got.join("|")}，期望 ${want.join("|")}`);
  }
}

const item = (label: string, sep = false) => ({ label, sep });
const labels = (xs: Array<{ label: string }>) => xs.map((x) => x.label);

console.log("\n[insertModuleViews]");
const viewItems = [
  item("隐藏侧栏"),
  item("资源管理器"),
  item("公式"),
  item("引用"),
  item("", true),
  item("显示 PDF 预览"),
];
const mods = [item("表格"), item("拼图"), item("绘图")];
eq(
  labels(insertModuleViews(viewItems, mods)),
  ["隐藏侧栏", "资源管理器", "公式", "引用", "表格", "拼图", "绘图", "", "显示 PDF 预览"],
  "插在第一个分隔线前：视图切换项连成一组",
);
eq(labels(viewItems), ["隐藏侧栏", "资源管理器", "公式", "引用", "", "显示 PDF 预览"], "不修改原数组");
eq(labels(insertModuleViews(viewItems, [])), labels(viewItems), "无模块项时原样拷贝");
eq(
  labels(insertModuleViews([item("A"), item("B")], mods)),
  ["A", "B", "表格", "拼图", "绘图"],
  "无分隔线时追加到末尾",
);
eq(
  labels(insertModuleViews([item("", true), item("A")], mods)),
  ["表格", "拼图", "绘图", "", "A"],
  "分隔线在最前时插到开头",
);
eq(
  labels(insertModuleViews(viewItems, [item("表格")])),
  ["隐藏侧栏", "资源管理器", "公式", "引用", "表格", "", "显示 PDF 预览"],
  "单个模块项同样插在分隔线前",
);

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
