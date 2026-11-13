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

/**
 * M2：当前编译流程步骤进度（Rust → 前端 `compile_step`）。
 * 每个 Tool 真正开跑前推一条，状态栏进度条旁显示「XeLaTeX（1/4）」。
 */
export interface CompileStepProgress {
  /** 任务代号：latest-wins 下前端只接受代号更大的事件，避免旧任务覆盖新任务 */
  seq: number;
  /** 当前执行的 Recipe 名（fallback 后会变） */
  recipe: string;
  /** 工具 / 引擎名（前端 toolLabel 转成 XeLaTeX 等规范大小写） */
  tool: string;
  /** 1-based 步骤位置（按 Recipe 原始步骤列表；条件跳过时序号会跳号） */
  index: number;
  /** Recipe 步骤总数 */
  total: number;
  /** repeat.untilStable 收敛重跑 */
  rerun: boolean;
  /** 本流程中此前被跳过的条件步骤数（供 tooltip 解释跳号） */
  skipped: number;
}

/** Perl 运行时检测结果（M0-15b/c） */
export interface PerlInfo {
  found: boolean;
  version?: string | null;
  binDir?: string | null;
  /** texlive / path / none */
  source: string;
}

/** TeX 发行版检测结果 */
export interface TexDistInfo {
  /** 是否检测到可用发行版 */
  found: boolean;
  /** 发行版名称：TeX Live / None / Unknown（未找到时为 null） */
  distribution?: string | null;
  version?: string | null;
  /** 可用引擎列表：xelatex / pdflatex / latexmk ... */
  engines: string[];
  /** 推荐引擎（默认 xelatex） */
  recommended?: string;
  /** M0-15b/c：TeX Live 自带的 Perl */
  perl: PerlInfo;
}

/** 环境引导/安装触发结果（预留：手动安装入口） */
export interface InstallResult {
  ok: boolean;
  message: string;
  /** 可打开的下载/安装器路径或 URL */
  openable?: string;
}

/** TeX 自动安装阶段（M0-15b/c） */
export type TexInstallStage =
  | "prepare"
  | "download"
  | "install"
  | "verify"
  | "done";

/** 自动安装进度事件负载（Rust → 前端） */
export interface TexInstallProgress {
  stage: TexInstallStage;
  /** 0–100；0 表示当前阶段无法估算（进度条走不确定动画） */
  percent: number;
  /** 下载速度（字节/秒；安装阶段为 0）。已做滑窗平滑，不再是单秒瞬时值 */
  speedBps: number;
  message: string;
  /** 当前下载镜像 host；仅下载阶段有值，供 UI 常驻显示（不会被进度消息覆盖） */
  mirror: string | null;
}

/**
 * M2：可用编译流程信息（list_recipes 返回；与 Rust commands/compile.rs 的 RecipeInfo 一一对应）。
 * 内置流程（latexmk / engine-direct）builtin=true、deletable=false，设置页不可删。
 */
export interface RecipeInfo {
  name: string;
  builtin: boolean;
  deletable: boolean;
  /** 步骤工具名序列（Detailed 步取 tool 字段） */
  tools: string[];
}

/** 自动安装最终结果（Rust → 前端 tex_install_finished） */
export interface TexInstallResult {
  ok: boolean;
  cancelled: boolean;
  distro: string;
  installDir: string | null;
  engineBinDir: string | null;
  version: string | null;
  message: string;
  /** 非致命警告 */
  warning?: string | null;
}
