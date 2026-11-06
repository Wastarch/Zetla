// M2·绘图模块（F1-1）：模块内 zustand 状态（最小骨架）。
// F1-1 仅持有 source / selectedId；后续切片扩展：
//   F1-2 接 CodeMirror 双向同步、F2-1 拖拽写回、F2-2 属性面板、F3 组件库插入。
import { create } from "zustand";

export interface DiagramState {
  /** 当前绘图源码（tikzpicture 环境内代码；F1-1 占位，F1-2 接 CodeMirror） */
  source: string;
  setSource: (s: string) => void;
  /** 当前选中图元 id（F2-2 属性面板用；F1-1 占位） */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
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
}));
