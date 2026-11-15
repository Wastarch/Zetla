// Zotero 联动 · P2 Citation Picker 开关状态（与 UI 解耦，供全局快捷键直接打开）
// 只存「是否打开 / 从哪里打开」，搜索词与选区都是浮层内的临时态，关闭即丢弃。
import { create } from "zustand";

interface ZoteroPickerState {
  open: boolean;
  /** 唤起时的活动 .tex 路径（仅用于提示，不参与插入逻辑） */
  openedAt: string | null;
  openPicker: (file: string) => void;
  closePicker: () => void;
}

export const useZoteroPicker = create<ZoteroPickerState>((set) => ({
  open: false,
  openedAt: null,
  openPicker: (file) => set({ open: true, openedAt: file }),
  closePicker: () => set({ open: false, openedAt: null }),
}));
