// M2·F3-6：相邻控制点命中圈重叠时按「指针距离」择优（§8 已知边界收口，纯逻辑）。
//
// F3-2 把视觉圆与透明命中圈分离后，命中圈半径约为视觉圆的 3×；当两个控制点在
// world 里靠得很近（例如矩形缩小后的相邻角、\foreach 展开点），命中圈会互相重叠。
// 浏览器按 DOM 绘制顺序分发 pointer 事件（后画的盖先画的），用户点在最靠近的那个上时
// 可能选到另一个 —— 拖拽会改错坐标。
//
// 这里只做「选谁」的纯计算；调用方（startDragFromEvent）**仅在 overlapping > 1 时**
// 才用它覆盖 DOM 分发结果，不重叠时保持原有命中链路零回归。
import { isDraggableHandle, lockedHandleReason, type PointLike } from "./dragEdit.ts";
import { resolveHandleLock, type CompatReport } from "./tikzEditor/compat.ts";
import type { TikzEditHandle } from "./tikzEditor/engine.ts";

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

/** 世界坐标重合容差（pt）：只吞掉真正同一个点的重复句柄，不碰邻近锚点。 */
const SHADOW_EPSILON_PT = 1e-6;

/**
 * F2-3 补充：被可写 node-position 句柄「遮住」的命名坐标句柄。
 *
 * 典型来源是 `\draw (a) -- (b);`：箭头端点 `(a)` / `(b)` 是命名坐标，拖动会把
 * 引用改写成绝对坐标、静默断开关联，因此引擎标为 unsupported 并画挂锁；但这两个
 * 坐标与 `\node (a) at (...)` / `\node (b) at (...)` 的 node-position 句柄**完全重合**，
 * 后者是可写的。此时挂锁属于重复控制点，视觉上却像「节点被锁住」，点击还会抢走
 * 节点句柄的命中。这里只识别「命名坐标 + 与另一条语句的可写 node-position 重合」
 * 这一种情形，把锁图标和命中圈一起省掉，节点照常拖动、箭头继续跟随引用。
 *
 * 不解锁其他情形：没有可写节点句柄的命名坐标、极坐标、F2-3 展开 / 计算型锁定、
 * 能力矩阵锁定、主动图层锁定全部保留。
 */
export function shadowedLockedHandleIds(
  handles: readonly TikzEditHandle[],
  compat: CompatReport | null = null,
): ReadonlySet<string> {
  const writableNodes: TikzEditHandle[] = [];
  for (const h of handles) {
    if (h.kind !== "node-position" || !h.world) continue;
    if (!Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
    if (!isDraggableHandle(h)) continue;
    if (resolveHandleLock(compat, h.id, true, lockedHandleReason(h)) !== null) continue;
    writableNodes.push(h);
  }
  const shadowed = new Set<string>();
  for (const h of handles) {
    if (h.coordinateForm !== "named" || isDraggableHandle(h) || !h.world) continue;
    if (!Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
    const covered = writableNodes.some((w) => {
      if (w.sourceRef?.sourceId === h.sourceRef?.sourceId) return false;
      return (
        Math.abs(w.world.x - h.world.x) <= SHADOW_EPSILON_PT &&
        Math.abs(w.world.y - h.world.y) <= SHADOW_EPSILON_PT
      );
    });
    if (covered) shadowed.add(h.id);
  }
  return shadowed;
}
