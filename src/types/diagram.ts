// M2 · 绘图模块协议类型（与 Rust src-tauri/src/commands/tikz_export.rs 一一对应）
import type { TexError } from "./compile";

/** 画布预览通道：local = tikz-editor 即时预览；precise = XeLaTeX 片段编译 */
export type PreviewMode = "local" | "precise";

/** 侧栏导出方式：source = 插入 TikZ 源码；image/file 由 F3 落盘链路接入 */
export type ExportMode = "source" | "image" | "file";

/** tikz_preview 的返回结构（Rust TikzPreviewResult，camelCase） */
export interface TikzPreviewResult {
  status: "ok" | "error";
  /** 成功时的 SVG 文本；前端转 data URL 交给 <img>，不内联注入 DOM */
  svg?: string;
  elapsedMs: number;
  /** standalone 导言区行数；errors[].line 已由 Rust 减去该偏移 */
  preambleLines: number;
  errors: TexError[];
  message?: string;
}
