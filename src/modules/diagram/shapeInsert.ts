// M2·F3-1：基础图元「工具坐标 → 标准 TikZ 语句 → 源码插入」的纯逻辑。
// 与 diagramSnippet.ts 同构：不碰 CodeMirror / zustand / IPC，Node 可直接回归
// （scripts/diagram-render.test.ts 用 --experimental-strip-types 直接导入）。
//
// 单位口径（由 scripts/diagram-capability-probe.mjs 实测，别凭直觉改）：
//   · 上游 tikz-editor 的 world 坐标单位是 **pt**、Y 轴向上；TikZ 源码里不带单位的
//     `(1,1)` 是 **cm**，1cm = 28.45275590551181 pt。
//   · 探针实测 `\draw (0,0) rectangle (1,1);` 的句柄 world = (28.4528, 28.4528)，
//     小数坐标 `(1.41,2.11)` 与 `applyEditIntent` 写回均正常，故本文件把 world pt
//     一次性换算成 cm 并保留 2 位小数，生成用户习惯的 `(1.41,2.11)` 写法。
//   · 这与 F2-1「拖拽写回绝不做 cm↔pt 换算」不冲突：那里有原源码写法可供上游
//     反算；新建形状没有原写法，必须自己定一个单位。换算只发生在这里。
//
// 生成语句全部是 TikZ 核心构造（探针：9 类均 used-supported、无 diagnostics），
// 不依赖任何 tikzlibrary；正多边形因上游顶层 `\usetikzlibrary` 会 parse-error，
// v1 不做（结论见计划 §7）。
import type { SourceSpanPatch } from "./dragEdit.ts";
import {
  canFinishShape,
  createShapeSession,
  toolDef,
  type ShapePoint,
  type ShapeSession,
  type ToolMode,
} from "./shapeTools.ts";

/** TeX 1cm = 72.27pt / 2.54 = 28.45275590551181pt（探针实测吻合）。 */
export const TIKZ_PT_PER_CM = 28.45275590551181;

/** 形状语句坐标 / 长度保留 2 位小数；整数不带 `.00`，且绝不出现 `-0`。 */
export function fmtTikzNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = Math.round(n * 100) / 100;
  return String(Object.is(v, -0) ? 0 : v);
}

export function ptToCm(pt: number): number {
  return pt / TIKZ_PT_PER_CM;
}

/** world pt 点 → TikZ 坐标 `(x,y)`（cm）。 */
export function fmtCoord(p: ShapePoint): string {
  return `(${fmtTikzNumber(ptToCm(p.x))},${fmtTikzNumber(ptToCm(p.y))})`;
}

/** world pt 长度 → TikZ 半径 / 轴长数值（cm，不带括号）。 */
export function fmtLength(pt: number): string {
  return fmtTikzNumber(ptToCm(pt));
}

/** 文本节点内容：去掉会破坏源码的构造，中文 / 常规标点保留。 */
export function sanitizeNodeText(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[{}%\\$]/g, "")
    .trim()
    .slice(0, 40);
  return cleaned || "text";
}

function dist(a: ShapePoint, b: ShapePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: ShapePoint, b: ShapePoint): ShapePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Shift 约束：把对角拖拽吸附成「以起点为一角的最大边正方形」。 */
function squareCorners(a: ShapePoint, b: ShapePoint): [ShapePoint, ShapePoint] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [a, { x: a.x + (dx < 0 ? -side : side), y: a.y + (dy < 0 ? -side : side) }];
}

export interface ShapeBuildOptions {
  shift?: boolean;
  text?: string;
}

export type ShapeBuildResult =
  | { ok: true; statement: string; label: string }
  | { ok: false; reason: string };

const MIN_DRAG_PT = 2;

/**
 * 把一组 world pt 点变成一条可直接插入 tikzpicture 的标准 TikZ 语句。
 * 返回 error 而不是抛异常：UI 层把理由原样显示给用户（不做死按钮 / 静默失败）。
 */
