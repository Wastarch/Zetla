// F3-7：画布视角（缩放 / 平移 / 适应）的纯逻辑，不依赖 DOM / React，Node 侧可直接回归。
//
// 实现口径：viewBox 是引擎几何真源，绝不改；缩放通过 SVG 的 width/height 百分比
// （sanitizeSvg 的第 3 参），平移通过外层容器 translate（只平移、不改尺度）。
// 容器以 stage 中心为原点，故 getScreenCTM() 的线性部分只含 zoom、平移只进 e/f，
// 所有既有 world↔SVG↔屏幕换算（尤其 svgUnitScale 的布局回退）保持成立。
import type { PointLike } from "./dragEdit.ts";

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.25;
/**
 * 上限 16：zoom=1 是「整张画布完整可见」（A4 正文宽 15cm × 默认高 10cm），
 * 默认示例的内容包围盒只有画布的约 1/4，要「适应内容」得放大数倍；
 * 旧的 4 倍会把适应内容卡在半路。
 */
export const MAX_ZOOM = 16;

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** 连续缩放钳位；NaN / 非法值回落到 1（不产出 NaN 打进 SVG 属性）。 */
export function clampZoom(n: number): number {
  if (!finite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}

export function normalizeViewport(v: Viewport | null | undefined): Viewport {
  if (!v) return { ...DEFAULT_VIEWPORT };
  return {
    zoom: clampZoom(v.zoom),
    panX: finite(v.panX) ? v.panX : 0,
    panY: finite(v.panY) ? v.panY : 0,
  };
}

/** 平移增量（屏幕 px）。pan 不参与任何 world↔SVG 换算。 */
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  const next = normalizeViewport(v);
  return {
    ...next,
    panX: finite(dx) ? next.panX + dx : next.panX,
    panY: finite(dy) ? next.panY + dy : next.panY,
  };
}

/**
 * 指针锚点连续缩放。
 *
 * 容器中心 = stage 中心；SVG 用户点 p 相对中心的屏幕位置 = (p - centerSVG) * s，
 * 其中 s = zoom * baseScale，baseScale 对同一 stage / viewBox 是常量。
 * 要求缩放前后指针下的 p 屏幕位置不变：
 *   pan' = pan + (pointer - stageCenter - pan) * (1 - nextZoom / oldZoom)
 * 退化 stage / 非法 zoom 时只改 zoom、不移动 pan，绝不产出 NaN。
 */
export function zoomAtPointer(
  v: Viewport,
  pointer: PointLike,
  stage: RectLike,
  nextZoom: number,
): Viewport {
  const prev = normalizeViewport(v);
  const zoom = clampZoom(nextZoom);
  if (
    !finite(pointer.x) || !finite(pointer.y) ||
    !finite(stage.x) || !finite(stage.y) ||
    !finite(stage.width) || !finite(stage.height) ||
    stage.width <= 0 || stage.height <= 0 ||
    prev.zoom <= 0
  ) {
    return { ...prev, zoom };
  }
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  const ratio = 1 - zoom / prev.zoom;
  return {
    zoom,
    panX: prev.panX + (pointer.x - cx - prev.panX) * ratio,
    panY: prev.panY + (pointer.y - cy - prev.panY) * ratio,
  };
}

/** 滚轮步长：向上放大 / 向下缩小，默认每格 1.12 倍。 */
export function zoomStep(
  v: Viewport,
  deltaY: number,
  pointer: PointLike,
  stage: RectLike,
  factor = 1.12,
): Viewport {
  const prev = normalizeViewport(v);
  if (!finite(deltaY) || deltaY === 0) return prev;
  const step = finite(factor) && factor > 1 ? factor : 1.12;
  return zoomAtPointer(prev, pointer, stage, prev.zoom * (deltaY < 0 ? step : 1 / step));
}

/**
 * 适应内容 / 适应画布：zoom = min(viewBox / targetBox)，pan 归零。
 * targetBox = viewBox 时 zoom = 1（现状「适应窗口」语义）；
 * targetBox = 纸张框时按纸张比例缩放，纸张框外的图元会被裁到容器外（视角操作不裁剪 DOM）。
 */
export function fitTo(targetBox: SizeLike, viewBox: SizeLike): Viewport {
  const vals = [targetBox.width, targetBox.height, viewBox.width, viewBox.height];
  if (!vals.every(finite) || vals.some((n) => n <= 0)) return { ...DEFAULT_VIEWPORT };
  const zoom = clampZoom(
    Math.min(viewBox.width / targetBox.width, viewBox.height / targetBox.height),
  );
  return { zoom, panX: 0, panY: 0 };
}

/** 「居中 / 100%」：回到默认视角。100% = 整张画布完整可见（见 renderScale）。 */
export function centerViewport(): Viewport {
  return { ...DEFAULT_VIEWPORT };
}

/**
 * 视角倍率 → SVG 的 width/height 百分比。
 *
 * 关键口径（F3-7 真机反馈修正）：**zoom=1 表示「整张固定画布完整可见」**，
 * 不是「内容包围盒铺满窗口」。15×10cm 画布（426×284pt）仍大于默认图 110×82pt，
 * 若按内容基准，纸张永远溢出视口、放大缩小都像「被裁剪」。
 *
 *   baseContent = min(stage.w / vb.w, stage.h / vb.h)   // px per SVG 单位，内容适配
 *   baseCanvas  = min(stage.w / paper.w, stage.h / paper.h) // 画布适配
 *   pct = zoom × baseCanvas / baseContent
 *
 * 于是 pct × baseContent = zoom × baseCanvas：
 *   zoom=1 → 纸张宽高都 ≤ stage（完整可见）；
 *   zoom=2 → 纸张放大一倍，超出部分交给 pan 查看（推近感）；
 *   无固定画布（paper=null）→ 退回 pct=zoom（与 F1-6 现状一致）。
 */
