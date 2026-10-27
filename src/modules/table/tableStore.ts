// M1-8 · 表格面板草稿状态（zustand）
// 会话内保留：切换侧栏视图不丢网格内容（Sidebar 条件渲染会卸载 TablePanel）。
// 不落盘：网格是一次性构建产物，落盘会与源码产生"面板与文档不一致"的困惑；
// 需要长期保留的只有 settings.table 的默认样式（见 types/settings.ts）。
import { create } from "zustand";
import { createTable, type TableModel } from "./tableModel";

/** 选区：anchor（按下点）+ focus（当前点）→ 矩形由面板取 min/max */
export interface TableSelection {
  ar: number;
  ac: number;
  fr: number;
  fc: number;
}

/** 反向编辑来源（P4）：源码区间 + 内容指纹，更新前校验是否被手改 */
export interface TableSource {
  from: number;
  to: number;
  fingerprint: string;
}

interface TableState {
  model: TableModel;
  sel: TableSelection;
  /** 最近一次「编辑当前表格」定位到的源码区间；null = 新建表格 */
  source: TableSource | null;
  setModel: (m: TableModel) => void;
  update: (fn: (m: TableModel) => TableModel) => void;
  setSel: (s: TableSelection) => void;
  setSource: (s: TableSource | null) => void;
  /** 重置为指定模型（缺省新建 3×3） */
  reset: (m?: TableModel) => void;
}

const initialSel: TableSelection = { ar: 0, ac: 0, fr: 0, fc: 0 };

export const useTableStore = create<TableState>((set) => ({
  model: createTable(3, 3),
  sel: initialSel,
  source: null,
  setModel: (model) => set({ model }),
  update: (fn) => set((s) => ({ model: fn(s.model) })),
  setSel: (sel) => set({ sel }),
  setSource: (source) => set({ source }),
  reset: (m) =>
    set({
      model: m ?? createTable(3, 3),
      sel: initialSel,
      source: null,
    }),
}));

/** 选区 → 有序矩形（r1≤r2、c1≤c2） */
export function selectionRect(sel: TableSelection): {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
} {
  return {
    r1: Math.min(sel.ar, sel.fr),
    c1: Math.min(sel.ac, sel.fc),
    r2: Math.max(sel.ar, sel.fr),
    c2: Math.max(sel.ac, sel.fc),
  };
}
