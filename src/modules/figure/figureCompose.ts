// P3 · 合成单张图片模式内核（§4.5）：布局 × targetWidthPx → Canvas，纯函数 + 图像预取。
//
// 口径（见 docs/拼图功能实现方案.md §4.5）：
//   - 格宽：直接复用 §4.2 的 computeRowLayout（与 subfigure 生成同源），再按像素归一；
//     行内多余空间按 \hfill 语义均分到子图之间（= LaTeX 真实的 justify 行为），
//     因此 gapCol 通过「压缩宽度预算」间接生效，与编译产物一致。
//   - 行距：gapRow × 图片宽度（等价 \vspace{gapRow\textwidth}）。
//   - 对齐：行级属性（同 subfigure，取该行首格 align），同一行共用一条基线语义——
//     顶 = 贴行顶、中 = 行内垂直居中、底 = 贴行底。
//   - 裁剪：crop 为归一化四边（左上角原点），换算成 drawImage 的源矩形采样。
//   - 预览（FigureRealPreview）与导出（toBlob）共用同一函数 → 零漂移。
//
// 图像预取：raster 走 fetch(asset)/File → blob（同源 blob URL，避免 canvas 被跨源污染，
// 否则 P3-2 的 toBlob 会抛 SecurityError）；PDF 用 pdf.js 栅格化**首页**（选页后置阶段二）。
import { FigureCell, FigureLayout, subFigureLetter } from "@/types/figure";
import { computeRowLayout, rowAlignOf } from "./figureGen";
import { cellPreviewUrl, isPdfSource } from "./figurePreviewUrl";
import { getDocument } from "@/preview/pdfjs";

/** 默认合成宽度（px）：与常见 \textwidth 印刷分辨率折中，够清晰又不过度占内存 */
export const DEFAULT_COMPOSE_WIDTH = 1600;

/* ------------------------------------------------------------------ *
 * 图像预取
 * ------------------------------------------------------------------ */

/** 预取缓存键：按来源去重（同一张图重复合成不重复解码） */
export function cellImageKey(cell: FigureCell): string {
  const s = cell.source;
  if (s?.kind === "path") return `p:${s.abs}`;
  if (s?.kind === "file") return `f:${s.file.name}:${s.file.size}:${s.file.lastModified}`;
  return `r:${cell.path}`;
}

/** 缓存 Promise（并发/重绘共用一次加载）；失败时剔除以便重试 */
const imageCache = new Map<string, Promise<CanvasImageSource>>();

/** 读取来源字节：file 直接用 File；path 走 asset 协议 fetch（blob 化后同源，canvas 不被污染） */
async function cellBlob(cell: FigureCell): Promise<Blob> {
  const s = cell.source;
  if (s?.kind === "file") return s.file;
  const url = cellPreviewUrl(cell);
  if (!url) throw new Error("缺少图片来源");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.blob();
}

/** raster 图 → HTMLImageElement（blob URL 解码，避免 canvas 跨源污染） */
async function decodeRaster(cell: FigureCell): Promise<HTMLImageElement> {
  const blob = await cellBlob(cell);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    // 先挂事件再给 src：避免极快加载导致 onload 先于监听器注册而永久挂起
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("图片解码失败"));
    });
    img.src = url;
    await loaded;
    return img;
  } finally {
    // 已解码为位图，撤销 URL 不影响后续 drawImage
    URL.revokeObjectURL(url);
  }
}

/** PDF → 首页栅格化 canvas（复用 pdfjs legacy 构建，与 PdfThumb 同口径） */
async function rasterizePdf(cell: FigureCell): Promise<HTMLCanvasElement> {
  const data = new Uint8Array(await (await cellBlob(cell)).arrayBuffer());
  const task = getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // 栅格化分辨率：按默认合成宽度折算，最多 3x，避免超大页吃内存
    const scale = Math.max(1, Math.min(3, DEFAULT_COMPOSE_WIDTH / Math.max(1, base.width)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 2D 上下文");
    await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    void task.destroy();
  }
}

/** 取单元格可绘制的图（带缓存）；PDF 只取首页 */
export function loadCellImage(cell: FigureCell): Promise<CanvasImageSource> {
  const key = cellImageKey(cell);
  const hit = imageCache.get(key);
  if (hit) return hit;
  const p = (isPdfSource(cell.source) ? rasterizePdf(cell) : decodeRaster(cell)).catch(
    (e: unknown) => {
      imageCache.delete(key);
      throw e;
    },
  );
  imageCache.set(key, p);
  return p;
}

/* ------------------------------------------------------------------ *
 * 合成
 * ------------------------------------------------------------------ */

/** 取图像原始尺寸（HTMLImageElement 用 naturalWidth，canvas 用 width） */
function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
    return { w: src.naturalWidth || src.width || 1, h: src.naturalHeight || src.height || 1 };
  }
  const s = src as { width?: number; height?: number };
  return { w: s.width || 1, h: s.height || 1 };
}