export function renderScale(
  zoom: number,
  stage: RectLike | null | undefined,
  viewBox: SizeLike | null | undefined,
  paper: SizeLike | null | undefined,
): number {
  const z = clampZoom(zoom);
  if (!paper) return z;
  if (!stage || !viewBox) return z;
  const sw = stage.width;
  const sh = stage.height;
  const vals = [sw, sh, viewBox.width, viewBox.height, paper.width, paper.height];
  if (!vals.every(finite) || vals.some((n) => n <= 0)) return z;
  const baseContent = Math.min(sw / viewBox.width, sh / viewBox.height);
  const baseCanvas = Math.min(sw / paper.width, sh / paper.height);
  if (!(baseContent > 0) || !(baseCanvas > 0)) return z;
  // 注意：pct 是 SVG 的 width/height 百分比，可能远小于 MIN_ZOOM（A4 约 12%），
  // 只钳输入 zoom、不钳 pct，否则「整张纸适配」会被顶到 25% 又溢出。
  const pct = z * (baseCanvas / baseContent);
  return Number.isFinite(pct) && pct > 0 ? pct : z;
}

/**
 * 「适应画布」：zoom=1（整张纸可见）+ 把**纸张中心**平移到窗口中心。
 *
 * 纸张框现在以图形包围盒中心为纸面中心（`canvasPaperRect`），所以这里的 pan 通常≈0；
 * 仍按通用公式算，是为了不把「纸张锚点」这一决策重复写进视角层——
 * 将来若改成别的锚点（左下角 / 顶部对齐），视角层无需再动。
 * 纸张中心相对 viewBox 中心的偏移 × 单位比 = 需要抵消的 pan。
 *
 * 注意：pan 作用在 `.dg-viewport` 上，而**裁剪发生在 `.dg-canvas-body`（窗口）**，
 * 不是 stage —— 否则裁剪框会跟着 pan 一起移动，放大后的边缘永远看不到。
 */
export function fitCanvasViewport(
  stage: SizeLike | null | undefined,
  viewBox: RectLike | null | undefined,
  paper: RectLike | null | undefined,
): Viewport {
  if (!paper || !stage || !viewBox) return { ...DEFAULT_VIEWPORT };
  const vals = [stage.width, stage.height, viewBox.x, viewBox.y, viewBox.width, viewBox.height, paper.x, paper.y, paper.width, paper.height];
  if (!vals.every(finite)) return { ...DEFAULT_VIEWPORT };
  const s = Math.min(stage.width / paper.width, stage.height / paper.height);
  if (!(s > 0)) return { ...DEFAULT_VIEWPORT };
  const vcx = viewBox.x + viewBox.width / 2;
  const vcy = viewBox.y + viewBox.height / 2;
  const pcx = paper.x + paper.width / 2;
  const pcy = paper.y + paper.height / 2;
  return { zoom: 1, panX: -(pcx - vcx) * s, panY: -(pcy - vcy) * s };
}

/**
 * 「适应内容」：把视角倍率调到内容包围盒刚好铺满窗口（纸张会超出视口）。
 * 无固定画布时就是 1。内容比画布小 → 结果 > 1（推近内容）。
 */
export function fitContentZoom(
  stage: RectLike | null | undefined,
  viewBox: SizeLike | null | undefined,
  paper: SizeLike | null | undefined,
): number {
  if (!paper) return 1;
  if (!stage || !viewBox) return 1;
  const vals = [stage.width, stage.height, viewBox.width, viewBox.height, paper.width, paper.height];
  if (!vals.every(finite) || vals.some((n) => n <= 0)) return 1;
  const baseContent = Math.min(stage.width / viewBox.width, stage.height / viewBox.height);
  const baseCanvas = Math.min(stage.width / paper.width, stage.height / paper.height);
  if (!(baseContent > 0) || !(baseCanvas > 0)) return 1;
  return clampZoom(baseContent / baseCanvas);
}

/**
 * 容器 CSS transform：只叠加 pan，**绝不带 -50% 位移**。
 * 容器本身是 inset:0（与 stage 同尺寸、同中心），内容居中由 stage 的
 * flex + justify/align center 负责；再补一个 -50% 会把整个画布推到左上角。
 */
export function viewportTransform(v: Viewport): string {
  const next = normalizeViewport(v);
  return `translate(${next.panX.toFixed(2)}px, ${next.panY.toFixed(2)}px)`;
}

/** 屏幕点 → stage 中心相对坐标（用于状态栏显示指针所在图元位置前的中间量）。 */
export function pointerFromStageCenter(pointer: PointLike, stage: RectLike, v: Viewport): PointLike {
  const prev = normalizeViewport(v);
  if (!finite(pointer.x) || !finite(pointer.y) || !finite(stage.x) || !finite(stage.y)) {
    return { x: 0, y: 0 };
  }
  return {
    x: pointer.x - (stage.x + stage.width / 2) - prev.panX,
    y: pointer.y - (stage.y + stage.height / 2) - prev.panY,
  };
}
