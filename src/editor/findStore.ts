// 单文件查找替换的共享状态（zustand）。
// 两个入口复用同一份状态：编辑区 TabBar 的查找按钮、以及全局搜索点击命中后的「就地高亮」。
// 面板自身读取/修改本 store；全局搜索通过 openFind(init) 预填 query 与开关并唤起面板。
import { create } from "zustand";

export interface FindInit {
  query?: string;
  replace?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  replaceMode?: boolean;
  preserveCase?: boolean;
}

interface FindState {
  /** 面板是否打开（渲染 FindReplacePanel 的依据） */
  open: boolean;
  /** 是否展开替换框 */
  replaceMode: boolean;
  /** 保留大小写（替换时对齐被替换文本的大小写形态） */
  preserveCase: boolean;
  query: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;

  openFind: (init?: FindInit) => void;
  closeFind: () => void;
  setQuery: (q: string) => void;
  setReplace: (r: string) => void;
  toggleCase: () => void;
  toggleWord: () => void;
  toggleRegex: () => void;
  toggleReplaceMode: () => void;
  togglePreserveCase: () => void;
}

export const useFindStore = create<FindState>((set) => ({
  open: false,
  replaceMode: false,
  preserveCase: false,
  query: "",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,

  openFind: (init) =>
    set((s) => ({
      open: true,
      replaceMode: init?.replaceMode ?? s.replaceMode,
      preserveCase: init?.preserveCase ?? s.preserveCase,
      query: init?.query ?? s.query,
      replace: init?.replace ?? s.replace,
      caseSensitive: init?.caseSensitive ?? s.caseSensitive,
      wholeWord: init?.wholeWord ?? s.wholeWord,
      regexp: init?.regexp ?? s.regexp,
    })),
  closeFind: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  setReplace: (replace) => set({ replace }),
  toggleCase: () => set((s) => ({ caseSensitive: !s.caseSensitive })),
  toggleWord: () => set((s) => ({ wholeWord: !s.wholeWord })),
  toggleRegex: () => set((s) => ({ regexp: !s.regexp })),
  toggleReplaceMode: () => set((s) => ({ replaceMode: !s.replaceMode })),
  togglePreserveCase: () => set((s) => ({ preserveCase: !s.preserveCase })),
}));

/**
 * 非响应式的动作桥：FindReplacePanel 挂载时登记 next/prev/focusFind，
 * 供 EditorWorkspace 的 F3 / Ctrl+F 快捷键调用，从而保持面板计数与编辑器同步刷新。
 */
export const findPanelBridge: {
  next: (() => void) | null;
  prev: (() => void) | null;
  focusFind: (() => void) | null;
} = { next: null, prev: null, focusFind: null };
