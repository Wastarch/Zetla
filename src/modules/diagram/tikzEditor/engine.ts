// M2·F1-3：tikz-editor 引擎封装。
// 职责：动态加载 vendor bundle（3.3MB，只在绘图 Tab 首次渲染时拉取）、
//       按源码内容做 LRU 缓存、把上游多种 diagnostics 归一化给 UI。
// 不做：debounce（在 DiagramCanvas）、SVG 消毒（在 ./svg.ts）、拖拽写回（F4）。
import type {
  VendorDiagnostic,
  VendorRenderResult,
  VendorViewBox,
} from "./vendor/engine.bundle.js";

export interface TikzDiagnostic {
  severity: "warning" | "error";
  message: string;
  code?: string;
  /** 源码字符偏移，供 F5 反向编辑定位；v1 仅展示 */
  offset?: number;
}

export interface TikzViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TikzRender {
  /** 引擎产出的完整 <svg>…</svg> 字符串（注入前必须经 ./svg.ts 消毒） */
  svg: string;
  viewBox: TikzViewBox;
  diagnostics: TikzDiagnostic[];
  /**
   * 引擎覆盖缺口（诊断 code 以 unsupported 开头，如 unsupported-pic-operation）。
   * 这类构造会被**静默丢弃**，导致预览缺元素但画布看起来"正常"；
   * UI 必须显式提示「预览不完整，导出以 XeLaTeX 为准」，不能只给一个可折叠的诊断按钮。
   */
  unsupported: TikzDiagnostic[];
  elapsedMs: number;
  fromCache: boolean;
}

type VendorModule = typeof import("./vendor/engine.bundle.js");

let vendorPromise: Promise<VendorModule> | null = null;

function loadVendor(): Promise<VendorModule> {
  if (!vendorPromise) {
    vendorPromise = import("./vendor/engine.bundle.js").catch((err: unknown) => {
      // 加载失败允许下次重试（例如网络抖动 / 资源被回收）
      vendorPromise = null;
      throw err;
    });
  }
  return vendorPromise;
}

/** 打开绘图 Tab 时预热，避免首次输入后还要等 3.3MB chunk 解析。 */
export function preloadTikzEngine(): Promise<void> {
  return loadVendor().then(() => undefined);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeDiagnostic(d: VendorDiagnostic | undefined): TikzDiagnostic | null {
  if (!d || typeof d.message !== "string" || !d.message.trim()) return null;
  const out: TikzDiagnostic = {
    severity: d.severity === "error" ? "error" : "warning",
    message: d.message,
  };
  if (typeof d.code === "string") out.code = d.code;
  if (typeof d.span?.from === "number") out.offset = d.span.from;
  return out;
}

/** 上游诊断分散在 parse / semantic / svg / renderDiagnostics 四处，去重后统一展示。 */
function collectDiagnostics(raw: VendorRenderResult): TikzDiagnostic[] {
  const groups: (VendorDiagnostic[] | undefined)[] = [
    raw.parse?.diagnostics,
    raw.semantic?.diagnostics,
    raw.svg?.diagnostics,
    raw.renderDiagnostics,
  ];
  const out: TikzDiagnostic[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const d = normalizeDiagnostic(item);
      if (!d) continue;
      const key = `${d.severity}|${d.offset ?? -1}|${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

const FALLBACK_VIEWBOX: TikzViewBox = { x: 0, y: 0, width: 100, height: 100 };

function readViewBox(raw: VendorRenderResult): TikzViewBox {
  const vb: VendorViewBox | undefined = raw.svg?.viewBox;
  if (
    vb &&
    [vb.x, vb.y, vb.width, vb.height].every((n) => Number.isFinite(n)) &&
    vb.width > 0 &&
    vb.height > 0
  ) {
    return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  }
  // 兜底：直接从 SVG 字符串读 viewBox（上游版本变动时仍可用）
  const m = /viewBox\s*=\s*"([^"]+)"/i.exec(raw.svg?.svg ?? "");
  if (m) {
    const n = m[1].trim().split(/[\s,]+/).map(Number);
    if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) {
      return { x: n[0], y: n[1], width: n[2], height: n[3] };
    }
  }
  return FALLBACK_VIEWBOX;
}

// 源码内容键（FNV-1a + 长度）+ 存原文比对，避免 hash 碰撞导致错图；
// LRU 上限 32 条，足够覆盖 F5-2 之前的反复微调场景。
const CACHE_LIMIT = 32;
interface CacheEntry {
  source: string;
  render: TikzRender;
}
const cache = new Map<string, CacheEntry>();

function keyOf(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h = Math.imul(h ^ source.charCodeAt(i), 16777619);
  }
  return `${source.length}:${(h >>> 0).toString(36)}`;
}

function readCache(source: string): TikzRender | null {
  const key = keyOf(source);
  const hit = cache.get(key);
  if (!hit || hit.source !== source) return null;
  cache.delete(key);
  cache.set(key, hit); // LRU bump
  return { ...hit.render, fromCache: true };
}

function writeCache(source: string, render: TikzRender): void {
  const key = keyOf(source);
  cache.delete(key);
  cache.set(key, { source, render: { ...render, fromCache: false } });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export function clearTikzRenderCache(): void {
  cache.clear();
}

/** 同步渲染一段完整 tikzpicture 源码；空源码由调用方拦截（不进引擎）。 */
export async function renderTikz(source: string): Promise<TikzRender> {
  const hit = readCache(source);
  if (hit) return hit;

  const mod = await loadVendor();
  const started = performance.now();
  let raw: VendorRenderResult;
  try {
    raw = mod.renderTikzToSvg(source);
  } catch (err) {
    throw new Error(`TikZ 渲染失败：${errorText(err)}`);
  }
  const svg = raw.svg?.svg;
  if (typeof svg !== "string" || !svg.trim()) {
    throw new Error("TikZ 引擎未返回 SVG 内容。");
  }

  const diagnostics = collectDiagnostics(raw);
  const render: TikzRender = {
    svg,
    viewBox: readViewBox(raw),
    diagnostics,
    unsupported: diagnostics.filter((d) => /^unsupported/i.test(d.code ?? "")),
    elapsedMs: performance.now() - started,
    fromCache: false,
  };
  writeCache(source, render);
  return render;
}
