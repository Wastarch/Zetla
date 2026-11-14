// M2·F2-1 / F2-2 / F2-4：画布 / 侧栏属性 → 源码编辑器的最小写回桥。
//
// DiagramCodePane 与 DiagramCanvas 是 DiagramTab 下的兄弟节点，且源码栏在「仅画布」
// 布局下仍然常驻挂载（只是 hidden）。这里用一个模块级注册表把 CM6 视图暴露给画布：
//   · 写回用最小 span dispatch，而不是 setSource 整篇替换 —— 保证和键盘直接改源码
//     走同一条 CM6 history，Ctrl+Z 一次就能撤销一次拖拽 / 一次属性改动；
//   · 注册方负责校验文档长度 / 内容与 store.source 一致，避免把补丁打到过期文档上；
//   · F2-4 增 replaceLast：在一个同步流程里撤销上一组微调，再从组内基准源码应用
//     合并补丁，让「连续微调」在 history 里只占一条记录；
//   · 没有视图时（极端情况：源码栏被卸载）由画布降级为 setSource，功能不丢但无撤销记录。
import type { EditorView } from "@codemirror/view";
import type { SourceSpanPatch } from "./dragEdit.ts";

export interface DiagramSourceBridge {
  getView: () => EditorView | null;
  /** 应用最小补丁；返回 false 表示视图不可用或源码已过期 */
  patch: (patch: SourceSpanPatch, expectedSource: string) => boolean;
  /**
   * F3-3：一次 dispatch 多个互不重叠的 span 补丁（拖组 / 多选整体平移）。
   * CM6 的一次 transaction 天然只占一条 history，因此「3 个图元一起移动」
   * 按一次 Ctrl+Z 就能退回；绝不退化成整篇替换。
   */
  patchMany: (patches: readonly SourceSpanPatch[], expectedSource: string) => boolean;
  /**
   * F2-4：撤销上一组微调 → 校验文档回到 expectedBaseSource → 应用从基准出发的
   * 合并补丁。patch 为 null 表示本组回到基准源码（只撤销、不 dispatch）。
   * 任何一步校验失败都必须 redo 回滚到 expectedCurrentSource 并返回 false。
   */
  replaceLast: (
    patch: SourceSpanPatch | null,
    expectedBaseSource: string,
    expectedCurrentSource: string,
    expectedTargetSource: string,
  ) => boolean;
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
