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
import {
  padBox,
  selectionCorners,
  type BoxLike,
  type HandleMetrics,
} from "./handleVisual.ts";

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
  for (const h of handles.slice(0, MAX_VISIBLE_HANDLES)) {
    if (!h.world || !Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
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
