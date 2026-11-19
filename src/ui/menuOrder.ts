// 「查看」菜单动态视图项的插入位置：必须紧跟静态视图切换项，不能追加到菜单末尾。
// 纯逻辑，不依赖 store / React，便于单测；Tauri 原生菜单不走这里。
export function insertModuleViews<T extends { sep?: boolean }>(
  items: readonly T[],
  moduleItems: readonly T[],
): T[] {
  if (moduleItems.length === 0) return [...items];
  const at = items.findIndex((it) => it.sep);
  if (at < 0) return [...items, ...moduleItems];
  return [...items.slice(0, at), ...moduleItems, ...items.slice(at)];
}
