// F4-2 · 浏览器侧公式增强入口：图 → MathJax SVG 字符串 → 消毒安全的混排 markup。
//
// 这里只做浏览器侧编排（renderMathGlyph 依赖 ?url 与 window.MathJax，不能进 Node 回归）：
//   · 按公式文本缓存 MathJax 结果，避免拖拽 / 每次重渲染重复调用；
//   · 失败不缓存（脚本被禁用 / 网络抖动后，下次重渲染可重试），回退由 mathText 完成。
// 纯字符串处理与混排布局在 ./mathText.ts（Node 可回归）。
import { renderMathGlyph } from "../../figure/captionRender";
import { enhanceMathInSvg, type MathEnhanceResult, type MathLayoutOptions } from "./mathText";

/** key = `${display ? 1 : 0}:${tex}`；只缓存成功结果。 */
const glyphCache = new Map<string, string>();

async function resolveGlyph(tex: string, display: boolean): Promise<string | null> {
  const key = `${display ? "1" : "0"}:${tex}`;
  const hit = glyphCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const svg = await renderMathGlyph(tex, display);
    glyphCache.set(key, svg);
    return svg;
  } catch {
    // 不写缓存：MathJax 脚本被禁用 / 加载失败后，下次渲染还能重试；
    // 本帧由 mathText 回退为 $...$ 字面量，不抛异常、不白屏。
    return null;
  }
}

/** 公式文本缓存命中数（调试用；key 含 display 前缀）。 */
export function mathGlyphCacheSize(): number {
  return glyphCache.size;
}

/** 清空公式缓存（MathJax 配置变更 / 主题重载时由调用方决定）。 */
export function clearMathGlyphCache(): void {
  glyphCache.clear();
}

/* ------------------------------------------------------------------ *
 * 文本段真实宽度测量（与 vendored 引擎 UE() 同款 canvas 口径）
 * ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    measureCtx = null;
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    measureCtx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/**
 * 用与引擎 <text> 完全相同的字体参数测量文本宽度，返回 SVG 用户单位。
 * 粗估（0.55em/字符）会高估拉丁小写字母，进而把公式段往右推，
 * 造成 "text$\alpha$" 这类混排出现明显空隙；这里改用真实字形宽度。
 * 返回 null 表示测量不可用，由 mathText 自动回退粗估（不白屏）。
 */
export function measureSvgText(
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: string,
  fontStyle: string,
): number | null {
  const ctx = getMeasureContext();
  if (!ctx) return null;
  const size = Math.max(1, fontSize);
  const style = fontStyle === "italic" ? "italic " : "";
  const weight = fontWeight === "bold" || fontWeight === "700" ? "bold " : "";
  // 引擎 UE() 直接把 fontFamily 常量接在 `${size}px ` 后；多词字体族名 CSS 可解析。
  ctx.font = `${style}${weight}${size}px ${fontFamily || "serif"}`;
  // font shorthand 被拒绝时 ctx.font 保持旧值，此时绝不能拿默认字体算宽度。
  const appliedPx = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
  if (!appliedPx || Math.abs(Number(appliedPx[1]) - size) > 0.01) return null;
  const metrics = ctx.measureText(text);
  return Number.isFinite(metrics.width) ? metrics.width : null;
}

/**
 * 增强一段引擎 SVG：含 `$...$` 的 <text> 换成 MathJax 字形组。
 * 若整段没有公式则原样返回（enhanced=0 / failed=0），调用方可跳过重挂载。
 */
export function enhanceDiagramMath(svg: string): Promise<MathEnhanceResult> {
  const layout: MathLayoutOptions = { measureText: measureSvgText };
  return enhanceMathInSvg(svg, resolveGlyph, layout);
}
