// M2·F1-3：SVG 消毒与 DOM 注入。
// 引擎本身会把节点文字里的 `<` 转义成 `&lt;`（spike 实证 <script> 不会成为元素），
// 但源码由用户编写、且 SVG 要直接挂进 DOM，仍按「零信任」做白名单：
//   · 元素白名单（剔除 script / foreignObject / image / animate / style …）
//   · 属性白名单（剔除 on* 事件、外部 href、style、未知属性）
//   · 用 DOMParser + importNode 挂载，不走 innerHTML，避免 HTML 解析器改命名空间
import type { TikzViewBox } from "./engine";

// 覆盖 tikz-editor 同步渲染实际产出的标签，并预留常见图元 / 渐变 / 裁剪。
const ALLOWED_TAGS = new Set([
  "svg", "g", "defs", "title", "desc", "symbol", "use",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textpath",
  "clippath", "mask", "marker",
  "lineargradient", "radialgradient", "pattern", "stop",
]);

const ALLOWED_ATTRS = new Set([
  "xmlns", "viewbox", "width", "height", "preserveaspectratio", "role",
  "id", "class", "transform", "opacity", "display", "visibility", "vectoreffect",
  "d", "points", "x", "y", "x1", "y1", "x2", "y2", "dx", "dy",
  "cx", "cy", "r", "rx", "ry", "fx", "fy",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
  "marker-start", "marker-mid", "marker-end", "markerwidth", "markerheight",
  "refx", "refy", "orient", "markerunits", "overflow",
  "gradienttransform", "gradientunits", "spreadmethod",
  "patternunits", "patterntransform", "patterncontentunits",
  "offset", "stop-color", "stop-opacity",
  "font-family", "font-size", "font-style", "font-weight", "font-variant",
  "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift",
  "letter-spacing", "text-decoration", "textlength", "lengthadjust",
  "xml:space", "startoffset", "rotate", "pathlength", "paint-order",
]);

/** 递归清理：先删不允许的元素，再删不允许的属性。 */
function cleanElement(el: Element): void {
  for (const child of Array.from(el.children)) {
    if (!ALLOWED_TAGS.has(child.localName.toLowerCase())) {
      child.remove();
      continue;
    }
    cleanElement(child);
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const keep =
      ALLOWED_ATTRS.has(name) ||
      name.startsWith("data-") ||
      name.startsWith("aria-") ||
      (name === "href" && /^#/.test(attr.value.trim()));
    if (!keep || /^on/.test(name)) {
      el.removeAttributeNode(attr);
      continue;
    }
    // <use href> 只允许指向本 SVG 内的 #id
    if ((name === "href" || name === "xlink:href") && !/^#/.test(attr.value.trim())) {
      el.removeAttributeNode(attr);
    }
  }
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

/**
 * 把引擎返回的 SVG 字符串解析、消毒、并转成可挂载的 SVGSVGElement。
 * 返回 null 表示 SVG 无法解析（UI 会显示错误态，不注入任何东西）。
 */
export function sanitizeSvg(
  markup: string,
  viewBox: TikzViewBox,
  zoom: number
): SVGSVGElement | null {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  } catch {
    return null;
  }
  if (parsed.getElementsByTagName("parsererror").length > 0) return null;
  const root = parsed.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") return null;

  cleanElement(root);

  let svg: SVGSVGElement;
  try {
    // DOM lib 把 Document.documentElement 标为 HTMLElement，但 XML 文档这里是 SVG 根元素
    svg = document.importNode(root, true) as unknown as SVGSVGElement;
  } catch {
    return null;
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute(
    "viewBox",
    `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`
  );
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // zoom=1 为「适应窗口」；>1 时等比放大并由 .dg-canvas-stage 提供滚动
  const pct = `${Math.round(zoom * 100)}%`;
  svg.setAttribute("width", pct);
  svg.setAttribute("height", pct);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "TikZ 画布预览");
  svg.style.display = "block";
  svg.style.margin = "auto";
  svg.style.maxWidth = "none";
  return svg;
}

/** 快速判断引擎是否真的画出了东西（空 tikzpicture / 全错源码会返回空 <svg>）。 */
export function hasDrawableContent(markup: string): boolean {
  return /<(path|rect|circle|ellipse|line|polyline|polygon|text|g|use)\b/i.test(markup);
}
