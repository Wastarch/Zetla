// M2·F1-2：绘图 Tab 的源码栏 —— **复用 Zetla 既有的 LaTeXEditor**，不新建编辑器实现。
// 受控接线：value = diagram store 的 source，onChange = setSource；
// bare 开关屏蔽主文档专属扩展（✎ 徽标 / 图片拖入 / 引用跳转 / synctex 等）；
// 不传 path → 不向全局 activeView 注册，不污染主文档的命令桥与查找替换。
import { useEffect, useRef } from "react";
import { LaTeXEditor, type LaTeXEditorHandle } from "@/editor/LaTeXEditor";
import { useSettingsStore } from "@/core/settings";
import { useDiagramStore } from "./store";

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
