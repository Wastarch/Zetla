// M2·绘图模块：模块内 zustand 状态。
// F1-1 起持有 source / targetTex；F1-2 增三布局 layoutMode 与分屏比例 splitRatio，
// 并用 localStorage 做轻量持久化（F1-5 再收敛到统一偏好设置）。
// 后续切片扩展：F3 组件库插入；F4 拖拽写回与属性面板。
import { create } from "zustand";

/** Tab 内三种布局：仅画布 / 仅源码 / 左右分屏（都是同一个 diagram://editor Tab 内的视图状态） */
export type LayoutMode = "canvas" | "code" | "split";

const LAYOUT_KEY = "zetla.diagram.layoutMode";
const RATIO_KEY = "zetla.diagram.splitRatio";
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

function clampRatio(n: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, n));
}

function readLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === "canvas" || v === "code" || v === "split" ? v : "split";
  } catch {
    return "split";
  }
}

function readRatio(): number {
  try {
    const raw = localStorage.getItem(RATIO_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampRatio(n) : 0.5;
  } catch {
    return 0.5;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式 / 无 storage：忽略，布局仅本次会话有效，不影响编辑。
  }
}

export interface DiagramState {
  /** 当前绘图源码（完整 tikzpicture 环境；由 Tab 内 LaTeXEditor 受控驱动） */
  source: string;
  setSource: (s: string) => void;
  /** 当前选中图元 id（F4 属性面板用；当前占位） */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /**
   * 编辑完成后代码要插入的目标 .tex 绝对路径（F1-1 打开绘图 Tab 时锁定）。
   * 伪 buffer Tab 活动时 getActiveView() 会失效，F1-4 必须靠此路径取 getEditorView(targetTex)。
   */
  targetTex: string | null;
  setTargetTex: (p: string | null) => void;
  /** F1-2：Tab 内布局（仅画布 / 仅源码 / 分屏），开关在 Tab 内部 */
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  /** F1-2：分屏时左栏（画布）占容器宽度的比例，钳在 0.2–0.8 */
  splitRatio: number;
  setSplitRatio: (r: number) => void;
}

/** 默认示例源码：标准 TikZ，含矩形/圆节点/箭头，供后续切片渲染与拖拽演示 */
export const DEFAULT_DIAGRAM_SOURCE = `\\begin{tikzpicture}
  \\draw[thick, rounded corners] (0,0) rectangle (3,2);
  \\node[draw, circle, fill=blue!20] (a) at (1,1) {A};
  \\node[draw, circle, fill=red!20]  (b) at (2.5,1) {B};
  \\draw[->, thick] (a) -- (b);
\\end{tikzpicture}`;

export const useDiagramStore = create<DiagramState>((set) => ({
  source: DEFAULT_DIAGRAM_SOURCE,
  setSource: (s) => set({ source: s }),
  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),
  targetTex: null,
  setTargetTex: (p) => set({ targetTex: p }),
  layoutMode: readLayout(),
  setLayoutMode: (m) => {
    writeSetting(LAYOUT_KEY, m);
    set({ layoutMode: m });
  },
  splitRatio: readRatio(),
  setSplitRatio: (r) => {
    const v = clampRatio(r);
    writeSetting(RATIO_KEY, String(v));
    set({ splitRatio: v });
  },
}));
