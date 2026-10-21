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

/** 激活标签对应的编辑器句柄（jump.ts 跳行用） */
export function setActiveEditorHandle(h: LaTeXEditorHandle | null): void {
  editorHandle = h;
}

/** 菜单/快捷键取用；调用前自行判空 */
export function getActiveView(): EditorView | null {
  return view;
}

export function getActiveEditorHandle(): LaTeXEditorHandle | null {
  return editorHandle;
}
