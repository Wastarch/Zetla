// M2·F3-4：智能参考线 / 吸附 / 旋转缩放手势的**纯逻辑**（无 DOM / React，Node 可直接回归）。
//
// 口径与 F2-1 一致：world 单位 pt、Y 轴向上。包围盒一律由「可写控制点的 world 坐标」
// 求得（见 transform.ts collectElementBoxes），**不用 getBBox() / getBoundingClientRect()**
// 参与写回计算 —— 这样「对齐算出来的 delta」和「applyEditIntent 真正改写的坐标」永远同源。
// 屏幕 DOM 只负责把参考线画出来，绝不反过来决定源码补丁。
import type { PointLike } from "./dragEdit.ts";
import { TIKZ_PT_PER_CM } from "./shapeInsert.ts";

/** world pt 坐标系下的轴对齐包围盒（Y 向上，maxY 是视觉上的「上边」）。 */
export interface WorldBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type GuideAxis = "x" | "y";

export interface GuideLine {
  axis: GuideAxis;
  /** 该轴在 world 坐标上的位置 */
  at: number;
  kind: "edge" | "center" | "canvas";
}

export function makeWorldBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): WorldBox | null {
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
}

/** 从一组点求包围盒；过滤 NaN / Infinity，空集返回 null（绝不画 NaN 框）。 */
export function boxFromPoints(points: readonly (PointLike | null | undefined)[]): WorldBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    count += 1;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return count > 0 ? makeWorldBox(minX, minY, maxX, maxY) : null;
}

export function unionWorldBox(boxes: readonly (WorldBox | null | undefined)[]): WorldBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const b of boxes) {
    if (!b || ![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) continue;
    found = true;
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  return found ? makeWorldBox(minX, minY, maxX, maxY) : null;
}

export function boxCenter(b: WorldBox): PointLike {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function boxWidth(b: WorldBox): number {
  return Math.max(0, b.maxX - b.minX);
}

export function boxHeight(b: WorldBox): number {
  return Math.max(0, b.maxY - b.minY);
}

/** 每个包围盒贡献 6 条潜在对齐轴：左 / 水平中 / 右、下 / 垂直中 / 上。 */
export function boxGuides(b: WorldBox): GuideLine[] {
  const c = boxCenter(b);
  return [
    { axis: "x", at: b.minX, kind: "edge" },
    { axis: "x", at: c.x, kind: "center" },
    { axis: "x", at: b.maxX, kind: "edge" },
    { axis: "y", at: b.minY, kind: "edge" },
    { axis: "y", at: c.y, kind: "center" },
    { axis: "y", at: b.maxY, kind: "edge" },
  ];
}

/** world pt 阈值：默认 6pt ≈ 屏幕 2–3px（100% 缩放、1 单位≈0.4px 时会放宽到 UI 换算）。 */
export const DEFAULT_SNAP_THRESHOLD_PT = 6;

export interface SnapOptions {
  /** 已施加指针位移后的候选包围盒 */
  moving: WorldBox;
  /** 其它静止元素的包围盒（不含被拖元素自身） */
  others: readonly WorldBox[];
  threshold?: number;
  /** 画布中心（可选，提供横向 / 纵向居中吸附） */
  canvasCenter?: PointLike | null;
}

export interface SnapResult {
  /** 需要额外叠加到本次位移上的修正量（已吸附为 0 / 0 表示不吸附） */
  delta: PointLike;
  guides: GuideLine[];
}

/**
 * 智能参考线吸附：在 x / y 两个方向各找一条「最近的候选轴 ↔ 目标轴」配对，
 * 差值在阈值内就把位移修正到完全对齐，并返回命中的参考线供画布绘制。
 * 两个轴独立，因此可以「左边缘对齐 + 垂直居中」同时成立。
 */
export function planSnap(options: SnapOptions): SnapResult {
  const threshold = options.threshold ?? DEFAULT_SNAP_THRESHOLD_PT;
  const none: SnapResult = { delta: { x: 0, y: 0 }, guides: [] };
  if (!Number.isFinite(threshold) || threshold <= 0) return none;
  const moving = options.moving;
  if (![moving.minX, moving.minY, moving.maxX, moving.maxY].every(Number.isFinite)) return none;

  const targets: GuideLine[] = [];
  for (const b of options.others) {
    if (b && [b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) {
      targets.push(...boxGuides(b));
    }
  }
  const c = options.canvasCenter;
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
    targets.push({ axis: "x", at: c.x, kind: "canvas" });
    targets.push({ axis: "y", at: c.y, kind: "canvas" });
  }
  if (targets.length === 0) return none;

  let bestX: { diff: number; guide: GuideLine } | null = null;
  let bestY: { diff: number; guide: GuideLine } | null = null;
  for (const m of boxGuides(moving)) {
    for (const t of targets) {
      if (m.axis !== t.axis) continue;
      const diff = t.at - m.at;
      if (!Number.isFinite(diff) || Math.abs(diff) > threshold) continue;
      const best = m.axis === "x" ? bestX : bestY;
      if (!best || Math.abs(diff) < Math.abs(best.diff)) {
        const hit = { diff, guide: t };
        if (m.axis === "x") bestX = hit;
        else bestY = hit;
      }
    }
  }
  const guides: GuideLine[] = [];
  if (bestX) guides.push(bestX.guide);
  if (bestY) guides.push(bestY.guide);
  return {
    delta: { x: bestX?.diff ?? 0, y: bestY?.diff ?? 0 },
    guides,
  };
}

/** 角度吸附：15° 步长覆盖 0/15/45/90，只有足够接近才吸附，否则保留 1 位小数。 */
export function snapAngle(deg: number, step = 15, tolerance = 4): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = ((deg % 360) + 360) % 360;
  const nearest = Math.round(wrapped / step) * step;
  if (Math.abs(wrapped - nearest) <= tolerance) return nearest >= 360 ? 0 : nearest;
  return Math.round(deg * 10) / 10;
}

/** 旋转柄：以包围盒中心为原点，起止指针向量的夹角（度，逆时针为正，Y 向上）。 */
export function rotationFromDrag(box: WorldBox, start: PointLike, current: PointLike): number {
  const c = boxCenter(box);
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a1 = Math.atan2(current.y - c.y, current.x - c.x);
  const deg = ((a1 - a0) * 180) / Math.PI;
  return Number.isFinite(deg) ? deg : 0;
}

/** 8 个缩放柄，顺时针：0 左上 / 1 上中 / 2 右上 / 3 右中 / 4 右下 / 5 下中 / 6 左下 / 7 左中。 */
export function cornerPoint(box: WorldBox, corner: number): PointLike {
  const c = boxCenter(box);
  switch (((corner % 8) + 8) % 8) {
    case 0: return { x: box.minX, y: box.maxY };
    case 1: return { x: c.x, y: box.maxY };
    case 2: return { x: box.maxX, y: box.maxY };
    case 3: return { x: box.maxX, y: c.y };
    case 4: return { x: box.maxX, y: box.minY };
    case 5: return { x: c.x, y: box.minY };
    case 6: return { x: box.minX, y: box.minY };
    default: return { x: box.minX, y: c.y };
  }
}

export interface ScaleArgs {
  box: WorldBox;
  corner: number;
  pointer: PointLike;
  /** Shift：强制等比 */
  uniform: boolean;
  /** Alt：以包围盒中心为锚点（否则以对角柄为锚点） */
  center: boolean;
}

export interface ScaleResult {
  /** v1 写入 `scale=` 选项的单一比例（几何平均） */
  scale: number;
  sx: number;
  sy: number;
}

function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(20, Math.max(0.05, n));
}

