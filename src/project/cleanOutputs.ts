// M1-41 · 手动清理确认文案（纯逻辑，不 import store / 不用 @/ 别名，供 Node 直跑测试）
// 后端 preview_build_outputs 只回前 12 条相对路径 + total 全量数。

export const CLEAN_PREVIEW_MAX_LIST = 12;

/** 拼装 Tauri confirm() 的正文：范围 + 总数 + 前 12 条清单 + 省略摘要 */
export function formatCleanMessage(
  files: string[],
  total: number,
  dirLabel: string,
): string {
  const shown = files.slice(0, CLEAN_PREVIEW_MAX_LIST);
  const lines = [
    "确定清除全部编译产物吗？此操作不可撤销。",
    "",
    `范围：${dirLabel}`,
    `共 ${total} 个文件：`,
    ...shown.map((p) => `  · ${p}`),
  ];
  const omitted = total - shown.length;
  if (omitted > 0) {
    lines.push(`  … 还有 ${omitted} 个（仅列出前 ${shown.length} 个）`);
  }
  return lines.join("\n");
}
