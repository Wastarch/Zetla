// M1-38 · 项目树「显示隐藏文件」判据（纯逻辑，与 Rust project.rs 同规则）
// 隐藏项默认不进树；开启后仅放行点号文件/目录，.git 与重型目录始终跳过，
// 防止 scan_project 的 5000 条上限被 .git objects 吃满。

/** 无论开关如何都跳过的重型目录（与 Rust skip_name 一致，大小写敏感） */
export const TREE_ALWAYS_SKIPPED_DIRS: readonly string[] = [
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "__pycache__",
];

/** 开启隐藏文件后仍跳过的目录 */
export const TREE_ALWAYS_SKIPPED_HIDDEN: readonly string[] = [".git"];

/** 是否从项目树中剔除该名称（隐藏开关只影响点号项） */
export function shouldSkipTreeName(name: string, showHidden: boolean): boolean {
  if (TREE_ALWAYS_SKIPPED_DIRS.includes(name)) return true;
  if (!name.startsWith(".")) return false;
  if (!showHidden) return true;
  return TREE_ALWAYS_SKIPPED_HIDDEN.includes(name);
}
