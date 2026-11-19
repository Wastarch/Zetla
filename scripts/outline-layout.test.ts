// 大纲区高度钳制纯逻辑单测
// 运行：node --experimental-strip-types scripts/outline-layout.test.ts
import {
  OUTLINE_H_DEFAULT,
  OUTLINE_H_MAX,
  OUTLINE_H_MIN,
  OUTLINE_HEAD_H,
  clampOutlineHeight,
  maxOutlineHeight,
} from "../src/outline/outlineLayout.ts";

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

console.log("\n[常量]");
eq(OUTLINE_HEAD_H, 28, "折叠态标题条 28px");
eq(OUTLINE_H_MIN, 96, "下限 96");
eq(OUTLINE_H_MAX, 480, "上限 480");
eq(OUTLINE_H_DEFAULT, 180, "默认 180");

console.log("\n[maxOutlineHeight]");
eq(maxOutlineHeight(600), 480, "空间充足 → 硬上限 480");
eq(maxOutlineHeight(300), 180, "侧栏 300 - 树 120 = 180");
eq(maxOutlineHeight(200), 96, "剩余不足下限时兜底 96（树不足 120，屏太小）");
eq(maxOutlineHeight(0), 480, "无效高度 → 硬上限");
eq(maxOutlineHeight(Number.NaN), 480, "NaN → 硬上限");

console.log("\n[clampOutlineHeight]");
eq(clampOutlineHeight(1000, 600), 480, "超过硬上限 → 480");
eq(clampOutlineHeight(20, 600), 96, "低于下限 → 96");
eq(clampOutlineHeight(250, 300), 180, "受动态上限约束 → 180");
eq(clampOutlineHeight(-50, 600), 96, "负数 → 下限");
eq(clampOutlineHeight(Number.NaN, 600), 180, "NaN → 默认 180");
eq(clampOutlineHeight(Number.POSITIVE_INFINITY, 600), 180, "Infinity → 默认 180");
eq(clampOutlineHeight(200.6, 600), 201, "四舍五入取整");
eq(clampOutlineHeight(180, 600), 180, "合法值原样返回");

console.log(`\n${total - failures}/${total} passed`);
if (failures) process.exit(1);
