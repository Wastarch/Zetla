// M0-10b · PDF 文本查找
// 索引：逐页 getTextContent，按文本块（item.str）做大小写不敏感匹配；
// 高亮：渲染后直接拆分文本节点并包 <mark class="pv-hit">，不依赖 CSS Highlight API。
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PDFDocumentProxy } from "./pdfjs";

export interface FindMatch {
  page: number;
  /** 该页内第几处（0-based），与 textDiv 内匹配顺序一致 */
  occ: number;
}

const MAX_MATCHES = 5000;

export interface PdfFindState {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  query: string;
  setQuery: (q: string) => void;
  matches: FindMatch[];
  current: number;
  setCurrent: Dispatch<SetStateAction<number>>;
  scanning: boolean;
}

export function usePdfFind(doc: PDFDocumentProxy | null): PdfFindState {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [current, setCurrent] = useState(0);
  const [scanning, setScanning] = useState(false);
  const cache = useRef(new Map<number, string[]>());

  // 换文档清缓存与结果
  useEffect(() => {
    cache.current.clear();
    setMatches([]);
    setCurrent(0);
  }, [doc]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!doc || !q) {
      setMatches([]);
      setCurrent(0);
      setScanning(false);
      return;
    }

    let cancelled = false;
    setScanning(true);

    void (async () => {
      const out: FindMatch[] = [];
      try {
        for (let p = 1; p <= doc.numPages; p++) {
          if (cancelled) return;
          let strs = cache.current.get(p);
          if (!strs) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            strs = tc.items.map((it) => (it as { str?: string }).str ?? "");
            cache.current.set(p, strs);
          }
          let occ = 0;
          for (const s of strs) {
            if (!s) continue;
            const low = s.toLowerCase();
            let from = 0;
            while (out.length < MAX_MATCHES) {
              const at = low.indexOf(q, from);
              if (at < 0) break;
              out.push({ page: p, occ: occ++ });
              from = at + q.length;
            }
            if (out.length >= MAX_MATCHES) break;
          }
          if (out.length >= MAX_MATCHES) break;
        }
      } catch (e) {
        // 文档销毁/切换时 getPage 会拒绝，静默丢弃这一轮结果
        if (cancelled) return;
        console.warn("[pdf find]", e);
      } finally {
        if (!cancelled) {
          setMatches(out);
          setCurrent(0);
          setScanning(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, query]);

  return {
    open,
    setOpen,
    query,
    setQuery: (q: string) => setQuery(q),
    matches,
    current,
    setCurrent,
    scanning,
  };
}

/** 清掉一页里的查找高亮，并把拆开的文本节点合并回去 */
export function clearFindMarks(root: HTMLElement): void {
  root.querySelectorAll("mark.pv-hit").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    if (parent instanceof Element) parent.normalize();
  });
}

/**
 * 在已渲染的文本层上标出命中：逐 textDiv 拆文本节点包 <mark>。
 * curOcc 为当前命中在「本页」内的序号，命中的 mark 追加 .cur。
 */
export function applyFindMarks(
  root: HTMLElement,
  divs: HTMLElement[],
  query: string,
  curOcc: number | null,
): void {
  clearFindMarks(root);
  const q = query.trim().toLowerCase();
  if (!q || divs.length === 0) return;

  let occ = 0;
  for (const div of divs) {
    const node = div.firstChild;
    // 文本层每个 div 通常只有一个文本节点；跨节点的短语基础版不处理
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const textNode = node as Text;
    const text = textNode.data;
    const low = text.toLowerCase();

    const hits: number[] = [];
    let from = 0;
    while (true) {
      const at = low.indexOf(q, from);
      if (at < 0) break;
      hits.push(at);
      from = at + q.length;
    }
    if (hits.length === 0) continue;

    // 从后往前拆，避免前面的偏移失效
    for (let i = hits.length - 1; i >= 0; i--) {
      const at = hits[i];
      const markNo = occ + i;
      textNode.splitText(at + q.length);
      const mid = textNode.splitText(at);
      const mark = document.createElement("mark");
      mark.className = markNo === curOcc ? "pv-hit cur" : "pv-hit";
      mark.dataset.occ = String(markNo);
      mid.parentNode?.insertBefore(mark, mid);
      mark.appendChild(mid);
    }
    occ += hits.length;
  }
}
