// M0-14a · 应用配置 / 偏好设置类型（与 src-tauri/src/commands/config.rs 的 AppConfig 一一对应，camelCase）
// schema v1；M0-13 在此追加 window / session / layout
import type { ProjectEntry } from "./project";

/** M1-22：编辑器/终端字体族为**任意字符串**（取消白名单；Rust 侧仅去空白，空回退默认）。
 *  以下三项仅作为设置页 datalist 建议（可自由输入系统内任意字体名） */
export const SUGGESTED_FONTS = ["IBM Plex Mono", "Consolas", "Cascadia Mono"] as const;
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
 * M1-3 旧固定流程步骤（"latex" / "bibtex" / "biber"）。
 * M2 起该字段**仅有数据兼容意义**：设置页不再提供编辑入口，
 * 老 config.json 里残留的 steps 仍由后端静默合成兼容 Recipe（优先级低于 defaultRecipe）。
 */
export type CompileStep = "latex" | "bibtex" | "biber";

// ── M2：Tool / Recipe 通用化编译编排（与 src-tauri/src/commands/config.rs 一一对应，camelCase）──
// 设计文档：docs/dev/compile-recipe-system.md。仅全局配置，不做项目级配置。

/** 条件触发（when）：每步执行前即时求值；Rust 侧 #[serde(tag="type", rename_all="camelCase")] */
export type BuildCondition =
  | { type: "fileExists"; path: string }
  | { type: "logRegex"; pattern: string }
  | { type: "env"; name: string; value?: string | null };

/** Recipe 单步：工具名字符串，或带条件的细化对象（Rust #[serde(untagged)]） */
export type RecipeStep = string | RecipeStepDetailed;

export interface RecipeStepDetailed {
  tool: string;
  when?: BuildCondition | null;
}

/** 自动重跑：解析主引擎 .log 的 Rerun 警告，仅重跑引擎步（Rust 默认 max=10） */
export interface RepeatConfig {
  untilStable: boolean;
  max: number;
}

/** 流程（Recipe）：有序工具列表 + 可选 repeat / fallback */
export interface RecipeDef {
  name: string;
  tools: RecipeStep[];
  repeat?: RepeatConfig | null;
  fallback?: string | null;
}

/** 工具（Tool）：单个可执行编译步骤（命令 + 参数 + 工作目录 + 环境变量） */
export interface ToolDef {
  name: string;
  /** 可执行命令或内置 token（"latex" 表示用 build.engine 解析出的引擎） */
  command: string;
  args: string[];
  cwd?: string | null;
  env: Record<string, string>;
  ignoreErrors: boolean;
}

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
  /** 可选：该条目最小高度（px）。不填则用全局默认（34px）；填了则单独覆盖该条目高度，给高型公式（矩阵/连分式/多行 cases 等）更多纵向空间 */
  h?: number;
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
    /** 字体族：任意字符串（M1-22 取消白名单） */
    fontFamily: string;
    fontSize: number; // 8–32（Ctrl+滚轮缩放后为连续区间）
    lineWrapping: boolean;
    /** Ctrl+滚轮缩放编辑器字体（M0-14a 用户追加，默认开） */
    mouseWheelZoom: boolean;
    /** 编辑器右侧缩略图（M1 小地图） */
    minimap: boolean;
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
    /** M1-3：编译流程步骤序列（空=自动 latexmk；非空=按序直跑，见 CompileStep）。
     *  M2 起为向后兼容字段：新流程走 defaultRecipe / recipes，旧 steps 由后端合成 Recipe */
    steps: CompileStep[];
    /** M2：用户自定义工具（全局配置；仅全局，不做项目级配置） */
    tools: ToolDef[];
    /** M2：用户自定义编译流程（内置 latexmk / engine-direct 由后端提供，不存此列） */
    recipes: RecipeDef[];
    /** M2：默认流程名（null = 内置 latexmk）；须匹配 recipes 中某 name 或内置 Recipe */
    defaultRecipe: string | null;
    /**
     * 保存时自动编译：手动保存（Ctrl+S / 保存菜单 / 保存按钮，不含自动保存）
     * 一个 .tex 文件成功后触发编译；自动保存到旧内容不触发，避免频繁编译。
     */
    compileOnSave: boolean;
    /**
     * M1-18：实时预览（Live Preview）——编辑停止后防抖静默编译，右侧 PDF 无感刷新。
     * 默认关：不改变存量用户「按需编译」的开箱行为。
     */
    livePreview: boolean;
    /** M1-18：实时预览防抖延迟（毫秒，200–2000；默认 600） */
    livePreviewDelayMs: number;
    /** M1-9b：编译成功完成后自动清理 LaTeX 辅助文件（.aux/.log/.out 等） */
    cleanAuxAfterCompile: boolean;
    /**
     * M1-9c：自定义清理辅助文件的后缀白名单（含点，如 ".aux" / ".synctex.gz"）。
     * 空数组 = 使用内置默认清单；前端清理与菜单手动清理都按此列表执行，Rust 侧兜底防呆。
     */
    cleanAuxExtensions: string[];
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
    /** M1-16：底部日志面板高度（120–560，拖拽上边界调整） */
    logHeight: number;
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
  /** M1-15a：最近项目注册表（与 Rust AppConfig.recent_projects 一一对应） */
  recentProjects: ProjectEntry[];
  /** M1-17：LaTeX 语法高亮配色（数据驱动；设置页「外观与保存 → 语法高亮」编辑） */
  highlight: HighlightSettings;
  /** M1-22：内置终端配置（与 Rust TerminalConfig 一一对应，camelCase） */
  terminal: TerminalSettings;
}

