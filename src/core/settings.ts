// M0-14a · 偏好设置状态（zustand）
// load 启动读取 / setSettings 即时预览（设置页改动立刻生效，不落盘）/ save 落盘并更新
// useSettingsEffects 把编辑器设置应用到 CSS 变量（--editor-fs / --editor-ff）
import { useEffect } from "react";
import { create } from "zustand";
import { configApi } from "@/ipc/invoke";
import { DEFAULT_SETTINGS, FONT_STACKS, type AppSettings } from "@/types/settings";

interface SettingsState {
  settings: AppSettings;
  /** 启动 load_app_config 完成后为 true（避免默认值抢先落盘/启动自动保存） */
  loaded: boolean;
  load: () => Promise<void>;
  /** 仅更新运行时设置（设置页即时预览） */
  setSettings: (next: AppSettings) => void;
  /** 落盘并更新；失败抛异常由调用方提示 */
  save: (next: AppSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const cfg = await configApi.loadAppConfig();
      set({ settings: { ...DEFAULT_SETTINGS, ...cfg }, loaded: true });
    } catch (e) {
      console.warn("[settings] 读取配置失败，使用默认值", e);
      set({ loaded: true });
    }
  },
  setSettings: (next) => set({ settings: next }),
  save: async (next) => {
    await configApi.saveAppConfig(next);
    set({ settings: next });
  },
}));

/** 编辑器行列 CSS 变量同步（字号/字体族），App 根部调用 */
export function useSettingsEffects(): void {
  const editor = useSettingsStore((s) => s.settings.editor);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-fs", `${editor.fontSize}px`);
    root.style.setProperty("--editor-ff", FONT_STACKS[editor.fontFamily]);
  }, [editor.fontFamily, editor.fontSize]);
}

/** 深拷贝（设置页快照/草稿用；结构固定无循环引用） */
export function cloneSettings(s: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(s)) as AppSettings;
}
