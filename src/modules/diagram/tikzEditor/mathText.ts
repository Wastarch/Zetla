// F4-2 · MathJax 节点公式增强 —— 纯逻辑层（Node 可回归，零 DOM / 零 ?url 依赖）。
//
// 职责边界：
//   ① `$...$` / `$$...$$` 分段（与 figure/captionRender 的 splitCaption 同款正则，
//      这里独立实现，避免把 mathjax?url 依赖带进 Node 回归与引擎层）；
//   ② MathJax tex2svg 产出的 <svg> → 能穿过 svg.ts 白名单的内嵌片段
//      （xlink:href→href、currentColor→实体色、删 style、id 加前缀防多公式冲突）；
//   ③ 混排布局：按 font-size 与 viewBox 比例排文本段 / 公式段，text-anchor 对齐；
//   ④ 遍历引擎 SVG 的 <text> 做替换。MathJax 调用由调用方以 resolve 注入，
//      测试可传假 resolver，因此 ①–④ 全可在 Node 里断言。
//
// 硬约束：只产出「增强后的预览 SVG 字符串」，绝不写 source / 导出片段；
//         失败逐段回退原文（保留 $...$ 字面量），不抛异常、不白屏。

/** 一段文本或一个公式。display=true 表示 $$...$$。 */
export interface MathSegment {
  type: "text" | "math";
  text: string;
  display: boolean;
}

/** MathJax 字形片段（消毒器安全）：可嵌入内嵌 <svg> 的内容。 */
export interface MathGlyphSvg {
  /** <defs>… + <g>…</g>，xlink:href 已改 href、currentColor 已替换、id 已加前缀 */
  inner: string;
  /** MathJax 原 viewBox 字符串（"x y w h"） */
  viewBox: string;
  vbW: number;
  vbH: number;
}

export interface MathEnhanceResult {
  svg: string;
  /** 成功渲染为公式的段数 */
  enhanced: number;
  /** 失败回退为原文的公式段数 */
  failed: number;
}

/**
 * 可选的浏览器侧布局输入。纯逻辑层不碰 DOM，测量能力由调用方注入，
 * 因此 Node 回归可用假测量函数，无 DOM 时自动回退 estimateTextWidth。
 */
export interface MathLayoutOptions {
  /**
   * 按真实字体测量文本段宽度（SVG 用户单位）；返回 null 表示测量不可用。
   * 参数与引擎 <text> 的字号 / 字体族 / 字重 / 字形一致。
   */
  measureText?: (
    text: string,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
    fontStyle: string,
  ) => number | null;
}

const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/**
 * 把一段节点文字切成 文本 / 行内公式 / 行间公式。
 * 正则与 figure/captionRender.splitCaption 一致（$$ 优先、$ 不跨行）。
 */
export function splitMathText(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  let last = 0;
  MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATH_RE.exec(input)) !== null) {
    if (m.index > last) out.push({ type: "text", text: input.slice(last, m.index), display: false });
    out.push({ type: "math", text: (m[1] ?? m[2]) as string, display: m[1] !== undefined });
    last = MATH_RE.lastIndex;
  }
  if (last < input.length) out.push({ type: "text", text: input.slice(last), display: false });
  return out;
}

// MathJax 只有 TeX math-mode，没有 PGF 驱动与宏展开；这些构造不能喂给它。
// 命中即回退原文（F4-2 明确「失败回退原文不白屏」）。
const UNSAFE_TEX = /\\(pgf|tikz|draw|node|coordinate|begin|end|usepackage|write18|input|include|csname|expandafter|def|newcommand)/i;

/** 喂给 MathJax 前的净化：空白 / PGF 构造拒绝；返回 null 表示该段回退原文。 */
export function sanitizeMathTex(tex: string): string | null {
  const t = String(tex ?? "").trim();
  if (!t) return null;
  if (UNSAFE_TEX.test(t)) return null;
  return t;
}

/**
 * MathJax tex2svg 的 <svg> 字符串 → 可穿过 svg.ts 白名单的内嵌片段。
 * 关键改写（对应计划 §4 四个实现要点之二）：
 *   · `xlink:href="#id"` → `href="#id"`（svg.ts 只放行 href 且仅 # 内引用）；
 *   · `currentColor` → 实体颜色（svg.ts 删 style 与 color 属性）；
 *   · 删 style / on* / foreignObject / script（白名单会删或注入风险）；
 *   · id 加前缀（MathJax 每个公式都用 MJX-1-…，同图多个公式会撞 id）。
 */
