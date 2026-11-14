// M2 · 绘图模块 F1-4：把 TikZ 源码插入主 .tex 文档。
// 坑一：伪 buffer Tab（diagram://editor）活动时 getActiveView() / insertSnippet() 会失效，
//       必须靠打开 Tab 时锁定的 targetTex 取 getEditorView(targetTex)，再 dispatch + setActive。
// 坑二：图片/代码插入复用既有管线；本切片只插入源码，不碰 importImage.precheck()
//       （后者要求活动缓冲以 .tex 结尾，diagram Tab 下必然失败）。
// 纯字符串逻辑（导言区幂等 / 片段组装）拆在 diagramSnippet.ts，便于 Node 侧回归。
import type { EditorView } from "@codemirror/view";
import { getEditorView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { notify, parentOf } from "@/project/useProject";
import { buildDiagramFigureSnippet } from "./figureInsert";
import { promoteFromInsertedCode } from "./imageStaging";
// P3：按「本次真正写进主文档的代码」判定要不要补 graphicx 导言区
import { sourceNeedsGraphicx } from "./imageNodeInsert.ts";
import { useDiagramStore } from "./store";
import {
  buildDiagramInsertCode,
  collectTikzLibraries,
  ensureGraphicxPreamble,
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

  // P3：源码含 P3 生成的 \node{\includegraphics{…}} 时补 graphicx，
  // 否则主文档可能只有 tikz 却没显式加载 graphicx（P0：显式补无冲突）。
  const preamble = ensureTikzPreamble(
    view.state.doc.toString(),
    collectTikzLibraries(source),
    sourceNeedsGraphicx(source),
  );
  if (preamble) insertPreamble(view, preamble);
  const code = buildDiagramInsertCode(source, wrapFigure, caption, label);
  insertAtCursor(view, code);
  // P2 转正：按「主文档最终写入的 \includegraphics 路径命中者」保留暂存图（一次性快照）
  void promoteFromInsertedCode(code);
  view.focus();
  useBuffersStore.getState().setActive(targetTex);
  notify(
    preamble
      ? "已插入 TikZ 源码，并在导言区补齐所需宏包与依赖库"
      : "已插入 TikZ 源码（导言区依赖已齐备）",
    "ok",
  );
  return true;
}

/**
 * F5-2：把刚导出落盘的图片以 figure 环境插入主文档（导出闭环的最后一公里）。
 *
 * 与 `insertDiagramCode` 同受「坑一」约束：绘图 Tab 是伪 buffer，活动视图不是目标
 * .tex，`getActiveView()` 取不到正确编辑器 —— 必须用打开 Tab 时锁定的 `targetTex`
 * 调 `getEditorView(targetTex)`，插完再 `setActive` 切回去。
 *
 * 相对路径按 `targetTex` 所在目录折算（`\includegraphics` 认相对路径），label 由
 * 文件名 slug 生成，caption 留空并把光标落在 `\caption{ }` 内 —— 与 R5 拖拽导入
 * (`importImage.finalize`) 的落点保持一致，便于用户直接敲图题。
 *
 * 失败时只提示、不改动主文档（图片此时已落盘，提示文案会说明这一点）。
 */
export function insertFigureForImage(absImagePath: string): boolean {
  const { targetTex } = useDiagramStore.getState();
  if (!targetTex) {
    notify("未锁定目标 .tex 文档：图片已保存，但未插入源码", "err");
    return false;
  }
  const view = getEditorView(targetTex);
  if (!view) {
    notify("目标文档编辑器未打开：图片已保存，未插入源码；请切回该 .tex 后重试", "err");
    return false;
  }

  // 「按画布尺寸导出」时画布本身已决定物理尺寸，插图直接用该宽度，避免再被
  // \linewidth 缩放（否则固定画布的图会被放大到版心、与预览所见不一致）。
  const { exportUseCanvas, canvasSize } = useDiagramStore.getState();
  const width =
    exportUseCanvas && canvasSize.preset !== "auto"
      ? `${canvasSize.widthCm}cm`
      : undefined;
  const { snippet, captionOffset } = buildDiagramFigureSnippet({
    texDir: parentOf(targetTex),
    imageAbsPath: absImagePath,
    width,
  });

  // P3：figure 片段必然含 \includegraphics，主文档缺 graphicx 时补导言区。
  // 只补 graphicx —— 导出成品图的主文档不必用 tikz，别顺带塞 \usepackage{tikz}。
  // 顺序同 insertDiagramCode：先写 preamble，再读光标（CM6 自动映射位置）。
  const preamble = ensureGraphicxPreamble(view.state.doc.toString());
  if (preamble) insertPreamble(view, preamble);

  const pos = view.state.selection.main.head;
  const needLeading = pos > 0 && !view.state.doc.sliceString(pos - 1, pos).includes("\n");
  const lead = needLeading ? "\n" : "";
  view.dispatch({
    changes: { from: pos, insert: `${lead}${snippet}\n` },
    selection: { anchor: pos + lead.length + captionOffset },
  });
  // P2：这里插入的是「导出成品」figure/diagram.png，源图不会命中 → 留待关 Tab 清理
  void promoteFromInsertedCode(snippet);
  view.focus();
  useBuffersStore.getState().setActive(targetTex);
  return true;
}
