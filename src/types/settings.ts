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
    fontSize: number; // 12 | 13 | 14 | 16
    lineWrapping: boolean;
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
}

/** 前端兜底默认值（与 Rust Default 一致；正常路径以 load_app_config 返回为准） */
export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  editor: { fontFamily: "IBM Plex Mono", fontSize: 13, lineWrapping: true },
  autosave: { enabled: true, intervalSeconds: 30, pauseWhileCompiling: true },
  build: { saveBeforeCompile: true },
  pdf: { defaultZoom: "fit-width" },
};

/** 字体族 → CSS font-family 栈（应用到 --editor-ff，仅影响编辑器代码区） */
export const FONT_STACKS: Record<EditorFontFamily, string> = {
  "IBM Plex Mono": "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace",
  Consolas: "Consolas, 'Cascadia Mono', monospace",
  "Cascadia Mono": "'Cascadia Mono', Consolas, monospace",
};
