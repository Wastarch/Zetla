// 拼图近似预览 · PDF 单元格渲染（首页 → canvas）
// 复用预览模块的 pdfjs 入口（legacy 构建，WebView2 兼容）。
// 取字节口径与 usePdfDoc 一致：path 级 fetch(convertFileSrc) 绕缓存；file 级直接 arrayBuffer。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getDocument, type PDFDocumentLoadingTask } from "@/preview/pdfjs";
import { useFigureStore } from "./figureStore";
import type { FigureCell } from "@/types/figure";

interface Props {
  cell: FigureCell;
  /** 单元格索引：用于回填 naturalSize（页面 pt 尺寸），供预览宽高比与 LaTeX trim 换算 */
  index: number;
  /** 裁剪时的放大/偏移样式（与 <img> 裁剪分支同口径） */
  canvasStyle?: CSSProperties;
}

/** 读取 PDF 字节：path → asset 协议 fetch；file → 内存 File */
async function readBytes(source: FigureCell["source"], path: string): Promise<Uint8Array> {
  if (source?.kind === "file") return new Uint8Array(await source.file.arrayBuffer());
  const url = source?.kind === "path" ? convertFileSrc(source.abs) : path;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export default function PdfThumb({ cell, index, canvasStyle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const setNaturalSize = useFigureStore((s) => s.setNaturalSize);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    const source = cell.source;
    const path = cell.path;

    void (async () => {
      setState("loading");
      try {
        const data = await readBytes(source, path);
        if (cancelled) return;
        task = getDocument({ data });
        const doc = await task.promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        if (cancelled) return;

        // 页面 view（pt=bp）→ naturalSize：与 raster 图「像素≈bp」口径一致，供 trim 换算
        const vb = page.view; // [x0, y0, x1, y1]
        const wPt = Math.round(Math.abs(vb[2]! - vb[0]!));
        const hPt = Math.round(Math.abs(vb[3]! - vb[1]!));
        setNaturalSize(index, { w: wPt, h: hPt });

        // 渲染分辨率：按容器 CSS 宽度 × DPR（最多 2x）折算 scale，保证清晰且不过度重绘
        const raw = page.getViewport({ scale: 1 });
        const canvas = canvasRef.current;
        const hostW = canvas?.parentElement?.clientWidth ?? 0;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const baseW = hostW > 0 ? hostW : 360;
        const scale = Math.max(0.3, Math.min(4, (baseW / raw.width) * dpr));
        const viewport = page.getViewport({ scale });

        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const renderTask = page.render({ canvas: null, canvasContext: ctx, viewport });
          await renderTask.promise;
        }
        if (cancelled) return;
        setState("ok");
      } catch (e) {
        if (cancelled) return;
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        console.warn("[figure pdf thumb]", e);
        setState("err");
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  // 依赖只取来源与索引：naturalSize 回填会替换 cell 对象，但不应触发重新加载 PDF
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.source, cell.path, index, setNaturalSize]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fig-approx-pdf-canvas"
        style={{ ...canvasStyle, visibility: state === "ok" ? "visible" : "hidden" }}
      />
      {state !== "ok" && (
        <div className="fig-approx-pdf fig-approx-pdf-status">
          {state === "err" ? "PDF 渲染失败" : "PDF 加载中…"}
        </div>
      )}
    </>
  );
}
