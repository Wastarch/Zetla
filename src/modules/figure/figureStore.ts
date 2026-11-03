// F1 · 拼图功能会话状态（zustand，不落盘——重启/切项目即清空，与 composeStore 同口径）
// 仅承载 FigureLayout 与基础变更；网格排布算法见 figureGen.ts（F5），UI 见 FigureCanvas.tsx（F2）。
//
// 切片边界：本文件只负责“数据 + 原子变更”，不含画布交互与代码生成。
import { create } from "zustand";
import {
  FigureLayout,
  FigureCell,
  FigureCellSource,
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
  /** 导入时的目标 .tex 路径（生成代码时插入此文件，即便拼图 Tab 当前活动） */
  targetTex: string | null;

  /** 用一批图片来源初始化画布（多图导入预填，行优先；F6 调用；选图即记录来源，不落盘） */
  initFromImages: (sources: FigureCellSource[], targetTex?: string | null) => void;
  /** 追加图片来源到画布（画布内“添加图片”入口，F6） */
  addImages: (sources: FigureCellSource[]) => void;
  /** 设置网格行列（≥1，向下取整） */
  setGrid: (rows: number, cols: number) => void;
  /** 删除单个子图（清除这张图），并修正选中索引 */
  removeCell: (index: number) => void;
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
  /** 设置渲染 / 导出模式（subfigure | composite，两模式平级） */
  setMode: (m: "subfigure" | "composite") => void;
  /** 设置选中子图索引（-1 未选） */
  setSelectedIndex: (i: number) => void;
  /** 记录某格自然尺寸（缩略图 onLoad 回填，供 §4.2 预算与裁剪换算） */
  setNaturalSize: (index: number, size: { w: number; h: number }) => void;
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
  targetTex: null,

  initFromImages: (sources, targetTex) =>
    set((s) => ({
      active: true,
      targetTex: targetTex ?? s.targetTex,
      layout: {
        ...s.layout,
        cells: sources.map((src, i) => makeCell(src, i)),
      },
    })),

  addImages: (sources) =>
    set((s) => ({
      active: true,
      layout: {
        ...s.layout,
        cells: [
          ...s.layout.cells,
          ...sources.map((src, k) => makeCell(src, s.layout.cells.length + k)),
        ],
      },
    })),

  setGrid: (rows, cols) =>
    set((s) => ({
      layout: { ...s.layout, rows: clampGrid(rows), cols: clampGrid(cols) },
    })),

  removeCell: (index) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      cells.splice(index, 1);
      // 选中索引修正：删除的正是选中项→取消选中；之后的项索引前移
      const sel = s.layout.selectedIndex;
      const selectedIndex =
        sel === index ? -1 : sel > index ? sel - 1 : sel;
      return { layout: { ...s.layout, cells, selectedIndex } };
    }),

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
  setMode: (mode) => set((s) => ({ layout: { ...s.layout, mode } })),
  setSelectedIndex: (selectedIndex) =>
    set((s) => ({ layout: { ...s.layout, selectedIndex } })),
  setNaturalSize: (index, size) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      const prev = cells[index].naturalSize;
      if (prev && prev.w === size.w && prev.h === size.h) return s;
      cells[index] = { ...cells[index], naturalSize: size };
      return { layout: { ...s.layout, cells } };
    }),
  setCaption: (caption) => set((s) => ({ layout: { ...s.layout, caption } })),
  setLabel: (label) => set((s) => ({ layout: { ...s.layout, label } })),
  setActive: (active) => set({ active }),
  reset: () => set({ layout: defaultLayout(), active: false }),
}));
