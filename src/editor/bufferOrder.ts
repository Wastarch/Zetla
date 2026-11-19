// 标签页拖拽排序的纯逻辑（不依赖 React / zustand，可由 Node 单测直接覆盖）
// 拖拽交互本身在 TabBar.tsx（指针事件），这里只负责「指针 X → 插入位置」与
// 「把某项移到插入位置」两步计算，避免把边界条件埋在组件里。

/** 标签在标签条上的水平占用区间（视口坐标） */
export interface TabSpan {
  left: number;
  right: number;
}

/**
 * 按指针 X 计算插入位置：落在第 i 个标签的前半段 → 插到它前面（返回 i）；
 * 越过所有标签 → 返回 length（末尾）。空列表或指针在第一个标签左侧 → 0。
 *
 * @param spans 各标签的水平区间，顺序与 buffers 一致
 * @param clientX 指针视口 X 坐标
 * @returns 原数组中的插入下标，范围 0..spans.length
 */
export function insertionIndex(spans: readonly TabSpan[], clientX: number): number {
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    if (clientX < (span.left + span.right) / 2) return i;
  }
  return spans.length;
}

/**
 * 把 path 对应项移动到「原数组的插入位置」dropIndex 处。
 * 语义与 insertionIndex 对齐：dropIndex=n 表示放到末尾；从前往后移动时
 * 移除项会让后续下标减一，此处统一换算，调用方无需关心方向。
 *
 * @returns 新数组；path 不存在或位置没变（含相邻交换的等价情形）时返回 null，
 *          便于 store 直接跳过 setState、不触发无谓的会话写盘。
 */
export function reorderByDrop<T extends { path: string }>(
  items: readonly T[],
  path: string,
  dropIndex: number,
): T[] | null {
  const from = items.findIndex((item) => item.path === path);
  if (from < 0) return null;
  const drop = Math.max(0, Math.min(dropIndex, items.length));
  // 原位、或只越过自身边界（drop === from + 1）都是无变化
  if (drop === from || drop === from + 1) return null;

  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  next.splice(drop > from ? drop - 1 : drop, 0, moved);
  return next;
}
