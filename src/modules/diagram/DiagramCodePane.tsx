// M2·F1-2 / F2-1：绘图 Tab 的源码栏 —— **复用 Zetla 既有的 LaTeXEditor**，不新建编辑器实现。
// 受控接线：value = diagram store 的 source，onChange = setSource；
// bare 开关屏蔽主文档专属扩展（✎ 徽标 / 图片拖入 / 引用跳转 / synctex 等）；
// 不传 path → 不向全局 activeView 注册，不污染主文档的命令桥与查找替换。
//
// F2-1 / F2-2：把本栏的 CM6 视图注册到 sourceBridge，供画布拖拽与侧栏属性编辑
// 用最小 span dispatch。这样「键盘直接改源码」「拖控制点」「改属性」共享同一条
// CM6 history，Ctrl+Z / 画布撤销按钮都能一次撤销一次改动。
import { useEffect, useRef } from "react";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { LaTeXEditor, type LaTeXEditorHandle } from "@/editor/LaTeXEditor";
import { useSettingsStore } from "@/core/settings";
import { useDiagramStore } from "./store";
import { registerDiagramSourceBridge } from "./sourceBridge";

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
          if (!view) return false;
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
