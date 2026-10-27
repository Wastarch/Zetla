// M0-14a · 应用配置 / 偏好设置类型（与 src-tauri/src/commands/config.rs 的 AppConfig 一一对应，camelCase）
// schema v1；M0-13 在此追加 window / session / layout

/** 编辑器字体族白名单（非法值由 Rust 侧归一化） */
export type EditorFontFamily = "IBM Plex Mono" | "Consolas" | "Cascadia Mono";
/** PDF 默认缩放：适合宽度 / 100% / 125% / 150% */
export type PdfDefaultZoom = "fit-width" | "100" | "125" | "150";
/**
 * M1-2：主题设置值。light=亮色 / dark=暗色 / auto=跟随系统（prefers-color-scheme）；
 * 非法值按 light 处理（token 见 zetla.css [data-theme] 两块）
 */
export type AppTheme = "light" | "dark" | "auto";
/** M1-2b：生效主题（auto 经系统偏好解析后的实际值；data-theme / CM6 / 菜单消费） */
export type EffectiveTheme = "light" | "dark";
/**
 * M1-3：编译引擎。"auto"=跟随项目 .ltex/config.json（缺省 xelatex）；
 * 显式指定时全局覆盖项目配置（设置 → 编译设置 → 默认编译引擎）
 */
export type CompileEngine = "auto" | "xelatex" | "pdflatex" | "lualatex";
/**
 * M1-3：编译流程步骤。"latex"=跑一次引擎；"bibtex"=传统参考文献工具；
 * "biber"=biblatex 参考文献工具。
 * steps 为空数组 = 自动（latexmk 自行调度）；非空 = 按序直跑的固定流程，
 * 如 ["latex","bibtex","latex","latex"] 即 LaTeX → BibTeX → LaTeX → LaTeX
 */
export type CompileStep = "latex" | "bibtex" | "biber";

/**
 * M1-10：公式定义（内置库 formulas.json + 用户自定义共用）。
 * latex 为公式**内部片段**（不含外层 $ 或 equation 环境）；
 * isEnv=true 表示整段已是完整环境（如 align/cases），插入时不再包裹编号/行内。
 */
export interface FormulaDef {
  /** 稳定 id（内置：fr-xxx；自定义：c-<时间戳>-<随机>） */
  id: string;
  /** 展示名（如「二次公式」） */
  name: string;
  /** LaTeX 内容（内部片段，或 isEnv 时的完整环境） */
  latex: string;
  /** 分类（9 类之一） */
  category: string;
  /** 近似字形/说明（可选；列表缩略用） */
  glyph?: string;
  /** 描述（可选；参与搜索） */
  desc?: string;
  /** 整段已是完整环境（不套用编号/行内包裹）；缺省 false */
  isEnv?: boolean;
}

/** M1-10：公式模块配置（收藏 / 自定义 / 插入行为） */
export interface FormulaConfig {
  /** 收藏的内置公式 id（去重、上限 100；失效 id 前端惰性过滤） */
  favorites: string[];
  /** 用户自定义公式（增删改；按 id 去重、上限 200） */
  custom: FormulaDef[];
  /** 插入时是否带公式编号：true=\begin{equation}（编号），false=\begin{equation*}（无编号） */
  numbered: boolean;
  /** 插入时是否为行内公式：true=$...$，false=display 环境（numbered 不生效） */
  inline: boolean;
}

export interface AppSettings {
  schemaVersion: number;
  editor: {
    fontFamily: EditorFontFamily;
    fontSize: number; // 8–32（Ctrl+滚轮缩放后为连续区间）
    lineWrapping: boolean;
    /** Ctrl+滚轮缩放编辑器字体（M0-14a 用户追加，默认开） */
    mouseWheelZoom: boolean;
  };
  autosave: {
    enabled: boolean;
    intervalSeconds: number; // 5 | 15 | 30 | 60
    pauseWhileCompiling: boolean;
  };
  build: {
    saveBeforeCompile: boolean;
    /** M1-3：默认编译引擎（"auto"=跟随项目 .ltex/config.json；显式值全局覆盖） */
    engine: CompileEngine;
    /** M1-3：编译流程步骤序列（空=自动 latexmk；非空=按序直跑，见 CompileStep） */
    steps: CompileStep[];
    /**
     * 保存时自动编译：手动保存（Ctrl+S / 保存菜单 / 保存按钮，不含自动保存）
     * 一个 .tex 文件成功后触发编译；自动保存到旧内容不触发，避免频繁编译。
     */
    compileOnSave: boolean;
  };
  pdf: {
    defaultZoom: PdfDefaultZoom;
  };
  /** M0-13：窗口几何（null=未记录，沿用 tauri.conf 默认） */
  window: {
    width: number | null;
    height: number | null;
    x: number | null;
    y: number | null;
    maximized: boolean;
  };
  /** M0-13：会话记忆 */
  session: {
    lastProject: string | null;
    /** M0-13c：上次离开时打开的编辑器标签页（绝对路径，按打开顺序） */
    openFiles: string[];
    /** M0-13c：上次离开时的活动标签（须在 openFiles 内；null=无活动标签） */
    activeFile: string | null;
  };
  /** M0-13：布局（侧栏/预览宽度与显隐） */
  layout: {
    sidebarVisible: boolean;
    sidebarWidth: number; // 170–560
    previewVisible: boolean;
    previewRatio: number; // 0.2–0.75
    /** PDF 预览内缩略图/目录侧栏宽度（110–380） */
    pvSideWidth: number;
  };
  /** M0-13：通用开关 */
  general: {
    restoreLastProject: boolean;
    rememberWindow: boolean;
    restoreLayout: boolean;
    /** M1-2：主题（light=亮色 / dark=暗色 / auto=跟随系统；非法值按 light 处理） */
    theme: AppTheme;
  };
  /** M0-15a：TeX 代装记录（Zetla 自动安装时写入；distro=null 时目录为手动指定） */
  tex: {
    /** texlive；null=没有代装记录 */
    distro: "texlive" | null;
    installDir: string | null;
    /** 引擎可执行目录（编译时优先注入 PATH；null=未指定） */
    engineBinDir: string | null;
  };
  /** @deprecated M0-15b/c：TeX Live 自带 Perl，此字段保留仅为兼容旧配置 */
  perl: {
    installDir: string | null;
  };
  /**
   * M1-1：功能模块开关（模块 id → 是否启用；缺省/空 = 各模块走 defaultEnabled）。
   * 与 Rust AppConfig.modules（BTreeMap<String, bool>）一一对应，camelCase。
   */
  modules: Record<string, boolean>;
  /** M1-10：公式模块配置（收藏 / 自定义 / 插入行为） */
  formula: FormulaConfig;
  /** M1-8：表格模块配置（默认线型 / 转义 / 编号 / 位置 / 行列上限） */
  table: TableSettings;
}

