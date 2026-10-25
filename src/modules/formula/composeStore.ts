// M1-12a · 公式侧栏编写区状态（会话级 zustand，**不落盘**——重启/切项目即清空）
// M1-12b：cursor → selStart/selEnd 选区模型——工具栏「字体/字号/环境」要包裹编写区
//          选区，符号插入要替换选区（与打字行为一致），单光标无法表达这两件事。
// 双区结构的上区「编写区」与下区「输出区域」经此共享：
//   符号/模板点击 → insert() 写入光标处（M1-12b 接通符号面板）
//   输出区实时渲染 text；\Box 空槽点选 → setCursor() 定位（cursorSeq 同步选区）
//   插入编辑器按钮 / Ctrl+Enter → mathInsert.submitCompose() 提交到主编辑器
import { create } from "zustand";
import { SLOT_MARK } from "@/editor/slotRange";

/** 最近使用条目（跨页签共享；符号/公式/模板写入均计入，M1-12c 起由公式库「最近」页签消费） */
export interface RecentItem {
  /** 稳定 key（符号 cmd / 公式 id / tpl:<id>） */
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

const clamp = (v: number, len: number) => Math.min(Math.max(v, 0), len);

export interface ComposeState {
  /** 编写区 LaTeX 源码 */
  text: string;
  /** textarea 选区起点（折叠时 = selEnd；工具栏包裹与符号插入都基于它） */
  selStart: number;
  /** textarea 选区终点 */
  selEnd: number;
  /** 选区/光标变更序号：程序化定位时递增，MathCompose 据此同步 textarea 选区 */
  cursorSeq: number;
  /** 源码 / 可视化（可视化 = KaTeX 只读渲染，点空槽切回源码定位） */
  mode: "source" | "visual";
  /** 编写区字号 px（可视化模式下为渲染字号） */
  fontSize: number;
  /** 输出区预览缩放 % */
  previewZoom: number;
  /** 最近使用（新→旧） */
  recent: RecentItem[];

  /** 用户编辑（打字/删除）：文本 + 选区一把更新 */
  edit: (t: string, selStart: number, selEnd: number) => void;
  /** 程序化选区（bump 序号让编写区同步） */
  setSelection: (a: number, b: number) => void;
  /** 程序化光标定位（点预览空槽用） */
  setCursor: (c: number) => void;
  /** 光标处插入片段：替换当前选区（点击符号/模板） */
  insert: (snippet: string) => void;
  /** 用 prefix/suffix 包裹当前选区（样式工具）；无选区时中间插 \Box 并选中 */
  wrapSelection: (prefix: string, suffix: string) => void;
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
  selStart: 0,
  selEnd: 0,
  cursorSeq: 0,
  mode: "source",
  fontSize: 13,
  previewZoom: 100,
  recent: [],

  edit: (t, selStart, selEnd) => set({ text: t, selStart, selEnd }),
  setSelection: (a, b) =>
    set((s) => {
      const len = s.text.length;
      const sa = clamp(a, len);
      const sb = clamp(Math.max(b, sa), len);
      return { selStart: sa, selEnd: sb, cursorSeq: s.cursorSeq + 1 };
    }),
  setCursor: (c) =>
    set((s) => {
      const v = clamp(c, s.text.length);
      return { selStart: v, selEnd: v, cursorSeq: s.cursorSeq + 1 };
    }),
  insert: (snippet) =>
    set((s) => {
      const len = s.text.length;
      const a = clamp(s.selStart, len);
      const b = clamp(Math.max(s.selEnd, a), len);
      const end = a + snippet.length;
      return {
        text: s.text.slice(0, a) + snippet + s.text.slice(b),
        selStart: end,
        selEnd: end,
        cursorSeq: s.cursorSeq + 1,
      };
    }),
  wrapSelection: (prefix, suffix) =>
    set((s) => {
      const len = s.text.length;
      const a = clamp(s.selStart, len);
      const b = clamp(Math.max(s.selEnd, a), len);
      const hasSel = a !== b;
      const body = hasSel ? s.text.slice(a, b) : SLOT_MARK;
      const text = s.text.slice(0, a) + prefix + body + suffix + s.text.slice(b);
      // 无选区 → 选中新插入的 \Box（可直接打字替换）；有选区 → 选中整个包裹结果
      const start = hasSel ? a : a + prefix.length;
      const end = hasSel ? a + prefix.length + body.length + suffix.length : start + SLOT_MARK.length;
      return { text, selStart: start, selEnd: end, cursorSeq: s.cursorSeq + 1 };
    }),
  setMode: (m) => set({ mode: m }),
  zoomFont: (d) =>
    set((s) => ({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + d)) })),
  zoomPreview: (d) =>
    set((s) => ({
      previewZoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.previewZoom + d)),
    })),
  clear: () =>
    set((s) => ({ text: "", selStart: 0, selEnd: 0, cursorSeq: s.cursorSeq + 1 })),
  pushRecent: (it) =>
    set((s) => ({
      recent: [it, ...s.recent.filter((r) => r.key !== it.key)].slice(0, RECENT_CAP),
    })),
}));
