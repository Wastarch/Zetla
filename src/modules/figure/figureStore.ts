// F1 · 拼图功能会话状态（zustand，不落盘——重启/切项目即清空，与 composeStore 同口径）
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
  subLabel,
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
  /** 移动子图位置（拖拽排序）；同时按新位置重排 label 与选中索引 */
  reorder: (from: number, to: number) => void;
  /** 更新单格字段（label 由索引自动生成，不在此覆盖） */
  updateCell: (index: number, patch: Partial<Omit<FigureCell, "label">>) => void;
  /** 设置单格裁剪（四边归一化 0–1） */
  setCrop: (index: number, crop: FigureCell["crop"]) => void;
  /** 设置垂直对齐（**行级属性**：LaTeX 同行子图共享基线，必须整行统一，故写整行） */
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

/**
 * 按当前顺序重排每格 label（fig:sub-a/b/c…）。
 * label 在 makeCell 时按索引写死，删除/拖拽排序后位置会变，必须重算，
 * 否则展示徽标（按位置）与生成代码里的 \label（按旧 label）会错位。
 */
function relabel(cells: FigureCell[]): FigureCell[] {
  let changed = false;
  const next = cells.map((c, i) => {
    const want = subLabel(i);
    if (c.label === want) return c;
    changed = true;
    return { ...c, label: want };
  });
  return changed ? next : cells;
}

/**
 * 按图片数量自动给出接近正方形的网格（如 4→2×2、5→3×2、6→3×2）。
 * 仅在导入时套用；用户之后可手动在侧栏改行列覆盖。
 */
export function autoGrid(n: number): { rows: number; cols: number } {
  const k = Math.max(1, Math.floor(n));
  const cols = Math.ceil(Math.sqrt(k));
  const rows = Math.ceil(k / cols);
  return { rows, cols };
}

export const useFigureStore = create<FigureState>((set) => ({
  layout: defaultLayout(),
  active: false,
  targetTex: null,

  initFromImages: (sources, targetTex) =>
    set((s) => {
      const cells = sources.map((src, i) => makeCell(src, i));
      const grid = autoGrid(cells.length);
      return {
        active: true,
        targetTex: targetTex ?? s.targetTex,
        layout: {
          ...s.layout,
          cells,
          rows: grid.rows,
          cols: grid.cols,
        },
      };
    }),

  addImages: (sources) =>
    set((s) => {
      const cells = [
        ...s.layout.cells,
        ...sources.map((src, k) => makeCell(src, s.layout.cells.length + k)),
      ];
      const grid = autoGrid(cells.length);
      return {
        active: true,
        layout: {
          ...s.layout,
          cells,
          rows: grid.rows,
          cols: grid.cols,
        },
      };
    }),

  setGrid: (rows, cols) =>
    set((s) => ({
      layout: { ...s.layout, rows: clampGrid(rows), cols: clampGrid(cols) },
    })),

  removeCell: (index) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      cells.splice(index, 1);
      // 删除后位置前移，重新按新顺序编号（否则 fig:sub-b 之后会跳号/错位）
      const next = relabel(cells);
      // 选中索引修正：删除的正是选中项→取消选中；之后的项索引前移
      const sel = s.layout.selectedIndex;
      const selectedIndex =
        sel === index ? -1 : sel > index ? sel - 1 : sel;
      return { layout: { ...s.layout, cells: next, selectedIndex } };
    }),

  reorder: (from, to) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      const n = cells.length;
      if (from < 0 || from >= n || to < 0 || to >= n || from === to) return s;
      const [moved] = cells.splice(from, 1);
      cells.splice(to, 0, moved!);
      // 顺序变了 → 重排 label，保证徽标 / 生成代码 / 预览三者编号一致
      const next = relabel(cells);
      // 选中索引跟随：移动项指向新位置；区间内的项整体 ±1 平移
      const sel = s.layout.selectedIndex;
      let selectedIndex = sel;
      if (sel === from) selectedIndex = to;
      else if (from < sel && sel <= to) selectedIndex = sel - 1;
      else if (to <= sel && sel < from) selectedIndex = sel + 1;
      return { layout: { ...s.layout, cells: next, selectedIndex } };
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

  // 对齐是行级属性：同行（同一条 LaTeX 基线）子图必须统一，否则 [b] 上飘/[t] 下垂。
  setAlign: (index, align) =>
    set((s) => {
      const cells = s.layout.cells.slice();
      if (index < 0 || index >= cells.length) return s;
      const row = Math.floor(index / s.layout.cols);
      const start = row * s.layout.cols;
      const end = Math.min(cells.length, start + s.layout.cols);
      for (let i = start; i < end; i++) cells[i] = { ...cells[i], align };
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
