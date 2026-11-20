// M1-28/M1-40 · 资源管理器底部「大纲」「构建文件」section 的高度纯逻辑。
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

/** M1-40：构建文件面板展开高度（与 config.rs BUILD_FILES_H_* 一致） */
export const BUILD_FILES_H_MIN = 96;
export const BUILD_FILES_H_MAX = 480;
export const BUILD_FILES_H_DEFAULT = 152;

/** 当前侧栏高度下大纲允许的最大高度（保证树至少 MIN_TREE_H；otherH 为另一面板占用） */
export function maxOutlineHeight(sidebarH: number, otherH = 0): number {
  if (!Number.isFinite(sidebarH) || sidebarH <= 0) return OUTLINE_H_MAX;
  return Math.max(OUTLINE_H_MIN, Math.min(OUTLINE_H_MAX, sidebarH - MIN_TREE_H - otherH));
}

/** 把目标高度钳制到合法区间；NaN / Infinity 回落到默认值 */
export function clampOutlineHeight(h: number, sidebarH: number, otherH = 0): number {
  const target = Number.isFinite(h) ? Math.round(h) : OUTLINE_H_DEFAULT;
  return Math.max(OUTLINE_H_MIN, Math.min(maxOutlineHeight(sidebarH, otherH), target));
}

/** 配置兜底用的静态钳制（与 config.rs BUILD_FILES_H_* 一致） */
export function clampBuildFilesHeightStatic(h: number): number {
  const target = Number.isFinite(h) ? Math.round(h) : BUILD_FILES_H_DEFAULT;
  return Math.max(BUILD_FILES_H_MIN, Math.min(BUILD_FILES_H_MAX, target));
}

/** 构建文件面板在当前侧栏高度下的最大高度（扣掉大纲占用，保证树至少 MIN_TREE_H） */
export function maxBuildFilesHeight(sidebarH: number, outlineH: number): number {
  if (!Number.isFinite(sidebarH) || sidebarH <= 0) return BUILD_FILES_H_MAX;
  return Math.max(
    BUILD_FILES_H_MIN,
    Math.min(BUILD_FILES_H_MAX, sidebarH - MIN_TREE_H - outlineH),
  );
}

/** 构建文件面板高度钳制；NaN / Infinity 回落到默认值 */
export function clampBuildFilesHeight(h: number, sidebarH: number, outlineH: number): number {
  const target = Number.isFinite(h) ? Math.round(h) : BUILD_FILES_H_DEFAULT;
  return Math.max(BUILD_FILES_H_MIN, Math.min(maxBuildFilesHeight(sidebarH, outlineH), target));
}