/** 可见区域（crop 后）的宽高比；图像未就绪时退回 naturalSize，再退回 4:3 兜底 */
function visibleAspect(cell: FigureCell, img?: CanvasImageSource): number {
  const { l, b, r, t } = cell.crop;
  const vw = Math.max(0.01, 1 - l - r);
  const vh = Math.max(0.01, 1 - t - b);
  const base = img ? sourceSize(img) : (cell.naturalSize ?? { w: 4, h: 3 });
  return (vw * base.w) / (vh * base.h);
}

interface Placed {
  gi: number;
  x: number;
  y: number; // 单元块（图片 + 子标题）顶偏移，对齐在此块上做
  w: number;
  h: number; // 图片高
  uh: number; // 单元块总高（图片 + 子标题）
  cap: { lead: string; lines: string[]; totalH: number };
}

interface CaptionLayout {
  lead: string;
  lines: string[];
  totalH: number;
}

/**
 * 合成整张拼图（同步、纯计算 + drawImage）。
 * 子标题（(a) + 文本）烘焙进 canvas——预览与导出 PNG 共用本函数，所见即产物
 * （与 subfigure 模式在图下渲染 (a)(b)… 的语义一致）。
 * @param images 索引 → 已预取的图像（缺失的格子留白，不阻断合成）
 * @returns 白底 canvas（宽 = targetWidthPx）
 */
