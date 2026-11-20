// 大纲区高度钳制纯逻辑单测
// 运行：node --experimental-strip-types scripts/outline-layout.test.ts
import {
  BUILD_FILES_H_DEFAULT,
  BUILD_FILES_H_MAX,
  BUILD_FILES_H_MIN,
  OUTLINE_H_DEFAULT,
  OUTLINE_H_MAX,
  OUTLINE_H_MIN,
  OUTLINE_HEAD_H,
  clampBuildFilesHeight,
  clampBuildFilesHeightStatic,
  clampOutlineHeight,
  maxBuildFilesHeight,
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

console.log("\n[M1-40 构建文件面板高度]");
eq(BUILD_FILES_H_MIN, 96, "下限 96");
eq(BUILD_FILES_H_MAX, 480, "上限 480");
eq(BUILD_FILES_H_DEFAULT, 152, "默认 152");
eq(clampBuildFilesHeightStatic(1000), 480, "静态钳制超上限 → 480");
eq(clampBuildFilesHeightStatic(20), 96, "静态钳制低于下限 → 96");
eq(clampBuildFilesHeightStatic(Number.NaN), 152, "静态钳制 NaN → 默认 152");
eq(clampBuildFilesHeightStatic(200.6), 201, "静态钳制四舍五入");
eq(maxBuildFilesHeight(600, 180), 300, "600 - 树 120 - 大纲 180 = 300");
eq(maxBuildFilesHeight(300, 480), 96, "剩余不足 → 下限 96");
eq(clampBuildFilesHeight(1000, 600, 100), 380, "受动态上限约束 → 380");
eq(clampBuildFilesHeight(Number.NaN, 600, 0), 152, "NaN → 默认 152");
eq(maxOutlineHeight(600, 152), 328, "大纲钳制扣掉构建文件占用 → 328");

console.log(`\n${total - failures}/${total} passed`);
if (failures) process.exit(1);
