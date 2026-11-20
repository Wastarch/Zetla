// M1-38/M1-40 · 项目树「显示隐藏文件」判据（纯逻辑，与 Rust project.rs skip_name 同规则）
// showHidden=false：跳过重型目录与所有点号项（含 .git）；
// showHidden=true：真正显示所有文件——重型目录与 .git 全部放行（用户明确选择），
// 仅受 Rust 扫描的 5000 条 / 12 层上限兜底。

/** 默认口径下跳过的重型目录（与 Rust skip_name 一致，大小写敏感） */
export const TREE_ALWAYS_SKIPPED_DIRS: readonly string[] = [
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "__pycache__",
];

/** 是否从项目树中剔除该名称（只判名称；中间文件后缀过滤在 Rust 侧按 outputDir 语境进行） */
export function shouldSkipTreeName(name: string, showHidden: boolean): boolean {
  if (showHidden) return false;
  if (TREE_ALWAYS_SKIPPED_DIRS.includes(name)) return true;
  return name.startsWith(".");
}
