// P2 · 拼图侧栏控制面板（替代原 F2 侧栏内画布）。
// 纯控制，不渲染画布：模式开关 / 行列 / 导入清空预览 / CellList / CellEditor ⇄ GapControls /
// 图片标题（总图 caption，仅已导入图片时出现）/ subcaption 检测横幅 /
// 底部随模式变化的主操作（subfigure→生成代码；composite→P3 占位）。
import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { useFigureStore } from "./figureStore";
import { useBuffersStore } from "@/editor/useBuffers";
import { getActiveView, getEditorView } from "@/editor/activeView";
import { pickImagesToCanvas } from "./figureImport";
import { generateSubfigure } from "./figureGen";
import { hasPackage, SUBCAPTION_SNIPPET, insertBeforeDocument } from "@/core/preamble";
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

/** 同名冲突项：索引 + 拟落盘文件名 + 处理选择 */
interface Conflict {
  index: number;
  fileName: string;
  choice: "use" | "rename";
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

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

/** 在目标 tex 的 \begin{document} 前加入 subcaption 宏包（复用 preamble 共享 helper） */
function addSubcaptionToPreamble(view: EditorView): boolean {
  const text = view.state.doc.toString();
  if (hasPackage(text, "subcaption")) {
    notify("导言区已包含 subcaption 宏包", "ok");
    return true;
  }
  if (!text.match(/\\begin\{document\}/)) {
    notify("未找到 \\begin{document}，无法自动加入导言区", "err");
    return false;
  }
  // 复用核心 helper 计算插入位置（\begin{document} 前独占一行），
  // 再整体替换文档（仅导言区前新增一行，安全）。
  const next = insertBeforeDocument(text, SUBCAPTION_SNIPPET);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
    selection: { anchor: 0 },
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
  const setCaption = useFigureStore((s) => s.setCaption);
  const setSelectedIndex = useFigureStore((s) => s.setSelectedIndex);
  const reorder = useFigureStore((s) => s.reorder);
  const reset = useFigureStore((s) => s.reset);

  const cells = layout.cells;
  const { rows, cols, gapCol, gapRow, mode, selectedIndex, caption } = layout;

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

    // 1) 计算每格拟落盘文件名，并检测 figure/ 下是否已存在同名文件
    const intended: { index: number; name: string }[] = [];
    for (let i = 0; i < cells.length; i++) {
      const src = cells[i]!.source;
      if (!src) continue; // 已落盘（cell.path 已填），无同名冲突
      intended.push({ index: i, name: src.kind === "path" ? basename(src.abs) : src.file.name });
    }
    const found: Conflict[] = [];
    for (const it of intended) {
      try {
        const exists = await projectApi.imageExists(root, imageDir, it.name);
        if (exists) found.push({ index: it.index, fileName: it.name, choice: "use" });
      } catch {
        // 检测失败不阻断：按“重命名”处理（Rust 端 dedup 兜底）
      }
    }
    if (found.length > 0) {
      setConflicts(found); // 弹窗让用户选择；确认后调用 doGenerate
      return;
    }
    await doGenerate(new Map(), root, imageDir, texDir, targetTex);
  };

  // 真正落盘 + 生成 + 插入（由 handleGenerate 或冲突弹窗确认后调用）
  const doGenerate = async (
    choices: Map<number, "use" | "rename">,
    root: string,
    imageDir: string,
    texDir: string,
    targetTex: string,
  ) => {
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
      const name = src.kind === "path" ? basename(src.abs) : src.file.name;
      const choice = choices.get(i) ?? "rename";
      if (choice === "use") {
        // 复用 figure/ 中已有的同名文件（不再复制）
        relPaths[i] = relativePath(texDir, `${root}/${imageDir}/${name}`);
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
        notify(`图片「${name}」落盘失败：${String(e)}`, "err");
        return;
      }
    }

