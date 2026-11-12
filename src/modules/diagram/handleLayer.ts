// M2·F3-2：控制点层 / 选中包围盒层的 **DOM 构建**（无 JSX / React，jsdom 可直接回归）。
//
// F2-1 时代这两个函数内嵌在 DiagramCanvas.tsx 里，Node 侧无法验证 DOM 结构；本次抽出后
// 保持所有既有 data 属性不变，确保「拖拽写回 / 锁定挂锁 / 点选」零回归：
//   · circle[data-dg-handle-id] 仍是 F2-1 的拖拽 marker（唯一，命中圈不带这个属性）；
//   · <g class="dg-handle-node" data-dg-handle-id> 让 target.closest() 在命中圈上也能取到 id；
//   · data-dg-locked / is-locked / is-compat-locked / 挂锁 / 引导线全部沿用。
//
// 关键拆分：每个控制点 = 一个 <g> 包两个 <circle> ——
//   视觉圆（小、pointer-events:none，只负责好看）
//   命中圈（透明、pointer-events:all，半径约 3× 视觉圆，只负责好点）
// 这样「节点太大」和「缩小后点不中」不会互相牵制。所有辅助层一律 createElementNS
// 追加到**已消毒**的 SVG 之后，绝不 innerHTML。
import type { TikzEditHandle, TikzViewBox } from "./tikzEditor/engine.ts";
import {
  MAX_VISIBLE_HANDLES,
  handleLabel,
  isDraggableHandle,
  lockedHandleReason,
  worldToSvgPoint,
} from "./dragEdit.ts";
import { resolveHandleLock, type CompatReport } from "./tikzEditor/compat.ts";
import { shadowedLockedHandleIds } from "./handleHit.ts";
import {
  padBox,
  selectionCorners,
  type BoxLike,
  type HandleMetrics,
} from "./handleVisual.ts";
import { cornerPoint, guideToSvgSegment, svgCornerForWorld, type GuideLine, type SvgViewBoxLike, type WorldBox } from "./guides.ts";
import { GRID_STEP_PT, gridLines, rulerTicks } from "./grid.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * F2-3 挂锁图标：锁体 + 锁梁 + 锁孔。内部坐标以屏幕 10px 见方写死，
 * 用 transform: scale(lockScale / unitScale) 保持任何缩放下屏幕尺寸恒定。
 * 注意这里必须用**实测单位比**而不是 UI zoom —— 只除 zoom 会让挂锁随
 * viewBox→px 的比例同步放大（F3-2 用户反馈「控制点还是太大」的根因之一）。
 * lockScale 不随节点档位缩小 —— 理由图标必须始终看得清（F3-2 验收项）。
 */
function appendLockGlyph(
  parent: SVGGElement,
  x: number,
  y: number,
  unitScale: number,
  compatLocked: boolean,
  lockScale = 1,
  handleId = "",
): void {
  const g = el("g", {
    class: `dg-handle-lock${compatLocked ? " is-compat" : ""}`,
    // F3-2 后续修复：实时预览换几何时按 id 把挂锁一起挪，避免锁图标留在旧位置。
    "data-dg-lock-for": handleId,
    transform: `translate(${fmtNum(x)} ${fmtNum(y)}) scale(${fmtNum(lockScale / unitScale)})`,
  });
  const body = el("rect", {
    class: "dg-handle-lock-body",
    x: -4,
    y: -0.5,
    width: 8,
    height: 6.5,
    rx: 1.2,
  });
  const shackle = el("path", {
    class: "dg-handle-lock-shackle",
    d: "M-2.5 -0.5 V-2.4 A2.5 2.5 0 0 1 2.5 -2.4 V-0.5",
  });
  const hole = el("circle", { class: "dg-handle-lock-hole", cx: 0, cy: 2.1, r: 0.9 });
  g.append(body, shackle, hole);
  parent.appendChild(g);
}

/**
 * 控制点图层。返回新建的 <g>，F2-1 拖拽期间仍靠 circle[data-dg-handle-id] 找 marker，
 * 并把虚线引导（data-dg-guide）放在同一层。
 */