export function composeFigure(
  layout: FigureLayout,
  images: Map<number, CanvasImageSource>,
  targetWidthPx: number = DEFAULT_COMPOSE_WIDTH,
): HTMLCanvasElement {
  const W = Math.max(200, Math.round(targetWidthPx));
  const { cells, cols, gapRow } = layout;
  const totalRows = Math.max(layout.rows, Math.ceil(cells.length / cols));

  // 子标题排版：字号随总宽等比例（≈ LaTeX \subcaption 占 \textwidth 2.4%），含兜底
  const CAP_FONT_RATIO = 0.024;
  const capFontPx = Math.max(11, Math.round(W * CAP_FONT_RATIO));
  const CAP_LINE_H = Math.round(capFontPx * 1.25);
  const CAP_TOP_GAP = Math.round(capFontPx * 0.4); // 图片底 → 子标题首行
  const CAP_STACK = `"Times New Roman","Songti SC","SimSun","Noto Serif CJK SC",serif`;
  const capNormalFont = `${capFontPx}px ${CAP_STACK}`;
  const capBoldFont = `bold ${capNormalFont}`;

  // 量测上下文：建正式画布前先算子标题所需高度（逐字符排版以兼容中文无空格换行）
  const meas = document.createElement("canvas");
  const mctx = meas.getContext("2d");

  function captionFor(gi: number, subW: number): CaptionLayout {
    const cell = cells[gi]!;
    const letter = `(${subFigureLetter(gi)})`;
    const text = (cell.subCaption ?? "").trim();
    if (text.length === 0 || !mctx) {
      return { lead: letter, lines: [letter], totalH: CAP_LINE_H + CAP_TOP_GAP };
    }
    mctx.font = capNormalFont;
    const chars: string[] = [];
    for (const ch of letter) chars.push(ch);
    chars.push(" ");
    for (const ch of text) chars.push(ch);
    const lines: string[] = [];
    let cur = "";
    for (const ch of chars) {
      const test = cur + ch;
      if (mctx.measureText(test).width > subW && cur.length > 0) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur.length > 0) lines.push(cur);
    return { lead: letter, lines, totalH: lines.length * CAP_LINE_H + CAP_TOP_GAP };
  }

  // 第一遍：逐行排布（宽度按 §4.2 预算 → \hfill 均分剩余 → 实际间距）
  const rows: { placed: Placed[]; height: number }[] = [];
  for (let r = 0; r < totalRows; r++) {
    const rl = computeRowLayout(layout, r);
    const k = rl.indices.length;
    if (k === 0) continue;

    const widthsPx = rl.widths.map((f) => f * W);
    const sumW = widthsPx.reduce((s, w) => s + w, 0);
    // §4.4 的 \hfill 语义：行内剩余空间均分到子图之间（k=1 时无间距、左对齐）
    const gapPx = k > 1 ? Math.max(0, (W - sumW) / (k - 1)) : 0;

    const placed: Placed[] = [];
    let x = 0;
    for (let i = 0; i < k; i++) {
      const gi = rl.indices[i]!;
      const cell = cells[gi]!;
      const w = widthsPx[i]!;
      // 等比：按列宽 × 可见区域宽高比反算高度（与 \includegraphics[width=...] 一致）
      const h = w / Math.max(0.0001, visibleAspect(cell, images.get(gi)));
      const cap = captionFor(gi, w);
      const uh = h + cap.totalH; // 单元块（图片 + 子标题）总高
      placed.push({ gi, x, y: 0, w, h, uh, cap });
      x += w + gapPx;
    }

    // 行级对齐：整行共用（同 subfigure 的 [t]/[c]/[b]），对齐的是「图片+子标题」单元块
    const align = rowAlignOf(layout, rl.indices);
    const rowH = Math.max(...placed.map((p) => p.uh));
    for (const p of placed) {
      const extra = rowH - p.uh;
      p.y = align === "t" ? 0 : align === "c" ? extra / 2 : extra;
    }
    rows.push({ placed, height: rowH });
  }

  // 第二遍：总高（行高之和 + 行间距）
  const rowGapPx = gapRow * W;
  const totalH =
    rows.reduce((s, r) => s + r.height, 0) + Math.max(0, rows.length - 1) * rowGapPx;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.max(1, Math.ceil(totalH));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // 论文插图默认白底（PNG 透明底在 PDF 里可能变黑/不可控）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let y = 0;
  for (const row of rows) {
    for (const p of row.placed) {
      const img = images.get(p.gi);
      const cell = cells[p.gi]!;
      if (img) {
        const { w: sw, h: sh } = sourceSize(img);
        const { l, b, r, t } = cell.crop;
        const sx = Math.max(0, l) * sw;
        const sy = Math.max(0, t) * sh;
        const sw2 = Math.max(1, (1 - Math.min(1, l + r)) * sw);
        const sh2 = Math.max(1, (1 - Math.min(1, t + b)) * sh);
        ctx.drawImage(img, sx, sy, sw2, sh2, p.x, y + p.y, p.w, p.h);
      }
      // 子标题（(a) + 文本）居中于子图下方；首行 (a) 粗体，与 subfigure 一致
      const cap = p.cap;
      ctx.fillStyle = "#1a1a1a";
      ctx.textBaseline = "top";
      let lineY = y + p.y + p.h + CAP_TOP_GAP;
      for (let li = 0; li < cap.lines.length; li++) {
        const lineText = cap.lines[li]!;
        if (li === 0 && lineText.startsWith(cap.lead)) {
          const rest = lineText.slice(cap.lead.length);
          ctx.font = capBoldFont;
          const leadW = ctx.measureText(cap.lead).width;
          ctx.font = capNormalFont;
          const restW = ctx.measureText(rest).width;
          const totalW = leadW + restW;
          const startX = p.x + p.w / 2 - totalW / 2;
          ctx.textAlign = "left";
          ctx.font = capBoldFont;
          ctx.fillText(cap.lead, startX, lineY);
          ctx.font = capNormalFont;
          ctx.fillText(rest, startX + leadW, lineY);
        } else {
          ctx.textAlign = "center";
          ctx.font = capNormalFont;
          ctx.fillText(lineText, p.x + p.w / 2, lineY);
        }
        lineY += CAP_LINE_H;
      }
    }
    y += row.height + rowGapPx;
  }

  return canvas;
}
