// M2·F3-2：控制点 / 包围盒的**纯数值逻辑**（不依赖 DOM / React，Node 侧可直接回归）。
//
// 用户反馈「现在的节点太大了」：F2-1 时代控制点视觉半径 4.2px、且视觉与命中共用
// 同一个 <circle>，缩小后就会难点中。本模块把两者拆成两套尺寸：
//   · visualR  —— 看到的空心圆，默认 3.3px（比 F2-1 的 4.2px 小），三档可调；
//   · hitR     —— 透明命中圈，约 3× 视觉半径且不小于 9px，保证「小而好点」。
// 所有数值以**屏幕像素**定义，再统一除以 zoom 变成 SVG 用户单位；这样 50%–200%
// 缩放下手柄在屏幕上恒定大小（与 F2-1 的 HANDLE_R_PX / zoom 同一口径）。
//
// 包围盒用 getBoundingClientRect()（屏幕像素，天然包含元素 transform）再经
// getScreenCTM() 的完整仿射逆回到 SVG 用户坐标；不用 getBBox()，避免局部坐标系
// 与 transform 叠加时算错。DOM 构建在 handleLayer.ts，本文件只产出数值。
import { clientToSvgPoint, type AffineMatrix } from "./dragEdit.ts";

export type HandleSize = "small" | "medium" | "large";

export const DEFAULT_HANDLE_SIZE: HandleSize = "medium";

export const HANDLE_SIZE_LABELS: Record<HandleSize, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 屏幕像素规格。命中半径恒 ≥ 2× 视觉半径，且不小于 9px（小图形也好点）。 */
export interface HandleSizeSpec {
  visualR: number;
  hitR: number;
  stroke: number;
}

export const HANDLE_SIZE_SPECS: Record<HandleSize, HandleSizeSpec> = {
  small: { visualR: 2.6, hitR: 9, stroke: 1.2 },
  medium: { visualR: 3.3, hitR: 10, stroke: 1.4 },
  large: { visualR: 4.2, hitR: 11.5, stroke: 1.6 },
};

export function isHandleSize(v: unknown): v is HandleSize {
  return v === "small" || v === "medium" || v === "large";
}

/** 挂锁图标的屏幕基准尺寸（10px 见方），不随节点档位缩小，保证 F2-3 的理由图标仍清晰。 */
export const LOCK_BASE_PX = 10;
/** 挂锁中心相对控制点中心的屏幕上移距离 = 命中半径 + 余量，避免盖住视觉圆。 */
const LOCK_GAP_PX = 5;
const BOX_STROKE_PX = 1.2;
const BOX_CORNER_PX = 6;
const BOX_PAD_PX = 3;

/** 所有长度均为 **SVG 用户单位**（已除以 zoom）；lockScale 是给 DOM 层的挂锁整体缩放系数。 */
export interface HandleMetrics {
  size: HandleSize;
  zoom: number;
  visualR: number;
  hitR: number;
  stroke: number;
  /** appendLockGlyph 的 transform: scale(lockScale / zoom)，内部坐标按 LOCK_BASE_PX 写死 */
  lockScale: number;
  lockOffset: number;
  boxStroke: number;
  boxCorner: number;
  boxPad: number;
}

/**
 * 三档 × 缩放 → 一组恒屏尺寸。非法 size 降级为 medium，非法 / 零 zoom 降级为 1，
 * 防止手改 localStorage 或画布尺寸为 0 时产出 Infinity / NaN 打进 SVG 属性。
 */
export function handleMetrics(size: HandleSize, zoom: number): HandleMetrics {
  const s = isHandleSize(size) ? size : DEFAULT_HANDLE_SIZE;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const spec = HANDLE_SIZE_SPECS[s];
  const px = (n: number) => n / z;
  return {
    size: s,
    zoom: z,
    visualR: px(spec.visualR),
    hitR: px(spec.hitR),
    stroke: px(spec.stroke),
    lockScale: 1,
    lockOffset: px(spec.hitR + LOCK_GAP_PX),
    boxStroke: px(BOX_STROKE_PX),
    boxCorner: px(BOX_CORNER_PX),
    boxPad: px(BOX_PAD_PX),
  };
}

/** SVG 用户坐标下的轴对齐矩形（getBBox / clientRectToSvgBox 的统一形态）。 */
export interface BoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 浏览器 getBoundingClientRect() 的必需字段。 */
export interface ClientRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function finite(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

function validBox(b: BoxLike | null | undefined): b is BoxLike {
  return (
    !!b &&
    finite(b.x) &&
    finite(b.y) &&
    finite(b.width) &&
    finite(b.height) &&
    b.width >= 0 &&
    b.height >= 0
  );
}

/**
 * 求多个图元矩形的并集。允许 width/height 为 0（直线 / 水平路径的真实 bbox 就是 0），
 * 由 padBox 再撑出可见厚度；忽略非有限值与负尺寸，全部无效时返回 null。
 */
export function unionBoxes(boxes: readonly (BoxLike | null | undefined)[]): BoxLike | null {
  const ok = boxes.filter(validBox);
  if (ok.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of ok) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 屏幕矩形 → SVG 用户坐标矩形。用完整仿射逆（含 e/f）把左上 / 右下各反算一次，
 * 再取外接盒：缩放、preserveAspectRatio 留白、SVG 在页面上的偏移都会自动抵消。
 * 退化矩阵（宽高为 0）返回 null，调用方应不画包围盒而不是画一个 NaN 框。
 */
export function clientRectToSvgBox(rect: ClientRectLike, m: AffineMatrix): BoxLike | null {
  if (!finite(rect.left) || !finite(rect.top) || !finite(rect.right) || !finite(rect.bottom)) {
    return null;
  }
  const a = clientToSvgPoint(m, rect.left, rect.top);
  const b = clientToSvgPoint(m, rect.right, rect.bottom);
  if (!a || !b) return null;
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** 给包围盒留一圈可见余量；零高度 / 零宽度的直线也能撑成看得见的框。 */
export function padBox(box: BoxLike, pad: number): BoxLike {
  const p = finite(pad) && pad > 0 ? pad : 0;
  return {
    x: box.x - p,
    y: box.y - p,
    width: box.width + 2 * p,
    height: box.height + 2 * p,
  };
}

/** 四角小方块的几何位置（左上 / 右上 / 右下 / 左下），边长由 metrics.boxCorner 给出。 */
export function selectionCorners(box: BoxLike, corner: number): BoxLike[] {
  const c = finite(corner) && corner > 0 ? corner : 0;
  const half = c / 2;
  return [
    { x: box.x - half, y: box.y - half, width: c, height: c },
    { x: box.x + box.width - half, y: box.y - half, width: c, height: c },
    { x: box.x + box.width - half, y: box.y + box.height - half, width: c, height: c },
    { x: box.x - half, y: box.y + box.height - half, width: c, height: c },
  ];
}

/** 供 UI / 文档展示：当前档位的屏幕像素摘要。 */
export function handleSizeSummary(size: HandleSize): string {
  const s = HANDLE_SIZE_SPECS[isHandleSize(size) ? size : DEFAULT_HANDLE_SIZE];
  return `视觉 ${s.visualR}px · 命中 ${s.hitR}px`;
}
