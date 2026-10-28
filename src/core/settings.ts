// M0-14a/M0-13 · 偏好设置状态（zustand）
// load 启动读取 / setSettings 即时预览（设置页改动立刻生效，不落盘）/ save 落盘并更新
// persisted：最后一次落盘值 —— 窗口/布局等「旁路自动保存」以它为基底写盘，
// 避免设置页未保存的预览改动被串写进 config
// useSettingsEffects 把编辑器设置应用到 CSS 变量（--editor-fs / --editor-ff）
import { useEffect } from "react";
import { create } from "zustand";
import { configApi } from "@/ipc/invoke";
import {
  DEFAULT_SETTINGS,
  DEFAULT_AUX_EXTENSIONS,
  FONT_STACKS,
  cloneSettings,
  type AppSettings,
  type AppTheme,
  type EffectiveTheme,
} from "@/types/settings";
import type { ProjectEntry } from "@/types/project";

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
/** 滚轮缩放字号 → 落盘防抖计时器（模块级，跨 store 调用共享） */
let fontPersistTimer: number | undefined;

/**
 * M1-2b：主题设置值 → 生效主题。"auto" 取系统偏好（prefers-color-scheme: dark）；
 * <html data-theme> 与 CM6 只认 light/dark，故解析集中在此一处。
 */
export function resolveTheme(theme: AppTheme): EffectiveTheme {
  if (theme !== "auto") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

interface SettingsState {
  /** 运行时设置（设置页即时预览直接写这里） */
  settings: AppSettings;
  /** 最后一次落盘值（旁路保存的基底） */
  persisted: AppSettings;
  /** 启动 load_app_config 完成后为 true（避免默认值抢先落盘/启动自动保存） */
  loaded: boolean;
  load: () => Promise<void>;
  /** 仅更新运行时设置（设置页即时预览） */
  setSettings: (next: AppSettings) => void;
  /** 落盘并更新（设置页「保存设置」）；失败抛异常由调用方提示 */
  save: (next: AppSettings) => Promise<void>;
  /**
   * 旁路落盘（M0-13 窗口尺寸/布局/上次项目自动保存）：
   * 以 persisted 为基底合并 patch 写文件，不动运行时预览值
   */
  persist: (patch: Partial<AppSettings>) => Promise<void>;
  /**
   * Ctrl+滚轮缩放字体（M0-14a 用户追加）：deltaY<0 放大 / >0 缩小，步进 1px，
   * clamp 8–32；运行时立即生效，500ms 防抖以 persisted 为基底落盘（不串写设置页草稿）
   */
  zoomEditorFont: (deltaY: number) => void;
  /**
   * M1-2：切换明暗主题（菜单栏快捷入口）。运行时立即生效（useSettingsEffects 同步
   * <html data-theme>），并即时落盘（低频操作，无需防抖；以 persisted 为基底不串写草稿）
   */
  setTheme: (theme: AppTheme) => void;
  /**
   * M1-2b：生效主题（"auto" 时为系统偏好解析值；运行时态不落盘，
   * 由 useSettingsEffects 在设置/系统偏好变化时写入，LaTeXEditor/MenuBar 订阅）
   */
  effectiveTheme: EffectiveTheme;
  setEffectiveTheme: (t: EffectiveTheme) => void;
  /**
   * M1-15a：同步最近项目注册表镜像。后端 register/pin/archive 已写盘并返回最新列表，
   * 此处同时更新 settings 与 persisted，避免后续 persist（以 persisted 为基底整写）
   * 用旧值回写、把注册表清空。
   */
  setRecentProjects: (list: ProjectEntry[]) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  persisted: DEFAULT_SETTINGS,
  loaded: false,
  effectiveTheme: resolveTheme(DEFAULT_SETTINGS.general.theme),
  load: async () => {
    try {
      const cfg = await configApi.loadAppConfig();
      const next = { ...DEFAULT_SETTINGS, ...cfg };
      // M1-9c：空列表 = 使用内置默认清单（语义统一）；旧配置缺字段时回退默认，UI 不显示空白列表
      if (
        !Array.isArray(next.build.cleanAuxExtensions) ||
        next.build.cleanAuxExtensions.length === 0
      ) {
        next.build.cleanAuxExtensions = [...DEFAULT_AUX_EXTENSIONS];
      }
      set({ settings: next, persisted: cloneSettings(next), loaded: true });
    } catch (e) {
      console.warn("[settings] 读取配置失败，使用默认值", e);
      set({ loaded: true });
    }
  },
  setSettings: (next) => set({ settings: next }),
  save: async (next) => {
    await configApi.saveAppConfig(next);
    set({ settings: next, persisted: cloneSettings(next) });
  },
  persist: async (patch) => {
    const st = get();
    if (!st.loaded) return;
    const merged = { ...cloneSettings(st.persisted), ...patch };
    try {
      await configApi.saveAppConfig(merged);
      set({ persisted: merged });
    } catch (e) {
      // 旁路保存失败不弹 toast（写盘在 500ms 防抖里频繁触发），只记录
      console.warn("[settings] 配置自动保存失败", e);
    }
  },
  zoomEditorFont: (deltaY) => {
    const st = get();
    if (!st.loaded || !st.settings.editor.mouseWheelZoom) return;
    const cur = st.settings.editor.fontSize;
    const next = Math.min(
      FONT_SIZE_MAX,
      Math.max(FONT_SIZE_MIN, cur + (deltaY < 0 ? 1 : -1)),
    );
    if (next === cur) return;
    // 1) 运行时立即生效（useSettingsEffects 同步 CSS 变量）
    set((s) => ({
      settings: { ...s.settings, editor: { ...s.settings.editor, fontSize: next } },
    }));
    // 2) 防抖落盘：以 persisted 为基底只改 editor.fontSize（不动设置页可能存在的预览草稿）
    if (fontPersistTimer !== undefined) window.clearTimeout(fontPersistTimer);
    fontPersistTimer = window.setTimeout(() => {
      fontPersistTimer = undefined;
      const base = get().persisted.editor;
      void get().persist({ editor: { ...base, fontSize: get().settings.editor.fontSize } });
    }, 500);
  },
  setTheme: (theme) => {
    const st = get();
    set((s) => ({ settings: { ...s.settings, general: { ...s.settings.general, theme } } }));
    // 即时落盘：低频操作直接写（与设置页保存走同一通道，但不动设置页草稿）
    if (st.loaded) {
      void get().persist({ general: { ...st.persisted.general, theme } });
    }
  },
  // 生效主题由 useSettingsEffects 统一写入（值不变时不触发订阅者重渲染）
  setEffectiveTheme: (t) => set((s) => (s.effectiveTheme === t ? s : { effectiveTheme: t })),
  // M1-15a：注册表镜像（同时写 settings 与 persisted，防 persist 回写旧值）
  setRecentProjects: (list) =>
    set((s) => ({
      settings: { ...s.settings, recentProjects: list },
      persisted: { ...s.persisted, recentProjects: list },
    })),
}));