export function buildShapeStatement(
  tool: ToolMode,
  points: readonly ShapePoint[],
  opts: ShapeBuildOptions = {},
): ShapeBuildResult {
  const def = toolDef(tool);
  const label = def.label;
  if (def.id === "select") return { ok: false, reason: "请选择一种绘图工具。" };
  if (points.length === 0 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { ok: false, reason: "坐标无效，请在画布内绘制。" };
  }
  const shift = !!opts.shift;

  if (def.interaction === "drag") {
    if (points.length < 2) return { ok: false, reason: "请按住鼠标拖出形状。" };
    const a = points[0];
    const b = points[1];
    const d = dist(a, b);
    if (d < MIN_DRAG_PT) return { ok: false, reason: "拖拽距离太小，形状未生成。" };
    switch (def.id) {
      case "line":
        return { ok: true, label, statement: `\\draw ${fmtCoord(a)} -- ${fmtCoord(b)};` };
      case "arrowLine":
        return { ok: true, label, statement: `\\draw[->] ${fmtCoord(a)} -- ${fmtCoord(b)};` };
      case "rectangle": {
        const [p1, p2] = shift ? squareCorners(a, b) : [a, b];
        return { ok: true, label, statement: `\\draw ${fmtCoord(p1)} rectangle ${fmtCoord(p2)};` };
      }
      case "circle": {
        const [p1, p2] = shift ? squareCorners(a, b) : [a, b];
        const center = shift ? midpoint(p1, p2) : a;
        const r = shift ? Math.abs(p2.x - p1.x) / 2 : d;
        return { ok: true, label, statement: `\\draw ${fmtCoord(center)} circle (${fmtLength(r)});` };
      }
      case "ellipse": {
        let rx = Math.abs(b.x - a.x) / 2;
        let ry = Math.abs(b.y - a.y) / 2;
        if (shift) rx = ry = Math.max(rx, ry);
        if (rx < MIN_DRAG_PT / 2 || ry < MIN_DRAG_PT / 2) {
          return { ok: false, reason: "椭圆宽或高太小，形状未生成。" };
        }
        return {
          ok: true,
          label,
          statement: `\\draw ${fmtCoord(midpoint(a, b))} ellipse (${fmtLength(rx)} and ${fmtLength(ry)});`,
        };
      }
    }
  }

  if (def.interaction === "click") {
    const p = points[0];
    if (def.id === "dot") {
      return { ok: true, label, statement: `\\node[circle,fill] at ${fmtCoord(p)} {};` };
    }
    return {
      ok: true,
      label,
      statement: `\\node at ${fmtCoord(p)} {${sanitizeNodeText(opts.text ?? "text")}};`,
    };
  }

  // multi：多边形 / 折线 / 圆弧
  const session: ShapeSession = { ...createShapeSession(tool), points: [...points], shift };
  if (!canFinishShape(session)) {
    return { ok: false, reason: `${label}至少需要 ${def.minPoints} 个点，请继续单击。` };
  }
  const chain = points.map((p) => fmtCoord(p)).join(" -- ");
  if (def.id === "polygon") {
    return { ok: true, label, statement: `\\draw ${chain} -- cycle;` };
  }
  if (def.id === "polyline") {
    return { ok: true, label, statement: `\\draw ${chain};` };
  }
  // arc：p1 弧起点、p2 圆心、p3 只取方向定终止角；角度按 world 逆时针归一。
  const [p1, p2, p3] = points;
  const r = dist(p1, p2);
  if (r < MIN_DRAG_PT) return { ok: false, reason: "圆弧半径太小，请重新点圆心。" };
  const deg = (p: ShapePoint) => (Math.atan2(p.y - p2.y, p.x - p2.x) * 180) / Math.PI;
  const a1 = deg(p1);
  let delta = deg(p3) - a1;
  while (delta < 0) delta += 360;
  while (delta >= 360) delta -= 360;
  const a2 = a1 + delta;
  return {
    ok: true,
    label,
    statement: `\\draw ${fmtCoord(p1)} arc (${Math.round(a1)}:${Math.round(a2)}:${fmtLength(r)});`,
  };
}

// ── 插入点与源码补丁 ──────────────────────────────────────────────────────────

export type InsertionMode = "inside" | "append" | "wrap";

export interface InsertionPoint {
  mode: InsertionMode;
  /** 插入 / 替换起点（原源码字符偏移） */
  at: number;
  /** wrap 模式下要替换掉的空白长度；其余为 0 */
  replaceTo: number;
  /** 语句行缩进 */
  indent: string;
}

const BEGIN = "\\begin{tikzpicture}";
const END = "\\end{tikzpicture}";
const DEFAULT_INDENT = "  ";

