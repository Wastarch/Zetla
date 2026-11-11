// M2 · 绘图模块 F1-6：XeLaTeX 精确预览的缓存 / hash / data URL 纯逻辑。
// 不依赖 Tauri invoke / React（precisePreview.ts 负责副作用），便于 Node 侧直接回归。
// 注意：这里只用 import type，Node --experimental-strip-types 会整条擦除，不会触发 @/ 别名解析。
import type { TikzPreviewResult } from "@/types/diagram";

export const MAX_PREVIEW_CACHE = 12;
/** key → 成功结果（Map 迭代序即 LRU 序） */
const cache = new Map<string, TikzPreviewResult>();

/**
 * F3-7：按画布尺寸导出的两个维度也进 key，避免开关 / 尺寸切换后误命中旧产物。
 * 开关关闭（或第三参省略）时 key 与 F1-6 完全一致 —— 现有调用点与回归零改动。
 */
export interface PreviewCanvasKey {
  widthPt: number;
  heightPt: number;
  useCanvas: boolean;
}

/** FNV-1a 32 位；附长度进一步降低碰撞概率 */
export function previewKey(source: string, engine: string, canvas?: PreviewCanvasKey): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const base = `${engine}:${(h >>> 0).toString(16)}:${source.length}`;
  if (!canvas?.useCanvas) return base;
  const w = Number.isFinite(canvas.widthPt) ? Math.round(canvas.widthPt * 100) / 100 : 0;
  const hh = Number.isFinite(canvas.heightPt) ? Math.round(canvas.heightPt * 100) / 100 : 0;
  return `${base}|c:${w}:${hh}`;
}

export function getCachedPreview(key: string): TikzPreviewResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

/** 只缓存成功结果：TeX 环境修好后重试应能恢复，不能被旧错误卡住 */
export function setCachedPreview(key: string, r: TikzPreviewResult): void {
  if (r.status !== "ok" || !r.svg) return;
  cache.set(key, r);
  while (cache.size > MAX_PREVIEW_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 手动重编译时只失效当前 key，不影响其他已缓存的成功预览 */
export function removeCachedPreview(key: string): void {
  cache.delete(key);
}

export function clearPrecisePreviewCache(): void {
  cache.clear();
}

/** SVG 文本 → 可被 <img> 直接使用的 data URL（隔离文档，脚本不执行） */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
