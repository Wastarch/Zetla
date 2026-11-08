// M2·F2-1：画布 → 源码编辑器的最小写回桥。
//
// DiagramCodePane 与 DiagramCanvas 是 DiagramTab 下的兄弟节点，且源码栏在「仅画布」
// 布局下仍然常驻挂载（只是 hidden）。这里用一个模块级注册表把 CM6 视图暴露给画布：
//   · 写回用最小 span dispatch，而不是 setSource 整篇替换 —— 保证和键盘直接改源码
//     走同一条 CM6 history，Ctrl+Z 一次就能撤销一次拖拽；
//   · 注册方负责校验文档长度 / 内容与 store.source 一致，避免把补丁打到过期文档上；
//   · 没有视图时（极端情况：源码栏被卸载）由画布降级为 setSource，功能不丢但无撤销记录。
import type { EditorView } from "@codemirror/view";
import type { SourceSpanPatch } from "./dragEdit.ts";

export interface DiagramSourceBridge {
  getView: () => EditorView | null;
  /** 应用最小补丁；返回 false 表示视图不可用或源码已过期 */
  patch: (patch: SourceSpanPatch, expectedSource: string) => boolean;
  undo: () => boolean;
  redo: () => boolean;
}

let current: DiagramSourceBridge | null = null;

/** 注册并返回注销函数；多个实例时后注册者生效，卸载时只注销自己。 */
export function registerDiagramSourceBridge(bridge: DiagramSourceBridge): () => void {
  current = bridge;
  return () => {
    if (current === bridge) current = null;
  };
}

export function getDiagramSourceBridge(): DiagramSourceBridge | null {
  return current;
}
