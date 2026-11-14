// M2 · 图片插入 TikZ · P4：本地即时显示真图（浏览器专属）。
//
// 定位不再自己推 world→SVG 翻转公式（P0 实测 C 由场景 bbox 决定，无法稳定推导）：
// 引擎渲染出的 `<text data-source-id="path:N" x y …>\includegraphics[…]{…}</text>` 已直接
// 给出图片节点在最终 SVG 用户坐标里的锚点。这里按 data-source-id 找到该 text，读 x/y，
// 把 `<image>` 以锚点为中心放置，并移除 / 隐藏字面量文字。
//
// 流程（在 sanitizeSvg 之前合成 → 沿用既有消毒 / 注入 / 唯一真源管线）：
//   解析引擎 SVG → 定位图片 text → resolveImagePath 取 realPath → convertFileSrc 出 href
//   → 读自然尺寸 → 合成 <image>（锚点为中心、data-source-id 移到 image、隐藏字面量）
//   → 求 viewBox 并集写回。消毒交给 svg.ts（已在白名单放行 image / 严格 asset 前缀 href）。
//
// 浏览器专属：用 DOMParser / XMLSerializer / Image / convertFileSrc；不进 Node 测试。
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveImagePath } from "./imageRefs.ts";
import {
  isSafeAssetHref,
  parseIncludeGraphics,
  resolveImageBoxPt,
  type ImageBoxPt,
} from "./imageSize.ts";
import type { TikzViewBox } from "./tikzEditor/engine";

const SVG_NS = "http://www.w3.org/2000/svg";
/** 单图上限，防止恶意 / 超大源一次塞太多 <image> 卡 WebView */
const MAX_IMAGES = 24;

export interface InjectResult {
  svg: string;
  /** 扩过的 viewBox（含图片外接框）；未注入任何图时为 undefined → 沿用引擎原值 */
  viewBox?: TikzViewBox;
}

/** 严格前缀白名单（与 svg.ts 同源判定）：只接受 Tauri asset 协议两种平台形态。 */
export function isLocalAssetHref(value: string): boolean {
  return isSafeAssetHref(value);
}

function loadNaturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 引擎 SVG 里的图片 <text>：文案含 \includegraphics，锚点是最终 SVG 用户坐标 */
function findImageTexts(root: Element): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(root.querySelectorAll("text[data-source-id]"))) {
    if (/\\includegraphics/.test(el.textContent ?? "")) out.push(el);
  }
  return out;
}

function readViewBox(root: Element): TikzViewBox | null {
  const v = root.getAttribute("viewBox");
  if (!v) return null;
  const p = v.split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  return { x: p[0], y: p[1], width: p[2], height: p[3] };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 把引擎 SVG 里的图片占位 <text> 替换成真 <image>。
 * ctx.texDir = 主文档所在目录（相对图片路径基准）；ctx.root = 项目根（越界校验）。
 * 任一图解析失败 / 拿不到自然尺寸（PDF 等）就跳过、保留字面量，不做破坏性注入。
 */
export async function injectLocalImages(
  markup: string,
  ctx: { texDir: string; root: string },
): Promise<InjectResult> {
  let parsed: Document;
  try {
    parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  } catch {
    return { svg: markup };
  }
  const root = parsed.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") return { svg: markup };

  const texts = findImageTexts(root);
  if (texts.length === 0) return { svg: markup };

  const vb = readViewBox(root);
  let expanded: TikzViewBox | null = null;

  for (const text of texts.slice(0, MAX_IMAGES)) {
    const parsedIg = parseIncludeGraphics(text.textContent ?? "");
    if (!parsedIg) continue;

    const resolved = resolveImagePath(ctx.texDir, ctx.root, parsedIg.relPath);
    if ("reason" in resolved) continue; // 解析不了 → 保留字面量（P5 接红框 / 重新链接）
    const realPath = resolved.abs;

    const href = convertFileSrc(realPath);
    const natural = await loadNaturalSize(href);
    if (!natural) continue; // 拿不到自然尺寸（PDF / 加载失败）→ 保留字面量，不注入

    const box: ImageBoxPt = resolveImageBoxPt(parsedIg, natural);

    // 锚点：text 的 x/y（text-anchor=middle / dominant-baseline=middle）→ 图片以锚点为中心
    const ax = Number(text.getAttribute("x") ?? "0") || 0;
    const ay = Number(text.getAttribute("y") ?? "0") || 0;
    const x = ax - box.widthPt / 2;
    const y = ay - box.heightPt / 2;

    const img = parsed.createElementNS(SVG_NS, "image");
    img.setAttribute("href", href);
    img.setAttribute("x", String(round4(x)));
    img.setAttribute("y", String(round4(y)));
    img.setAttribute("width", String(round4(box.widthPt)));
    img.setAttribute("height", String(round4(box.heightPt)));
    img.setAttribute("preserveAspectRatio", box.stretch ? "none" : "xMidYMid meet");
    // 把选中 / 拖拽锚点从字面量文字移到真图：文字 display:none 且去掉 data-source-id，
    // 避免框选并集被 0 框（display:none 的 getBoundingClientRect）污染。
    const sid = text.getAttribute("data-source-id");
    if (sid) img.setAttribute("data-source-id", sid);
    img.setAttribute("data-dg-image", "1");
    text.setAttribute("display", "none");
    if (sid) text.removeAttribute("data-source-id");
    text.parentNode?.insertBefore(img, text);

    if (vb) {
      const nx = Math.min(vb.x, x);
      const ny = Math.min(vb.y, y);
      const nx2 = Math.max(vb.x + vb.width, x + box.widthPt);
      const ny2 = Math.max(vb.y + vb.height, y + box.heightPt);
      expanded = { x: nx, y: ny, width: nx2 - nx, height: ny2 - ny };
    }
  }

  if (!expanded) return { svg: markup };
  const out = new XMLSerializer().serializeToString(root);
  return { svg: out, viewBox: expanded };
}
