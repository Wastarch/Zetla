// P2 · 拼图侧栏控制面板（替代原 F2 侧栏内画布）。
// 纯控制，不渲染画布：模式开关 / 行列 / 导入清空预览 / CellList / CellEditor ⇄ GapControls /
// subcaption 检测横幅 / 底部随模式变化的主操作（subfigure→生成代码；composite→P3 占位）。
import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { useFigureStore } from "./figureStore";
import { useBuffersStore } from "@/editor/useBuffers";
import { getActiveView, getEditorView } from "@/editor/activeView";
import { pickImagesToCanvas } from "./figureImport";
import { generateSubfigure } from "./figureGen";
import { hasPackage, SUBCAPTION_SNIPPET } from "@/core/preamble";
import { parentOf, notify, useProjectStore } from "@/project/useProject";
import { relativePath } from "@/editor/image/pathUtils";
import { projectApi } from "@/ipc/invoke";
import { startCompile } from "@/compile/useCompile";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import type { CompileResult } from "@/types";
import CellList from "./CellList";
import CellEditor from "./CellEditor";
import GapControls from "./GapControls";
import "./figure-sidebar.css";

/** 把生成代码插入到指定视图光标处（活动缓冲非 tex 时仍可用目标 tex 视图） */
function insertGenerated(view: EditorView, code: string): { from: number; to: number } {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const needLeading = pos > 0 && !doc.sliceString(pos - 1, pos).includes("\n");
  let text = code;
  if (needLeading) text = "\n" + text;
  text = text + "\n";
  const from = pos;
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
  return { from, to: from + text.length };
}

/** 在目标 tex 的 \begin{document} 前加入 subcaption 宏包 */
function addSubcaptionToPreamble(view: EditorView): boolean {
  const text = view.state.doc.toString();
  const m = text.match(/\\begin\{document\}/);
  if (!m || m.index === undefined) {
    notify("未找到 \\begin{document}，无法自动加入导言区", "err");
    return false;
  }
  const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
  view.dispatch({
    changes: { from: lineStart, insert: SUBCAPTION_SNIPPET + "\n" },
    selection: { anchor: lineStart },
  });
  view.focus();
  notify("已加入 \\usepackage{subcaption}", "ok");
  return true;
}

