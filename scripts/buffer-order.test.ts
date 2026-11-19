// 标签页拖拽排序的纯逻辑单测（指针落点 → 插入位置；按插入位置重排）
// 运行：node --experimental-strip-types scripts/buffer-order.test.ts
import {
  insertionIndex,
  reorderByDrop,
  type TabSpan,
} from "../src/editor/bufferOrder.ts";

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
function paths(items: readonly { path: string }[]): string {
  return items.map((i) => i.path).join(",");
}

const spans: TabSpan[] = [
  { left: 100, right: 200 },
  { left: 200, right: 300 },
  { left: 300, right: 400 },
];

console.log("\n[insertionIndex]");
eq(insertionIndex([], 150), 0, "无标签 → 0");
eq(insertionIndex(spans, 10), 0, "第一个标签左侧 → 插到最前");
eq(insertionIndex(spans, 120), 0, "落在第一个标签前半段 → 0");
eq(insertionIndex(spans, 220), 1, "落在第二个标签前半段 → 1");
eq(insertionIndex(spans, 320), 2, "落在第三个标签前半段 → 2");
eq(insertionIndex(spans, 500), 3, "越过所有标签（工具条区域）→ 末尾");
eq(insertionIndex(spans, 150), 1, "恰好命中中点 → 归到后一个标签之前");

console.log("\n[reorderByDrop]");
const items = ["A", "B", "C", "D"].map((path) => ({ path }));
eq(paths(items), "A,B,C,D", "初始顺序");
eq(paths(reorderByDrop(items, "B", 3) ?? []), "A,C,B,D", "向后拖：B 放到 C 之后");
eq(paths(reorderByDrop(items, "B", 0) ?? []), "B,A,C,D", "向前拖：B 放到最前");
eq(paths(reorderByDrop(items, "D", 0) ?? []), "D,A,B,C", "末项拖到最前");
eq(paths(reorderByDrop(items, "A", 4) ?? []), "B,C,D,A", "首项拖到末尾");
eq(reorderByDrop(items, "B", 1), null, "原地放下 → 返回 null（store 不写盘）");
eq(reorderByDrop(items, "B", 2), null, "只越过自身边界 → 返回 null");
eq(reorderByDrop(items, "X", 0), null, "路径不存在 → 返回 null");
eq(paths(reorderByDrop(items, "B", -5) ?? []), "B,A,C,D", "越界下标向前钳制到 0");
eq(paths(reorderByDrop(items, "B", 99) ?? []), "A,C,D,B", "越界下标向后钳制到末尾");
check(
  reorderByDrop(items, "B", 3)?.[1] === items[2] &&
    reorderByDrop(items, "B", 3)?.[2] === items[1],
  "未移动的项保持对象引用（编辑器实例 key 不变）",
);
eq(paths(items), "A,B,C,D", "纯函数不修改入参");

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
