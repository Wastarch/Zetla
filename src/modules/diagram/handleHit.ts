// M2·F3-6：相邻控制点命中圈重叠时按「指针距离」择优（§8 已知边界收口，纯逻辑）。
//
// F3-2 把视觉圆与透明命中圈分离后，命中圈半径约为视觉圆的 3×；当两个控制点在
// world 里靠得很近（例如矩形缩小后的相邻角、\foreach 展开点），命中圈会互相重叠。
// 浏览器按 DOM 绘制顺序分发 pointer 事件（后画的盖先画的），用户点在最靠近的那个上时
// 可能选到另一个 —— 拖拽会改错坐标。
//
// 这里只做「选谁」的纯计算；调用方（startDragFromEvent）**仅在 overlapping > 1 时**
// 才用它覆盖 DOM 分发结果，不重叠时保持原有命中链路零回归。
import type { PointLike } from "./dragEdit.ts";

export interface HitCandidate {
  id: string;
  /** SVG 用户坐标（命中圈 cx / cy） */
  x: number;
  y: number;
}

export interface NearestHit {
  id: string | null;
  /** 落在 hitRadius 内的候选数；> 1 才说明确实发生了重叠 */
  overlapping: number;
  /** 最近候选的距离，便于回归断言 */
  distance: number;
}

/**
 * 选距离指针最近的控制点。只有落进 hitRadius 的候选参与；
 * 距离相同（严格重合）时按输入顺序取先者，保证结果确定。
 * hitRadius 与指针都用 **SVG 用户单位**（metrics.hitR 已按 unitScale 换算过），
 * 因此 50%–200% 缩放下判定一致，绝不混用屏幕 px。
 */
export function pickNearestHandle(
  candidates: readonly HitCandidate[],
  pointer: PointLike,
  hitRadius: number,
): NearestHit {
  const radius = Math.max(0, hitRadius);
  const inside: { c: HitCandidate; d: number }[] = [];
  for (const c of candidates) {
    if (!c.id || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const d = Math.hypot(c.x - pointer.x, c.y - pointer.y);
    if (d <= radius) inside.push({ c, d });
  }
  if (inside.length === 0) return { id: null, overlapping: 0, distance: Infinity };
  let best = inside[0];
  for (let i = 1; i < inside.length; i += 1) {
    if (inside[i].d < best.d) best = inside[i];
  }
  return { id: best.c.id, overlapping: inside.length, distance: best.d };
}
