// M2·F1-2 / F2-1 / F2-4：绘图 Tab 的源码栏 —— **复用 Zetla 既有的 LaTeXEditor**，不新建编辑器实现。
// 受控接线：value = diagram store 的 source，onChange = setSource；
// bare 开关屏蔽主文档专属扩展（✎ 徽标 / 图片拖入 / 引用跳转 / synctex 等）；
// 不传 path → 不向全局 activeView 注册，不污染主文档的命令桥与查找替换。
//
// F2-1 / F2-2：把本栏的 CM6 视图注册到 sourceBridge，供画布拖拽与侧栏属性编辑
// 用最小 span dispatch。这样「键盘直接改源码」「拖控制点」「改属性」共享同一条
// CM6 history，Ctrl+Z / 画布撤销按钮都能一次撤销一次改动。
// F2-4：新增 replaceLast —— 连续微调时撤销上一组历史、从组内基准源码重放合并补丁，
// 让一整串微调只占一条撤销记录；全程同步且带三重文档校验，失败即 redo 回滚。
import { useEffect, useRef } from "react";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { LaTeXEditor, type LaTeXEditorHandle } from "@/editor/LaTeXEditor";
import { useSettingsStore } from "@/core/settings";
import { useDiagramStore } from "./store";
import { registerDiagramSourceBridge } from "./sourceBridge";
import type { SourceSpanPatch } from "./dragEdit.ts";

/** 从 expectedSource 出发应用最小补丁；所有 dispatch 共用同一段校验与 userEvent。 */
function dispatchPatch(
  view: EditorView,
  patch: SourceSpanPatch,
  expectedSource: string,
): boolean {
  const doc = view.state.doc;
  if (doc.toString() !== expectedSource) return false;
  if (patch.from < 0 || patch.to > doc.length || patch.from > patch.to) return false;
  const caret = patch.from + patch.insert.length;
  view.dispatch({
    changes: { from: patch.from, to: patch.to, insert: patch.insert },
    selection: { anchor: caret },
    effects: EditorView.scrollIntoView(caret, { y: "nearest" }),
    userEvent: "input.diagram",
  });
  return true;
}

export function DiagramCodePane() {
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const lineWrapping = useSettingsStore((s) => s.settings.editor.lineWrapping);
  const handle = useRef<LaTeXEditorHandle | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 布局切换（隐藏→显示）与拖拽分隔条都会改变容器尺寸，CM6 需重新测量，
  // 否则会出现行号/滚动范围错乱。用 ResizeObserver 统一兜底，调 LaTeXEditor.refresh()。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => handle.current?.refresh());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // F2-1 / F2-2：源码栏在三种布局下都常驻挂载（仅 hidden），画布与侧栏始终能拿到视图。
  // patch 前校验 expectedSource === 当前文档，杜绝把补丁打到用户在操作期间改过的源码上。
  useEffect(
    () =>
      registerDiagramSourceBridge({
        getView: () => handle.current?.getView() ?? null,
        patch(patch, expectedSource) {
          const view = handle.current?.getView();
          return !!view && dispatchPatch(view, patch, expectedSource);
        },
        replaceLast(patch, expectedBase, expectedCurrent, expectedTarget) {
          const view = handle.current?.getView();
          if (!view) return false;
          if (view.state.doc.toString() !== expectedCurrent) return false;
          // 顶端历史必须能被撤销；撤销后文档要正好回到本组起点。
          if (!undo(view)) return false;
          const base = view.state.doc.toString();
          const rollback = (): boolean => {
            redo(view);
            return false;
          };
          if (base !== expectedBase) return rollback();
          // 微调恰好回到起点：撤销整组即可，不再 dispatch，避免留一条空历史。
          if (patch === null) return base === expectedTarget ? true : rollback();
          if (patch.from < 0 || patch.to > base.length || patch.from > patch.to) return rollback();
          // 先在字符串上预演补丁结果，确认它真的把基准源码变成目标源码，
          // 绝不把「按旧 span 算出来的」可疑补丁写进 CM6。
          const projected = base.slice(0, patch.from) + patch.insert + base.slice(patch.to);
          if (projected !== expectedTarget) return rollback();
          if (projected === base) return true;
          return dispatchPatch(view, patch, expectedBase);
        },
        undo() {
          const view = handle.current?.getView();
          return view ? undo(view) : false;
        },
        redo() {
          const view = handle.current?.getView();
          return view ? redo(view) : false;
        },
      }),
    [],
  );

  return (
    <div ref={wrapRef} className="dg-pane-code-inner">
      <LaTeXEditor
        ref={handle}
        value={source}
        onChange={setSource}
        height="100%"
        lineWrapping={lineWrapping}
        bare
        placeholder="在此编写 TikZ 源码…"
      />
    </div>
  );
}
