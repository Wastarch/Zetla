// pdfjs 统一入口
// 必须用 legacy 构建：现代构建依赖 Map.prototype.getOrInsertComputed，
// WebView2（144.0.3719.115）尚无该 API，会在 page.render 时抛错；
// legacy 内联 core-js polyfill。类型仍取主包（legacy/build/pdf.d.mts 只是 export *）。
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export { getDocument };
export { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
export type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  RenderTask,
} from "pdfjs-dist";
