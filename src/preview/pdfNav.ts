// PDF 导航辅助：解析内链/目录目标页、打开外部链接
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PDFDocumentProxy } from "./pdfjs";

/** PDF 链接/目录项的最小信息 */
export interface PageLink {
  url?: string | null;
  dest?: unknown;
}

/**
 * 把 PDF 目标（命名目标字符串或显式目标数组）解析成 1-based 页码。
 * 显式目标首元素：整数页码（0-based）或页面引用 { num, gen }。
 */
export async function resolveDestPage(
  doc: PDFDocumentProxy,
  dest: unknown,
): Promise<number | null> {
  try {
    let target: unknown = dest;
    if (typeof dest === "string") target = await doc.getDestination(dest);
    if (!Array.isArray(target) || target.length === 0) return null;

    const first: unknown = target[0];
    if (typeof first === "number") return first + 1;
    if (first && typeof first === "object" && "num" in first) {
      const index = await doc.getPageIndex(
        first as Parameters<PDFDocumentProxy["getPageIndex"]>[0],
      );
      return index + 1;
    }
    return null;
  } catch {
    return null;
  }
}

export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    console.warn("[openUrl]", e);
  }
}
