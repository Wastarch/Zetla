// M0-10 · PDF 文档加载：路径/编译计数变化 → asset 协议取字节 → getDocument
// 用 fetch(no-store) 绕开 WebView 对 asset:// 的缓存，同路径重编译也能拿到新字节。
// 重编译期间保留旧 doc 直到新 doc 就绪，避免预览闪烁与旧 doc 被提前 destroy。
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "./pdfjs";

export interface PdfDocState {
  doc: PDFDocumentProxy | null;
  err: string | null;
  loading: boolean;
  reload: () => void;
}

export function usePdfDoc(pdfPath: string | null, rev: number): PdfDocState {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualRev, setManualRev] = useState(0);
  /** 当前展示中的 doc 对应的 loading task（销毁时要留着它） */
  const activeTask = useRef<PDFDocumentLoadingTask | null>(null);

  const reload = useCallback(() => setManualRev((v) => v + 1), []);

  useEffect(() => {
    if (!pdfPath) {
      void activeTask.current?.destroy();
      activeTask.current = null;
      setDoc(null);
      setErr(null);
      setLoading(false);
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
          void loadingTask.destroy();
          return;
        }

        // 新文档就绪后再销毁旧的
        if (activeTask.current && activeTask.current !== loadingTask) {
          void activeTask.current.destroy();
        }
        activeTask.current = loadingTask;
        setDoc(next);
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
      // 只销毁「尚未成为展示文档」的加载任务；展示中的等新文档接替
      if (task && task !== activeTask.current) void task.destroy();
    };
  }, [pdfPath, rev, manualRev]);

  // 卸载时清理当前文档
  useEffect(
    () => () => {
      void activeTask.current?.destroy();
      activeTask.current = null;
    },
    [],
  );

  return { doc, err, loading, reload };
}
