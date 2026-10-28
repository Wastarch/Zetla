// M1-14j · 文档语言手动覆盖（按文件路径，仅本次会话有效）
// 状态栏「文档语言」chip 的切换目标：正常情况下按扩展名自动识别（langByExt.langOf），
// 用户手动指定后以本 store 为准，供 LaTeXEditor 装配词法/配色。
import { create } from "zustand";
import type { EditorLang } from "./langByExt";

interface LangOverrideState {
  /** path → 手动指定的语言；缺省表示按扩展名自动识别 */
  byPath: Record<string, EditorLang>;
  /** 指定（lang 为 null 等价于清除，恢复自动识别） */
  setLang: (path: string, lang: EditorLang | null) => void;
  /** 清除某文件的覆盖 */
  reset: (path: string) => void;
}

export const useLangOverride = create<LangOverrideState>((set) => ({
  byPath: {},
  setLang: (path, lang) =>
    set((s) => {
      const next = { ...s.byPath };
      if (lang === null) delete next[path];
      else next[path] = lang;
      return { byPath: next };
    }),
  reset: (path) =>
    set((s) => {
      if (!(path in s.byPath)) return s;
      const next = { ...s.byPath };
      delete next[path];
      return { byPath: next };
    }),
}));
