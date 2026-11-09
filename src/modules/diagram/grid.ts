// M2·F3-5：画布网格 / 标尺 / 吸附网格的纯逻辑（无 DOM / React / vendor 依赖）。
//
// 坐标口径（沿用 dragEdit）：world 单位 pt、Y 向上；SVG 用户单位同 pt、Y 向下，
// svgY = 2*vb.y + vb.height - worldY。因此：
//   · 吸附在 **world** 空间做（snapToGrid），落到 step 的整数倍；
//   · 网格线的**横向**在 SVG x 上就是 step 的整数倍（svgX = worldX）；
//   · 网格线的**纵向**先取 world y 的整数倍，再翻到 SVG y 绘制 —— 这样「吸附到的位置」
//     必然落在画出来的某条网格线上，视觉与命中完全一致（不能直接按 SVG y 取倍数，
//     否则翻转后会有 2*vb.y+vb.height 的相位差）。
import type { TikzViewBox } from "./tikzEditor/engine.ts";
import type { PointLike } from "./dragEdit.ts";

/** 默认网格步长 = 1cm（与 TikZ `1cm` 一致，便于对齐常见尺寸）。 */
export const GRID_STEP_PT = 28.45275590551181;

/** world 点吸附到最近的网格交点（step 的整数倍）。 */
export function snapToGrid(p: PointLike, step: number = GRID_STEP_PT): PointLike {
  if (!Number.isFinite(step) || step <= 0) return { x: p.x, y: p.y };
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/** [min,max] 内 step 的全部整数倍（容忍浮点误差，带 1e-6 容差）。 */
function multiplesIn(min: number, max: number, step: number): number[] {
  if (!Number.isFinite(step) || step <= 0) return [];
  const eps = 1e-6;
  const out: number[] = [];
  const first = Math.ceil((min - eps) / step);
  const last = Math.floor((max + eps) / step);
  for (let k = first; k <= last; k += 1) out.push(k * step);
  return out;
}

/**
 * 生成网格线在 **SVG 用户坐标** 下的位置：
 *   · xs —— 竖线，svgX = worldX（step 的整数倍）；
 *   · ys —— 横线，取 world y 的整数倍再翻成 svgY。
 * 只覆盖给定 viewBox 可见范围，避免无谓的超长线。
 */
export function gridLines(
  vb: TikzViewBox,
  step: number = GRID_STEP_PT,
): { xs: number[]; ys: number[] } {
  const xs = multiplesIn(vb.x, vb.x + vb.width, step);
  const worldYs = multiplesIn(vb.y, vb.y + vb.height, step);
  const ys = worldYs.map((wy) => 2 * vb.y + vb.height - wy);
  return { xs, ys };
}

/** 顶部标尺刻度：每条竖网格线一个主刻度，标签为 cm 值（worldX / step）。 */
export function rulerTicks(
  vb: TikzViewBox,
  step: number = GRID_STEP_PT,
): { svgX: number; cm: number }[] {
  return multiplesIn(vb.x, vb.x + vb.width, step).map((x) => ({
    svgX: x,
    cm: Math.round(x / step),
  }));
}