export function buildHandleLayer(
  svg: SVGSVGElement,
  handles: readonly TikzEditHandle[],
  viewBox: TikzViewBox,
  compat: CompatReport | null,
  metrics: HandleMetrics,
): SVGGElement {
  const layer = el("g", { "data-dg-handle-layer": "1" });
  // F2-3 补充：`\draw (a) -- (b)` 的命名坐标端点与节点 position 句柄重合时，
  // 它是重复且不可写的控制点；连命中圈一起省掉，节点才能被直接拖动，箭头仍跟随引用。
  const shadowed = shadowedLockedHandleIds(handles, compat);
  for (const h of handles.slice(0, MAX_VISIBLE_HANDLES)) {
    if (!h.world || !Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
    if (shadowed.has(h.id)) continue;
    const p = worldToSvgPoint(h.world, viewBox);
    const lockReason = resolveHandleLock(
      compat,
      h.id,
      isDraggableHandle(h),
      lockedHandleReason(h),
    );
    const draggable = lockReason === null;
    const compatLocked = !!compat?.handleReasons[h.id];

    // g 与视觉圆都带 id：g 让命中圈上的点击能被 closest() 识别，circle 让 F2-1
    // 的 querySelectorAll("circle[data-dg-handle-id]") 仍只找到一个 marker。
    const node = el("g", {
      class: "dg-handle-node",
      "data-dg-handle-id": h.id,
      "data-dg-source-id": h.sourceRef?.sourceId ?? "",
    });
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = draggable
      ? `${handleLabel(h)}：按住拖动可改写源码坐标`
      : lockReason;
    node.appendChild(title);

    const visual = el("circle", {
      class: `dg-handle${draggable ? "" : " is-locked"}${compatLocked ? " is-compat-locked" : ""}`,
      cx: fmtNum(p.x),
      cy: fmtNum(p.y),
      r: fmtNum(metrics.visualR),
      "stroke-width": fmtNum(metrics.stroke),
      "data-dg-handle-id": h.id,
      "data-dg-locked": draggable ? "0" : "1",
    });
    // 透明命中圈：fill:none + pointer-events:all，即使没被 paint 也接收指针事件。
    const hit = el("circle", {
      class: `dg-handle-hit${draggable ? "" : " is-locked"}`,
      cx: fmtNum(p.x),
      cy: fmtNum(p.y),
      r: fmtNum(metrics.hitR),
      "data-dg-hit-id": h.id,
      "pointer-events": "all",
    });
    node.append(visual, hit);
    layer.appendChild(node);
    if (!draggable) {
      appendLockGlyph(
        layer,
        p.x,
        p.y - metrics.lockOffset,
        metrics.unitScale,
        compatLocked,
        metrics.lockScale,
        h.id,
      );
    }
  }
  // 拖拽时的虚线引导（从起点到当前位置），平时 hidden
  const guide = el("line", {
    class: "dg-handle-guide",
    "data-dg-guide": "1",
    "stroke-width": fmtNum(metrics.stroke),
    "stroke-dasharray": fmtNum(metrics.stroke * 3),
    visibility: "hidden",
  });
  layer.appendChild(guide);
  svg.appendChild(layer);
  return layer;
}

/**
 * F3-3：应用「主动隐藏」。只切 DOM class，不改源码、不重建 SVG：
 *   · `[data-source-id]` 几何节点（一条语句可能对应多个节点，全部隐藏）；
 *   · 对应的控制点 `<g>`；
 *   · 该控制点的 F2-3 挂锁（按 data-dg-lock-for 匹配，避免用 CSS.escape）。
 * 隐藏是纯编辑器侧状态，切回可见只需再调一次，天然幂等。
 */
export function applyLayerVisibility(
  svg: SVGSVGElement,
  hiddenIds: ReadonlySet<string>,
): void {
  const locks = new Map<string, Element>();
  for (const g of Array.from(svg.querySelectorAll("g.dg-handle-lock"))) {
    const key = g.getAttribute("data-dg-lock-for");
    if (key) locks.set(key, g);
  }
  for (const el of Array.from(svg.querySelectorAll("[data-source-id]"))) {
    el.classList.toggle("dg-hidden", hiddenIds.has(el.getAttribute("data-source-id") ?? ""));
  }
  for (const node of Array.from(svg.querySelectorAll("g.dg-handle-node"))) {
    const hidden = hiddenIds.has(node.getAttribute("data-dg-source-id") ?? "");
    node.classList.toggle("dg-hidden", hidden);
    const hid = node.getAttribute("data-dg-handle-id") ?? "";
    const lock = locks.get(hid);
    if (lock) lock.classList.toggle("dg-hidden", hidden);
  }
}

/** 选中包围盒层：先于控制点层 append，手柄画在虚线框之上；整层不接收指针事件。 */
export function createSelectionLayer(svg: SVGSVGElement): SVGGElement {
  const layer = el("g", {
    class: "dg-selection-layer",
    "data-dg-selection-layer": "1",
  });
  svg.appendChild(layer);
  return layer;
}

/** 清空并重画选中包围盒；box 为 null 时只清空（点空白 / 切精确通道）。 */
export function drawSelectionBox(
  layer: SVGGElement,
  box: BoxLike | null,
  metrics: HandleMetrics,
  /** 选中框边的拖拽代理 id：只挂透明 stroke 上，不遮框内图元本体 / 文字双击。 */
  hitId?: string | null,
): void {
  layer.replaceChildren();
  if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return;
  const padded = padBox(box, metrics.boxPad);
  const frame = el("rect", {
    class: "dg-sel-box",
    "data-dg-selection-box": "1",
    x: fmtNum(padded.x),
    y: fmtNum(padded.y),
    width: fmtNum(padded.width),
    height: fmtNum(padded.height),
    "stroke-width": fmtNum(metrics.boxStroke),
    "stroke-dasharray": fmtNum(metrics.boxStroke * 3),
  });
  layer.appendChild(frame);
  // 虚线框本身以前是 pointer-events:none，用户「拖框移动」完全落空。
  // 这里加一条只在边框附近生效的透明 stroke 命中区：data-source-id 让它直接复用
  // F2-1 的本体拖拽链路；fill:none 保证框内点击仍命中图元本体（F4-3 双击文字不受影响）。
  if (hitId) {
    layer.appendChild(
      el("rect", {
        class: "dg-sel-hit",
        "data-dg-ui-hit": "1",
        "data-source-id": hitId,
        x: fmtNum(padded.x),
        y: fmtNum(padded.y),
        width: fmtNum(padded.width),
        height: fmtNum(padded.height),
        fill: "none",
        stroke: "transparent",
        "stroke-width": fmtNum(metrics.boxPad * 2),
      }),
    );
  }
  for (const c of selectionCorners(padded, metrics.boxCorner)) {
    layer.appendChild(
      el("rect", {
        class: "dg-sel-corner",
        x: fmtNum(c.x),
        y: fmtNum(c.y),
        width: fmtNum(c.width),
        height: fmtNum(c.height),
        "stroke-width": fmtNum(metrics.boxStroke),
      }),
    );
  }
}

/** 参考线层：每次重绘都整层重写，永远画在几何之上（F3-4 智能参考线）。 */
export function createGuideLayer(svg: SVGSVGElement): SVGGElement {
  const layer = el("g", { class: "dg-guide-layer", "data-dg-guide-layer": "1" });
  svg.appendChild(layer);
  return layer;
}

/**
 * 把 store 里的 world 参考线画成 SVG 线段。viewBox 是渲染视口（world 单位，Y 轴已翻转），
 * 由 guides.guideToSvgSegment 做 world→svg 换算，绝不参与写回计算（见 guides.ts 口径）。
 */
export function drawGuides(
  layer: SVGGElement | null,
  guides: readonly GuideLine[],
  viewBox: SvgViewBoxLike | null,
): void {
  if (!layer) return;
  layer.replaceChildren();
  if (!viewBox || !guides || guides.length === 0) return;
  for (const line of guides) {
    const seg = guideToSvgSegment(line, viewBox);
    if (!seg) continue;
    layer.appendChild(
      el("line", {
        class: "dg-guide-line",
        "data-dg-guide-line": "1",
        x1: fmtNum(seg.x1),
        y1: fmtNum(seg.y1),
        x2: fmtNum(seg.x2),
        y2: fmtNum(seg.y2),
      }),
    );
  }
}

/** 变换手柄层：旋转 / 缩放柄（F3-4）。每次重绘整层重写，永远在控制点之上。 */
export function createTransformLayer(svg: SVGSVGElement): SVGGElement {
  const layer = el("g", { class: "dg-transform-layer", "data-dg-transform-layer": "1" });
  svg.appendChild(layer);
  return layer;
}

/**
 * 在选中包围盒上画 8 个缩放柄 + 1 个旋转柄。svgBox 已是 SVG 用户坐标（Y 轴已按 viewBox 翻转），
 * 因此直接用 cornerPoint 取角点 / 边中点即可定位，无需再翻转。柄尺寸按实测单位比换算，
 * 任何缩放下屏幕恒定。柄只接 pointer-events:all，命中只靠 data 属性由 onStagePointerDown 区分。
 */
export function drawTransformHandles(
  layer: SVGGElement | null,
  svgBox: WorldBox | null,
  metrics: HandleMetrics,
): void {
  if (!layer) return;
  layer.replaceChildren();
  if (!svgBox || !Number.isFinite(svgBox.minX) || !Number.isFinite(svgBox.maxY)) return;
  const s = metrics.unitScale > 0 ? metrics.unitScale : 1;
  const half = 4 / s;
  // F6-补强：视觉柄保持小而清晰，另画**透明命中圈**（约 3×）负责接收 pointerdown。
  // 与 F3-2 控制点同构：8px 的方块 / 10px 的旋转圆在 100%–200% 缩放下都太难点，
  // 命中圈放大不改变视觉、不改 data 属性语义（closest 仍从命中圈取到同一组 data）。
  const hitHalf = 11 / s;
  const stroke = 1.2 / s;
  const cx = (svgBox.minX + svgBox.maxX) / 2;
  const topY = svgBox.minY; // SVG 空间里 minY 是「上边」
  // 8 个缩放柄：data-dg-corner 保持 world 语义（0 左上 … 7 左中），
  // 但 SVG 框 Y 向下，绘制位置必须按 svgCornerForWorld 上下翻转，否则拖哪都反。
  for (let i = 0; i < 8; i += 1) {
    const p = cornerPoint(svgBox, svgCornerForWorld(i));
    const g = el("g", {
      "data-dg-transform-handle": "1",
      "data-dg-transform-kind": "scale",
      "data-dg-corner": String(i),
    });
    g.appendChild(
      el("rect", {
        class: "dg-scale-hit",
        x: fmtNum(p.x - hitHalf),
        y: fmtNum(p.y - hitHalf),
        width: fmtNum(hitHalf * 2),
        height: fmtNum(hitHalf * 2),
      }),
    );
    g.appendChild(
      el("rect", {
        class: "dg-scale-handle",
        x: fmtNum(p.x - half),
        y: fmtNum(p.y - half),
        width: fmtNum(half * 2),
        height: fmtNum(half * 2),
        "stroke-width": fmtNum(stroke),
      }),
    );
    layer.appendChild(g);
  }
  // 旋转柄：顶边中点上方一段固定屏幕距离处画一个小圆 + 连线（线只做视觉，不命中）。
  const rotY = topY - 18 / s;
  layer.appendChild(
    el("line", {
      class: "dg-rotate-stick",
      x1: fmtNum(cx),
      y1: fmtNum(topY),
      x2: fmtNum(cx),
      y2: fmtNum(rotY),
      "stroke-width": fmtNum(stroke),
    }),
  );
  const rotG = el("g", {
    "data-dg-transform-handle": "1",
    "data-dg-transform-kind": "rotate",
  });
  rotG.appendChild(
    el("circle", {
      class: "dg-rotate-hit",
      cx: fmtNum(cx),
      cy: fmtNum(rotY),
      r: fmtNum(11 / s),
    }),
  );
  rotG.appendChild(
    el("circle", {
      class: "dg-rotate-handle",
      cx: fmtNum(cx),
      cy: fmtNum(rotY),
      r: fmtNum(5 / s),
      "stroke-width": fmtNum(stroke),
    }),
  );
  layer.appendChild(rotG);
}

/** 网格层（F3-5）：插到 SVG 最底层，几何图形覆盖其上；每次整层重写。 */
export function createGridLayer(svg: SVGSVGElement): SVGGElement {
  const layer = el("g", { class: "dg-grid-layer", "data-dg-grid-layer": "1" });
  svg.insertBefore(layer, svg.firstChild);
  return layer;
}

/** 在 SVG 用户坐标下画网格线；线宽按 unitScale 换算，任何缩放下都是细线。 */
export function drawGrid(
  layer: SVGGElement | null,
  viewBox: TikzViewBox | null,
  metrics: HandleMetrics,
  step: number = GRID_STEP_PT,
): void {
  if (!layer) return;
  layer.replaceChildren();
  if (!viewBox) return;
  const s = metrics.unitScale > 0 ? metrics.unitScale : 1;
  const stroke = (1 / s).toFixed(4);
  const { xs, ys } = gridLines(viewBox, step);
  const x1 = fmtNum(viewBox.x);
  const x2 = fmtNum(viewBox.x + viewBox.width);
  const y1 = fmtNum(viewBox.y);
  const y2 = fmtNum(viewBox.y + viewBox.height);
  for (const x of xs) {
    layer.appendChild(
      el("line", {
        class: "dg-grid-line",
        "data-dg-grid-line": "1",
        x1: fmtNum(x),
        y1,
        x2: fmtNum(x),
        y2,
        "stroke-width": stroke,
      }),
    );
  }
  for (const y of ys) {
    layer.appendChild(
      el("line", {
        class: "dg-grid-line",
        "data-dg-grid-line": "1",
        x1,
        y1: fmtNum(y),
        x2,
        y2: fmtNum(y),
        "stroke-width": stroke,
      }),
    );
  }
}

/** 标尺层（F3-5）：顶部刻度 + cm 标签，文字与刻度按 unitScale 恒屏（挂在最上层，pointer-events:none）。 */
export function createRulerLayer(svg: SVGSVGElement): SVGGElement {
  const layer = el("g", { class: "dg-ruler-layer", "data-dg-ruler-layer": "1" });
  svg.appendChild(layer);
  return layer;
}

export function drawRuler(
  layer: SVGGElement | null,
  viewBox: TikzViewBox | null,
  metrics: HandleMetrics,
  step: number = GRID_STEP_PT,
): void {
  if (!layer) return;
  layer.replaceChildren();
  if (!viewBox) return;
  const s = metrics.unitScale > 0 ? metrics.unitScale : 1;
  const stroke = (1 / s).toFixed(4);
  const tickTop = fmtNum(viewBox.y);
  const tickLen = 6 / s;
  const tickBottom = fmtNum(viewBox.y + tickLen);
  const fontSize = 10 / s;
  // 顶部刻度带（半透明底色，避免与图形混读）
  layer.appendChild(
    el("rect", {
      class: "dg-ruler-band",
      "data-dg-ruler-band": "1",
      x: fmtNum(viewBox.x),
      y: tickTop,
      width: fmtNum(viewBox.width),
      height: fmtNum(tickLen * 1.6),
    }),
  );
  for (const t of rulerTicks(viewBox, step)) {
    layer.appendChild(
      el("line", {
        class: "dg-ruler-tick",
        "data-dg-ruler-tick": "1",
        x1: fmtNum(t.svgX),
        y1: tickTop,
        x2: fmtNum(t.svgX),
        y2: tickBottom,
        "stroke-width": stroke,
      }),
    );
    if (t.cm !== 0) {
      const text = el("text", {
        class: "dg-ruler-label",
        "data-dg-ruler-label": "1",
        x: fmtNum(t.svgX + 3 / s),
        y: fmtNum(viewBox.y + tickLen * 1.5),
        "font-size": fmtNum(fontSize),
      });
      text.textContent = String(t.cm);
      layer.appendChild(text);
    }
  }
}
