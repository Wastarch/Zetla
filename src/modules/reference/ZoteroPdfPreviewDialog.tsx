// P3-2 · Zotero 附件 PDF 的内嵌预览浮层（只读）
// 复用项目已有 PdfPreview（path 模式：不接 synctex、不改全局预览 store）。
// 路径由 Rust 只读 /file/view/url 解析得来，asset 协议 scope 为 **。
import { useEffect } from "react";
import { PdfPreview } from "@/preview/PdfPreview";

export interface ZoteroPdfPreviewDialogProps {
  path: string;
  filename: string;
  onClose: () => void;
}

export function ZoteroPdfPreviewDialog({ path, filename, onClose }: ZoteroPdfPreviewDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="zo-pdf-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="zo-pdf-dialog" role="dialog" aria-label={`Zotero PDF 预览 · ${filename}`}>
        <button type="button" className="zo-pdf-close" title="关闭预览（Esc）" onClick={onClose}>
          ×
        </button>
        <PdfPreview path={path} rev={0} />
      </div>
    </div>
  );
}
