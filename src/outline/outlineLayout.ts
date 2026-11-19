// M1-28 · 资源管理器底部「大纲」section 的高度纯逻辑。
// 常量需与 src-tauri/src/commands/config.rs 的 LayoutConfig 钳制保持一致。

/** 折叠后只剩标题条的高度 */
export const OUTLINE_HEAD_H = 28;
/** 展开态硬下限（低于此值列表不可用） */
export const OUTLINE_H_MIN = 96;
/** 展开态硬上限 */
export const OUTLINE_H_MAX = 480;
/** 首次默认值 */
export const OUTLINE_H_DEFAULT = 180;
/** 拖到极限时至少给项目树留出的高度 */
export const MIN_TREE_H = 120;

/** 当前侧栏高度下大纲允许的最大高度（保证树至少 MIN_TREE_H） */
export function maxOutlineHeight(sidebarH: number): number {
  if (!Number.isFinite(sidebarH) || sidebarH <= 0) return OUTLINE_H_MAX;
  return Math.max(OUTLINE_H_MIN, Math.min(OUTLINE_H_MAX, sidebarH - MIN_TREE_H));
}

/** 把目标高度钳制到合法区间；NaN / Infinity 回落到默认值 */
export function clampOutlineHeight(h: number, sidebarH: number): number {
  const target = Number.isFinite(h) ? Math.round(h) : OUTLINE_H_DEFAULT;
  return Math.max(OUTLINE_H_MIN, Math.min(maxOutlineHeight(sidebarH), target));
}
