// 编译协议类型 —— 与 Rust src-tauri/src/compile.rs 的 struct 一一对应

/** 结构化编译错误（开发文档 §6.1） */
export interface TexError {
  /** 源文件 */
  file: string;
  /** 行号 */
  line: number;
  /** "error" | "warning"（交叉引用未定义等算 warning） */
  severity: "error" | "warning";
  col?: number;
  /** 原始报错（如 "Missing $ inserted"） */
  raw: string;
  /** 大白话解释 */
  readable: string;
  /** 修复建议 */
  fix?: string;
  /** 命中的常见错误规则提示 */
  hint?: string;
}

/** 编译结果（开发文档 §6.2） */
export interface CompileResult {
  status: "ok" | "error" | "cancelled";
  pdfPath?: string;
  /** 本次编译日志路径（M0-11；存在才返回，「帮助 → 查看日志文件」用） */
  logPath?: string;
  errors: TexError[];
  /** 实际编译几遍 */
  passes: number;
  durationMs: number;
}

/** 编译进度事件负载（Rust → 前端） */
export interface CompileProgress {
  /** 阶段：prepare / run / parse / done */
  stage: string;
  /** 0–100 */
  pct: number;
  /** 当前动作描述（如 "xelatex pass 2"） */
  current: string;
}

/** TeX 发行版检测结果 */
export interface TexDistInfo {
  /** 是否检测到可用发行版 */
  found: boolean;
  /** 发行版名称：MiKTeX / TeX Live / ... */
  distribution?: string;
  version?: string;
  /** 可用引擎列表：xelatex / pdflatex / latexmk ... */
  engines: string[];
  /** 推荐引擎（默认 xelatex） */
  recommended?: string;
}

/** 环境引导/安装触发结果 */
export interface InstallResult {
  ok: boolean;
  message: string;
  /** 可打开的下载/安装器路径或 URL */
  openable?: string;
}
