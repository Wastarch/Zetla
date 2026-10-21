// M0-10 / M0-10b · 右侧 PDF 预览
// 连续滚动 / 翻页、单列 / 双列、Ctrl+滚轮缩放、文本层（复制）、查找、缩略图、目录、链接
// 加载链路：compile_finished(ok) → store.previewPdf/rev → usePdfDoc（asset 协议 + no-store）
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { base as fileBase } from "@/project/useProject";
import { Icon } from "@/ui/Icon";
import { usePdfDoc } from "./usePdfDoc";
import { usePdfFind } from "./pdfFind";
import { openExternal, resolveDestPage, type PageLink } from "./pdfNav";
import { PdfPageView } from "./PdfPageView";
import { PdfFindBar } from "./PdfFindBar";
import { PdfSidebar, type SideTab } from "./PdfSidebar";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const PAGE_GAP = 18;
/** .pdf-scroll 左右 padding 合计 */
const SCROLL_PAD_X = 40;
/** .pdf-scroll 上下 padding 合计（22 + 40） */
const SCROLL_PAD_Y = 62;
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type Zoom = { kind: "fit-width" } | { kind: "fit-page" } | { kind: "custom"; scale: number };
type Layout = "single" | "double";

export function PdfPreview({ style }: { style?: CSSProperties }) {
  const pdfPath = useAppStore((s) => s.previewPdf);
  const rev = useAppStore((s) => s.previewRev);
  const compileStatus = useAppStore((s) => s.compileStatus);
  const togglePreview = useAppStore((s) => s.togglePreview);

  const { doc, err, loading, reload } = usePdfDoc(pdfPath, rev);
  const find = usePdfFind(doc);

  // M0-14a：默认缩放来自偏好设置（仅在打开/重载 PDF 时应用）
  const [zoom, setZoom] = useState<Zoom>(() => {
    const d = useSettingsStore.getState().settings.pdf.defaultZoom;
    return d === "fit-width" ? { kind: "fit-width" } : { kind: "custom", scale: Number(d) / 100 };
  });
  const [layout, setLayout] = useState<Layout>("single");
  const [paged, setPaged] = useState(false);
  const [page, setPage] = useState(1);
  const [side, setSide] = useState<SideTab | "none">("none");
  const [menu, setMenu] = useState<null | "fit" | "view">(null);
  const [zoomInput, setZoomInput] = useState<string>(() => {
    const d = useSettingsStore.getState().settings.pdf.defaultZoom;
    return d === "fit-width" ? "100" : d;
  });
  const [pageInput, setPageInput] = useState("1");
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [viewSize, setViewSize] = useState({ w: 432, h: 640 });
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  const rootRef = useRef<HTMLElement | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const wantScrollRef = useRef(false);
  const hoverRef = useRef(false);
  const scaleRef = useRef(1);
  const anchorRef = useRef<{ rx: number; ry: number; cx: number; cy: number } | null>(null);
  const scrollRafRef = useRef(false);
  const pendingScrollRef = useRef(false);

  const numPages = doc?.numPages ?? 0;

  // 视图菜单：默认与按钮左对齐；面板过窄时只左移最少距离，避免超出面板右缘
  useLayoutEffect(() => {
    if (menu !== "view") return;
    const m = viewMenuRef.current;
    if (!m) return;
    const bound = (rootRef.current?.getBoundingClientRect().right ?? window.innerWidth) - 8;
    m.style.left = "0px";
    const over = m.getBoundingClientRect().right - bound;
    if (over > 0) m.style.left = `${-over}px`;
  }, [menu]);

  // 页面基准尺寸（用首页；同理适用于同尺寸文档）与页码夹取
  useEffect(() => {
    if (!doc) {
      setBaseSize(null);
      setPage(1);
      return;
    }
    let cancelled = false;
    void doc
      .getPage(1)
      .then((p) => {
        if (cancelled) return;
        const vp = p.getViewport({ scale: 1 });
        setBaseSize({ w: vp.width, h: vp.height });
        setPage((n) => Math.min(Math.max(n, 1), doc.numPages));
      })
      .catch(() => {
        /* 页面读取失败时由渲染层兜底 */
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // 可分配视口尺寸
  useEffect(() => {
    if (!scrollEl) return;
    const update = () => setViewSize({ w: scrollEl.clientWidth, h: scrollEl.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  const scale = useMemo(() => {
    if (!baseSize) return 1;
    const cols = layout === "double" ? 2 : 1;
    const availW = Math.max(80, viewSize.w - SCROLL_PAD_X);
    const availH = Math.max(80, viewSize.h - SCROLL_PAD_Y);
    const fitW = (availW - PAGE_GAP * (cols - 1)) / (baseSize.w * cols);
    const fitH = (availH - PAGE_GAP * (cols - 1)) / (baseSize.h * cols);
    const raw =
      zoom.kind === "custom"
        ? zoom.scale
        : zoom.kind === "fit-width"
          ? fitW
          : Math.min(fitW, fitH);
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
  }, [baseSize, zoom, layout, viewSize]);
  scaleRef.current = scale;

  const jumpTo = useCallback(
    (n: number) => {
      if (!doc) return;
      let target = Math.min(Math.max(Math.round(n), 1), doc.numPages);
      if (paged && layout === "double") target = target % 2 === 0 ? target - 1 : target;
      setPage(target);
      if (paged) return;
      const el = scrollEl?.querySelector<HTMLElement>(`[data-page="${target}"]`);
      el?.scrollIntoView({ block: "start" });
    },
    [doc, paged, layout, scrollEl],
  );

  // 连续模式下滚动时同步当前页
  const onScroll = () => {
    if (!scrollEl || paged || scrollRafRef.current) return;
    scrollRafRef.current = true;
    requestAnimationFrame(() => {
      scrollRafRef.current = false;
      if (paged || !scrollEl) return;
      const mid = scrollEl.getBoundingClientRect().top + scrollEl.clientHeight * 0.45;
      let best = 1;
      const list = scrollEl.querySelector(".pdf-pages")?.children;
      if (list && list.length > 0) {
        // 用 offsetTop 二分，避免大文档逐页 getBoundingClientRect
        const y = scrollEl.scrollTop + scrollEl.clientHeight * 0.45;
        let lo = 0;
        let hi = list.length - 1;
        while (lo <= hi) {
          const midIdx = (lo + hi) >> 1;
          const child = list[midIdx] as HTMLElement;
          if (child.offsetTop <= y) {
            best = Number(child.dataset.page) || best;
            lo = midIdx + 1;
          } else {
            hi = midIdx - 1;
          }
        }
      } else {
        scrollEl.querySelectorAll<HTMLElement>("[data-page]").forEach((el) => {
          if (el.getBoundingClientRect().top <= mid) best = Number(el.dataset.page);
        });
      }
      setPage((p) => (p === best ? p : best));
    });
  };

  // Ctrl+滚轮缩放：指针锚定（capture 阶段避免被 React 被动监听吞掉）
  useEffect(() => {
    if (!scrollEl) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = scrollEl.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      anchorRef.current = {
        rx: scrollEl.scrollWidth > 0 ? (scrollEl.scrollLeft + cx) / scrollEl.scrollWidth : 0,
        ry: scrollEl.scrollHeight > 0 ? (scrollEl.scrollTop + cy) / scrollEl.scrollHeight : 0,
        cx,
        cy,
      };
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, scaleRef.current * Math.exp(-e.deltaY * 0.0015)),
      );
      setZoom({ kind: "custom", scale: Number(next.toFixed(3)) });
    };
    scrollEl.addEventListener("wheel", onWheel, { passive: false });
    return () => scrollEl.removeEventListener("wheel", onWheel);
  }, [scrollEl]);

  // 缩放后恢复指针处的相对位置
  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a || !scrollEl) return;
    anchorRef.current = null;
    scrollEl.scrollLeft = a.rx * scrollEl.scrollWidth - a.cx;
    scrollEl.scrollTop = a.ry * scrollEl.scrollHeight - a.cy;
  }, [scale, scrollEl]);

  // Ctrl+F：指针在预览内（或焦点在预览内）时打开 PDF 查找
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f") return;
      if (e.defaultPrevented) return;
      if (!hoverRef.current && !rootRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      find.setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [find.setOpen]);

  // 查找导航：切到命中页（连续模式滚动过去 → 懒渲染 → 再定位具体命中）
  useEffect(() => {
    if (!find.open || !wantScrollRef.current) return;
    const m = find.matches[find.current];
    if (m && m.page !== page) jumpTo(m.page);
  }, [find.current, find.matches, find.open, page, jumpTo]);

  useEffect(() => {
    if (!wantScrollRef.current) return;
    const el = scrollEl?.querySelector<HTMLElement>(".pv-hit.cur");
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    wantScrollRef.current = false;
  }, [find.current, renderTick, scrollEl]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  // 从翻页切回连续滚动时，滚到当前页（否则画面回到第一页而页码还停在原处）
  useEffect(() => {
    if (!pendingScrollRef.current || paged || !doc) return;
    pendingScrollRef.current = false;
    requestAnimationFrame(() => jumpTo(page));
  }, [paged, doc, page, jumpTo]);

  // 双页翻页时对齐到跨页起始页（奇数）
  useEffect(() => {
    if (paged && layout === "double" && page > 1 && page % 2 === 0) setPage(page - 1);
  }, [paged, layout, page]);

  // 菜单点外部关闭
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest(".pv-menu, .pv-menu-btn")) setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const onTextRendered = useCallback(() => setRenderTick((t) => t + 1), []);

  const currentMatch = find.matches[find.current] ?? null;

  const pages = useMemo(() => {
    if (!doc) return [];
    if (!paged) return Array.from({ length: doc.numPages }, (_, i) => i + 1);
    const start = layout === "double" ? (page % 2 === 0 ? page - 1 : page) : page;
    const out = [start];
    if (layout === "double" && start + 1 <= doc.numPages) out.push(start + 1);
    return out;
  }, [doc, paged, layout, page]);

  function zoomBy(dir: 1 | -1) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((scale + dir * 0.1).toFixed(2))));
    setZoom({ kind: "custom", scale: next });
  }

  function openZoomMenu() {
    setZoomInput(String(Math.round(scale * 100)));
    setMenu((m) => (m === "fit" ? null : "fit"));
  }

  function commitPageInput() {
    const n = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(n)) {
      setPageInput(String(page));
      return;
    }
    jumpTo(n);
  }

  function setView(nextPaged: boolean, nextLayout: Layout) {
    if (paged && !nextPaged) pendingScrollRef.current = true;
    setPaged(nextPaged);
    setLayout(nextLayout);
    setMenu(null);
  }

  function gotoMatch(delta: number) {
    if (find.matches.length === 0) return;
    wantScrollRef.current = true;
    find.setCurrent((c) => (c + delta + find.matches.length) % find.matches.length);
  }

  const handleLink = useCallback(
    (link: PageLink) => {
      if (link.url) {
        void openExternal(link.url);
        return;
      }
      if (link.dest != null && doc) {
        void resolveDestPage(doc, link.dest).then((p) => {
          if (p) jumpTo(p);
        });
      }
    },
    [doc, jumpTo],
  );

  const step = paged && layout === "double" ? 2 : 1;
  const title = pdfPath ? `PDF 预览 · ${fileBase(pdfPath)}` : "PDF 预览";
  const stale = compileStatus === "error" && !!doc;

  return (
    <aside
      className="preview"
      style={style}
      ref={rootRef}
      aria-label="PDF 预览"
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
    >
      <div className="pv-head">
        <Icon name="pdf" style={{ color: "var(--txt-3)" }} />
        <h2 title={pdfPath ?? undefined}>{title}</h2>
        {stale && (
          <span className="pv-stale" title="本次编译失败，显示的是上一次成功的结果">
            未更新
          </span>
        )}
        <button
          type="button"
          className={side === "thumbs" ? "ibtn on" : "ibtn"}
          title="缩略图"
          disabled={!doc}
          onClick={() => setSide((s) => (s === "thumbs" ? "none" : "thumbs"))}
        >
          <Icon name="image" />
        </button>
        <button
          type="button"
          className={side === "outline" ? "ibtn on" : "ibtn"}
          title="目录"
          disabled={!doc}
          onClick={() => setSide((s) => (s === "outline" ? "none" : "outline"))}
        >
          <Icon name="book" />
        </button>
        <button type="button" className="ibtn" title="收起预览面板" onClick={togglePreview}>
          <Icon name="panel-right" />
        </button>
      </div>

      <div className="pv-tools">
        <button
          type="button"
          className="ibtn"
          title="上一页"
          disabled={!doc || page <= 1}
          onClick={() => jumpTo(page - step)}
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
                setPageInput(String(page));
                e.currentTarget.blur();
              }
            }}
          />
          / <span>{numPages || "—"}</span>
        </div>
        <button
          type="button"
          className="ibtn"
          title="下一页"
          disabled={!doc || page >= numPages}
          onClick={() => jumpTo(page + step)}
        >
          <Icon name="chev" />
        </button>

        <div className="sep" />
        <button type="button" className="ibtn" title="缩小" disabled={!doc} onClick={() => zoomBy(-1)}>
          <Icon name="zoom-out" />
        </button>
        <div className="pv-menu-wrap">
          <button
            type="button"
            className="zoom-val pv-menu-btn"
            title="缩放（Ctrl+滚轮）"
            disabled={!doc}
            onClick={openZoomMenu}
          >
            {Math.round(scale * 100)}%
          </button>
          {menu === "fit" && (
            <div className="pv-menu">
              <button
                type="button"
                className="mi"
                onClick={() => {
                  setZoom({ kind: "fit-width" });
                  setMenu(null);
                }}
              >
                适合宽度
              </button>
              <button
                type="button"
                className="mi"
                onClick={() => {
                  setZoom({ kind: "fit-page" });
                  setMenu(null);
                }}
              >
                适合页面
              </button>
              <div className="pv-menu-sep" />
              {ZOOM_PRESETS.map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`mi${zoom.kind === "custom" && Math.abs(zoom.scale - z) < 0.005 ? " on" : ""}`}
                  onClick={() => {
                    setZoom({ kind: "custom", scale: z });
                    setMenu(null);
                  }}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
              <div className="pv-menu-sep" />
              <form
                className="pv-zoom-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(zoomInput);
                  if (!Number.isFinite(n)) return;
                  const s = Math.min(400, Math.max(25, n)) / 100;
                  setZoom({ kind: "custom", scale: s });
                  setMenu(null);
                }}
              >
                <input
                  value={zoomInput}
                  inputMode="numeric"
                  aria-label="自定义缩放百分比"
                  onChange={(e) => setZoomInput(e.target.value)}
                />
                <span>%</span>
                <button type="submit" className="ibtn" title="应用自定义缩放">
                  <Icon name="check" size={13} />
                </button>
              </form>
            </div>
          )}
        </div>
        <button type="button" className="ibtn" title="放大" disabled={!doc} onClick={() => zoomBy(1)}>
          <Icon name="zoom-in" />
        </button>

        <div className="sep" />
        <div className="pv-menu-wrap">
          <button
            type="button"
            className={`ibtn pv-menu-btn${menu === "view" ? " on" : ""}`}
            title="视图"
            disabled={!doc}
            onClick={() => setMenu((m) => (m === "view" ? null : "view"))}
          >
            <Icon name="layout" />
          </button>
          {menu === "view" && (
            <div className="pv-menu" ref={viewMenuRef}>
              {(
                [
                  ["连续滚动 · 单列", false, "single"],
                  ["连续滚动 · 双列", false, "double"],
                  ["翻页 · 单页", true, "single"],
                  ["翻页 · 双页", true, "double"],
                ] as const
              ).map(([label, p, l]) => (
                <button
                  key={label}
                  type="button"
                  className={`mi${paged === p && layout === l ? " on" : ""}`}
                  onClick={() => setView(p, l)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`ibtn${find.open ? " on" : ""}`}
          title="查找（Ctrl+F）"
          disabled={!doc}
          onClick={() => find.setOpen((o) => !o)}
        >
          <Icon name="search" />
        </button>
      </div>

      {find.open && (
        <PdfFindBar
          query={find.query}
          onQuery={find.setQuery}
          current={find.matches.length > 0 ? find.current + 1 : 0}
          total={find.matches.length}
          scanning={find.scanning}
          onNext={() => gotoMatch(1)}
          onPrev={() => gotoMatch(-1)}
          onClose={() => find.setOpen(false)}
        />
      )}

      <div className="pv-body">
        {side !== "none" && doc && (
          <PdfSidebar
            doc={doc}
            tab={side}
            onTab={setSide}
            page={page}
            onJump={(p) => jumpTo(p)}
          />
        )}

        <div className="pdf-scroll" ref={setScrollEl} onScroll={onScroll}>
          {!pdfPath ? (
            <div className="pdf-empty">
              <Icon name="pdf" size={30} />
              <p>尚无 PDF</p>
              <p className="hint">编译成功后自动加载，或 文件 → 打开 PDF…</p>
            </div>
          ) : err ? (
            <div className="pdf-empty">
              <Icon name="alert" size={26} style={{ color: "var(--err)" }} />
              <p>PDF 加载失败</p>
              <p className="hint">{err}</p>
              <button type="button" className="btn" onClick={reload}>
                重试
              </button>
            </div>
          ) : !doc || !baseSize ? (
            <div className="pdf-empty">
              <p>加载中…</p>
            </div>
          ) : (
            <div className={`pdf-pages ${layout}${paged ? " paged" : ""}`}>
              {pages.map((n) => (
                <PdfPageView
                  key={n}
                  doc={doc}
                  pageNo={n}
                  scale={scale}
                  baseW={baseSize.w}
                  baseH={baseSize.h}
                  scrollRoot={scrollEl}
                  findQuery={find.open ? find.query : ""}
                  findCurOcc={currentMatch && currentMatch.page === n ? currentMatch.occ : null}
                  onLink={handleLink}
                  onTextRendered={onTextRendered}
                />
              ))}
            </div>
          )}
          {loading && doc && <div className="pdf-loading">更新中…</div>}
        </div>
      </div>
    </aside>
  );
}

export default PdfPreview;
