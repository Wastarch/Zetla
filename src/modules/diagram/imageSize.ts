// M2 · 图片插入 TikZ · P4：本地即时显示的「尺寸解析」纯逻辑。
//
// 与本地注入 DOM 代码隔离：本文件无 DOM / Tauri / React / store 依赖，
// Node --experimental-strip-types 可直测；相对 import 带 .ts，与 imageRefs 同例。
//
// 背景（P0 实证定稿）：引擎把 `\node at (x,y) {\includegraphics[…]{…}}` 渲染成
// `<text data-source-id x y …>\includegraphics[…]{…}</text>` 字面量，锚点 x/y 已经是
// 最终 SVG 用户坐标（pt，Y 向上无需翻转）。P4 复用该锚点合成 `<image>`，并把 [width/height]
// 选项折算成 pt 外接框；缺尺寸时用自然像素（1px≈1pt）兜底并封顶，防超大图卡 WebView。
export const CM_TO_PT = 28.45275590551181;

/** 无显式尺寸时，自然像素按 pt 计并封顶，防止超大图卡 WebView */
export const MAX_NATURAL_PT = 800;
/** 显式 [width=]/[height=] 也封顶，防止用户写一个 200cm 把画布撑爆 */
export const MAX_EXPLICIT_PT = 2000;

export interface IncludeGraphicsParsed {
  /** 相对主文档目录的路径（正斜杠、trim 后） */
  relPath: string;
  /** 显式宽度（cm），未给为 null */
  widthCm: number | null;
  /** 显式高度（cm），未给为 null */
  heightCm: number | null;
}

/** 只认 \includegraphics 的 {必选参数}，[opt] 允许跨行（与 imageRefs.REF_RE 同口径） */
const IG_RE = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/;

/**
 * 从引擎 SVG 里图片 <text> 的字面量内容，抽出相对路径与显式宽高（cm）。
 * 返回 null 表示不是图片节点（普通文字节点 / 解析失败）。
 */
export function parseIncludeGraphics(text: string): IncludeGraphicsParsed | null {
  const m = IG_RE.exec(text);
  if (!m) return null;
  const opt = m[1] ?? "";
  const relPath = (m[2] ?? "").trim();
  if (!relPath) return null;
  let widthCm: number | null = null;
  let heightCm: number | null = null;
  const wm = opt.match(/width\s*=\s*([\d.]+)\s*cm/i);
  if (wm) widthCm = Number(wm[1]);
  const hm = opt.match(/height\s*=\s*([\d.]+)\s*cm/i);
  if (hm) heightCm = Number(hm[1]);
  if (widthCm != null && !Number.isFinite(widthCm)) widthCm = null;
  if (heightCm != null && !Number.isFinite(heightCm)) heightCm = null;
  return { relPath, widthCm, heightCm };
}

export interface ImageBoxPt {
  widthPt: number;
  heightPt: number;
  /** width 与 height 同时显式给出 → 拉伸（preserveAspectRatio="none"） */
  stretch: boolean;
}

function clampPt(v: number, cap: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(v, cap);
}

/**
 * 由选项 + 自然尺寸算出 SVG 用户坐标（pt）下的外接框。
 *  - 同时给 width/height → 拉伸到该框；
 *  - 只给一边 → 另一边按自然比例推出；
 *  - 都没给 → 用自然像素（1px≈1pt），封顶 MAX_NATURAL_PT；拿不到自然尺寸（PDF 等）
 *    回落 3cm 占位框（注入层会先判 natural，PDF 通常跳过注入，这里只是兜底）。
 */
export function resolveImageBoxPt(
  parsed: IncludeGraphicsParsed,
  natural: { width: number; height: number } | null,
): ImageBoxPt {
  // 防御：非有限 cm 视为未给（parseIncludeGraphics 已处理，这里再兜底一次）
  const wCm = parsed.widthCm != null && Number.isFinite(parsed.widthCm) ? parsed.widthCm : null;
  const hCm = parsed.heightCm != null && Number.isFinite(parsed.heightCm) ? parsed.heightCm : null;

  if (wCm != null && hCm != null) {
    return {
      widthPt: clampPt(wCm * CM_TO_PT, MAX_EXPLICIT_PT),
      heightPt: clampPt(hCm * CM_TO_PT, MAX_EXPLICIT_PT),
      stretch: true,
    };
  }
  if (wCm != null) {
    const wPt = clampPt(wCm * CM_TO_PT, MAX_EXPLICIT_PT);
    const hPt =
      natural && natural.height > 0 && natural.width > 0
        ? (wPt * natural.height) / natural.width
        : wPt;
    return { widthPt: wPt, heightPt: hPt, stretch: false };
  }
  if (hCm != null) {
    const hPt = clampPt(hCm * CM_TO_PT, MAX_EXPLICIT_PT);
    const wPt =
      natural && natural.width > 0 && natural.height > 0
        ? (hPt * natural.width) / natural.height
        : hPt;
    return { widthPt: wPt, heightPt: hPt, stretch: false };
  }

  const nw = natural?.width ?? 0;
  const nh = natural?.height ?? 0;
  if (nw <= 0 || nh <= 0) {
    const d = 3 * CM_TO_PT;
    return { widthPt: d, heightPt: d, stretch: false };
  }
  let wPt = nw;
  let hPt = nh;
  const maxDim = Math.max(wPt, hPt);
  if (maxDim > MAX_NATURAL_PT) {
    const k = MAX_NATURAL_PT / maxDim;
    wPt *= k;
    hPt *= k;
  }
  return { widthPt: wPt, heightPt: hPt, stretch: false };
}

/**
 * Tauri asset 协议的两种平台形态（严格前缀白名单）：
 *  - Windows WebView2：`http://asset.localhost/…`
 *  - macOS / Linux：`asset://localhost/…`
 * 拒绝任何 http(s) 外链 / 外部路径 / `javascript:` 等。
 */
export function isSafeAssetHref(value: string): boolean {
  return (
    /^https?:\/\/asset\.localhost\//i.test(value) ||
    /^asset:\/\/localhost\//i.test(value)
  );
}