    // 2) 用回填后的 path 生成代码
    const genLayout = {
      ...layout,
      cells: cells.map((c, i) => ({ ...c, path: relPaths[i] ?? c.path })),
    };
    const { code, overwide } = generateSubfigure(genLayout);

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
    if (overwide) {
      notify("布局存在超宽行（子图总宽 > \\textwidth），编译后可能溢出换行，请减小 scale 或行列数", "err");
    }
    void startCompile({ live: true });
  };

  // 同名冲突弹窗的本地状态与操作
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const updateChoice = (index: number, choice: "use" | "rename") =>
    setConflicts((prev) =>
      prev ? prev.map((c) => (c.index === index ? { ...c, choice } : c)) : prev,
    );
  const allUse = () =>
    setConflicts((prev) => (prev ? prev.map((c) => ({ ...c, choice: "use" as const })) : prev));
  const allRename = () =>
    setConflicts((prev) => (prev ? prev.map((c) => ({ ...c, choice: "rename" as const })) : prev));
  const confirmConflicts = async () => {
    if (!conflicts) return;
    const map = new Map<number, "use" | "rename">();
    conflicts.forEach((c) => map.set(c.index, c.choice));
    setConflicts(null);
    const project = useProjectStore.getState();
    const root = project.root;
    const imageDir = project.tree?.imageDir?.trim() || "figure";
    const texDir = targetTex ? parentOf(targetTex) : "";
    if (!root || !targetTex) {
      notify("缺少项目根或目标 .tex，无法生成", "err");
      return;
    }
    await doGenerate(map, root, imageDir, texDir, targetTex);
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

  // 清空：重置画布布局，并关闭已打开的拼图预览 Tab（figure 伪 buffer 永不脏，不弹确认）
  const handleClear = () => {
    reset();
    void useBuffersStore.getState().closeBuffer("figure://preview");
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
        <button type="button" className="btn" onClick={handleClear} disabled={cells.length === 0}>
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
            onReorder={reorder}
          />
          {selectedIndex >= 0 && selectedIndex < cells.length ? (
            <CellEditor cell={cells[selectedIndex]!} index={selectedIndex} />
          ) : (
            <GapControls gapCol={gapCol} gapRow={gapRow} />
          )}

          {/* 图片标题：= 总图 \caption{}（subfigure 生成即写入）；composite 模式还用作 PNG 命名。
              仅在已导入图片时出现（空态下无意义），位置紧跟间距/子图编辑卡片。 */}
          <label className="figside-captioncol">
            <span className="figside-label">图片标题</span>
            <input
              type="text"
              className="figside-input"
              value={caption}
              placeholder={
                mode === "composite"
                  ? "总图标题；留空则命名 fig-<slug>-composite.png"
                  : "总图 \\caption{}，可留空"
              }
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
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
          <button
            type="button"
            className="btn primary"
            disabled
            title="合成落盘与单图直插在 P3-2 接入；当前可先看 Canvas 合成预览"
          >
            合成单图并插入（P3-2 接入）
          </button>
        )}
      </div>

      {/* 同名冲突弹窗：生成前 figure/ 已存在同名文件时提示用现有 / 重命名 */}
      {conflicts && (
        <div className="figside-modal-overlay">
          <div className="figside-modal">
            <div className="figside-modal-head">figure/ 中存在同名文件</div>
            <p className="figside-modal-sub">
              以下图片在项目图片目录中已有同名文件，请选择处理方式（仅影响最终进入代码的文件）：
            </p>
            <ul className="figside-conflict-list">
              {conflicts.map((c) => (
                <li key={c.index} className="figside-conflict-item">
                  <span className="figside-conflict-name" title={c.fileName}>
                    {c.fileName}
                  </span>
                  <label className={c.choice === "use" ? "figside-radio is-on" : "figside-radio"}>
                    <input
                      type="radio"
                      name={`cf-${c.index}`}
                      checked={c.choice === "use"}
                      onChange={() => updateChoice(c.index, "use")}
                    />
                    用 figure 中现有的
                  </label>
                  <label
                    className={c.choice === "rename" ? "figside-radio is-on" : "figside-radio"}
                  >
                    <input
                      type="radio"
                      name={`cf-${c.index}`}
                      checked={c.choice === "rename"}
                      onChange={() => updateChoice(c.index, "rename")}
                    />
                    重命名复制新文件
                  </label>
                </li>
              ))}
            </ul>
            <div className="figside-modal-actions">
              <button type="button" className="btn" onClick={allUse}>
                全部用现有
              </button>
              <button type="button" className="btn" onClick={allRename}>
                全部重命名
              </button>
              <span className="figside-spacer" />
              <button type="button" className="btn" onClick={() => setConflicts(null)}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={confirmConflicts}>
                确定并生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
