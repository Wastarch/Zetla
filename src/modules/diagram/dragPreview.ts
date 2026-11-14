// M2·F3-2 后续修复：拖拽 **实时几何预览**（纯逻辑 + DOM 层，无 React，jsdom 可回归）。
//
// 用户口径（2026-11-09）：「透明命中圈所产生的改变，本质仍然是原来的节点，只是加了
// 一层由命中圈转为 TikZ 节点」。所以这里绝不引入第二套编辑语义：
//   · 透明命中圈 → 命中 upstream editHandle → applyEditIntent 得到候选源码（唯一真源仍是源码）；
//   · 候选源码 → renderTikz 得到候选 SVG → 只把「几何子节点」换掉，实时看到图形变化；
//   · 松手才由 commitDiagramPatch 写回 CM6，预览期间不写 source / 不进撤销栈 / 不动 renderMeta。
//
// 关键技术点：**保持基准 viewBox 不变**。上游会按图形包围盒重算 viewBox，若直接把候选
// SVG 整棵换上去，画布会因为 viewBox 宽高变化而"跳一下"，正在拖动的控制点也会错位。
// 因此只导入候选 SVG 的子节点，并按两个 viewBox 的 Y 基准差做一次 translate：
//   world→svg 的映射是 svgY = 2*vb.y + vb.height - worldY（见 dragEdit.ts），
//   故把候选几何整体平移 dy = (2*base.y+base.height) - (2*cand.y+cand.height) 后，
//   同一个 world 点在基准 viewBox 下仍落在原来的屏幕位置。X 方向没有 viewBox 偏移，dx = 0。
//   实测：横向拖动只改 vb.x / width，dy=0；纵向拖动 vb.y / height 变化，dy 恰好等于 Y 基准差。
import type { TikzEditHandle, TikzViewBox } from "./tikzEditor/engine.ts";
import { sanitizeSvg } from "./tikzEditor/svg.ts";
import { worldToSvgPoint } from "./dragEdit.ts";
import type { HandleMetrics } from "./handleVisual.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