/** M1-8：表格模块设置（与 Rust TableConfig 一一对应，camelCase） */
export interface TableSettings {
  /** 线型：booktabs 三线表 / grid 全框线 / plain 无线 */
  style: "booktabs" | "grid" | "plain";
  /** 是否带编号（false → table*） */
  numbered: boolean;
  /** 浮动位置参数 */
  placement: string;
  /** label 前缀（默认 "tab:"） */
  labelPrefix: string;
  /** 单元格转义：smart 保留 $..$ 与命令 / full 全转义 / off 不转义 */
  escape: "smart" | "full" | "off";
  /** 新表默认带表头 */
  headerRow: boolean;
  /** 面板「＋行」上限（模型硬上限 100） */
  maxRows: number;
  /** 面板「＋列」上限（模型硬上限 20） */
  maxCols: number;
}

/** 前端兜底默认值（与 Rust Default 一致；正常路径以 load_app_config 返回为准） */
export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  editor: { fontFamily: "IBM Plex Mono", fontSize: 13, lineWrapping: true, mouseWheelZoom: true },
  autosave: { enabled: true, intervalSeconds: 30, pauseWhileCompiling: true },
  build: { saveBeforeCompile: true, engine: "auto", steps: [], compileOnSave: false },
  pdf: { defaultZoom: "fit-width" },
  window: { width: null, height: null, x: null, y: null, maximized: false },
  session: { lastProject: null, openFiles: [], activeFile: null },
  layout: {
    sidebarVisible: true,
    sidebarWidth: 258,
    previewVisible: true,
    previewRatio: 0.5,
    pvSideWidth: 132,
  },
  general: { restoreLastProject: true, rememberWindow: true, restoreLayout: true, theme: "light" },
  tex: { distro: null, installDir: null, engineBinDir: null },
  perl: { installDir: null },
  modules: {},
  formula: { favorites: [], custom: [], numbered: false, inline: false },
  table: {
    style: "booktabs",
    numbered: true,
    placement: "htbp",
    labelPrefix: "tab:",
    escape: "smart",
    headerRow: true,
    maxRows: 100,
    maxCols: 20,
  },
};

/** 字体族 → CSS font-family 栈（应用到 --editor-ff，仅影响编辑器代码区） */
export const FONT_STACKS: Record<EditorFontFamily, string> = {
  "IBM Plex Mono": "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace",
  Consolas: "Consolas, 'Cascadia Mono', monospace",
  "Cascadia Mono": "'Cascadia Mono', Consolas, monospace",
};

/** M1-3：步骤显示名（设置页步骤编辑器 / 编译日志共用） */
export const STEP_LABELS: Record<CompileStep, string> = {
  latex: "LaTeX",
  bibtex: "BibTeX",
  biber: "Biber",
};

/** M1-3：编译流程预设（设置页「编译流程」下拉；custom 不在列，由编辑器匹配得出） */
export const PIPELINE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  steps: CompileStep[];
}> = [
  { id: "auto", label: "自动（latexmk 调度）", steps: [] },
  { id: "single", label: "单遍 LaTeX", steps: ["latex"] },
  {
    id: "bibtex",
    label: "LaTeX → BibTeX → LaTeX → LaTeX（传统参考文献）",
    steps: ["latex", "bibtex", "latex", "latex"],
  },
  {
    id: "biber",
    label: "LaTeX → Biber → LaTeX → LaTeX（biblatex）",
    steps: ["latex", "biber", "latex", "latex"],
  },
];

/** M1-3：步骤序列 → 可读串（编译日志 / 预览用；空序列 = 自动） */
export function stepsLabel(steps: readonly CompileStep[]): string {
  if (steps.length === 0) return "自动（latexmk）";
  return steps.map((s) => STEP_LABELS[s]).join(" → ");
}

/** M1-3：当前 steps 是否恰好等于某预设（相等则下拉显示该预设，否则显示「自定义」） */
export function matchPipelinePreset(steps: readonly CompileStep[]): string {
  const hit = PIPELINE_PRESETS.find(
    (p) => p.steps.length === steps.length && p.steps.every((s, i) => s === steps[i]),
  );
  return hit ? hit.id : "custom";
}

/** 深拷贝（设置页快照/草稿与 persisted 用；结构固定无循环引用） */
export function cloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s)) as AppSettings;
}