/** M1-22：内置终端设置（与 Rust TerminalConfig 一一对应，camelCase） */
export interface TerminalSettings {
  /** 字体族；空串 = 跟随编辑器字体 */
  fontFamily: string;
  /** 字号 8–24 */
  fontSize: number;
  /** 光标样式 */
  cursorStyle: "block" | "bar" | "underline";
  /** 光标闪烁 */
  cursorBlink: boolean;
  /** 回滚行数（100–50000；xterm 建实例时生效） */
  scrollback: number;
  /** 选中文本自动复制 */
  copyOnSelect: boolean;
  /** 右键粘贴剪贴板 */
  rightClickPaste: boolean;
  /** 默认工作目录（project=项目根 / home=用户主目录） */
  defaultCwd: "project" | "home";
}

/** M1-22：终端回滚行数可选档位（设置页下拉） */
export const TERMINAL_SCROLLBACK_OPTIONS = [1000, 5000, 10000, 50000] as const;

/** M1-22：终端字号可选档位（8–24 连续区间整数值） */
export const TERMINAL_FONT_SIZE_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 8);

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

/**
 * M1-17：LaTeX 语法高亮配色（数据驱动，取代 LaTeXEditor.tsx 内硬编码的 LATEX_HIGHLIGHT）。
 * 分组**可扩展、数量不限**：每个 HighlightGroup 自带它要着色的 lezer 标签名（tags），
 * 构建时由 src/editor/highlightConfig.ts 的 resolveTags 解析为 lezer Tag；
 * 未知标签名安全跳过。亮/暗各一份颜色；设置页「外观与保存 → 语法高亮」可改、可应用主题预设、可导出/导入。
 * id 仅用于设置层去重/对齐（不同预设可复用相同 id），不是固定枚举。
 */
export interface HighlightGroup {
  /** 稳定 id（设置层去重/对齐用；不同预设可复用相同 id） */
  id: string;
  /** 设置页展示名 */
  label: string;
  /** 该组着色的 lezer 标签名（如 "keyword"、"variableName"）；见 @lezer/highlight 的 tags 命名空间 */
  tags: string[];
  /** 亮色主题下的颜色（hex） */
  light: string;
  /** 暗色主题下的颜色（hex） */
  dark: string;
}

export interface HighlightSettings {
  /** LaTeX 文档语法高亮配色组（有序，顺序决定 HighlightStyle 优先级：靠后更高；长度可变） */
  latex: HighlightGroup[];
}

/** M1-17：LaTeX 语法高亮默认配色（亮/暗双份；与 codemirror-lang-latex 的 styleTags 对齐；可扩展分组） */
export const DEFAULT_LATEX_HIGHLIGHT: HighlightGroup[] = [
  { id: "meta", label: "verbatim 内容 / 正文", tags: ["meta", "content"], light: "#7a828c", dark: "#7e8794" },
  { id: "comment", label: "注释", tags: ["comment"], light: "#8d959e", dark: "#6b7480" },
  { id: "string", label: "字面参数 / 数字", tags: ["string", "number"], light: "#9a5b0d", dark: "#e0b169" },
  { id: "keyword", label: "控制序列（\\cmd / \\begin / \\end）", tags: ["keyword", "definitionKeyword"], light: "#2b62cf", dark: "#7fb0ff" },
  { id: "heading", label: "章节命令", tags: ["heading"], light: "#1e4fae", dark: "#7fb0ff" },
  { id: "operator", label: "数学符号 / $", tags: ["operator", "variableName", "processingInstruction"], light: "#9a5b0d", dark: "#e0b169" },
  { id: "bracket", label: "括号", tags: ["bracket"], light: "#7a828c", dark: "#7e8794" },
  { id: "class", label: "环境名 / \\label / \\ref / \\cite", tags: ["className", "labelName", "quote"], light: "#0d7a6e", dark: "#6fd3c4" },
  { id: "strong", label: "加粗文本", tags: ["strong"], light: "#1b1f24", dark: "#e8eaed" },
  { id: "emphasis", label: "斜体文本", tags: ["emphasis"], light: "#1b1f24", dark: "#e8eaed" },
  { id: "monospace", label: "等宽文本", tags: ["monospace"], light: "#1b1f24", dark: "#e8eaed" },
  { id: "invalid", label: "非法字符", tags: ["invalid"], light: "#c2382f", dark: "#f26a60" },
];

