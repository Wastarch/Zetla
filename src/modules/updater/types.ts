// M1-13 · 更新相关类型（与 src-tauri/src/commands/updater.rs 对齐）

/** latest.json 的 installers 项 */
export interface InstallerSrc {
  url: string;
  sha256: string;
}

/**
 * 更新包类型（与 latest.json platforms[*].kind 对齐）。
 * 未知值一律按 `none` 处理 —— 将来新增格式不会把旧客户端带崩。
 */
export type UpdateKind = "exe" | "app-tar-gz" | "appimage" | "none";

/** latest.json platforms[平台键] 条目（U1 · 清单协议 v2，原始形态） */
export interface PlatformEntry {
  /** 未给出时由调用方按 `none` 处理 */
  kind?: string;
  installers?: InstallerSrc[];
  /** 系统包安装形态（deb/rpm）：仅用于下载引导，不参与自更新 */
  packages?: InstallerSrc[];
}

/** `pickEntry` 归一化后的可用条目：kind 已过白名单，installers 必有（可能为空数组） */
export interface ResolvedEntry {
  kind: UpdateKind;
  installers: InstallerSrc[];
  packages?: InstallerSrc[];
}

/** Rust `update_env_info` 返回值（camelCase） */
export interface UpdateEnv {
  /** "windows" | "macos" | "linux" */
  os: string;
  /** "x86_64" | "aarch64" */
  arch: string;
  /** 清单查找键，如 "darwin-aarch64" */
  key: string;
  /** 期望的产物类型，与 platforms[*].kind 对齐 */
  kind: string;
  /** 能否在应用内完成换包 */
  canSelfUpdate: boolean;
  /** 不能自更新的原因（直接展示给用户） */
  reason?: string | null;
  /** 当前可执行文件路径（诊断用） */
  installPath?: string | null;
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
  /**
   * 兼容旧客户端：保留并指向 Windows 安装包。0.2.x / 0.3.0 只读这一项，
   * 删空会让老版本误判「已是最新」。
   */
  installers: InstallerSrc[];
  /** 平台键 → 条目（v2 新增；老清单没有，走 installers 兜底） */
  platforms?: Record<string, PlatformEntry>;
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
