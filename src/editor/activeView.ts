// 顶部菜单栏命令桥（M0-13 前移）：模块级持有当前活动编辑器视图。
// 方案 A 多实例常驻下，EditorWorkspace 在激活标签变化时登记对应实例；
// 菜单「撤销/重做/切换注释」与后续全局快捷键经此派发 CM6 命令。
// M0-12：另登记活动编辑器句柄（错误定位跳行 jump.ts 直接调用）。
import type { EditorView } from "@codemirror/view";
import type { LaTeXEditorHandle } from "./LaTeXEditor";

let view: EditorView | null = null;
let editorHandle: LaTeXEditorHandle | null = null;

/** 激活标签变化/编辑器卸载时登记（null = 无活动编辑器） */
export function setActiveView(v: EditorView | null): void {
  view = v;
}

/** 激活标签对应的编辑器句柄（jump.ts 跳行 / 模块插入用） */
export function setActiveEditorHandle(h: LaTeXEditorHandle | null): void {
  editorHandle = h;
}

/**
 * 取当前活动编辑器视图。
 * M1-1 修正：CM6 的 EditorView 由 @uiw/react-codemirror 在容器 ref → setContainer →
 * 再渲染后的 layout effect 中创建，切换标签那一刻句柄已就绪但 getView() 可能仍为 null。
 * 早期实现把 getView() 的返回值快照进 view，一旦快照到 null 就会永久失准
 * （菜单撤销/重做、模块 insertSnippet 静默失效）。改为经句柄**实时**解析。
 */
export function getActiveView(): EditorView | null {
  return editorHandle ? editorHandle.getView() : view;
}

export function getActiveEditorHandle(): LaTeXEditorHandle | null {
  return editorHandle;
}
