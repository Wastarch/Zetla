// M1-12a · 公式侧栏编写区状态（会话级 zustand，**不落盘**——重启/切项目即清空）
// 双区结构的上区「编写区」与下区「输出区域」经此共享：
//   符号/模板点击 → insert() 写入光标处（M1-12b 接通符号面板）
//   输出区实时渲染 text；\Box 空槽点选 → setCursor() 定位（cursorSeq 同步选区）
//   插入编辑器按钮 / Ctrl+Enter → mathInsert.submitCompose() 提交到主编辑器
import { create } from "zustand";

/** 最近使用条目（跨页签共享；符号/公式/模板写入均计入，M1-12c 起由公式库「最近」页签消费） */
export interface RecentItem {
  /** 稳定 key（符号 cmd / 公式 id） */
  key: string;
  /** 展示名 */
  label: string;
  /** LaTeX 源码（点击可再写入） */
  latex: string;
}

/** 最近使用上限（与 FormulaPanel 既有 RECENT_CAP 口径一致） */
export const RECENT_CAP = 12;

/** 编写区字号范围（缩放步进 1px） */
const FONT_MIN = 11;
const FONT_MAX = 20;
/** 输出区预览缩放范围（%，步进 25） */
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

export interface ComposeState {
  /** 编写区 LaTeX 源码 */
  text: string;
  /** 光标偏移（符号/模板的写入处） */
  cursor: number;
  /** 光标变更序号：程序化定位时递增，MathCompose 据此同步 textarea 选区 */
  cursorSeq: number;
  /** 源码 / 可视化（输出区预览形态；切换 UI 随 M1-12b 二级工具栏落地） */
  mode: "source" | "visual";
  /** 编写区字号 px */
  fontSize: number;
  /** 输出区预览缩放 % */
  previewZoom: number;
  /** 最近使用（新→旧） */
  recent: RecentItem[];

  setText: (t: string) => void;
  /** 程序化定位光标（点预览空槽用；bump 序号让编写区同步选区） */
  setCursor: (c: number) => void;
  /** 光标处插入片段（点击符号/模板） */
  insert: (snippet: string) => void;
  setMode: (m: "source" | "visual") => void;
  /** 编写区字号缩放（±1px，clamp 11–20） */
  zoomFont: (d: number) => void;
  /** 输出区预览缩放（±25%，clamp 50–200） */
  zoomPreview: (d: number) => void;
  clear: () => void;
  pushRecent: (it: RecentItem) => void;
}

export const useComposeStore = create<ComposeState>((set) => ({
  text: "",
  cursor: 0,
  cursorSeq: 0,
  mode: "source",
  fontSize: 13,
  previewZoom: 100,
  recent: [],

  setText: (t) => set({ text: t }),
  setCursor: (c) => set((s) => ({ cursor: c, cursorSeq: s.cursorSeq + 1 })),
  insert: (snippet) =>
    set((s) => {
      const c = Math.min(Math.max(s.cursor, 0), s.text.length);
      return {
        text: s.text.slice(0, c) + snippet + s.text.slice(c),
        cursor: c + snippet.length,
        cursorSeq: s.cursorSeq + 1,
      };
    }),
  setMode: (m) => set({ mode: m }),
  zoomFont: (d) =>
    set((s) => ({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + d)) })),
  zoomPreview: (d) =>
    set((s) => ({
      previewZoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.previewZoom + d)),
    })),
  clear: () => set((s) => ({ text: "", cursor: 0, cursorSeq: s.cursorSeq + 1 })),
  pushRecent: (it) =>
    set((s) => ({
      recent: [it, ...s.recent.filter((r) => r.key !== it.key)].slice(0, RECENT_CAP),
    })),
}));
