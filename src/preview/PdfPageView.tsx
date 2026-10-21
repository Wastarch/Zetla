// M0-10b · 单页渲染：canvas + 文本层（可选中复制）+ 链接热区
// 仅当页面进入滚动视口 ±400px 才真正渲染；缩放/换页自动重绘并取消旧任务。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "./pdfjs";
import type { PageLink } from "./pdfNav";
import { applyFindMarks } from "./pdfFind";

interface RawLink {
  subtype?: string;
  rect?: number[];
  url?: string | null;
  dest?: unknown;
}

export interface PdfPageViewProps {
  doc: PDFDocumentProxy;
  pageNo: number;
  scale: number;
  /** 页面基准尺寸（PDF pt，scale=1），用于首帧占位与同步布局 */
  baseW: number;
  baseH: number;
  scrollRoot: HTMLElement | null;
  findQuery: string;
  findCurOcc: number | null;
  onLink: (link: PageLink) => void;
  onTextRendered: (page: number) => void;
}

interface LinkBox {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  link: PageLink;
}

export function PdfPageView({
  doc,
  pageNo,
  scale,
  baseW,
  baseH,
  scrollRoot,
  findQuery,
  findCurOcc,
  onLink,
  onTextRendered,
}: PdfPageViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const divsRef = useRef<HTMLElement[]>([]);
  const renderRef = useRef<RenderTask | null>(null);

  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [textTick, setTextTick] = useState(0);
  const [links, setLinks] = useState<LinkBox[]>([]);

  // 懒渲染：进入视口附近才开始画
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let layer: TextLayer | null = null;

    void (async () => {
      try {
        const page = await doc.getPage(pageNo);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        // 存未缩放尺寸：缩放变化时宿主宽高随 scale 同步更新（滚轮锚定依赖这一点）
        const raw = page.getViewport({ scale: 1 });
        setSize({ w: raw.width, h: raw.height });
        setLinks([]);

        // canvas（DPR≤2，位图放大、CSS 尺寸保持逻辑像素）
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          renderRef.current?.cancel();
          const task = page.render({
            canvas: null,
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          });
          renderRef.current = task;
          await task.promise;
          if (renderRef.current === task) renderRef.current = null;
        }
        if (cancelled) return;

        // 文本层：透明覆盖，提供选中/复制与查找定位
        const host = textRef.current;
        if (host) {
          host.replaceChildren();
          layer = new TextLayer({
            textContentSource: page.streamTextContent(),
            container: host,
            viewport,
          });
          await layer.render();
          if (cancelled) return;
          divsRef.current = layer.textDivs.slice();
          setTextTick((t) => t + 1);
          onTextRendered(pageNo);
        }

        // 链接热区
        const anns = (await page.getAnnotations({ intent: "display" })) as RawLink[];
        if (cancelled) return;
        const boxes: LinkBox[] = [];
        anns.forEach((a, i) => {
          if (a.subtype !== "Link" || !Array.isArray(a.rect) || a.rect.length < 4) return;
          const url = typeof a.url === "string" ? a.url : null;
          if (!url && a.dest == null) return;
          const p0 = viewport.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
          const p1 = viewport.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
          const left = Math.min(p0[0], p1[0]);
          const top = Math.min(p0[1], p1[1]);
          const width = Math.abs(p1[0] - p0[0]);
          const height = Math.abs(p1[1] - p0[1]);
          if (width < 1 || height < 1) return;
          boxes.push({ key: `${pageNo}-${i}`, left, top, width, height, link: { url, dest: a.dest } });
        });
        setLinks(boxes);
      } catch (e) {
        if (cancelled) return;
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        console.warn("[pdf render]", pageNo, e);
      }
    })();

    return () => {
      cancelled = true;
      if (renderRef.current) {
        renderRef.current.cancel();
        renderRef.current = null;
      }
      layer?.cancel();
    };
  }, [doc, pageNo, scale, visible, onTextRendered]);

  // 查找高亮：查询或当前项变化时重画
  useEffect(() => {
    const host = textRef.current;
    if (!host) return;
    applyFindMarks(host, divsRef.current, findQuery, findCurOcc);
  }, [findQuery, findCurOcc, textTick]);

  const w = (size?.w ?? baseW) * scale;
  const h = (size?.h ?? baseH) * scale;
  const hostStyle = {
    width: w,
    height: h,
    "--total-scale-factor": scale,
  } as CSSProperties;

  return (
    <div
      ref={hostRef}
      className="pdf-page"
      data-page={pageNo}
      style={hostStyle}
      aria-label={`第 ${pageNo} 页`}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textRef} className="textLayer" />
      {links.map((b) => (
        <button
          key={b.key}
          type="button"
          className="pv-link"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          title={b.link.url ?? "跳转到目标页"}
          onClick={() => onLink(b.link)}
        />
      ))}
    </div>
  );
}

export default PdfPageView;
