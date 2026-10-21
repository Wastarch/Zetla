// M0-10b · 预览侧栏：缩略图 / 目录（大纲）
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { openExternal, resolveDestPage } from "./pdfNav";
import type { PDFDocumentProxy } from "./pdfjs";

export type SideTab = "thumbs" | "outline";

export interface PdfSidebarProps {
  doc: PDFDocumentProxy;
  tab: SideTab;
  onTab: (t: SideTab) => void;
  page: number;
  onJump: (page: number) => void;
}

export function PdfSidebar({ doc, tab, onTab, page, onJump }: PdfSidebarProps) {
  return (
    <aside className="pv-side" aria-label="PDF 导航">
      <div className="pv-side-tabs">
        <button
          type="button"
          className={tab === "thumbs" ? "on" : ""}
          onClick={() => onTab("thumbs")}
        >
          <Icon name="image" size={12} />
          缩略图
        </button>
        <button
          type="button"
          className={tab === "outline" ? "on" : ""}
          onClick={() => onTab("outline")}
        >
          <Icon name="book" size={12} />
          目录
        </button>
      </div>
      <div className="pv-side-body">
        {tab === "thumbs" ? (
          <Thumbs doc={doc} page={page} onJump={onJump} />
        ) : (
          <Outline doc={doc} onJump={onJump} />
        )}
      </div>
    </aside>
  );
}

/* ── 缩略图 ─────────────────────────────────────────── */

const THUMB_W = 104;
let active = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < 2) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active = Math.max(0, active - 1);
  waiting.shift()?.();
}

function Thumbs({
  doc,
  page,
  onJump,
}: {
  doc: PDFDocumentProxy;
  page: number;
  onJump: (p: number) => void;
}) {
  const list = Array.from({ length: doc.numPages }, (_, i) => i + 1);
  return (
    <div className="pv-thumbs">
      {list.map((n) => (
        <Thumb
          key={n}
          doc={doc}
          pageNo={n}
          active={n === page}
          onJump={onJump}
        />
      ))}
    </div>
  );
}

function Thumb({
  doc,
  pageNo,
  active,
  onJump,
}: {
  doc: PDFDocumentProxy;
  pageNo: number;
  active: boolean;
  onJump: (p: number) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (active) btnRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const el = btnRef.current;
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
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || done) return;
    let cancelled = false;

    void (async () => {
      await acquire();
      try {
        const page = await doc.getPage(pageNo);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_W / base.width });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || cancelled) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        await page.render({
          canvas: null,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise;
        if (!cancelled) setDone(true);
      } catch (e) {
        if (!cancelled) console.warn("[pdf thumb]", pageNo, e);
      } finally {
        release();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, pageNo, visible, done]);

  return (
    <button
      ref={btnRef}
      type="button"
      className={active ? "pv-thumb on" : "pv-thumb"}
      title={`第 ${pageNo} 页`}
      onClick={() => onJump(pageNo)}
    >
      <canvas ref={canvasRef} />
      <span className="num">{pageNo}</span>
    </button>
  );
}

/* ── 目录（大纲） ───────────────────────────────────── */

interface OutlineNode {
  title: string;
  dest?: unknown;
  url?: string | null;
  items?: OutlineNode[];
}

function Outline({
  doc,
  onJump,
}: {
  doc: PDFDocumentProxy;
  onJump: (p: number) => void;
}) {
  const [items, setItems] = useState<OutlineNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void doc
      .getOutline()
      .then((o) => {
        if (!cancelled) setItems((o as OutlineNode[] | null) ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  async function go(node: OutlineNode) {
    if (node.url) {
      await openExternal(node.url);
      return;
    }
    const p = await resolveDestPage(doc, node.dest);
    if (p) onJump(p);
  }

  function renderNodes(nodes: OutlineNode[], depth: number): ReactNode {
    return nodes.map((n, i) => (
      <div key={`${depth}-${i}-${n.title}`}>
        <button
          type="button"
          className="pv-outline-item"
          style={{ paddingLeft: 6 + depth * 10 }}
          title={n.title}
          onClick={() => void go(n)}
        >
          {n.title}
        </button>
        {n.items && n.items.length > 0 ? renderNodes(n.items, depth + 1) : null}
      </div>
    ));
  }

  if (items === null) return <div className="pv-side-empty">加载中…</div>;
  if (items.length === 0) return <div className="pv-side-empty">此 PDF 无目录</div>;
  return <div className="pv-outline">{renderNodes(items, 0)}</div>;
}

export default PdfSidebar;