export default function FigureSidebar() {
  const layout = useFigureStore((s) => s.layout);
  const targetTex = useFigureStore((s) => s.targetTex);
  const setGrid = useFigureStore((s) => s.setGrid);
  const setMode = useFigureStore((s) => s.setMode);
  const setSelectedIndex = useFigureStore((s) => s.setSelectedIndex);
  const reset = useFigureStore((s) => s.reset);

  const cells = layout.cells;
  const { rows, cols, gapCol, gapRow, mode, selectedIndex } = layout;

  // 目标 tex 内容（用于 subcaption 检测 / 实时高亮）
  const texContent = useBuffersStore(
    (s) => (targetTex ? s.buffers.find((b) => b.path === targetTex)?.content ?? null : null),
  );
  const subcaptionMissing =
    mode === "subfigure" &&
    cells.length > 0 &&
    texContent != null &&
    !hasPackage(texContent, "subcaption");

  // 记录最近一次插入范围，编译失败时可高亮
  const lastInsert = useRef<{ view: EditorView; from: number; to: number } | null>(null);

  // 后台编译自检：失败仅 warning + 高亮插入块（不阻塞插入）
  useEffect(() => {
    let un: (() => void) | undefined;
    void onKernelEvent<CompileResult>(RustEvents.compileFinished, (r) => {
      if (r.status !== "error") return;
      notify("拼图代码编译失败，请查看日志面板", "err");
      const li = lastInsert.current;
      if (li) {
        li.view.dispatch({ selection: { anchor: li.from, head: li.to } });
        li.view.focus();
      }
    }).then((u) => {
      un = u;
    });
    return () => un?.();
  }, []);

  const handleGenerate = async () => {
    if (cells.length === 0) {
      notify("请先导入图片", "err");
      return;
    }
    const project = useProjectStore.getState();
    const root = project.root;
    if (!root || !targetTex) {
      notify("缺少项目根或目标 .tex，无法生成", "err");
      return;
    }
    const imageDir = project.tree?.imageDir?.trim() || "figure";
    const texDir = parentOf(targetTex);

    // 1) 生成时才把“用到的图”落盘到 figure/（path 级拷文件；file 级读字节），并回填 LaTeX 相对路径
    const relPaths: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      const src = cell.source;
      if (!src) {
        // 兜底：已落盘链路（cell.path 已为相对路径）
        relPaths[i] = cell.path;
        continue;
      }
      try {
        const res =
          src.kind === "path"
            ? await projectApi.importImageFromPath(root, imageDir, src.abs)
            : await projectApi.importImage(
                root,
                imageDir,
                src.file.name,
                new Uint8Array(await src.file.arrayBuffer()),
              );
        relPaths[i] = relativePath(texDir, res.absPath);
      } catch (e) {
        notify(`图片「${src.kind === "path" ? src.abs : src.file.name}」落盘失败：${String(e)}`, "err");
        return;
      }
    }

    // 2) 用回填后的 path 生成代码
    const genLayout = {
      ...layout,
      cells: cells.map((c, i) => ({ ...c, path: relPaths[i] ?? c.path })),
    };
    const { code } = generateSubfigure(genLayout);

    // 3) 插入目标 .tex（即便拼图 Tab 当前活动）
    const target = targetTex;
    const view = getEditorView(target) ?? getActiveView();
    if (!view) {
      notify("无活动编辑器，无法插入代码", "err");
      return;
    }
    lastInsert.current = { view, ...insertGenerated(view, code) };
    useBuffersStore.getState().setActive(target);
    void useProjectStore.getState().refresh(); // figure/ 新增文件进资源树
    notify("已生成 subfigure 代码，后台编译自检中…", "ok");
    void startCompile({ live: true });
  };

  const handleAddSubcaption = () => {
    const target = targetTex ?? useBuffersStore.getState().activePath;
    const view = (target ? getEditorView(target) : null) ?? getActiveView();
    if (!view) {
      notify("无活动编辑器，无法加入导言区", "err");
      return;
    }
    addSubcaptionToPreamble(view);
  };

  return (
    <div className="figside">
      <div className="figside-head">
        <span className="figside-title">插图</span>
      </div>

      {/* 模式开关（两模式平级；composite 主操作留待 P3） */}
      <div className="figside-modes">
        <button
          type="button"
          className={mode === "subfigure" ? "figside-mode is-on" : "figside-mode"}
          onClick={() => setMode("subfigure")}
        >
          subfigure
        </button>
        <button
          type="button"
          className={mode === "composite" ? "figside-mode is-on" : "figside-mode"}
          onClick={() => setMode("composite")}
        >
          合成单张图片
        </button>
      </div>

      {/* 行列 + 元信息 */}
      <div className="figside-row">
        <label className="figside-field">
          行
          <input
            type="number"
            min={1}
            value={rows}
            onChange={(e) => setGrid(Math.max(1, Number(e.target.value) || 1), cols)}
          />
        </label>
        <label className="figside-field">
          列
          <input
            type="number"
            min={1}
            value={cols}
            onChange={(e) => setGrid(rows, Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <span className="figside-meta">共 {cells.length} 图</span>
      </div>

      {/* 导入 / 清空 / 打开预览 */}
      <div className="figside-row">
        <button type="button" className="btn" onClick={() => void pickImagesToCanvas(false)}>
          选择图片…
        </button>
        <button type="button" className="btn" onClick={reset} disabled={cells.length === 0}>
          清空
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => useBuffersStore.getState().openFigure()}
        >
          打开预览
        </button>
      </div>

      {cells.length === 0 ? (
        <div className="figside-empty">
          <p>尚未载入图片。点击「选择图片…」选本地图片，或拖入 / 粘贴多张图片自动进入。</p>
          <button type="button" className="btn" onClick={() => void pickImagesToCanvas(false)}>
            选择图片…
          </button>
        </div>
      ) : (
        <>
          <CellList
            cells={cells}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
          {selectedIndex >= 0 && selectedIndex < cells.length ? (
            <CellEditor cell={cells[selectedIndex]!} index={selectedIndex} />
          ) : (
            <GapControls gapCol={gapCol} gapRow={gapRow} />
          )}
        </>
      )}

      {/* subcaption 缺失横幅 */}
      {subcaptionMissing && (
        <div className="figside-banner">
          <span>导言区缺少 subcaption 宏包（subfigure 必需）</span>
          <button type="button" className="btn" onClick={handleAddSubcaption}>
            加入导言区
          </button>
        </div>
      )}

      {/* 底部随模式变化的主操作 */}
      <div className="figside-actions">
        {mode === "subfigure" ? (
          <button
            type="button"
            className="btn primary"
            disabled={cells.length === 0}
            onClick={handleGenerate}
          >
            生成 subfigure 代码
          </button>
        ) : (
          <button type="button" className="btn primary" disabled title="将在 P3 实现">
            合成单图并插入（P3）
          </button>
        )}
      </div>
    </div>
  );
}