/** 缩放柄：从「柄的初始位置 + 对侧锚点」与当前指针的距离比求比例。 */
export function scaleFromDrag(args: ScaleArgs): ScaleResult | null {
  const { box, pointer } = args;
  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  const corner = ((args.corner % 8) + 8) % 8;
  const start = cornerPoint(box, corner);
  const anchor = args.center ? boxCenter(box) : cornerPoint(box, corner + 4);
  const w = Math.abs(start.x - anchor.x);
  const h = Math.abs(start.y - anchor.y);
  let sx = w > 1e-6 ? Math.abs(pointer.x - anchor.x) / w : 1;
  let sy = h > 1e-6 ? Math.abs(pointer.y - anchor.y) / h : 1;
  // 边中点柄只影响一个轴；角柄两轴都参与
  if (corner === 1 || corner === 5) sx = 1;
  else if (corner === 3 || corner === 7) sy = 1;
  sx = clampScale(sx);
  sy = clampScale(sy);
  return {
    scale: Math.round(clampScale(Math.sqrt(sx * sy)) * 1000) / 1000,
    sx: Math.round(sx * 1000) / 1000,
    sy: Math.round(sy * 1000) / 1000,
  };
}

/** 仅供 UI 显示：pt → cm。**绝不用于写回源码**（写回坐标一律交给上游 applyEditIntent）。 */
export function formatCm(pt: number): string {
  if (!Number.isFinite(pt)) return "—";
  return `${(pt / TIKZ_PT_PER_CM).toFixed(2)} cm`;
}

export function formatDeg(deg: number): string {
  return Number.isFinite(deg) ? `${(Math.round(deg * 10) / 10).toFixed(1)}°` : "—";
}

export interface SvgViewBoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 把一条 world 参考线换算成 SVG 用户坐标线段（svgY = 2*vb.y + vb.height - worldY）。 */
export function guideToSvgSegment(
  line: GuideLine,
  vb: SvgViewBoxLike,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!Number.isFinite(line.at) || ![vb.x, vb.y, vb.width, vb.height].every(Number.isFinite)) {
    return null;
  }
  if (line.axis === "x") {
    return { x1: line.at, y1: vb.y, x2: line.at, y2: vb.y + vb.height };
  }
  const y = 2 * vb.y + vb.height - line.at;
  return { x1: vb.x, y1: y, x2: vb.x + vb.width, y2: y };
}

/** 把 union 包围盒从 world 翻到 SVG 用户坐标（画缩放 / 旋转柄用）。 */
export function worldBoxToSvgBox(box: WorldBox, vb: SvgViewBoxLike) {
  const flip = (y: number) => 2 * vb.y + vb.height - y;
  return makeWorldBox(box.minX, flip(box.maxY), box.maxX, flip(box.minY));
}

/** worldBoxToSvgBox 的逆：把画布 SVG 用户坐标的包围盒翻回 world 坐标（Y 轴向上）。 */
export function svgBoxToWorldBox(box: WorldBox, vb: SvgViewBoxLike): WorldBox | null {
  if (!box || ![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) return null;
  const flip = (y: number) => 2 * vb.y + vb.height - y;
  return makeWorldBox(box.minX, flip(box.maxY), box.maxX, flip(box.minY));
}
