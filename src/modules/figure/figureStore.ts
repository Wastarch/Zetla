// F1 · 拼图功能会话状态（zustand，不落盘——重启/切项目即清空，与 composeStore 同口径）
// 仅承载 FigureLayout 与基础变更；网格排布算法见 figureGen.ts（F5），UI 见 FigureCanvas.tsx（F2）。
//
// 切片边界：本文件只负责“数据 + 原子变更”，不含画布交互与代码生成。
import { create } from "zustand";
import {
  FigureLayout,
  FigureCell,
  UniformMode,
  VAlign,
  defaultLayout,
  makeCell,
} from "@/types/figure";

export interface FigureState {
  /** 当前布局（行优先） */
  layout: FigureLayout;
  /** 是否处于画布编辑态（单图直插不走画布；F6 多图导入置 true） */
  active: boolean;

  /** 用一批图片路径初始化画布（多图导入预填，行优先；F6 调用） */
  initFromImages: (paths: string[]) => void;
  /** 设置网格行列（≥1，向下取整） */
  setGrid: (rows: number, cols: number) => void;
  /** 更新单格字段（label 由索引自动生成，不在此覆盖） */
  updateCell: (index: number, patch: Partial<Omit<FigureCell, "label">>) => void;
  /** 设置单格裁剪（四边归一化 0–1） */
  setCrop: (index: number, crop: FigureCell["crop"]) => void;
  /** 设置单格垂直对齐 */
  setAlign: (index: number, align: VAlign) => void;
  /** 设置全局间距（占列宽比例，clamp 0–1） */
  setGaps: (gapCol: number, gapRow: number) => void;
  /** 设置统一尺寸模式 */
  setUniform: (u: UniformMode) => void;
  /** 设置外层标题 / label */
  setCaption: (c: string) => void;
  setLabel: (l: string) => void;
  /** 打开 / 关闭画布 */
  setActive: (a: boolean) => void;
  /** 重置（清空布局并关闭画布） */
  reset: () => void;
}

const clampGrid = (n: number) => Math.max(1, Math.floor(n));
const clampRatio = (n: number) => Math.min(1, Math.max(0, n));

export const useFigureStore = create<FigureState>((set) => ({
  layout: defaultLayout(),
  active: false,

  initFromImages: (paths) =>
    set((s) => ({
      active: true,
      layout: {
        ...s.layout,
        cells: paths.map((p, i) => makeCell(p, i)),
      },
    })),

  setGrid: (rows, cols) =>
    set((s) => ({
      layout: { ...s.layout, rows: clampGrid(rows), cols: clampGrid(cols) },
    })),

  updateCell: (index, patch) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      cells[index] = { ...cells[index], ...patch };
      return { layout: { ...s.layout, cells } };
    }),

  setCrop: (index, crop) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      cells[index] = { ...cells[index], crop };
      return { layout: { ...s.layout, cells } };
    }),

  setAlign: (index, align) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      cells[index] = { ...cells[index], align };
      return { layout: { ...s.layout, cells } };
    }),

  setGaps: (gapCol, gapRow) =>
    set((s) => ({
      layout: { ...s.layout, gapCol: clampRatio(gapCol), gapRow: clampRatio(gapRow) },
    })),

  setUniform: (uniform) => set((s) => ({ layout: { ...s.layout, uniform } })),
  setCaption: (caption) => set((s) => ({ layout: { ...s.layout, caption } })),
  setLabel: (label) => set((s) => ({ layout: { ...s.layout, label } })),
  setActive: (active) => set({ active }),
  reset: () => set({ layout: defaultLayout(), active: false }),
}));
