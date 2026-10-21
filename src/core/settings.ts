// M0-14a/M0-13 · 偏好设置状态（zustand）
// load 启动读取 / setSettings 即时预览（设置页改动立刻生效，不落盘）/ save 落盘并更新
// persisted：最后一次落盘值 —— 窗口/布局等「旁路自动保存」以它为基底写盘，
// 避免设置页未保存的预览改动被串写进 config
// useSettingsEffects 把编辑器设置应用到 CSS 变量（--editor-fs / --editor-ff）
import { useEffect } from "react";
import { create } from "zustand";
import { configApi } from "@/ipc/invoke";
import { DEFAULT_SETTINGS, FONT_STACKS, cloneSettings, type AppSettings } from "@/types/settings";

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
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  persisted: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const cfg = await configApi.loadAppConfig();
      const next = { ...DEFAULT_SETTINGS, ...cfg };
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

/** 深拷贝（设置页快照/草稿用；类型定义处实现，此处转发） */
export { cloneSettings } from "@/types/settings";