/** 编辑器行列 CSS 变量同步（字号/字体族）+ 明暗主题同步，App 根部调用 */
export function useSettingsEffects(): void {
  const editor = useSettingsStore((s) => s.settings.editor);
  const theme = useSettingsStore((s) => s.settings.general.theme);
  const setEffectiveTheme = useSettingsStore((s) => s.setEffectiveTheme);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-fs", `${editor.fontSize}px`);
    root.style.setProperty("--editor-ff", FONT_STACKS[editor.fontFamily]);
  }, [editor.fontFamily, editor.fontSize]);
  // 主题：<html data-theme> 驱动 zetla.css 双 token 块 + color-scheme（原生滚动条/表单控件）
  // CM6 编辑器主题由 LaTeXEditor 订阅 effectiveTheme 经 theme prop 切换（非 CSS 层）
  // M1-2b："auto" = 跟随系统 —— 监听 prefers-color-scheme，系统切换时实时重算生效主题
  useEffect(() => {
    const apply = () => {
      const eff = resolveTheme(theme);
      document.documentElement.dataset.theme = eff;
      setEffectiveTheme(eff);
    };
    apply();
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, setEffectiveTheme]);
}

/** 深拷贝（设置页快照/草稿用；类型定义处实现，此处转发） */
export { cloneSettings } from "@/types/settings";