export function normalizeMathSvg(
  svgMarkup: string,
  color: string,
  idPrefix: string,
): MathGlyphSvg | null {
  if (/foreignObject|<script|javascript:|<image\b/i.test(svgMarkup)) return null;
  const vbMatch = svgMarkup.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!vbMatch) return null;
  const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isFinite(n))) return null;
  const [vbX, vbY, vbW, vbH] = parts;
  if (!(vbW > 0 && vbH > 0)) return null;

  // 取根 svg 内部内容（<defs> + 字形 <g>），外层属性全部重建。
  let inner = svgMarkup
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "");
  inner = inner
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, "")
    .replace(/xlink:href\s*=\s*"/gi, 'href="')
    .replace(/currentColor/gi, color);
  // href 只允许 # 内引用，其余（含空串 / 外链）剔除
  inner = inner.replace(/href\s*=\s*"([^"]*)"/gi, (full, value: string) =>
    /^#/.test(value.trim()) ? full : "",
  );
  // 去掉事件属性
  inner = inner.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  // id 加前缀，并同步改写内部 href（先收齐再换，避免半截替换）
  const ids = new Set<string>();
  inner = inner.replace(/\bid\s*=\s*"([^"]+)"/gi, (_full, id: string) => {
    ids.add(id);
    return `id="${idPrefix}-${id}"`;
  });
  for (const id of ids) {
    inner = inner.split(`href="#${id}"`).join(`href="#${idPrefix}-${id}"`);
  }

  return {
    inner,
    viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
    vbW,
    vbH,
  };
}

/* ------------------------------------------------------------------ *
 * 混排布局（纯数值，便于单测）
 * ------------------------------------------------------------------ */

/** 文本段宽度粗估（仅测量不可用时兜底）：CJK ≈ 1em，窄拉丁 ≈ 0.3em，其余 ≈ 0.55em。 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of String(text ?? "")) {
    if (/[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) w += fontSize;
    else if (/[ilI.,';:!|`]/.test(ch)) w += fontSize * 0.3;
    else w += fontSize * 0.55;
  }
  return w;
}

/**
 * MathJax SVG 的 viewBox 单位：1000 = 1em（`svg.scale=1` 时恒定）。
 * 例：`\alpha` 的 viewBox 是 `0 -442 640 453`，即 0.453em 高、0.640em 宽；
 * 若把 vbH 直接当成 font-size 用，字形会被放大 1000/453 ≈ 2.2 倍。
 */
export const MATH_UNITS_PER_EM = 1000;

/** 公式相对正文的视觉缩放系数：1 = 与正文同字号，真机可在 0.9–1.1 间微调。 */
export const MATH_HEIGHT_FACTOR = 1;

