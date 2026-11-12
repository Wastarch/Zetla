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

/** F5-1：tikz_export 的请求体（Rust TikzExportPayload，camelCase） */
export interface TikzExportPayload {
  source: string;
  engine: string;
  /** 固定画布尺寸（world pt）；不传 / null 则跟随内容自适应 */
  canvas?: { widthPt: number; heightPt: number } | null;
  /** "png" | "svg" | "pdf" */
  format: "png" | "svg" | "pdf";
  /** 完整绝对目标路径（含扩展名） */
  outPath: string;
  /** 目标已存在时是否覆盖（覆盖前由前端 confirm 后再传 true） */
  force?: boolean;
}

/** F5-1：tikz_export 的返回结构（Rust TikzExportResult，camelCase） */
export interface TikzExportResult {
  /** "ok" | "exists" | "error" */
  status: "ok" | "exists" | "error";
  outPath?: string;
  elapsedMs: number;
  preambleLines: number;
  errors: TexError[];
  message?: string;
}