/**
 * M1-9c：内置默认清理清单（后缀含点）。作为 cleanAuxExtensions 的前端默认值，
 * 用户可在此基础增删；与 Rust DEFAULT_AUX_SUFFIXES 保持一致。
 */
export const DEFAULT_AUX_EXTENSIONS: string[] = [
  ".aux", ".log", ".bbl", ".blg", ".toc", ".out", ".lof", ".lot",
  ".idx", ".ilg", ".ind", ".fls", ".fdb_latexmk", ".synctex.gz",
];

/** M1-18：实时预览防抖延迟可选档位（毫秒；设置页下拉；600 为默认，须包含以免空选） */
export const LIVE_PREVIEW_DELAY_PRESETS = [500, 600, 800, 1200] as const;

/**
 * M1-18c：实时预览开启时必须保留的辅助文件后缀。
 * - `.fdb_latexmk` / `.fls` 是 latexmk 的增量缓存，删了下次就退化为全量慢编译；
 * - `.synctex.gz` 是滚动锚定 / 双向跳转的数据源，删了锚定直接失效。
 * 开启实时预览时，编译后清理会跳过这三类（其余后缀照删）。
 */
export const LIVE_PREVIEW_KEEP_AUX: string[] = [".fdb_latexmk", ".fls", ".synctex.gz"];

/** 过滤掉实时预览必需的缓存/同步后缀（后缀比较不区分大小写） */
export function liveSafeAuxExtensions(exts: string[]): string[] {
  const keep = new Set(LIVE_PREVIEW_KEEP_AUX.map((e) => e.toLowerCase()));
  return exts.filter((e) => !keep.has(e.trim().toLowerCase()));
}

/** 前端兜底默认值（与 Rust Default 一致；正常路径以 load_app_config 返回为准） */
export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  editor: { fontFamily: "IBM Plex Mono", fontSize: 13, lineWrapping: true, mouseWheelZoom: true, minimap: true },
  autosave: { enabled: true, intervalSeconds: 30, pauseWhileCompiling: true },
  build: { saveBeforeCompile: true, engine: "auto", steps: [], tools: [], recipes: [], defaultRecipe: null, compileOnSave: false, livePreview: false, livePreviewDelayMs: 600, cleanAuxAfterCompile: false, cleanAuxExtensions: DEFAULT_AUX_EXTENSIONS },
  pdf: { defaultZoom: "fit-width" },
  window: { width: null, height: null, x: null, y: null, maximized: false },
  session: { lastProject: null, openFiles: [], activeFile: null },
  layout: {
    sidebarVisible: true,
    sidebarWidth: 258,
    previewVisible: true,
    previewRatio: 0.5,
    pvSideWidth: 132,
    logHeight: 212,
  },
  general: { restoreLastProject: true, rememberWindow: true, restoreLayout: true, theme: "light" },
  tex: { distro: null, installDir: null, engineBinDir: null },
  perl: { installDir: null },
  modules: {},
  formula: { favorites: [], custom: [], numbered: false, inline: false },
  /** M1-15a：最近项目注册表（缺省空；后端 register_recent_project 写回） */
  recentProjects: [],
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
  /** M1-17：LaTeX 语法高亮默认配色（与 Rust DEFAULT_HIGHLIGHT 一致） */
  highlight: { latex: DEFAULT_LATEX_HIGHLIGHT },
  /** M1-22：内置终端默认配置（与 Rust TerminalConfig::default 一致） */
  terminal: {
    fontFamily: "",
    fontSize: 12,
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 5000,
    copyOnSelect: false,
    rightClickPaste: true,
    defaultCwd: "project",
  },
};

/**
 * 字体族 → CSS font-family 栈：用户字体优先，后接内置等宽兜底链。
 * 用户值会过滤引号/反斜杠/分号再进单引号字面量，防 CSS 注入。
 */
export function editorFontStack(family: string): string {
  const f = family.trim().replace(/['"\\;{}]/g, "") || "IBM Plex Mono";
  return `'${f}', 'Cascadia Mono', Consolas, monospace`;
}

/** 旧 steps 步骤显示名（仅编译日志用） */
export const STEP_LABELS: Record<CompileStep, string> = {
  latex: "LaTeX",
  bibtex: "BibTeX",
  biber: "Biber",
};

/** 旧 steps 序列 → 可读串（仅编译日志用；空序列 = 自动） */
export function stepsLabel(steps: readonly CompileStep[]): string {
  if (steps.length === 0) return "自动（latexmk）";
  return steps.map((s) => STEP_LABELS[s]).join(" → ");
}

/** 深拷贝（设置页快照/草稿与 persisted 用；结构固定无循环引用） */
export function cloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s)) as AppSettings;
}
