// M2·F1-3 / F2-1 / F2-2 / F2-3：tikz-editor 引擎封装。
// 职责：动态加载 vendor bundle（3.4MB，只在绘图 Tab 首次渲染时拉取）、
//       按源码内容做 LRU 缓存、把上游多种 diagnostics 归一化给 UI、
//       把语义层 editHandles 透出给画布、把一次拖拽落成最小源码补丁、
//       F2-2 把 parse.figure.body 归一化为属性面板可用的语句清单、
//       F2-3 把 capabilityMatrix / featureUsage 交给 compat.ts 生成锁定报告。
// 不做：debounce（在 DiagramCanvas）、SVG 消毒（在 ./svg.ts）、DOM 控制点绘制（在 ../DiagramCanvas）。
import type {
  VendorDiagnostic,
  VendorEditHandle,
  VendorEditIntentResult,
  VendorRenderResult,
  VendorViewBox,
} from "./vendor/engine.bundle.js";
import { collectStatements, type TikzStatement } from "../optionsEdit.ts";
import { buildCompatReport, type CompatReport } from "./compat.ts";

export interface TikzDiagnostic {
  severity: "warning" | "error";
  message: string;
  code?: string;
  /** 源码字符偏移，供 F4-1 反向编辑定位；F1 仅展示 */
  offset?: number;
}

/** F2-1：画布控制点。字段是上游 EditHandle 的子集，其余字段原样透给 applyEditIntent。 */
export type TikzEditHandle = VendorEditHandle;

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
  /**
   * 与这份 svg 同一次渲染产出的可拖拽控制点（F2-1）。
   * 世界坐标单位是 pt、Y 轴向上；applyDragEdit 必须传同一份数组，否则上游会因
   * sourceFingerprint 不匹配返回 stale handle。
   */
  handles: TikzEditHandle[];
  /**
   * F2-2：与这份 svg 同一次解析得到的语句清单（id 与 SVG 的 data-source-id 一致）。
   * 侧栏属性面板按 selectedId 查语句，再用 optionsEdit 生成最小选项补丁。
   */
  statements: TikzStatement[];
  /**
   * F2-3：与这份 svg / handles / statements 同源的兼容报告（锁定语句 / 控制点 + 具体理由）。
   * 由 capabilityMatrix + featureUsage + 源码扫描生成；随 LRU 一起缓存，不重复计算。
   */
  compat: CompatReport;
  elapsedMs: number;
  fromCache: boolean;
}

/** 一次拖拽的写回结果；status 三态分别对应成功 / 上游不支持 / 引擎报错。 */
export type DragEditOutcome =
  | {
      status: "ok";
      newSource: string;
      /** 上游给出的坐标替换文本，用于提示条展示「(1,1) → (1.4,1.2)」 */
      replacement: string | null;
    }
  | { status: "unsupported"; reason: string }
  | { status: "error"; message: string };

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
// LRU 上限 32 条，足够覆盖 F4-2 之前的反复微调场景。
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
  const rawHandles = raw.semantic?.editHandles;
  const handles: TikzEditHandle[] = Array.isArray(rawHandles)
    ? (rawHandles.filter((h) => h && typeof h.id === "string") as TikzEditHandle[])
    : [];
  const statements = collectStatements(raw.parse?.figure, source);
  const compat = buildCompatReport({
    source,
    statements,
    handles,
    featureUsage: raw.semantic?.featureUsage ?? null,
    capabilityMatrix: mod.capabilityMatrix ?? null,
    featureIds: mod.FEATURE_IDS ?? null,
  });
  const render: TikzRender = {
    svg,
    viewBox: readViewBox(raw),
    diagnostics,
    unsupported: diagnostics.filter((d) => /^unsupported/i.test(d.code ?? "")),
    handles,
    statements,
    compat,
    elapsedMs: performance.now() - started,
    fromCache: false,
  };
  writeCache(source, render);
  return render;
}

/**
 * F2-1：把一次控制点拖拽交给上游语义层改写成新源码。
 * 只做「算」，不碰 CodeMirror / store —— 提交由 DiagramCanvas 经 sourceBridge 完成，
 * 这样源码直编与画布拖拽进的是同一条 CM6 撤销栈。
 */
export async function applyDragEdit(
  source: string,
  handles: readonly TikzEditHandle[],
  handleId: string,
  newWorld: { x: number; y: number },
): Promise<DragEditOutcome> {
  if (!Number.isFinite(newWorld.x) || !Number.isFinite(newWorld.y)) {
    return { status: "error", message: "拖拽坐标无效" };
  }
  let raw: VendorEditIntentResult;
  try {
    const mod = await loadVendor();
    raw = mod.applyEditIntent(source, handles, { kind: "move", handleId, newWorld });
  } catch (err) {
    return { status: "error", message: `引擎写回异常：${errorText(err)}` };
  }
  if (raw.kind === "success") {
    const replacement = raw.patches?.[0]?.replacement;
    if (typeof raw.newSource !== "string") {
      return { status: "error", message: "引擎未返回新源码" };
    }
    return {
      status: "ok",
      newSource: raw.newSource,
      replacement: typeof replacement === "string" ? replacement : null,
    };
  }
  if (raw.kind === "unsupported") {
    return { status: "unsupported", reason: raw.reason || "该构造暂不支持拖拽写回" };
  }
  return { status: "error", message: raw.message || "写回失败" };
}
