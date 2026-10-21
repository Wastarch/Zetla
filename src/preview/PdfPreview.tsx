// M0-10 · 右侧 PDF 预览（pdfjs-dist → canvas 单页）
// 加载链路：compile_finished(ok) → store.previewPdf/previewRev
//   → convertFileSrc → fetch(cache: no-store) → getDocument({data}) → canvas
// 用 fetch 绕开 WebView 对 asset:// 的缓存，重编译必拿到新字节。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
// 必须用 legacy 构建：现代构建依赖 Map.prototype.getOrInsertComputed，
// WebView2（144.0.3719.115）尚无该 API，会在 page.render 时抛错；
// legacy 自带 core-js polyfill。类型仍取主包（pdf.d.mts 只是 export *）。
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useAppStore } from "@/core/store";
import { base } from "@/project/useProject";
import { Icon } from "@/ui/Icon";

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
/** .pdf-scroll 左右 padding（40）+ 可能的滚动条宽度 */
const SCROLL_PAD = 54;

type ZoomMode = { kind: "fit" } | { kind: "custom"; scale: number };

function clampScale(s: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
}

export function PdfPreview({ style }: { style?: CSSProperties }) {
  const pdfPath = useAppStore((s) => s.previewPdf);
  const rev = useAppStore((s) => s.previewRev);
  const compileStatus = useAppStore((s) => s.compileStatus);
  const togglePreview = useAppStore((s) => s.togglePreview);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [zoom, setZoom] = useState<ZoomMode>({ kind: "fit" });
  /** 实际渲染缩放（fit 时由容器宽度算出；仅用于工具栏显示） */
  const [scale, setScale] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 手动刷新计数 */
  const [manualRev, setManualRev] = useState(0);
  /** .preview 宽度（fit 计算用） */
  const [width, setWidth] = useState(432);
  const [pageInput, setPageInput] = useState("1");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  // 跟随面板宽度（右栏拖拽 / 窗口缩放）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 文档加载：路径或成功编译计数变化时重新取字节
  useEffect(() => {
    if (!pdfPath) {
      setDoc(null);
      setErr(null);
      setLoading(false);
      setPageNo(1);
      return;
    }

    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setErr(null);

    void (async () => {
      try {
        const res = await fetch(convertFileSrc(pdfPath), { cache: "no-store" });
        if (!res.ok) throw new Error(`读取 PDF 失败（HTTP ${res.status}）`);
        const data = new Uint8Array(await res.arrayBuffer());
        if (cancelled) return;

        const loadingTask = getDocument({ data });
        task = loadingTask;
        const next = await loadingTask.promise;
        if (cancelled) {
          // 已被新一次加载取代：destroy 会连带释放文档
          void loadingTask.destroy();
          return;
        }
        setDoc(next);
        // 重新编译后保留页码，但按新文档页数夹取
        setPageNo((p) => Math.min(Math.max(p, 1), next.numPages));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setDoc(null);
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [pdfPath, rev, manualRev]);

  // 渲染当前页：文档 / 页码 / 缩放 / 容器宽度变化时重绘
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    void (async () => {
      try {
        const page = await doc.getPage(pageNo);
        if (cancelled) return;

        const s =
          zoom.kind === "fit"
            ? clampScale((width - SCROLL_PAD) / page.getViewport({ scale: 1 }).width)
            : zoom.scale;
        setScale(s);

        const viewport = page.getViewport({ scale: s });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // 高分屏按 DPR 放大位图，CSS 尺寸保持逻辑像素
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTaskRef.current?.cancel();
        const task = page.render({
          canvas: null,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      } catch (e) {
        if (cancelled) return;
        if ((e as { name?: string })?.name === "RenderingCancelledException") return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [doc, pageNo, zoom, width]);

  // 页码输入框跟随实际页码
  useEffect(() => {
    setPageInput(String(pageNo));
  }, [pageNo]);

  const pageCount = doc?.numPages ?? 0;

  function gotoPage(n: number) {
    if (!pageCount) return;
    const target = Math.min(Math.max(n, 1), pageCount);
    setPageNo(target);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function commitPageInput() {
    const n = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(n)) {
      setPageInput(String(pageNo));
      return;
    }
    gotoPage(n);
  }

  function zoomBy(dir: 1 | -1) {
    setZoom({ kind: "custom", scale: clampScale(Number((scale + dir * ZOOM_STEP).toFixed(2))) });
  }

  function refresh() {
    setManualRev((v) => v + 1);
  }

  const title = pdfPath ? `PDF 预览 · ${base(pdfPath)}` : "PDF 预览";
  const stale = compileStatus === "error" && !!doc;

  return (
    <aside className="preview" style={style} ref={rootRef} aria-label="PDF 预览">
      <div className="pv-head">
        <Icon name="pdf" style={{ color: "var(--txt-3)" }} />
        <h2 title={pdfPath ?? undefined}>{title}</h2>
        {stale && (
          <span className="pv-stale" title="本次编译失败，显示的是上一次成功的结果">
            未更新
          </span>
        )}
        <button type="button" className="ibtn" title="收起预览面板" onClick={togglePreview}>
          <Icon name="panel-right" />
        </button>
      </div>

      <div className="pv-tools">
        <button
          type="button"
          className="ibtn"
          title="上一页"
          disabled={pageNo <= 1}
          onClick={() => gotoPage(pageNo - 1)}
        >
          <Icon name="chev" style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="page-jump">
          <input
            value={pageInput}
            disabled={!doc}
            inputMode="numeric"
            aria-label="页码"
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPageInput();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setPageInput(String(pageNo));
                e.currentTarget.blur();
              }
            }}
          />
          / <span>{pageCount || "—"}</span>
        </div>
        <button
          type="button"
          className="ibtn"
          title="下一页"
          disabled={!doc || pageNo >= pageCount}
          onClick={() => gotoPage(pageNo + 1)}
        >
          <Icon name="chev" />
        </button>

        <div className="sep" />
        <button type="button" className="ibtn" title="缩小" disabled={!doc} onClick={() => zoomBy(-1)}>
          <Icon name="zoom-out" />
        </button>
        <span className="zoom-val">{Math.round(scale * 100)}%</span>
        <button type="button" className="ibtn" title="放大" disabled={!doc} onClick={() => zoomBy(1)}>
          <Icon name="zoom-in" />
        </button>
        <button
          type="button"
          className="ibtn"
          title="适合宽度"
          disabled={!doc}
          onClick={() => setZoom({ kind: "fit" })}
        >
          <Icon name="fit" />
        </button>

        <div className="sep" />
        <button type="button" className="ibtn" title="重新加载 PDF" disabled={!pdfPath} onClick={refresh}>
          <Icon name="refresh" />
        </button>
        {/* Synctex 双向同步是 M3；置灰不接假入口；窄面板时不挤占工具条 */}
        {width >= 400 && (
          <div className="sync-chip" aria-disabled="true">
            <button type="button" className="on" disabled title="Synctex 双向同步 M3 接通">
              正向同步
            </button>
            <button type="button" disabled title="Synctex 双向同步 M3 接通">
              反向同步
            </button>
          </div>
        )}
      </div>

      {!pdfPath ? (
        <div className="pdf-empty">
          <Icon name="pdf" size={30} />
          <p>尚无 PDF</p>
          <p className="hint">编译成功后自动加载（Ctrl+B）</p>
        </div>
      ) : err ? (
        <div className="pdf-empty">
          <Icon name="alert" size={26} style={{ color: "var(--err)" }} />
          <p>PDF 加载失败</p>
          <p className="hint">{err}</p>
          <button type="button" className="btn" onClick={refresh}>
            重试
          </button>
        </div>
      ) : (
        <div className="pdf-scroll" ref={scrollRef}>
          {!doc && loading && <div className="pdf-loading">加载中…</div>}
          <div className="pdf-stage">
            <canvas ref={canvasRef} className="pdf-canvas" />
          </div>
        </div>
      )}
    </aside>
  );
}

export default PdfPreview;
