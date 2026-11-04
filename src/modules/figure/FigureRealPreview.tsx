// P3-1 · 合成单张图片模式的 Canvas 实时预览（所见即产物）。
// 布局参数（行列 / 间距 / 裁剪 / 缩放 / 对齐）变化即重绘；图像按来源预取并缓存，
// PDF 走 pdf.js 首页栅格化。合成算法与导出共用 figureCompose.composeFigure（零漂移）。
import { useEffect, useMemo, useRef, useState } from "react";
import { useFigureStore } from "./figureStore";
import { cellImageKey, composeFigure, loadCellImage } from "./figureCompose";
import { renderCaption, type RenderedCaption } from "./captionRender";
import { subFigureLetter } from "@/types/figure";

/** 预览合成分辨率上限/下限（导出用 DEFAULT_COMPOSE_WIDTH，预览按显示宽度自适应） */
const MIN_PREVIEW_PX = 640;
const MAX_PREVIEW_PX = 2200;

export default function FigureRealPreview() {
  const layout = useFigureStore((s) => s.layout);
  const cells = layout.cells;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [images, setImages] = useState<Map<number, CanvasImageSource>>(new Map());
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [hostWidth, setHostWidth] = useState(0);
  // 子标题渲染结果（公式 → 图片）：异步就绪后触发重绘
  const [captions, setCaptions] = useState<Map<number, RenderedCaption>>(new Map());

  // 预取键：只有「来源集合」变化才重新加载（裁剪/缩放/间距改动直接复用已解码位图）
  const sourceKey = useMemo(() => cells.map(cellImageKey).join("|"), [cells]);
  // 子标题内容键：子标题文本变化才重渲染公式（缩放/间距等几何改动不重渲染公式）
  const captionKey = useMemo(() => cells.map((c) => c.subCaption).join("\u0001"), [cells]);

  useEffect(() => {
    let cancelled = false;
    const next = new Map<number, CanvasImageSource>();
    let left = cells.length;
    setPending(left);
    setFailed(0);
    setImages(new Map());
    if (left === 0) return;

    cells.forEach((cell, i) => {
      void loadCellImage(cell)
        .then((img) => {
          if (cancelled) return;
          next.set(i, img);
          setImages(new Map(next)); // 逐张到位即重绘，不必等全部
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          console.warn("[figure compose] 图片加载失败", e);
          setFailed((n) => n + 1);
        })
        .finally(() => {
          if (cancelled) return;
          left -= 1;
          setPending(left);
        });
    });

    return () => {
      cancelled = true;
    };
    // 仅随来源集合变化重跑（cells 数组身份在裁剪等编辑时也会变，用 key 收敛）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // 子标题渲染（公式 → 自包含 SVG 图片），随子标题文本变化重跑；就绪后存入 state 触发重绘
  useEffect(() => {
    let cancelled = false;
    if (cells.length === 0) {
      setCaptions(new Map());
      return;
    }
    Promise.all(
      cells.map((cell, i) =>
        renderCaption(`(${subFigureLetter(i)})`, cell.subCaption ?? "", "#1a1a1a"),
      ),
    ).then((list) => {
      if (cancelled) return;
      const next = new Map<number, RenderedCaption>();
      list.forEach((rc, i) => next.set(i, rc));
      setCaptions(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captionKey, sourceKey]);

  // 宿主宽度：合成分辨率按显示宽度 × DPR 折算（尺子变化时重合成）
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    setHostWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setHostWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 几何签名：只有影响像素的字段变化才重合成（改标题/选中态不重绘）
  const geometryKey = useMemo(
    () =>
      [
        layout.rows,
        layout.cols,
        layout.gapCol,
        layout.gapRow,
        cells
          .map(
            (c) =>
              `${cellImageKey(c)}@${c.scale}|${c.crop.l},${c.crop.b},${c.crop.r},${c.crop.t}|${c.align}|${c.subCaption}`,
          )
          .join("~"),
      ].join("/"),
    [layout.rows, layout.cols, layout.gapCol, layout.gapRow, cells],
  );

  const composed = useMemo(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = Math.round(
      Math.min(MAX_PREVIEW_PX, Math.max(MIN_PREVIEW_PX, (hostWidth || 720) * dpr)),
    );
    return composeFigure(layout, images, target, captions);
    // layout 仅读几何字段（已由 geometryKey 覆盖），避免标题逐字触发重合成
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey, images, hostWidth, captions]);

  // 把合成结果贴到可见 canvas（尺寸即合成尺寸，CSS 再按版心缩放）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = composed.width;
    canvas.height = composed.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(composed, 0, 0);
  }, [composed]);

  const loading = pending > 0;

  return (
    <div className="fig-real">
      <div className="fig-real-paper" ref={hostRef}>
        <canvas ref={canvasRef} className="fig-real-canvas" />
        {loading && <div className="fig-real-overlay">合成中…（剩余 {pending} 张）</div>}
        {!loading && failed > 0 && (
          <div className="fig-real-overlay is-warn">有 {failed} 张图片加载失败，已留白</div>
        )}
      </div>
      <div className="fig-real-note">
        合成预览（Canvas）：<b>所见即产物</b>——与导出 PNG 共用同一合成函数，零漂移。
        白底、按列宽等比缩放、行内剩余空间按 \hfill 均分（与 LaTeX 一致）；
        子标题（(a) + 文本 + 公式）烘焙进图，居中于子图下方、首行编号粗体，与 subfigure 模式图下标注一致；
        公式经 MathJax 渲染为自包含 SVG 后画入（不污染画布，导出 PNG 同样带公式）；
        外层总图题仍由 LaTeX \caption 生成（见左侧「图片标题」）。PDF 仅取首页。
      </div>
    </div>
  );
}
