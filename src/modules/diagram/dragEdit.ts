// M2·F2-1：拖拽写回的纯逻辑（不依赖 DOM / React，Node 侧可直接回归）。
//
// 坐标口径（上游 tikz-editor，勿凭直觉改符号）：
//   · 语义层 world 单位是 pt，Y 轴向上；1cm = 28.4527559…pt。
//   · SVG 用同一个 viewBox 但 Y 轴向下：svgY = 2*vb.y + vb.height - worldY，
//     svgX = worldX（见上游 coords/svg.ts worldToSvgPoint）。
//   · 屏幕像素 → SVG 用户单位要过 svg 根元素的 getScreenCTM() 线性部分求逆，
//     这样缩放（width/height 百分比）与 preserveAspectRatio 的留白都自动抵消。
//   · 写回时把 newWorld（pt）交给上游 applyEditIntent，由它反算成源码里的
//     `(1.4,1.2)` 等原本写法；Zetla 不做单位换算，避免破坏 x=.../ polar / calc 等语法。
import type { TikzEditHandle, TikzViewBox } from "./tikzEditor/engine.ts";

export interface PointLike {
  x: number;
  y: number;
}

export interface MatrixLike {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface SourceSpanPatch {
  from: number;
  to: number;
  insert: string;
}

/** 屏幕位移（CSS px）→ SVG 用户单位位移。退化矩阵返回 null，调用方应取消拖拽。 */
export function clientDeltaToSvgDelta(
  m: MatrixLike,
  dxPx: number,
  dyPx: number,
): PointLike | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return {
    x: (m.d * dxPx - m.c * dyPx) / det,
    y: (-m.b * dxPx + m.a * dyPx) / det,
  };
}

/** SVG 用户单位位移 → world 位移（Y 翻转）。 */
export function svgDeltaToWorldDelta(d: PointLike): PointLike {
  return { x: d.x, y: -d.y };
}

/** world 点 → SVG 用户坐标（用于把控制点画在正确位置）。 */
export function worldToSvgPoint(world: PointLike, vb: TikzViewBox): PointLike {
  return { x: world.x, y: 2 * vb.y + vb.height - world.y };
}

/**
 * F3-1：SVG 用户坐标 → world 点（worldToSvgPoint 的逆）。
 * 形状工具把「用户在画布上点的位置」变成 world pt，再交给 shapeInsert 生成 TikZ 坐标。
 */
export function svgToWorldPoint(svg: PointLike, vb: TikzViewBox): PointLike {
  return { x: svg.x, y: 2 * vb.y + vb.height - svg.y };
}

/** getScreenCTM() 的完整仿射矩阵（F2-1 的位移换算只用 a/b/c/d，这里还要 e/f 平移）。 */
export interface AffineMatrix extends MatrixLike {
  e: number;
  f: number;
}

/**
 * F3-1：屏幕 client 坐标 → SVG 用户单位绝对坐标。
 * 与 clientDeltaToSvgDelta 的区别：这里是**绝对点**，必须减去 e/f 平移，
 * 否则 preserveAspectRatio 的居中留白与 SVG 在页面上的位置都会造成整体偏移。
 * 退化矩阵（宽度 / 高度为 0）返回 null，调用方应取消本次绘制。
 */
export function clientToSvgPoint(
  m: AffineMatrix,
  clientX: number,
  clientY: number,
): PointLike | null {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const x = clientX - m.e;
  const y = clientY - m.f;
  return {
    x: (m.d * x - m.c * y) / det,
    y: (-m.b * x + m.a * y) / det,
  };
}

/**
 * 由「整段旧源码 / 整段新源码」求最小单点补丁（公共前缀 + 公共后缀）。
 * 上游重写只替换一个坐标 span，所以这里必然是单 patch；返回 null 表示无变化。
 * 用最小补丁 dispatch 而不是整篇替换，CM6 的撤销记录才只有几字符、光标也不跳走。
 */
export function singleSpanPatch(before: string, after: string): SourceSpanPatch | null {
  if (before === after) return null;
  const maxPrefix = Math.min(before.length, after.length);
  let from = 0;
  while (from < maxPrefix && before[from] === after[from]) from += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > from &&
    endAfter > from &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { from, to: endBefore, insert: after.slice(from, endAfter) };
}

const WRITABLE_REWRITE_MODES = new Set(["direct", "delta", "calc", "positioning"]);

/**
 * 可拖拽判定。rewriteMode = unsupported 的多是 `(a)` 这类命名坐标引用：
 * 上游其实支持「脱离引用」改写，但那会静默改变语义，v1 一律锁定（F2-3 再给明确说明）。
 */
export function isDraggableHandle(h: TikzEditHandle): boolean {
  if (!h || typeof h.id !== "string") return false;
  if (!h.world || !Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) return false;
  return WRITABLE_REWRITE_MODES.has(h.rewriteMode ?? "");
}

/** 控制点 / 提示条上的可读名称。 */
export function handleLabel(h: TikzEditHandle): string {
  if (h.kind === "node-position" || h.kind === "path-control" || h.kind === "path-bend") {
    return "节点 / 控制点";
  }
  return "路径点";
}

/** 锁定控制点的提示文案（F2-3 会接 capabilityMatrix 给出更细的理由，这里先给稳定说明）。 */
export function lockedHandleReason(h: TikzEditHandle): string {
  if (h.coordinateForm === "named") {
    return `「${h.sourceText ?? "命名坐标"}」引用了命名节点，拖拽会断开引用；当前版本锁定，请直接改源码。`;
  }
  if (h.coordinateForm === "polar") {
    return "极坐标写法暂不支持拖拽写回，请直接改源码。";
  }
  return "该控制点的源码写法暂不支持拖拽写回，请直接改源码。";
}

/** 数量上限：foreach / 大量节点时避免往 SVG 里塞成千上万个 circle。 */
export const MAX_VISIBLE_HANDLES = 160;

/** 拖拽期间展示的实时位移（pt）。 */
export function dragDeltaLabel(dxWorld: number, dyWorld: number): string {
  const f = (n: number) => (Math.abs(n) < 0.05 ? "0" : n.toFixed(1));
  return `Δ ${f(dxWorld)}, ${f(dyWorld)} pt`;
}