/** 按 text-anchor 计算整行起点 x。 */
export function lineStartX(x: number, totalWidth: number, anchor: string): number {
  if (anchor === "middle") return x - totalWidth / 2;
  if (anchor === "end") return x - totalWidth;
  return x;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function numAttr(attrs: string, name: string, fallback: number): number {
  const v = attr(attrs, name);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** String.replace 不支持 async resolver —— 顺序执行版。 */
async function replaceAsync(
  input: string,
  re: RegExp,
  fn: (...args: string[]) => Promise<string>,
): Promise<string> {
  const out: string[] = [];
  let last = 0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out.push(input.slice(last, m.index));
    out.push(await fn(m[0], ...m.slice(1)));
    last = re.lastIndex;
  }
  out.push(input.slice(last));
  return out.join("");
}

const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

/**
 * 把引擎 SVG 里含 `$...$` 的 <text> 换成 <g class="dg-math-run">：
 *   文本段 → 原生 <text>（text-anchor=start、原 fill / font-size / 基线）；
 *   公式段 → 内嵌 <svg x/y/width/height/viewBox>（字形组已消毒安全）。
 * transform / data-source-id 原样提到包裹 <g> 上，保证旋转节点与选中命中不丢。
 *
 * @param resolve (tex, display) => MathJax <svg> 字符串；返回 null 表示失败回退原文
 * @param options 可选的浏览器侧真实字形宽度测量；缺省时退回粗估（Node 回归用）
 */
export async function enhanceMathInSvg(
  svg: string,
  resolve: (tex: string, display: boolean) => Promise<string | null>,
  options: MathLayoutOptions = {},
): Promise<MathEnhanceResult> {
  let enhanced = 0;
  let failed = 0;
  let seq = 0;
  const out = await replaceAsync(svg, TEXT_RE, async (_full, attrs: string, inner: string) => {
    if (!inner.includes("$")) return _full;
    const segs = splitMathText(inner);
    if (!segs.some((s) => s.type === "math")) return _full;

    const x = numAttr(attrs, "x", 0);
    const y = numAttr(attrs, "y", 0);
    const fontSize = numAttr(attrs, "font-size", 10);
    const anchor = attr(attrs, "text-anchor") ?? "start";
    const fill = attr(attrs, "fill") ?? "#000000";
    const transform = attr(attrs, "transform");
    const dataId = attr(attrs, "data-source-id");
    const fontFamilyAttr = attr(attrs, "font-family");
    const fontFamily = fontFamilyAttr ?? "serif";
    const fontWeight = attr(attrs, "font-weight") ?? "";
    const fontStyle = attr(attrs, "font-style") ?? "";
    const fillOpacity = attr(attrs, "fill-opacity");

    // 文本段宽度优先用真实字体测量。粗估把每个拉丁字母按 0.55em 算，
    // 而 Latin Modern/Times 的 "text" 只有 ≈1.5em（4×0.55=2.2em），
    // 多出的 ≈0.7em 会整体变成公式段左侧的空白，看起来像凭空插了个空格。
    const textWidth = (text: string): number => {
      const measured = options.measureText?.(text, fontSize, fontFamily, fontWeight, fontStyle);
      return measured !== null && measured !== undefined && Number.isFinite(measured) && measured >= 0
        ? measured
        : estimateTextWidth(text, fontSize);
    };

    interface Run {
      kind: "text" | "math";
      /** 文本原文（已 XML 安全）或字形 inner */
      content: string;
      w: number;
      h: number;
      vb?: string;
    }
    const runs: Run[] = [];
    let localEnhanced = 0;
    for (const seg of segs) {
      if (seg.type === "text") {
        if (seg.text) runs.push({ kind: "text", content: seg.text, w: textWidth(seg.text), h: fontSize });
        continue;
      }
      const tex = sanitizeMathTex(seg.text);
      let glyph: MathGlyphSvg | null = null;
      if (tex !== null) {
        try {
          const raw = await resolve(tex, seg.display);
          if (raw) glyph = normalizeMathSvg(raw, fill, `dgm${seq}`);
        } catch {
          glyph = null;
        }
      }
      if (glyph) {
        enhanced++;
        localEnhanced++;
        // viewBox 单位 → SVG 用户单位：vbH=453 的 \alpha 只应占 0.453em，
        // 而不是整个 font-size。宽高同乘一个 scale，保持 MathJax 原生比例。
        const scale = (fontSize / MATH_UNITS_PER_EM) * MATH_HEIGHT_FACTOR;
        const h = glyph.vbH * scale;
        runs.push({ kind: "math", content: glyph.inner, w: glyph.vbW * scale, h, vb: glyph.viewBox });
      } else {
        failed++;
        // 回退：保留原 $...$ 字面量，信息不丢；宽度按完整字面量（含 $ 定界符）测量
        const literal = seg.display ? `$$${seg.text}$$` : `$${seg.text}$`;
        runs.push({ kind: "text", content: literal, w: textWidth(literal), h: fontSize });
      }
      seq++;
    }
    // 本段一个公式都没渲染成功 → 原样保留 <text>，不包空 g（避免无意义 DOM 与空字形组）。
    // 部分成功时仍重排：成功段出字形、失败段保留字面量，混排信息不丢。
    if (runs.length === 0 || localEnhanced === 0) return _full;

    const total = runs.reduce((a, r) => a + r.w, 0);
    let cursor = lineStartX(x, total, anchor);
    const pieces: string[] = [];
    for (const run of runs) {
      if (run.kind === "text") {
        const textAttrs = [
          `x="${fmt(cursor)}"`,
          `y="${fmt(y)}"`,
          `font-size="${fmt(fontSize)}"`,
          `fill="${fill}"`,
          fillOpacity ? `fill-opacity="${fillOpacity}"` : "",
          fontWeight ? `font-weight="${fontWeight}"` : "",
          fontStyle ? `font-style="${fontStyle}"` : "",
          'text-anchor="start"',
          'dominant-baseline="middle"',
          'xml:space="preserve"',
        ]
          .filter(Boolean)
          .join(" ");
        pieces.push(`<text ${textAttrs}>${run.content}</text>`);
      } else {
        pieces.push(
          `<svg x="${fmt(cursor)}" y="${fmt(y - run.h / 2)}" width="${fmt(run.w)}" height="${fmt(run.h)}" viewBox="${run.vb}" preserveAspectRatio="xMidYMid meet">${run.content}</svg>`,
        );
      }
      cursor += run.w;
    }
    const gAttrs = [
      'class="dg-math-run"',
      'data-dg-math-run="1"',
      dataId ? `data-source-id="${dataId}"` : "",
      transform ? `transform="${transform}"` : "",
      fontFamilyAttr ? `font-family="${fontFamilyAttr}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<g ${gAttrs}>${pieces.join("")}</g>`;
  });
  return { svg: out, enhanced, failed };
}
