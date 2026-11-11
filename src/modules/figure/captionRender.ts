// 子标题渲染：把含 $...$ / $$...$$ 的 LaTeX 子标题，烘焙进合成 canvas。
//
// 为什么用 MathJax 而非 KaTeX：
//   - 合成图要把公式画进 canvas，且导出走 canvas.toBlob；
//   - KaTeX 输出是 HTML+CSS，栅格化必须包 <foreignObject> → 画进 canvas 会污染（toBlob 抛 SecurityError）；
//   - MathJax 的 SVG 输出把字形画成 <path>（fontCache:'local' 自包含），作为 data: URL 图片画进 canvas
//     不触发污染，导出 PNG 同样带公式。
//
// 公式在固定参考字号（REF_FONT_PX）渲染一次，绘制时按显示字号等比缩放 → 预览缩放/导出分辨率变化
// 不重复调用 MathJax，性能好。
import mathjaxUrl from "mathjax/es5/tex-svg.js?url";

/** 公式渲染参考字号（px）：画大一点，绘制时缩小更清晰 */
const REF_FONT_PX = 48;

type RawSeg =
  | { type: "text"; text: string }
  | { type: "math"; tex: string; display: boolean };

export type RenderedSeg =
  | { type: "text"; text: string }
  | { type: "math"; img: HTMLImageElement | null; tex: string };

export interface RenderedCaption {
  /** 子编号，如 (a) */
  letter: string;
  segs: RenderedSeg[];
}

/* ------------------------------------------------------------------ *
 * MathJax 懒加载（脚本方式，避免预编译包的 ESM 格式问题）
 * ------------------------------------------------------------------ */

let mjPromise: Promise<unknown> | null = null;

export function ensureMathJax(): Promise<any> {
  if (mjPromise) return mjPromise as Promise<any>;
  mjPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.MathJax && w.MathJax.tex2svg) {
      resolve(w.MathJax);
      return;
    }
    // 配置必须在脚本加载前注入（MathJax 启动即读取）
    w.MathJax = {
      startup: { typeset: false },
      svg: { fontCache: "local", scale: 1 },
    };
    const s = document.createElement("script");
    s.src = mathjaxUrl;
    s.async = true;
    s.onload = () => {
      const mj = w.MathJax;
      if (mj && mj.startup && mj.startup.promise) {
        mj.startup.promise.then(() => resolve(mj)).catch((e: unknown) => {
          mjPromise = null; // 启动失败允许下次重试（禁用脚本 / 网络抖动后恢复）
          reject(e);
        });
      } else {
        mjPromise = null;
        reject(new Error("MathJax 启动失败"));
      }
    };
    s.onerror = () => {
      mjPromise = null; // 禁用 / 加载失败不永久锁死，重渲染时可重试
      reject(new Error("MathJax 脚本加载失败"));
    };
    document.head.appendChild(s);
  });
  return mjPromise as Promise<any>;
}

/**
 * F4-2：把一段 TeX 公式渲染为 MathJax 原生 <svg> 字符串（fontCache:'local' 单例）。
 * 与 figure 子标题共用同一个 ensureMathJax 脚本 / 配置，不新增依赖、不重复加载 2MB 脚本。
 * 只负责产出字形 markup；消毒与混排交给 diagram/tikzEditor/mathText.ts。
 */
export async function renderMathGlyph(tex: string, display: boolean): Promise<string> {
  const mj = await ensureMathJax();
  const container = mj.tex2svg(tex, { display });
  const svg = container?.querySelector?.("svg") as SVGSVGElement | null;
  if (!svg) throw new Error("MathJax 未产出 svg");
  return new XMLSerializer().serializeToString(svg);
}

/* ------------------------------------------------------------------ *
 * 分段：正文 / 行内公式 / 行间公式
 * ------------------------------------------------------------------ */

/** 把子标题切成 文本段 与 公式段（支持 $..$ 与 $$..$$） */
export function splitCaption(subCaption: string): RawSeg[] {
  const segs: RawSeg[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(subCaption)) !== null) {
    if (m.index > last) segs.push({ type: "text", text: subCaption.slice(last, m.index) });
    const tex = (m[1] ?? m[2]) as string;
    const display = m[1] !== undefined; // $$ → 行间
    segs.push({ type: "math", tex, display });
    last = re.lastIndex;
  }
  if (last < subCaption.length) segs.push({ type: "text", text: subCaption.slice(last) });
  return segs;
}

/* ------------------------------------------------------------------ *
 * 单条公式 → 自包含 SVG 图片（不污染 canvas）
 * ------------------------------------------------------------------ */

async function texToImage(tex: string, display: boolean, color: string): Promise<HTMLImageElement> {
  const mj = await ensureMathJax();
  const container = mj.tex2svg(tex, { display });
  const svg = container.querySelector("svg") as SVGSVGElement | null;
  if (!svg) throw new Error("MathJax 未产出 svg");

  // 颜色：MathJax 字形用 fill="currentColor"，由 color 属性/样式决定
  svg.setAttribute("color", color);
  svg.style.color = color;

  // 归一为固定参考像素尺寸（仅依赖 viewBox，分辨率无关）
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const p = vb.split(/[\s,]+/).map(Number);
    const vbW = p[2];
    const vbH = p[3];
    if (vbW && vbH) {
      const w = REF_FONT_PX * (vbW / vbH);
      const h = REF_FONT_PX;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
    }
  }

  let svgStr = new XMLSerializer().serializeToString(svg);
  if (!/xmlns=/.test(svgStr)) {
    svgStr = svgStr.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // 含 foreignObject 的 SVG 画进 canvas 会污染 → 直接放弃烘焙，回退纯文本
  if (svgStr.includes("foreignObject")) {
    throw new Error("MathJax 输出含 foreignObject");
  }

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("SVG 解码失败"));
    img.src = url;
  });
  return img;
}

/* ------------------------------------------------------------------ *
 * 整条子标题渲染（公式 → 图片，正文保留）
 * ------------------------------------------------------------------ */

/**
 * 渲染一条子标题：返回 letter + 分段（公式已栅格化为图片，失败则回退为纯文本 tex）。
 * @param letter   子编号，如 (a)
 * @param subCaption 子标题原文（可含 $...$）
 * @param color   公式颜色（与正文一致）
 */
export async function renderCaption(
  letter: string,
  subCaption: string,
  color: string,
): Promise<RenderedCaption> {
  const raw = splitCaption(subCaption);
  const segs: RenderedSeg[] = [];
  for (const s of raw) {
    if (s.type === "text") {
      segs.push({ type: "text", text: s.text });
    } else {
      try {
        const img = await texToImage(s.tex, s.display, color);
        segs.push({ type: "math", img, tex: s.tex });
      } catch {
        // 公式渲染失败：回退为纯文本（去掉 $），保证信息不丢、不污染
        segs.push({ type: "text", text: s.tex });
      }
    }
  }
  return { letter, segs };
}
