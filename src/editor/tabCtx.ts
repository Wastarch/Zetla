// M1-45 · 标签页右键菜单纯逻辑（零 import，供 Node 单测；CM/UI 接线见 TabCtxMenu.tsx）

/** 伪 buffer（拼图/绘图/偏好设置）没有真实文件路径，路径族动作禁用 */
export function isRealFileTab(kind: string): boolean {
  return kind === "text" || kind === "image" || kind === "pdf";
}

/**
 * 复制相对路径：项目根之下取相对形式（保留原大小写与分隔符）；
 * 无项目根 / 不在根之下 → 原样返回绝对路径（与跳转/补全的基准目录口径一致）。
 */
export function relativePathOf(path: string, root: string | null | undefined): string {
  if (!root) return path;
  const rootNorm = root.replace(/[\\/]+$/, "");
  if (!rootNorm) return path;
  // 判定用 / 归一（Windows 反斜杠路径也算根之下）；\→/ 是 1:1 替换，
  // 命中后按同长度前缀切片，保留路径原大小写与分隔符
  const rootFwd = rootNorm.replace(/\\/g, "/");
  if (!path.replace(/\\/g, "/").toLowerCase().startsWith(rootFwd.toLowerCase() + "/")) {
    return path;
  }
  return path.slice(rootFwd.length + 1);
}

/** 关闭动作的目标集合（VS Code 语义；dirty = content !== savedContent） */
export interface TabCloseInfo {
  path: string;
  dirty: boolean;
}

export interface TabCloseSets {
  /** 关闭其他（除目标外全部） */
  others: string[];
  /** 关闭右侧标签页（目标之后全部；目标在末位 → 空） */
  right: string[];
  /** 关闭已保存（非脏） */
  saved: string[];
  /** 全部关闭 */
  all: string[];
}

export function tabCloseSets(
  tabs: TabCloseInfo[],
  targetPath: string,
): TabCloseSets {
  const idx = tabs.findIndex((t) => t.path === targetPath);
  if (idx < 0) return { others: [], right: [], saved: [], all: [] };
  return {
    others: tabs.filter((t) => t.path !== targetPath).map((t) => t.path),
    right: tabs.slice(idx + 1).map((t) => t.path),
    saved: tabs.filter((t) => !t.dirty).map((t) => t.path),
    all: tabs.map((t) => t.path),
  };
}
