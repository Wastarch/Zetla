// M0-14a · 应用配置 / 偏好设置类型（与 src-tauri/src/commands/config.rs 的 AppConfig 一一对应，camelCase）
// schema v1；M0-13 在此追加 window / session / layout

/** 编辑器字体族白名单（非法值由 Rust 侧归一化） */
export type EditorFontFamily = "IBM Plex Mono" | "Consolas" | "Cascadia Mono";
/** PDF 默认缩放：适合宽度 / 100% / 125% / 150% */
export type PdfDefaultZoom = "fit-width" | "100" | "125" | "150";

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
}

/** 前端兜底默认值（与 Rust Default 一致；正常路径以 load_app_config 返回为准） */
export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  editor: { fontFamily: "IBM Plex Mono", fontSize: 13, lineWrapping: true, mouseWheelZoom: true },
  autosave: { enabled: true, intervalSeconds: 30, pauseWhileCompiling: true },
  build: { saveBeforeCompile: true },
  pdf: { defaultZoom: "fit-width" },
  window: { width: null, height: null, x: null, y: null, maximized: false },
  session: { lastProject: null },
  layout: {
    sidebarVisible: true,
    sidebarWidth: 258,
    previewVisible: true,
    previewRatio: 0.5,
    pvSideWidth: 132,
  },
  general: { restoreLastProject: true, rememberWindow: true, restoreLayout: true },
  tex: { distro: null, installDir: null, engineBinDir: null },
  perl: { installDir: null },
};

/** 字体族 → CSS font-family 栈（应用到 --editor-ff，仅影响编辑器代码区） */
export const FONT_STACKS: Record<EditorFontFamily, string> = {
  "IBM Plex Mono": "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace",
  Consolas: "Consolas, 'Cascadia Mono', monospace",
  "Cascadia Mono": "'Cascadia Mono', Consolas, monospace",
};

/** 深拷贝（设置页快照/草稿与 persisted 用；结构固定无循环引用） */
export function cloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s)) as AppSettings;
}
