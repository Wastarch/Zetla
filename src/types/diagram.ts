// M2 · 绘图模块协议类型（与 Rust src-tauri/src/commands/tikz_export.rs 一一对应）
import type { TexError } from "./compile";

/** 画布预览通道：local = tikz-editor 即时预览；precise = XeLaTeX 片段编译 */
export type PreviewMode = "local" | "precise";

/** 侧栏导出方式：source = 插入 TikZ 源码；image/file 由 F3 落盘链路接入 */
export type ExportMode = "source" | "image" | "file";

/** P1：图片资源映射（Rust `TikzAsset`，camelCase）。
 *  token 只出现在派发给后端的源码副本里；realPath 是项目内的真实绝对路径。 */
export interface TikzImageAsset {
  token: string;
  realPath: string;
}

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
  /** P1：\includegraphics 的资源表；源码里的图片路径已在 source 中换成 token */
  assets?: TikzImageAsset[];
  /** P1：项目根绝对路径，Rust 用它做资源越界校验；无资源时可省略 */
  projectRoot?: string | null;
}

/** 项目内 TikZ 来源候选（Rust src-tauri/src/commands/tikz_source.rs，camelCase） */
export interface TikzSourceCandidate {
  /** relPath + startLine + fingerprint 前缀 */
  id: string;
  /** 绝对路径 */
  path: string;
  /** 相对项目根的正斜杠路径 */
  relPath: string;
  /** "tikz-file" = 整文件；"tex-env" = LaTeX 中的一个 tikzpicture 环境 */
  kind: "tikz-file" | "tex-env";
  /** "project" = 项目扫描发现；"external" = 用户从项目外手动导入 */
  origin: "project" | "external";
  /** 规范化后的片段（库声明 + tikzpicture），可直接进绘图源码栏 */
  source: string;
  /** 原始文本，供候选预览/排错 */
  rawSource: string;
  startLine: number;
  endLine: number;
  /** 该文件声明的 \usetikzlibrary 库名（去重保序） */
  libraries: string[];
  confidence: number;
  reason: string;
  fingerprint: string;
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
