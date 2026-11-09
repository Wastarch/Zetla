// M2·F3-2：控制点 / 包围盒的**纯数值逻辑**（不依赖 DOM / React，Node 侧可直接回归）。
//
// 用户反馈「现在的节点太大了」：F2-1 时代控制点视觉半径 4.2px、且视觉与命中共用
// 同一个 <circle>，缩小后就会难点中。F3-2 把两者拆成两套尺寸：
//   · visualR  —— 看到的空心圆，默认 3.3px（比 F2-1 的 4.2px 小），三档可调；
//   · hitR     —— 透明命中圈，约 3× 视觉半径且不小于 9px，保证「小而好点」。
//
// 用户再反馈「控制点还是太大了」→ 查到 F3-2 的**真根因**：数值以屏幕像素定义，
// 却只除以 UI zoom，漏了 SVG `viewBox → CSS 像素` 这层隐含缩放。默认示例的
// viewBox 约 124 单位被 `width:100%` 铺进约 400px 的画布，1 单位 ≈ 3.2 屏幕 px，
// 于是「3.3px 半径」在屏幕上实际画成约 21px 直径（挂锁 / 四角方块同样放大 3 倍）。
// 修复：统一以实测的 **unitScale = 屏幕 px / SVG 用户单位** 为换算基准
// （getScreenCTM() 优先，布局尺寸逐级回退），zoom 已包含在实测值里，不再单独除。
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

/** 所有长度均为 **SVG 用户单位**（屏幕 px / unitScale）；lockScale 是挂锁整体缩放系数。 */
export interface HandleMetrics {
  size: HandleSize;
  /** 实测的 屏幕 px / SVG 用户单位（已含 UI zoom 与 viewBox 缩放），非法时降级为 1 */
  unitScale: number;
  visualR: number;
  hitR: number;
  stroke: number;
  /** appendLockGlyph 的 transform: scale(lockScale / unitScale)，内部坐标按 LOCK_BASE_PX 写死 */
  lockScale: number;
  lockOffset: number;
  boxStroke: number;
  boxCorner: number;
  boxPad: number;
}

/** 只需要宽高的尺寸形状，便于 jsdom / 布局回退里传普通对象做回归。 */
export interface SizeLike {
  width: number;
  height: number;
}

/** CTM 线性部分行列式的平方根 = 等效的 屏幕 px / SVG 用户单位（旋转 / 非等比也成立）。 */
export function unitScaleFromCtm(m: AffineMatrix | null | undefined): number | null {
  if (!m || !finite(m.a) || !finite(m.b) || !finite(m.c) || !finite(m.d)) return null;
  const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  return Number.isFinite(s) && s > 0 ? s : null;
}

/**
 * 布局回退：preserveAspectRatio="xMidYMid meet" 取 min(宽比, 高比)。
 * rect 若是 **svg 自身**的 getBoundingClientRect，zoom 传 1（百分比宽度已含 zoom）；
 * rect 若是 **stage 容器**，传 UI zoom（svg 的 width/height = zoom × stage）。
 */
export function unitScaleFromRect(
  rect: SizeLike | null | undefined,
  viewBox: SizeLike | null | undefined,
  zoom = 1,
): number | null {
  if (!rect || !viewBox) return null;
  const vals = [rect.width, rect.height, viewBox.width, viewBox.height, zoom];
  if (!vals.every((n) => finite(n))) return null;
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0 || zoom <= 0) {
    return null;
  }
  const s = zoom * Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/** 测量所需的最小 SVG 接口（真实 SVGSVGElement 与测试桩都满足）。 */
export interface UnitScaleSvgLike {
  isConnected?: boolean;
  getScreenCTM?: () => AffineMatrix | null;
  getBoundingClientRect?: () => SizeLike | null;
}

/**
 * 实测 unitScale。**必须先挂载 SVG** 才有可靠的 getScreenCTM()；未挂载 / jsdom /
 * 零尺寸布局时逐级回退：CTM → svg rect → stage rect × zoom → 1（旧口径，绝不产出 NaN）。
 */
export function svgUnitScale(
  svg: UnitScaleSvgLike | null | undefined,
  viewBox: SizeLike | null | undefined,
  zoom: number,
  stageRect?: SizeLike | null,
): number {
  if (svg && svg.isConnected !== false) {
    const fromCtm = unitScaleFromCtm(svg.getScreenCTM?.() ?? null);
    const fromSvgRect = unitScaleFromRect(svg.getBoundingClientRect?.() ?? null, viewBox, 1);
    // 少数环境里根 <svg> 的 getScreenCTM() 不含 viewBox 变换（返回近单位矩阵），
    // 与布局实测值明显不符时以布局为准，避免又退回「漏乘比例」的老 bug。
    if (fromCtm !== null && fromSvgRect !== null) {
      const drift = Math.abs(fromCtm - fromSvgRect) / fromSvgRect;
      return drift <= 0.25 ? fromCtm : fromSvgRect;
    }
    if (fromCtm !== null) return fromCtm;
    if (fromSvgRect !== null) return fromSvgRect;
  }
  return unitScaleFromRect(stageRect, viewBox, zoom) ?? 1;
}

/**
 * 三档 × 实测单位比 → 一组恒屏尺寸。非法 size 降级为 medium，非法 / 零 unitScale
 * 降级为 1，防止手改 localStorage 或画布尺寸为 0 时产出 Infinity / NaN 打进 SVG 属性。
 */
export function handleMetrics(size: HandleSize, unitScale: number): HandleMetrics {
  const s = isHandleSize(size) ? size : DEFAULT_HANDLE_SIZE;
  const z = Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1;
  const spec = HANDLE_SIZE_SPECS[s];
  const px = (n: number) => n / z;
  return {
    size: s,
    unitScale: z,
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
