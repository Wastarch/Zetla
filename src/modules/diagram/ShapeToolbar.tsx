// M2·F3-1：基础图元工具调色板（Illustrator 左侧形状工具的横排等价物）。
// 只负责「展示 + 切换工具」：坐标反算、绘制预览与源码写回都在 DiagramCanvas 内，
// 工具定义与状态机在 shapeTools.ts。精确通道是 XeLaTeX 只读结果，整条工具条禁用。
import { useDiagramStore } from "./store";
import { TOOL_DEFS, isToolMode, toolDef } from "./shapeTools";
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
 * 未列入分组的新工具会自动落到末尾「其他」，保证永远不会静默少一个按钮
 * （见组件内 toolGroups 的兜底组）。
 */
const TOOL_GROUPS: { key: string; label: string; ids: string[] }[] = [
  { key: "select", label: "选择", ids: ["select"] },
  { key: "geometry", label: "几何", ids: ["rectangle", "circle", "ellipse", "polygon", "arc"] },
  { key: "line", label: "线", ids: ["line", "arrowLine", "polyline"] },
  { key: "node", label: "节点", ids: ["dot", "text"] },
];

export function ShapeToolbar({ sessionHint, onNewBlank }: ShapeToolbarProps) {
  const toolMode = useDiagramStore((s) => s.toolMode);
  const setToolMode = useDiagramStore((s) => s.setToolMode);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const source = useDiagramStore((s) => s.source);
  // F3-6：走全模块统一的只读判定，文案与侧栏面板 / 画布键盘一致。
  const permission = canEditDiagramSource({ previewMode });
  const readonly = !permission.ok;
  const empty = source.trim().length === 0;
  const current = toolDef(isToolMode(toolMode) ? toolMode : "select");
  // F3-8：兜底组，防止以后新增工具 id 忘了登记就静默从工具条消失（纯展示）。
  const restIds = TOOL_DEFS
    .filter((d) => !TOOL_GROUPS.some((g) => g.ids.includes(d.id)))
    .map((d) => d.id);
  const toolGroups = restIds.length
    ? [...TOOL_GROUPS, { key: "other", label: "其他", ids: restIds }]
    : TOOL_GROUPS;

  return (
    <div className="dg-tool-bar" role="toolbar" aria-label="基础图元工具">
      <span className="dg-tool-bar-label">工具</span>
      <div className="dg-tool-buttons">
        {toolGroups.map((g) => {
          const items = TOOL_DEFS.filter((d) => g.ids.includes(d.id));
          if (items.length === 0) return null;
          return (
            <div key={g.key} className={`dg-tool-group dg-tool-group-${g.key}`} role="group" aria-label={g.label}>
              <span className="dg-tool-group-label">{g.label}</span>
              {items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`dg-tool-btn${toolMode === d.id ? " on" : ""}${d.id === "select" ? " is-select" : ""}`}
                  aria-pressed={toolMode === d.id}
                  disabled={readonly}
                  title={`${d.title}${d.sample ? ` · ${d.sample}` : ""}${readonly ? " · 精确通道只读" : ""}`}
                  onClick={() => setToolMode(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
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
            ? "选择：拖动控制点 / 点选图元改属性 · Esc 可切回选择工具"
            : `${current.title} · 绘制后自动选中，可在侧栏改属性 · Esc 取消 / 回选择`)}
      </span>
    </div>
  );
}
