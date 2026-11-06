// M2·绘图模块：模块内 zustand 状态（最小骨架）。
// 当前仅持有 source / selectedId；后续切片扩展：
//   F1-2 加 layoutMode（三布局）、复用 LaTeXEditor 双向同步；F3 组件库插入；
//   F4 拖拽写回与属性面板。
import { create } from "zustand";

export interface DiagramState {
  /** 当前绘图源码（完整 tikzpicture 环境；F1-2 起由 Tab 内 LaTeXEditor 受控驱动） */
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
}));
