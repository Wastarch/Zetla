// M2·F1-2 / F3-1：绘图 Tab 内顶部布局开关（仅画布 / 仅源码 / 分屏）+ 当前工具徽标。
// 三种布局都是同一个 `diagram://editor` Tab 内部的视图状态，不新建/替换 Tab，
// 主编辑区的其它 Tab 与 PDF 预览始终可用。
// v1：源码来源入口放在 .dg-tab-meta 最右侧的下拉面板（状态 / 操作 / 候选分区）。
import { useRef, useState } from "react";
import { Chevron } from "@/ui/Chevron";
import { useDiagramStore, type LayoutMode } from "./store";
import { toolDef } from "./shapeTools";
import { TikzSourceMenu } from "./TikzSourceMenu";

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
  const toolMode = useDiagramStore((s) => s.toolMode);
  const lineCount = source.split("\n").length;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

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
        <span className="dg-tab-meta-text">
          {lineCount} 行 · 工具：{toolDef(toolMode).label} · 目标：
          {targetTex ? basename(targetTex) : "未锁定"}
        </span>
        <button
          type="button"
          ref={triggerRef}
          className="dg-source-trigger"
          title="项目内 TikZ 来源：扫描 / 导入候选 / 导入外部文件"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={() => {
            if (menu) {
              setMenu(null);
              return;
            }
            const r = triggerRef.current?.getBoundingClientRect();
            if (r) setMenu({ x: Math.max(6, r.right - 300), y: r.bottom + 6 });
          }}
        >
          <span>源码来源</span>
          <Chevron open={!!menu} size={11} />
        </button>
      </span>
      {menu && (
        <TikzSourceMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
