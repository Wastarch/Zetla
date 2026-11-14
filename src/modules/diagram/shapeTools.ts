// M2·F3-1：基础图元工具定义 + 绘制会话状态机（纯逻辑，无 DOM / React 依赖）。
//
// 与 F6 组件库严格区分：这里是「Illustrator 左侧形状工具」——选工具 → 在画布上
// 拖 / 点 → 生成一条标准 TikZ 语句；F6 才是神经网络 / 流程图等高层可复用模板。
// 本文件只管「有哪些工具 / 怎么收集点」，把点变成源码的事交给 shapeInsert.ts，
// 把坐标反算的事交给 dragEdit.ts，把写回的事交给 diagramHistory.ts。
// 带 .ts 扩展名：scripts/diagram-render.test.ts 用 node --experimental-strip-types 直接导入。
//
// 坐标口径：ShapePoint 是 **world pt、Y 轴向上**（与 F2-1 的 editHandle.world 一致）。

export interface ShapePoint {
  x: number;
  y: number;
}

export type ToolMode =
  | "select"
  | "line"
  | "arrowLine"
  | "rectangle"
  | "circle"
  | "ellipse"
  | "polygon"
  | "polyline"
  | "arc"
  | "dot"
  | "text";

/** drag = 按下拖到终点；multi = 逐点单击后闭合；click = 单点放置。 */
export type ToolInteraction = "drag" | "multi" | "click";

export interface ToolDef {
  id: ToolMode;
  label: string;
  title: string;
  interaction: ToolInteraction;
  /** multi 工具闭合所需的最少点数 */
  minPoints: number;
  /** 固定点数（如圆弧三点）；null = 点数开放 */
  exactPoints: number | null;
  /** 生成的 TikZ 语句示意，工具栏 title 里展示 */
  sample: string;
}

/** 防止多点工具无限累积点（真实绘图也不该出现上千顶点的多边形）。 */
export const MAX_SHAPE_POINTS = 24;

export const TOOL_DEFS: readonly ToolDef[] = [
  { id: "select", label: "选择", title: "选择 / 拖拽已有图元（F2-1 控制点）", interaction: "drag", minPoints: 0, exactPoints: null, sample: "" },
  { id: "line", label: "直线", title: "拖出一条直线", interaction: "drag", minPoints: 2, exactPoints: 2, sample: String.raw`\draw (x1,y1) -- (x2,y2);` },
  { id: "arrowLine", label: "箭头线", title: "拖出带箭头的直线（箭头类型可在属性区改）", interaction: "drag", minPoints: 2, exactPoints: 2, sample: String.raw`\draw[->] (x1,y1) -- (x2,y2);` },
  { id: "rectangle", label: "矩形", title: "对角拖出矩形（Shift 正方形）", interaction: "drag", minPoints: 2, exactPoints: 2, sample: String.raw`\draw (x1,y1) rectangle (x2,y2);` },
  { id: "circle", label: "圆", title: "圆心拖出半径（Shift：从边界起算的正圆）", interaction: "drag", minPoints: 2, exactPoints: 2, sample: String.raw`\draw (cx,cy) circle (r);` },
  { id: "ellipse", label: "椭圆", title: "对角拖出椭圆（Shift 正圆）", interaction: "drag", minPoints: 2, exactPoints: 2, sample: String.raw`\draw (cx,cy) ellipse (rx and ry);` },
  { id: "polygon", label: "多边形", title: "逐点单击，双击 / Enter 闭合，Esc 取消", interaction: "multi", minPoints: 3, exactPoints: null, sample: String.raw`\draw (p1) -- (p2) -- ... -- cycle;` },
  { id: "polyline", label: "折线", title: "逐点单击，双击 / Enter 结束", interaction: "multi", minPoints: 2, exactPoints: null, sample: String.raw`\draw (p1) -- (p2) -- ...;` },
  { id: "arc", label: "圆弧", title: "三次单击：弧起点 → 圆心 → 终止角", interaction: "multi", minPoints: 3, exactPoints: 3, sample: String.raw`\draw (x,y) arc (a1:a2:r);` },
  { id: "dot", label: "圆点", title: "单击放置实心圆点", interaction: "click", minPoints: 1, exactPoints: 1, sample: String.raw`\node[circle,fill] at (x,y) {};` },
  { id: "text", label: "文本", title: "单击放置文本节点（内容在源码栏修改）", interaction: "click", minPoints: 1, exactPoints: 1, sample: String.raw`\node at (x,y) {text};` },
];

const DEF_BY_ID = new Map<ToolMode, ToolDef>(TOOL_DEFS.map((d) => [d.id, d]));

export const DEFAULT_TOOL_MODE: ToolMode = "select";

/** localStorage 里可能是任意字符串，读偏好时先过这道白名单。 */
export function isToolMode(v: unknown): v is ToolMode {
  return typeof v === "string" && DEF_BY_ID.has(v as ToolMode);
}

export function toolDef(id: ToolMode): ToolDef {
  // Map 由常量表构造，所有 ToolMode 都在表里；兜底仅为极端情况下的类型安全。
  return DEF_BY_ID.get(id) ?? TOOL_DEFS[0];
}

export function isDrawingTool(id: ToolMode): boolean {
  return id !== "select";
}

/** 多点绘制会话（只存 world 点，不存 SVG / DOM）。 */
export interface ShapeSession {
  tool: ToolMode;
  points: ShapePoint[];
  /** 当前是否按住 Shift（只影响最后一次预览与生成，逐点工具不持久化） */
  shift: boolean;
}

export function createShapeSession(tool: ToolMode, first?: ShapePoint): ShapeSession {
  return { tool, points: first ? [first] : [], shift: false };
}

/** 追加一个点；超过上限或已达固定点数时返回原对象（不可变更新，方便回归）。 */
export function addShapePoint(session: ShapeSession, p: ShapePoint): ShapeSession {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return session;
  const def = toolDef(session.tool);
  const cap = def.exactPoints ?? MAX_SHAPE_POINTS;
  if (session.points.length >= cap) return session;
  return { ...session, points: [...session.points, p] };
}

export function popShapePoint(session: ShapeSession): ShapeSession {
  if (session.points.length === 0) return session;
  return { ...session, points: session.points.slice(0, -1) };
}

export function canFinishShape(session: ShapeSession): boolean {
  const def = toolDef(session.tool);
  return session.points.length >= def.minPoints;
}

/** 固定点数的多点工具（圆弧）在收集满时自动完成，不需要再双击 / Enter。 */
export function isShapeComplete(session: ShapeSession): boolean {
  const def = toolDef(session.tool);
  return def.exactPoints !== null && session.points.length >= def.exactPoints;
}

/** 画布底部会话提示；常驻显示，避免用户不知道多点工具怎么收尾（同 F2-3 反死按钮反馈）。 */
export function shapeSessionHint(session: ShapeSession): string {
  const def = toolDef(session.tool);
  const n = session.points.length;
  if (def.id === "arc") {
    const steps = ["弧起点", "圆心", "终止角"];
    return `圆弧 · 第 ${Math.min(n + 1, 3)} 点：${steps[Math.min(n, 2)]} · Esc 取消 · Backspace 退一点`;
  }
  return `${def.label} · 已 ${n} 点（至少 ${def.minPoints} 点） · 双击 / Enter 闭合 · Backspace 退一点 · Esc 取消`;
}
