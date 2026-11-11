// M2·F3-1：基础图元工具调色板（Illustrator 左侧形状工具的等价物）。
// 只负责「展示 + 切换工具」：坐标反算、绘制预览与源码写回都在 DiagramCanvas 内，
// 工具定义与状态机在 shapeTools.ts。精确通道是 XeLaTeX 只读结果，整排按钮禁用。
//
// F3-9（工作台布局重排）：基础元素按钮整体搬到**左侧栏** `ShapePalette`，
// 画布顶部只留 `ShapeToolbar` 紧凑提示条（当前工具 / 绘制会话 / 新建空白图）。
// 两者共用 TOOL_DEFS、TOOL_GROUPS 与全模块唯一只读判定，不新增任何状态机。
import { Fragment } from "react";
import { useDiagramStore } from "./store";
import { TOOL_DEFS, isToolMode, toolDef, type ToolMode } from "./shapeTools";
import { canEditDiagramSource } from "./editability.ts";
import "./diagram.css";

interface ShapeToolbarProps {
  /** 绘制会话提示（多点工具）；null 时显示当前工具用法 */
  sessionHint: string | null;
  /** 空白源码时提供「新建空白图」，让空画布也能开画 */
  onNewBlank: () => void;
}

/**
 * F3-8：工具条的**纯展示分组**（选择 / 几何 / 线 / 节点）。
 * 只是 id → 标签的映射，不新增 state、不重排 TOOL_DEFS、不改任何点击行为；
 * 未列入分组的新工具会自动落到末尾「其他」，保证永远不会静默少一个按钮。
 */
const TOOL_GROUPS: { key: string; label: string; ids: string[] }[] = [
  { key: "select", label: "选择", ids: ["select"] },
  { key: "geometry", label: "几何", ids: ["rectangle", "circle", "ellipse", "polygon", "arc"] },
  { key: "line", label: "线", ids: ["line", "arrowLine", "polyline"] },
  { key: "node", label: "节点", ids: ["dot", "text"] },
];

function groupedTools(): { key: string; label: string; ids: string[] }[] {
  const restIds = TOOL_DEFS
    .filter((d) => !TOOL_GROUPS.some((g) => g.ids.includes(d.id)))
    .map((d) => d.id);
  return restIds.length
    ? [...TOOL_GROUPS, { key: "other", label: "其他", ids: restIds }]
    : TOOL_GROUPS;
}

/** 纯手写内联 SVG 小图标（不引第三方图标包，沿用 F3-8 口径）。 */
function ToolGlyph({ id }: { id: ToolMode }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (id) {
    case "select":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M5 3l13 8-6 1.5L9.5 19z" />
        </svg>
      );
    case "rectangle":
      return <svg {...common}><rect x="4" y="6" width="16" height="12" rx="1" /></svg>;
    case "circle":
      return <svg {...common}><circle cx="12" cy="12" r="7" /></svg>;
    case "ellipse":
      return <svg {...common}><ellipse cx="12" cy="12" rx="9" ry="6" /></svg>;
    case "polygon":
      return <svg {...common}><path d="M12 3l8 6-3 10H7L4 9z" /></svg>;
    case "arc":
      return <svg {...common}><path d="M5 18a9 9 0 0 1 14-9" /><path d="M5 18h3M19 9v3" /></svg>;
    case "line":
      return <svg {...common}><path d="M4 18L20 6" /></svg>;
    case "arrowLine":
      return <svg {...common}><path d="M4 18L20 6M20 6l-6 1M20 6l-1 6" /></svg>;
    case "polyline":
      return <svg {...common}><path d="M3 17l6-8 5 5 7-9" /></svg>;
    case "dot":
      return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case "text":
      return <svg {...common}><path d="M5 5h14M12 5v14" /></svg>;
    default:
      return <svg {...common}><rect x="5" y="5" width="14" height="14" rx="2" /></svg>;
  }
}

/**
 * F3-9：左侧栏「基础元素」网格。按 F3-8 的四组分区，3 列图标按钮；
 * 点击只写 toolMode，绘制坐标反算 / 源码写回仍全在 DiagramCanvas。
 */
export function ShapePalette() {
  const toolMode = useDiagramStore((s) => s.toolMode);
  const setToolMode = useDiagramStore((s) => s.setToolMode);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const permission = canEditDiagramSource({ previewMode });
  const readonly = !permission.ok;

  // F3-9 二次优化：**所有工具连续排进一个密网格**，组之间只插一条 1px 竖线
  // （占一个格子、不换行），不再让每组独占一行 + 一条「细线夹小字」分节标题。
  // 组名进 tooltip，当前工具名提到侧栏手风琴标题右侧，两处都不再占垂直空间。
  return (
    <div className="dg-element-palette" role="toolbar" aria-label="基础元素">
      <div className="dg-element-grid">
        {groupedTools().map((g, gi) => (
          <Fragment key={g.key}>
            {gi > 0 && (
              <span className="dg-element-sep" title={g.label} aria-hidden="true" />
            )}
            {TOOL_DEFS.filter((d) => g.ids.includes(d.id)).map((d) => (
              <button
                key={d.id}
                type="button"
                className={`dg-element-btn${toolMode === d.id ? " on" : ""}`}
                aria-pressed={toolMode === d.id}
                aria-label={d.label}
                disabled={readonly}
                title={`${g.label} · ${d.label} · ${d.title}${d.sample ? ` · ${d.sample}` : ""}${readonly ? ` · ${permission.reason}` : ""}`}
                onClick={() => setToolMode(d.id)}
              >
                <ToolGlyph id={d.id} />
              </button>
            ))}
          </Fragment>
        ))}
      </div>
      {readonly && <span className="dg-tool-readonly">{permission.reason}</span>}
    </div>
  );
}

/** F3-9：画布顶部紧凑提示条 —— 按钮已在左侧栏，这里只保留会话与上下文说明。 */
export function ShapeToolbar({ sessionHint, onNewBlank }: ShapeToolbarProps) {
  const toolMode = useDiagramStore((s) => s.toolMode);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const source = useDiagramStore((s) => s.source);
  const permission = canEditDiagramSource({ previewMode });
  const readonly = !permission.ok;
  const empty = source.trim().length === 0;
  const current = toolDef(isToolMode(toolMode) ? toolMode : "select");

  return (
    <div className="dg-tool-bar dg-tool-bar-compact">
      <span className="dg-tool-bar-label">当前工具</span>
      <span className="dg-tool-current">{current.label}</span>
      {readonly ? (
        <span className="dg-tool-readonly">{permission.reason}</span>
      ) : empty ? (
        <button type="button" className="dg-tool-blank" onClick={onNewBlank}>
          新建空白图
        </button>
      ) : null}
      <span className="dg-tool-hint" role="status">
        {sessionHint ??
          (current.id === "select"
            ? "在左侧栏选基础元素 · 拖动控制点 / 点选图元后到右侧属性面板编辑 · Esc 回选择"
            : `${current.title} · 绘制后自动选中，在右侧属性面板改属性 · Esc 取消 / 回选择`)}
      </span>
    </div>
  );
}
