// P2 后续 · 拼图预览 URL 解析（按 FigureCell.source 取预览地址，与落盘解耦）。
// - path 来源：用 convertFileSrc 直接映射原始磁盘路径（零拷贝）；
// - file 来源：用对象 URL（内存预览，生成时才读字节落盘）；
// - PDF 不能用 <img> 渲染：isPdfSource 供上层改用 PdfThumb（pdf.js 首页 → canvas）。
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FigureCell, FigureCellSource } from "@/types/figure";

/** File 对象 → 对象 URL 缓存（WeakMap 自动随 File 回收，无需手动 revoke） */
const fileUrlCache = new WeakMap<File, string>();
function fileUrl(file: File): string {
  let u = fileUrlCache.get(file);
  if (!u) {
    u = URL.createObjectURL(file);
    fileUrlCache.set(file, u);
  }
  return u;
}

/** 该来源是否为 PDF（<img> 无法渲染，需占位） */
export function isPdfSource(s?: FigureCellSource): boolean {
  if (!s) return false;
  if (s.kind === "path") return /\.pdf$/i.test(s.abs);
  return /\.pdf$/i.test(s.file.name);
}

/** 来源的文件名（用于占位卡 / 列表显示） */
export function sourceName(s?: FigureCellSource): string {
  if (!s) return "";
  if (s.kind === "path") return s.abs;
  return s.file.name;
}

/** 预览 URL：path 级零拷贝 / file 级对象 URL；无来源返回 null（旧链路兜底） */
export function cellPreviewUrl(cell: FigureCell): string | null {
  const s = cell.source;
  if (!s) return cell.path || null;
  if (s.kind === "path") return convertFileSrc(s.abs);
  return fileUrl(s.file);
}