function num(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export interface PreviewOffset {
  dx: number;
  dy: number;
}

/**
 * 候选几何在「基准 viewBox 下」需要的平移量。非法 / 缺失字段按 0 处理，
 * 绝不产出 NaN 打进 transform（手改缓存、引擎返回退化 viewBox 时的护栏）。
 */
export function previewGeometryOffset(
  base: TikzViewBox,
  candidate: TikzViewBox,
): PreviewOffset {
  const baseY = 2 * num(base?.y) + num(base?.height);
  const candY = 2 * num(candidate?.y) + num(candidate?.height);
  const dy = baseY - candY;
  return { dx: 0, dy: Number.isFinite(dy) ? dy : 0 };
}

/**
 * 一次指针移动是否值得重渲染。上游把坐标量化到 cm 小数点后两位（≈0.28pt），
 * 因此很多 pointermove 会得到完全相同的源码 —— 用源码字符串去重即可，
 * 不必再做位移阈值判断，也保证「预览的源码」与「松手提交的源码」是同一份。
 */
export function shouldRenderPreview(
  previousSource: string | null,
  nextSource: string,
  baseSource: string,
): boolean {
  return (
    typeof nextSource === "string" &&
    nextSource.length > 0 &&
    nextSource !== baseSource &&
    nextSource !== previousSource
  );
}

export interface PreviewGeometryOptions {
  /** 候选（live=true）或基准（live=false，还原）SVG 文本 */
  markup: string;
  /** 拖拽开始时的 viewBox，整个手势期间根 SVG 的 viewBox 保持它不变 */
  baseViewBox: TikzViewBox;
  /** 与 markup 同源的 viewBox */
  candidateViewBox: TikzViewBox;
  zoom: number;
  /** true = 预览候选几何；false = 还原基准几何并清理预览标记 */
  live: boolean;
}

/** 辅助层：选中框 / 控制点 / 形状工具预览 / 参考线 / 变换柄 / F3-7 纸张框。替换几何时它们必须原样保留（拖拽 DOM 引用不丢）。 */
function isAuxLayer(el: Element): boolean {
  return (
    el.hasAttribute("data-dg-selection-layer") ||
    el.hasAttribute("data-dg-handle-layer") ||
    el.hasAttribute("data-dg-shape-preview") ||
    el.hasAttribute("data-dg-guide-layer") ||
    el.hasAttribute("data-dg-transform-layer") ||
    el.hasAttribute("data-dg-paper")
  );
}

/**
 * 只替换根 SVG 的几何子节点；辅助层留在原处且仍在几何之上。
 * 绝不 innerHTML：候选 SVG 先经 sanitizeSvg 白名单消毒，再用 importNode 的子节点挂载。
 * 返回 false 表示候选 SVG 无法解析（调用方保留上一帧，不打断拖拽）。
 */
export function applyPreviewGeometry(
  svg: SVGSVGElement,
  opts: PreviewGeometryOptions,
): boolean {
  const fresh = sanitizeSvg(opts.markup, opts.candidateViewBox, opts.zoom);
  if (!fresh) return false;
  const children = Array.from(fresh.childNodes);
  const offset = opts.live
    ? previewGeometryOffset(opts.baseViewBox, opts.candidateViewBox)
    : { dx: 0, dy: 0 };

  // 删掉旧几何（含上一帧的预览包裹层），辅助层一个都不动。
  for (const child of Array.from(svg.children)) {
    if (!isAuxLayer(child)) child.remove();
  }
  const firstAux = Array.from(svg.children).find(isAuxLayer) ?? null;
  const insert = (node: Node) => svg.insertBefore(node, firstAux);

  if (opts.live) {
    const wrap = document.createElementNS(SVG_NS, "g");
    wrap.setAttribute("class", "dg-preview-geometry");
    wrap.setAttribute("data-dg-preview-geometry", "1");
    if (Math.abs(offset.dx) > 1e-9 || Math.abs(offset.dy) > 1e-9) {
      wrap.setAttribute(
        "transform",
        `translate(${fmtNum(offset.dx)} ${fmtNum(offset.dy)})`,
      );
    }
    for (const child of children) wrap.appendChild(child);
    insert(wrap);
    // 拖出基准 viewBox 的图形不该被裁掉；还原时撤掉，避免长期影响布局。
    svg.setAttribute("data-dg-drag-preview", "1");
    svg.setAttribute("overflow", "visible");
  } else {
    // 还原成与首次渲染一致的扁平结构（不包裹 <g>），清掉预览标记。
    for (const child of children) insert(child);
    svg.removeAttribute("data-dg-drag-preview");
    svg.removeAttribute("overflow");
  }
  return true;
}

/** 根 SVG 是否正处于实时预览态（还原操作要幂等，避免把正常重渲染当成预览态）。 */
export function isPreviewActive(svg: SVGSVGElement | null): boolean {
  return !!svg && svg.getAttribute("data-dg-drag-preview") === "1";
}

/**
 * 用候选渲染的 editHandles 把「非活动」控制点跟着几何一起挪。
 * 活动控制点由 onMove 直接跟指针（更顺滑，且上游坐标量化会带来 <1px 抖动），
 * 所以传 skipId 跳过它；挂锁图标按 data-dg-lock-for 同步。
 * 返回实际更新的节点数（jsdom 回归用）。
 */
export function updateHandleLayerPositions(
  layer: SVGGElement,
  handles: readonly TikzEditHandle[],
  viewBox: TikzViewBox,
  metrics: HandleMetrics,
  skipId?: string,
): number {
  const byId = new Map<string, TikzEditHandle>();
  for (const h of handles) {
    if (
      h &&
      typeof h.id === "string" &&
      h.world &&
      Number.isFinite(h.world.x) &&
      Number.isFinite(h.world.y)
    ) {
      byId.set(h.id, h);
    }
  }
  const locks = new Map<string, SVGGElement>();
  for (const g of Array.from(layer.querySelectorAll("g.dg-handle-lock"))) {
    const id = g.getAttribute("data-dg-lock-for");
    if (id) locks.set(id, g as SVGGElement);
  }

  let updated = 0;
  for (const node of Array.from(layer.querySelectorAll("g.dg-handle-node"))) {
    const id = node.getAttribute("data-dg-handle-id") ?? "";
    if (!id || id === skipId) continue;
    const h = byId.get(id);
    if (!h || !h.world) continue;
    const p = worldToSvgPoint(h.world, viewBox);
    const x = fmtNum(p.x);
    const y = fmtNum(p.y);
    for (const c of Array.from(node.querySelectorAll("circle"))) {
      c.setAttribute("cx", x);
      c.setAttribute("cy", y);
    }
    const lock = locks.get(id);
    if (lock) {
      lock.setAttribute(
        "transform",
        `translate(${x} ${fmtNum(p.y - metrics.lockOffset)}) scale(${fmtNum(
          metrics.lockScale / metrics.unitScale,
        )})`,
      );
    }
    updated += 1;
  }
  return updated;
}