function inferBodyIndent(source: string, beginIdx: number): string {
  const lineEnd = source.indexOf("\n", beginIdx);
  const rest = lineEnd >= 0 ? source.slice(lineEnd + 1) : "";
  for (const line of rest.split("\n")) {
    const m = /^([ \t]+)\S/.exec(line);
    if (m) return m[1];
  }
  return DEFAULT_INDENT;
}

/**
 * 选择插入点：
 *   · 完整 tikzpicture → 插在 \end 行之前（沿用正文缩进，注释 / 其它语句零改动）；
 *   · 只有 \begin 没有 \end（残缺源码）→ 末尾追加语句并补齐 \end，避免画布一直报错；
 *   · 空白源码 → 直接生成完整 tikzpicture 环境，让用户在空画布上也能开画。
 */
export function findInsertionPoint(source: string): InsertionPoint {
  const beginIdx = source.indexOf(BEGIN);
  const endIdx = source.lastIndexOf(END);
  if (beginIdx >= 0 && endIdx >= beginIdx) {
    const at = source.lastIndexOf("\n", endIdx - 1) + 1;
    return {
      mode: "inside",
      at,
      replaceTo: at,
      indent: inferBodyIndent(source, beginIdx),
    };
  }
  if (beginIdx >= 0) {
    return {
      mode: "append",
      at: source.length,
      replaceTo: source.length,
      indent: inferBodyIndent(source, beginIdx),
    };
  }
  return { mode: "wrap", at: 0, replaceTo: source.length, indent: DEFAULT_INDENT };
}

export interface ShapeInsertion {
  /** 插入后的完整源码 */
  source: string;
  /** 从旧源码到新源码的单点补丁（与 F2-1 / F2-4 写回口径一致） */
  patch: SourceSpanPatch;
  /** 新语句在新源码里的字符区间，用于插入后自动选中 */
  selection: { from: number; to: number };
  mode: InsertionMode;
  /** 额外补了 \end{tikzpicture}（残缺源码）时给 UI 的说明 */
  note: string | null;
}

/** 只做字符串运算；真正的 CM6 dispatch 由 diagramHistory.commitDiagramPatch 负责。 */
export function insertShapeStatement(source: string, statement: string): ShapeInsertion {
  const p = findInsertionPoint(source);
  let insert = "";
  let indentLen = 0;
  let note: string | null = null;

  if (p.mode === "inside") {
    insert = `${p.indent}${statement}\n`;
    indentLen = p.indent.length;
  } else if (p.mode === "append") {
    const prefix = source.endsWith("\n") || source.length === 0 ? "" : "\n";
    insert = `${prefix}${p.indent}${statement}\n${END}`;
    indentLen = prefix.length + p.indent.length;
    note = "源码缺少 \\end{tikzpicture}，已自动补齐环境结尾。";
  } else {
    const head = `${BEGIN}\n${p.indent}`;
    insert = `${head}${statement}\n${END}`;
    indentLen = head.length;
    note = "已新建空白 tikzpicture 环境。";
  }

  const next = source.slice(0, p.at) + insert + source.slice(p.replaceTo);
  const selection = {
    from: p.at + indentLen,
    to: p.at + indentLen + statement.length,
  };
  return {
    source: next,
    patch: { from: p.at, to: p.replaceTo, insert },
    selection,
    mode: p.mode,
    note,
  };
}

/** 从新一次渲染的语句清单里，找到刚插入那条语句的 id（与 SVG data-source-id 一致）。 */
export function pickInsertedStatementId(
  statements: readonly { id: string; span: { from: number; to: number } }[],
  selection: { from: number; to: number },
): string | null {
  for (const s of statements) {
    if (s.span.from >= selection.from && s.span.to <= selection.to) return s.id;
  }
  return null;
}

/** UI 预览：world 三点圆弧 → SVG `A` 弧命令用的角度差（度，0–360）。 */
export function arcSweepDegrees(p1: ShapePoint, p2: ShapePoint, p3: ShapePoint): number {
  const deg = (p: ShapePoint) => (Math.atan2(p.y - p2.y, p.x - p2.x) * 180) / Math.PI;
  let delta = deg(p3) - deg(p1);
  while (delta < 0) delta += 360;
  while (delta >= 360) delta -= 360;
  return delta;
}
