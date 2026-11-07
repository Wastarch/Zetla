// M2 · 绘图模块 F1-4：把 TikZ 源码插入主 .tex 文档。
// 坑一：伪 buffer Tab（diagram://editor）活动时 getActiveView() / insertSnippet() 会失效，
//       必须靠打开 Tab 时锁定的 targetTex 取 getEditorView(targetTex)，再 dispatch + setActive。
// 坑二：图片/代码插入复用既有管线；本切片只插入源码，不碰 importImage.precheck()
//       （后者要求活动缓冲以 .tex 结尾，diagram Tab 下必然失败）。
// 纯字符串逻辑（导言区幂等 / 片段组装）拆在 diagramSnippet.ts，便于 Node 侧回归。
import type { EditorView } from "@codemirror/view";
import { getEditorView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { notify } from "@/project/useProject";
import { useDiagramStore } from "./store";
import {
  buildDiagramInsertCode,
  collectTikzLibraries,
  ensureTikzPreamble,
} from "./diagramSnippet";

/** 把片段插进导言区 \begin{document} 之前（独占一行）；找不到则追加到文末 */
function insertPreamble(view: EditorView, snippet: string): void {
  const doc = view.state.doc.toString();
  const m = doc.match(/\\begin\{document\}/);
  const at = m?.index ?? doc.length;
  const lineStart = at < doc.length ? doc.lastIndexOf("\n", at - 1) + 1 : doc.length;
  // 不传 selection：CodeMirror 会自动把当前光标按 ChangeSet 映射，
  // 下一步读到的 head 仍是用户原来的光标（已向后偏移）。
  view.dispatch({ changes: { from: lineStart, insert: `${snippet}\n` } });
}

/** 在光标处插入代码（同 FigureSidebar.insertGenerated 的口径） */
function insertAtCursor(view: EditorView, code: string): void {
  const pos = view.state.selection.main.head;
  const needLeading = pos > 0 && !view.state.doc.sliceString(pos - 1, pos).includes("\n");
  const text = `${needLeading ? "\n" : ""}${code}\n`;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
}

/**
 * 侧栏主操作。成功返回 true；失败已通过 notify 提示原因，且不改动主文档。
 * 不触发自动编译（避免打扰用户），与拼图模块不同。
 */
export function insertDiagramCode(): boolean {
  const { source, targetTex, wrapFigure, caption, label } = useDiagramStore.getState();
  if (!source.trim()) {
    notify("绘图源码为空，无法插入", "err");
    return false;
  }
  if (!targetTex) {
    notify("未锁定目标 .tex 文档，请先在 .tex 标签页活动时打开绘图 Tab", "err");
    return false;
  }
  const view = getEditorView(targetTex);
  if (!view) {
    notify("目标文档编辑器未打开，请切回该 .tex 标签页后重试", "err");
    return false;
  }

  const preamble = ensureTikzPreamble(view.state.doc.toString(), collectTikzLibraries(source));
  if (preamble) insertPreamble(view, preamble);
  insertAtCursor(view, buildDiagramInsertCode(source, wrapFigure, caption, label));
  view.focus();
  useBuffersStore.getState().setActive(targetTex);
  notify(
    preamble
      ? "已插入 TikZ 源码，并在导言区补齐 tikz 宏包与依赖库"
      : "已插入 TikZ 源码（导言区依赖已齐备）",
    "ok",
  );
  return true;
}
