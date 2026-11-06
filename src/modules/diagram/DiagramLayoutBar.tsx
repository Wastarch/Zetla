// M2·F1-2：绘图 Tab 内顶部布局开关（仅画布 / 仅源码 / 分屏）。
// 三种布局都是同一个 `diagram://editor` Tab 内部的视图状态，不新建/替换 Tab，
// 主编辑区的其它 Tab 与 PDF 预览始终可用。
import { useDiagramStore, type LayoutMode } from "./store";

const LAYOUTS: { id: LayoutMode; label: string; title: string }[] = [
  { id: "canvas", label: "仅画布", title: "只显示 TikZ 画布" },
  { id: "code", label: "仅源码", title: "只显示 TikZ 源码编辑器" },
  { id: "split", label: "分屏", title: "左画布 + 右源码，源码改动同步到画布" },
];

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function DiagramLayoutBar() {
  const layoutMode = useDiagramStore((s) => s.layoutMode);
  const setLayoutMode = useDiagramStore((s) => s.setLayoutMode);
  const source = useDiagramStore((s) => s.source);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const lineCount = source.split("\n").length;

  return (
    <div className="dg-tab-bar">
      <span className="dg-tab-title">绘图工作台 · TikZ</span>
      <div className="dg-tab-layouts" role="group" aria-label="画布布局">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={layoutMode === l.id ? "dg-tab-layout active" : "dg-tab-layout"}
            title={l.title}
            aria-pressed={layoutMode === l.id}
            onClick={() => setLayoutMode(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <span className="dg-tab-meta">
        {lineCount} 行 · 目标：{targetTex ? basename(targetTex) : "未锁定"}
      </span>
    </div>
  );
}
