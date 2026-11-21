// M2·F1-2 / F3-1：绘图 Tab 内顶部布局开关（仅画布 / 仅源码 / 分屏）+ 当前工具徽标。
// 三种布局都是同一个 `diagram://editor` Tab 内部的视图状态，不新建/替换 Tab，
// 主编辑区的其它 Tab 与 PDF 预览始终可用。
// v1：源码来源入口放在 .dg-tab-meta 最右侧的下拉菜单（状态 / 重扫 / 开关 / 候选）。
import { useRef, useState } from "react";
import { Chevron } from "@/ui/Chevron";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { notify } from "@/project/useProject";
import { useDiagramStore, type LayoutMode } from "./store";
import { toolDef } from "./shapeTools";

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
  const candidates = useDiagramStore((s) => s.tikzCandidates);
  const scanStatus = useDiagramStore((s) => s.tikzScanStatus);
  const scanError = useDiagramStore((s) => s.tikzScanError);
  const activeCandidateId = useDiagramStore((s) => s.activeCandidateId);
  const importedPath = useDiagramStore((s) => s.importedPath);
  const autoImportEnabled = useDiagramStore((s) => s.autoImportEnabled);
  const setAutoImportEnabled = useDiagramStore((s) => s.setAutoImportEnabled);
  const setActiveCandidateId = useDiagramStore((s) => s.setActiveCandidateId);
  const refreshTikzSources = useDiagramStore((s) => s.refreshTikzSources);
  const applyTikzCandidate = useDiagramStore((s) => s.applyTikzCandidate);
  const lineCount = source.split("\n").length;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const scanHint =
    scanStatus === "scanning"
      ? "扫描中…"
      : scanStatus === "error"
        ? "扫描失败"
        : importedPath
          ? `已导入 ${basename(importedPath)}`
          : candidates.length > 0
            ? `发现 ${candidates.length} 个候选`
            : "未发现候选";

  const actions: CtxAction[] = [
    {
      label: scanHint,
      disabled: true,
      className: "dg-source-status",
      hint: scanError ?? "当前项目内 TikZ 来源扫描状态",
      onClick: () => {},
    },
    ...(scanError
      ? [
          {
            label: `扫描失败：${scanError}`,
            disabled: true,
            className: "dg-source-error",
            onClick: () => {},
          },
        ]
      : []),
    {
      label: "重新扫描",
      disabled: scanStatus === "scanning",
      hint: "重新扫描项目里的 .tikz 文件与 .tex/.ltx 中的 tikzpicture",
      onClick: () => void refreshTikzSources(),
    },
    {
      label: `自动导入：${autoImportEnabled ? "开" : "关"}`,
      hint: autoImportEnabled ? "关闭打开绘图 Tab 时的自动导入" : "开启打开绘图 Tab 时的自动导入",
      onClick: () => setAutoImportEnabled(!autoImportEnabled),
    },
    { label: "", disabled: true, className: "dg-source-sep", onClick: () => {} },
    ...candidates.map((c) => ({
      label: `${c.relPath}${c.kind === "tex-env" ? `:${c.startLine}` : ""}`,
      sc: c.kind === "tikz-file" ? "文件" : "环境",
      className: "dg-source-candidate",
      primary: activeCandidateId === c.id,
      hint: `${c.reason} · 置信度 ${c.confidence}${
        c.rawSource ? ` · ${c.rawSource.split("\n")[0].trim()}` : ""
      }`,
      onClick: () => {
        setActiveCandidateId(c.id);
        applyTikzCandidate(c);
        notify(`已导入 ${c.relPath}${c.kind === "tex-env" ? `:${c.startLine}` : ""}`, "ok");
      },
    })),
  ];

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
          title="项目内 TikZ 来源：扫描 / 重新扫描 / 导入候选"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={() => {
            if (menu) {
              setMenu(null);
              return;
            }
            const r = triggerRef.current?.getBoundingClientRect();
            if (r) setMenu({ x: Math.max(6, r.right - 220), y: r.bottom + 6 });
          }}
        >
          <span>源码来源</span>
          <Chevron open={!!menu} size={11} />
        </button>
      </span>
      {menu && (
        <InsertCtxMenu x={menu.x} y={menu.y} actions={actions} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
