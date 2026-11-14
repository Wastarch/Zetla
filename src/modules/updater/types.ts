// M1-13 · 更新相关类型（与 src-tauri/src/commands/updater.rs 对齐）

/** latest.json 的 installers 项 */
export interface InstallerSrc {
  url: string;
  sha256: string;
}

/** latest.json 结构 */
export interface LatestInfo {
  version: string;
  /**
   * 更新说明：支持轻量标记（`## 标题` / `- 条目` / `1. 条目` / `**粗体**` / `` `代码` ``），
   * 也可直接给字符串数组（每项一行）。解析见 `notes.ts`。
   */
  notes?: string | string[];
  /** ISO 时间字符串，用于展示发布日期 */
  pubDate?: string;
  /** 发布页（GitHub Release / Gitee Release） */
  releaseUrl?: string;
  installers: InstallerSrc[];
  /** 低于此版本视为必须更新（可选） */
  minVersion?: string;
  /** 强制更新（可选） */
  mandatory?: boolean;
}

/** 下载进度事件负载（与 Rust UpdateProgress 对齐，camelCase） */
export interface UpdateProgress {
  downloaded: number;
  total: number;
  source: string;
}
