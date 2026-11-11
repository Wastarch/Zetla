// M2·F1-3 · 绘图引擎纯逻辑回归测试
// 跑法：node --experimental-strip-types scripts/diagram-render.test.ts
// 依赖 node_modules/jsdom（项目已有），不需要浏览器 / Tauri 运行时。
import { JSDOM } from "jsdom";
import {
  renderTikz,
  clearTikzRenderCache,
  applyDragEdit,
  applyGroupEdit,
  applyDeltaEdit,
} from "../src/modules/diagram/tikzEditor/engine.ts";
import {
  MAX_VISIBLE_HANDLES,
  clientDeltaToSvgDelta,
  clientToSvgPoint,
  dragDeltaLabel,
  isDraggableHandle,
  lockedHandleReason,
  singleSpanPatch,
  svgDeltaToWorldDelta,
  svgToWorldPoint,
  worldToSvgPoint,
} from "../src/modules/diagram/dragEdit.ts";
import {
  applyBlockOrder,
  clearLastMoveDelta,
  getClipboard,
  getLastMoveDelta,
  hasClipboard,
  matchClones,
  minimalSourcePatch,
  planDuplicate,
  planDuplicateEdit,
  planPaste,
  planZOrder,
  planZOrderEdit,
  planZOrderMany,
  setClipboard,
  setLastMoveDelta,
  topLevelBlocks,
} from "../src/modules/diagram/zOrder.ts";
import {
  GRID_STEP_PT,
  gridLines,
  rulerTicks,
  snapToGrid,
} from "../src/modules/diagram/grid.ts";
import {
  PRECISE_READONLY_REASON,
  canEditDiagramSource,
  isDiagramEditKey,
  isPreciseReadonly,
  type EditKeyLike,
} from "../src/modules/diagram/editability.ts";
import {
  pickNearestHandle,
  shadowedLockedHandleIds,
} from "../src/modules/diagram/handleHit.ts";
import {
  CANVAS_PRESETS,
  CM_TO_PT,
  DEFAULT_CANVAS_SIZE,
  canvasPaperRect,
  canvasSizeForPreset,
  canvasSizeLabel,
  canvasSizeToPt,
  DEFAULT_CANVAS_HEIGHT_CM,
  normalizeCanvasSize,
  presetMaxHeightCm,
} from "../src/modules/diagram/canvasSize.ts";
import {
  inferDocumentPaper,
  lengthToCm,
} from "../src/modules/diagram/documentPaper.ts";
import {
  DEFAULT_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  centerViewport,
  clampZoom,
  fitCanvasViewport,
  fitContentZoom,
  fitTo,
  renderScale,
  normalizeViewport,
  panBy,
  pointerFromStageCenter,
  viewportTransform,
  zoomAtPointer,
  zoomStep,
} from "../src/modules/diagram/viewport.ts";
import {
  hasDrawableContent,
  sanitizeSvg,
} from "../src/modules/diagram/tikzEditor/svg.ts";
import {
  applyPatchToSource,
  isColorFlag,
  normalizeCustomValue,
  planPropertyPatch,
  readProperty,
  statementEditability,
} from "../src/modules/diagram/optionsEdit.ts";
import {
  allReasonsNonEmpty,
  buildCompatReport,
  compatHandleReason,
  effectiveSeverity,
  emptyCompatReport,
  featureLabel,
  maskComments,
  owningStatement,
  readSupport,
  readUsage,
  resolveHandleLock,
  type CompatCapabilityRow,
  type CompatHandle,
  type CompatStatement,
} from "../src/modules/diagram/tikzEditor/compat.ts";
import { insertBeforeDocument } from "../src/core/preamble.ts";
import {
  buildDiagramInsertCode,
  collectTikzLibraries,
  ensureTikzPreamble,
} from "../src/modules/diagram/diagramSnippet.ts";
import {
  MAX_PREVIEW_CACHE,
  clearPrecisePreviewCache,
  getCachedPreview,
  previewKey,
  removeCachedPreview,
  setCachedPreview,
  svgDataUrl,
} from "../src/modules/diagram/previewCache.ts";
import {
  MAX_MERGE_STEPS,
  MERGE_WINDOW_MS,
  commitWithMerge,
  planHistoryMerge,
  resetMergeSession,
  resolveHistoryShortcut,
  type HistoryKeyContext,
  type HistoryKeyLike,
  type HistoryPatchApplier,
  type MergeGroup,
  type MergeSession,
} from "../src/modules/diagram/historyMerge.ts";
import {
  commitDiagramPatches,
  shouldHandleHistoryKey,
} from "../src/modules/diagram/diagramHistory.ts";
import { registerDiagramSourceBridge } from "../src/modules/diagram/sourceBridge.ts";
import {
  DEFAULT_TOOL_MODE,
  MAX_SHAPE_POINTS,
  TOOL_DEFS,
  addShapePoint,
  canFinishShape,
  createShapeSession,
  isShapeComplete,
  isToolMode,
  popShapePoint,
  shapeSessionHint,
  toolDef,
} from "../src/modules/diagram/shapeTools.ts";
import {
  TIKZ_PT_PER_CM,
  arcSweepDegrees,
  buildShapeStatement,
  findInsertionPoint,
  fmtCoord,
  fmtLength,
  fmtTikzNumber,
  insertShapeStatement,
  pickInsertedStatementId,
  ptToCm,
  sanitizeNodeText,
} from "../src/modules/diagram/shapeInsert.ts";
import {
  DEFAULT_HANDLE_SIZE,
  HANDLE_SIZE_LABELS,
  HANDLE_SIZE_SPECS,
  LOCK_BASE_PX,
  clientRectToSvgBox,
  handleMetrics,
  handleSizeSummary,
  isHandleSize,
  padBox,
  selectionCorners,
  svgUnitScale,
  unionBoxes,
  unitScaleFromCtm,
  unitScaleFromRect,
  type HandleSize,
} from "../src/modules/diagram/handleVisual.ts";
import {
  applyLayerVisibility,
  buildHandleLayer,
  createSelectionLayer,
  drawSelectionBox,
} from "../src/modules/diagram/handleLayer.ts";
import {
  applyPreviewGeometry,
  isPreviewActive,
  previewGeometryOffset,
  shouldRenderPreview,
  updateHandleLayerPositions,
} from "../src/modules/diagram/dragPreview.ts";
import {
  EMPTY_GROUPING,
  applyMarqueeSelection,
  buildLayerRows,
  createGroup,
  deleteGroup,
  expandGroupElements,
  findGroupByMembers,
  groupAncestors,
  groupingStorageKey,
  isManuallyHidden,
  isManuallyLocked,
  marqueeBox,
  marqueeHits,
  mergeSourcePatches,
  normalizeGrouping,
  patchGroup,
  planGroupMove,
  pruneGrouping,
  rectInsideBox,
  rectIntersectsBox,
  toggleId,
  toggleSelection,
  type GroupingState,
  type RectLike,
} from "../src/modules/diagram/grouping.ts";
import {
  collectElementBoxes,
  normalizeTransformValue,
  planAlignDeltas,
  planDistributeDeltas,
  planDragSnap,
  planTransformPatches,
  type ElementBox,
} from "../src/modules/diagram/transform.ts";
import {
  SIZE_KEYS,
  isSizeKey,
  normalizeSizeValue,
  planSizePatch,
  planSizePatches,
  ptToSizeString,
  sizeValueToPt,
  sizeValuesFromDrag,
} from "../src/modules/diagram/sizeEdit.ts";
import {
  findStyleUsers,
  scanSharedStyles,
  sharedStyleHint,
  styleNamesForStatement,
} from "../src/modules/diagram/sharedStyle.ts";
import {
  DEFAULT_SNAP_THRESHOLD_PT,
  formatCm,
  guideToSvgSegment,
  makeWorldBox,
  planSnap,
  rotationFromDrag,
  scaleFromDrag,
  snapAngle,
  svgBoxToWorldBox,
  worldBoxToSvgBox,
} from "../src/modules/diagram/guides.ts";

// svg.ts 只在函数内部访问 DOM API，模块加载时不碰 DOM，故可先 import 再注入全局。
const dom = new JSDOM("<!doctype html><html><body><div id=\"host\"></div></body></html>");
const g = globalThis as unknown as { DOMParser: typeof DOMParser; document: Document };
g.DOMParser = dom.window.DOMParser;
// 注意：document 要等引擎渲染用例跑完再注入。否则引擎会认为自己在浏览器里，
// 尝试 HTMLCanvasElement.getContext('2d') 做文字度量，jsdom 未实现会打印噪音。
// 真实 webview 里 canvas 可用，属正常路径。

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

const GOOD = String.raw`\begin{tikzpicture}
  \draw[thick] (0,0) rectangle (3,2);
  \node[draw, circle, fill=blue!20] (a) at (1,1) {A};
  \draw[->] (a) -- (2.5,1);
\end{tikzpicture}`;
const BAD = String.raw`\begin{tikzpicture}\draw[ ( ; \end{tikzpicture}`;

console.log("F1-3 · renderTikz（缓存 / 诊断）");
clearTikzRenderCache();
const good = await renderTikz(GOOD);
check(good.svg.includes("<path"), "正常源码产出 <path>");
check(good.svg.includes("<text"), "不带文字引擎时仍有 <text> 节点");
check(good.viewBox.width > 0 && good.viewBox.height > 0, "viewBox 有效");
check(good.diagnostics.length === 0, "正常源码无诊断");
check(!good.fromCache, "首次渲染未命中缓存");
const cached = await renderTikz(GOOD);
check(cached.fromCache && cached.svg === good.svg, "同一源码命中 LRU 缓存");

const bad = await renderTikz(BAD);
check(bad.diagnostics.length > 0, "坏源码产出解析诊断而非抛异常");
check(
  bad.diagnostics.every((d) => d.severity === "warning" || d.severity === "error"),
  "诊断 severity 归一化"
);
check(hasDrawableContent(good.svg) && !hasDrawableContent(bad.svg), "空画布识别正确");

// 用户 2026-11-07 实测反馈：\pic{angle} + angles/quotes 库被引擎静默丢弃，
// 三角形画出来了但角度标记与三个点没出来，只留一个可折叠的「1 条诊断」。
// 现在把 unsupported-* 单独抽出，供 UI 常驻提示。
console.log("F1-3 · 引擎覆盖缺口（unsupported-*）");
const PIC = String.raw`\begin{tikzpicture}
\coordinate (A) at (2,0);
\coordinate (B) at (0,0);
\coordinate (C) at (2,2);
\pic[draw, "$\theta$", angle radius=0.8cm] {angle = C--A--B};
\end{tikzpicture}`;
const pic = await renderTikz(PIC);
check(pic.unsupported.length === 1, "unsupported-pic-operation 被识别为覆盖缺口");
check(pic.unsupported[0]?.code === "unsupported-pic-operation", "缺口诊断 code 正确");
check(!hasDrawableContent(pic.svg), "\\pic 被丢弃时画布确实为空");
const FIXED = String.raw`\begin{tikzpicture}
  \def\L{6}
  \def\H{3.5}
  \draw[thick] (0,0) -- (\L,0) -- (\L,\H) -- cycle;
  \fill[gray!20] (0,0) -- (\L,0) -- (\L,\H) -- cycle;
  \coordinate (A) at (\L,0);
  \coordinate (B) at (0,0);
  \coordinate (C) at (\L,\H);
  \foreach \p in {A,B,C} \fill (\p) circle (2pt);
  \draw (A) ++(180:0.8cm) arc (180:90:0.8cm);
  \node at (5.35,0.55) {theta};
\end{tikzpicture}`;
const fixed = await renderTikz(FIXED);
check(fixed.unsupported.length === 0, "改用基础语法后无覆盖缺口");
check((fixed.svg.match(/<path/g) ?? []).length >= 6, "三角形 + 三个圆点 + 角度弧全部渲染");
check(fixed.svg.includes("<text"), "角度文字标签渲染");

console.log("F1-3 · sanitizeSvg（白名单消毒 / 注入）");
g.document = dom.window.document;
// 一旦注入 document，引擎会认为自己在浏览器里并用 canvas 度量节点文字宽度。
// jsdom 未实现 getContext，这里给最小 stub（F2-1 的写回用例也会重新渲染），
// 避免打印 "Not implemented" 噪音；真实 webview 走正常路径。
(dom.window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext =
  () => ({ font: "", measureText: (t: string) => ({ width: t.length * 5 }) });
const clean = sanitizeSvg(good.svg, good.viewBox, 1);
check(clean !== null, "合法 SVG 可解析");
check(clean?.namespaceURI === "http://www.w3.org/2000/svg", "保持 SVG 命名空间");
check((clean?.getAttribute("width") ?? "") === "100%", "适应窗口时 width=100%");
check(clean?.getAttribute("preserveAspectRatio") === "xMidYMid meet", "等比例缩放");
check(!!clean?.querySelector("text"), "文字节点保留");
check(!!clean?.querySelector("path"), "路径节点保留");
check(
  clean?.querySelector("text")?.hasAttribute("font-family") === true,
  "字体回退链属性未被白名单误删"
);
const zoomed = sanitizeSvg(good.svg, good.viewBox, 2);
check(zoomed?.getAttribute("width") === "200%", "放大后 width 等比变为 200%");

const EVIL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <script>alert(1)</script>
  <path d="M0 0 L1 1" onload="alert(2)" onclick="alert(3)"/>
  <image href="javascript:alert(4)"/>
  <foreignObject><div>boom</div></foreignObject>
  <a href="https://evil.example"><text x="1" y="1">OK</text></a>
  <text x="2" y="2">&lt;script&gt;escaped&lt;/script&gt;</text>
</svg>`;
const safe = sanitizeSvg(EVIL, { x: 0, y: 0, width: 10, height: 10 }, 1);
check(!!safe, "恶意 SVG 仍可解析（不白屏）");
check(!safe?.querySelector("script"), "<script> 被剔除");
check(!safe?.querySelector("image"), "<image> 外部资源被剔除");
check(!safe?.querySelector("foreignObject"), "<foreignObject> 被剔除");
check(!safe?.querySelector("a"), "<a> 外部链接被剔除");
check(
  Array.from(safe?.querySelectorAll("*") ?? []).every((el) =>
    Array.from(el.attributes).every((a) => !/^on/i.test(a.name))
  ),
  "on* 事件属性全部剔除"
);
check(!safe?.outerHTML.includes("javascript:"), "无 javascript: 协议残留");
check(safe?.textContent?.includes("escaped") === true, "转义后的文字内容保留为纯文本");

const broken = sanitizeSvg("<svg><path d=", good.viewBox, 1);
check(broken === null, "无法解析的 SVG 返回 null（阻止注入）");

console.log("F1-4 · 插入主文档（导言区幂等 / 片段组装）");
const LIB_SRC = String.raw`\usetikzlibrary{arrows.meta,angles,quotes}
\usetikzlibrary{calc, angles}
\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}`;
const libs = collectTikzLibraries(LIB_SRC);
check(
  libs.join(",") === "arrows.meta,angles,quotes,calc",
  "\\usetikzlibrary 跨行去重合并"
);
const bareTex = String.raw`\documentclass{article}
\begin{document}
hello
\end{document}`;
const addition = ensureTikzPreamble(bareTex, libs);
check(addition.includes("\\usepackage{tikz}"), "缺 tikz 宏包时补齐");
check(addition.includes("\\usetikzlibrary{arrows.meta,angles,quotes,calc}"), "缺库时补齐");
const patched = insertBeforeDocument(bareTex, addition);
check(ensureTikzPreamble(patched, libs) === "", "补齐后再次计算为空串（幂等）");
check(
  patched.indexOf(addition) < patched.indexOf("\\begin{document}"),
  "导言区片段插在 \\begin{document} 之前"
);
const plainCode = buildDiagramInsertCode(LIB_SRC, false, "", "");
check(plainCode === LIB_SRC.trim(), "不套 figure 时原样插入（仅去首尾空白）");
const figCode = buildDiagramInsertCode(LIB_SRC, true, "  斜面受力  ", "fig:slope");
check(figCode.startsWith("\\begin{figure}[htbp]"), "figure 包裹起始正确");
check(figCode.includes("  \\centering"), "figure 内含 \\centering");
check(figCode.includes("\\caption{斜面受力}"), "caption 去空白生效");
check(figCode.includes("\\label{fig:slope}"), "label 生效");
check(figCode.trimEnd().endsWith("\\end{figure}"), "figure 环境闭合");
check(figCode.includes("  \\begin{tikzpicture}"), "figure 内源码缩进但不改内容");

console.log("F1-6 · 精确预览缓存 / key / data URL");
clearPrecisePreviewCache();
const keyA = previewKey(LIB_SRC, "xelatex");
check(keyA === previewKey(LIB_SRC, "xelatex"), "同源码同引擎 key 稳定");
check(keyA !== previewKey(LIB_SRC + " ", "xelatex"), "源码变化 key 变化");
check(keyA !== previewKey(LIB_SRC, "lualatex"), "引擎变化 key 变化");
const okResult = {
  status: "ok" as const,
  svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
  elapsedMs: 123,
  preambleLines: 6,
  errors: [],
};
setCachedPreview(keyA, { ...okResult, status: "error", svg: undefined });
check(getCachedPreview(keyA) === undefined, "失败结果不进缓存（环境修好后可重试）");
setCachedPreview(keyA, okResult);
check(getCachedPreview(keyA)?.svg === okResult.svg, "成功结果写入并命中缓存");
removeCachedPreview(keyA);
check(getCachedPreview(keyA) === undefined, "手动重编译可定向失效当前 key");
setCachedPreview(keyA, okResult);
for (let i = 0; i < MAX_PREVIEW_CACHE + 2; i += 1) {
  setCachedPreview(previewKey(`src-${i}`, "xelatex"), okResult);
}
check(getCachedPreview(keyA) === undefined, "超出上限后最旧条目被 LRU 淘汰");
clearPrecisePreviewCache();
check(getCachedPreview(keyA) === undefined, "清空缓存生效");
const evilData = svgDataUrl("<svg><script>alert(1)</script></svg>");
check(evilData.startsWith("data:image/svg+xml;charset=utf-8,"), "data URL 前缀正确");
check(!evilData.includes("<script"), "SVG 内容整体编码，无裸标签");
check(decodeURIComponent(evilData.split(",")[1] ?? "").includes("<script>"), "解码后可还原原文");
check(!evilData.includes("\n"), "换行也被编码，不会截断属性");

console.log("F2-1 · 拖拽坐标换算 / 最小源码补丁");
const m2x = { a: 2, b: 0, c: 0, d: 2 };
const dSvg = clientDeltaToSvgDelta(m2x, 20, 10);
check(!!dSvg && dSvg.x === 10 && dSvg.y === 5, "2× 缩放下屏幕位移正确反算为 SVG 位移");
check(clientDeltaToSvgDelta({ a: 0, b: 0, c: 0, d: 0 }, 1, 1) === null, "退化 CTM 返回 null（取消拖拽）");
check(svgDeltaToWorldDelta({ x: 3, y: 4 }).y === -4, "SVG→world 的 Y 轴翻转正确");
const dragVb = { x: -12.4, y: -12.4, width: 110.16, height: 81.71 };
const originSvg = worldToSvgPoint({ x: 0, y: 0 }, dragVb);
check(
  Math.abs(originSvg.x) < 1e-9 &&
    Math.abs(originSvg.y - (2 * dragVb.y + dragVb.height)) < 1e-9,
  "world 原点映射到 SVG 的正确 Y"
);
check(
  worldToSvgPoint({ x: 0, y: 28.45 }, dragVb).y < originSvg.y,
  "world Y 增大时 SVG Y 减小（Y 轴向上）"
);
const patchBefore = String.raw`\draw (1,1) -- (2,2);`;
const patchAfter = String.raw`\draw (1.4,1.2) -- (2,2);`;
const span = singleSpanPatch(patchBefore, patchAfter);
check(
  !!span &&
    patchBefore.slice(0, span.from) + span.insert + patchBefore.slice(span.to) === patchAfter,
  "最小 span 补丁可精确还原新源码"
);
check(!!span && span.to - span.from <= 5, "只替换坐标数字，未整篇替换");
check(singleSpanPatch(patchBefore, patchBefore) === null, "无变化时返回 null");
check(MAX_VISIBLE_HANDLES === 160, "控制点数量上限稳定");
const deltaLabel = dragDeltaLabel(28.45, -14.23);
check(
  deltaLabel.startsWith("Δ ") && deltaLabel.endsWith(" pt") && !deltaLabel.includes("NaN"),
  "拖拽实时位移标签格式正确"
);

console.log("F2-1 · applyDragEdit 真实写回 / 过期句柄 / 锁定判定");
const DRAG_SRC = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (3,2);
  \node[draw] (a) at (1,1) {A};
  \draw[->] (a) -- (2.5,1);
\end{tikzpicture}`;
const dragRender = await renderTikz(DRAG_SRC);
check(Array.isArray(dragRender.handles) && dragRender.handles.length > 0, "渲染结果带语义 editHandles");
const nodeHandle = dragRender.handles.find(
  (h) => h.kind === "node-position" && isDraggableHandle(h)
);
check(!!nodeHandle, "存在可拖的 node-position 控制点");
if (nodeHandle) {
  // 1cm = 28.4527559pt、0.5cm = 14.22637795pt，向上游传 world(pt) 由它反算源码写法
  const target = {
    x: nodeHandle.world.x + 28.4527559,
    y: nodeHandle.world.y + 14.22637795,
  };
  const moved = await applyDragEdit(DRAG_SRC, dragRender.handles, nodeHandle.id, target);
  check(moved.status === "ok", "拖拽节点成功返回新源码");
  if (moved.status === "ok") {
    check(moved.newSource !== DRAG_SRC, "写回后源码确实变化");
    check(typeof moved.replacement === "string" && moved.replacement.startsWith("("), "返回坐标替换文本");
    check(!!singleSpanPatch(DRAG_SRC, moved.newSource), "新旧源码可求最小补丁");
    const rerender = await renderTikz(moved.newSource);
    check(rerender.svg.includes("<path"), "写回后的源码仍可渲染");
    check(rerender.handles.length === dragRender.handles.length, "写回后控制点数量稳定");
    const stale = await applyDragEdit(DRAG_SRC + " ", dragRender.handles, nodeHandle.id, target);
    check(stale.status === "error", "源码在拖拽期间变化会被 sourceFingerprint 拒绝");
  }
  const unknown = await applyDragEdit(DRAG_SRC, dragRender.handles, "handle:no-such", {
    x: 0,
    y: 0,
  });
  check(unknown.status === "error", "未知句柄返回 error 而不是抛异常");
  const named = dragRender.handles.find((h) => h.coordinateForm === "named");
  check(!named || !isDraggableHandle(named), "命名坐标引用默认锁定，不静默脱离引用");
  if (named) check(lockedHandleReason(named).includes("命名"), "锁定控制点给出可读原因");
}

console.log("F2-2 · 属性语句解析 / 可编辑性 / 当前值读取");
const PROP_SRC = String.raw`\begin{tikzpicture}
  % 保留这一行注释
  \draw[thick, blue, ->, dashed] (0,0) rectangle (3,2);
  \node[draw, circle, fill=red!20] (a) at (1,1) {A};
  \draw (2,0) -- (3,1);
\end{tikzpicture}`;
const propRender = await renderTikz(PROP_SRC);
const stmts = propRender.statements;
check(stmts.length === 3, "三条语句（含有 / 无选项）都被归一化");
check(stmts[0]?.id === "path:0" && stmts[0]?.command === "draw", "draw 语句 id / command 正确");
check(stmts[0]?.optionsRaw === "[thick, blue, ->, dashed]", "draw 顶层选项块原文正确");
check(
  stmts[1]?.command === "node" && stmts[1]?.optionsRaw === "[draw, circle, fill=red!20]",
  "node 的选项从 items[].Node.options 取到"
);
check(stmts[2]?.optionsSpan === null && (stmts[2]?.insertOffset ?? -1) > 0, "无选项语句给出插入位置");
check(statementEditability(stmts[0]).editable, "\\draw 可编辑属性");
check(statementEditability(stmts[0]).keys.includes("arrow"), "\\draw 开放箭头属性");
check(
  statementEditability(stmts[1]).editable && !statementEditability(stmts[1]).keys.includes("arrow"),
  "\\node 可编辑但不显示箭头属性"
);
check(readProperty(stmts[0], "lineWidth") === "thick", "读到线宽 thick");
check(readProperty(stmts[0], "stroke") === "blue", "读到裸颜色 blue");
check(readProperty(stmts[0], "arrow") === "->", "读到箭头 ->");
check(readProperty(stmts[0], "dash") === "dashed", "读到线型 dashed");
check(readProperty(stmts[1], "fill") === "red!20", "读到 node 的 fill=red!20");
check(readProperty(stmts[2], "stroke") === null, "未显式设置的属性返回 null");
check(isColorFlag("red!50!white") && isColorFlag("blue!20"), "xcolor 混色写法被识别为颜色");
check(!isColorFlag("thick") && !isColorFlag("dashed"), "线宽 / 线型不会被误判成颜色");

console.log("F2-2 · 最小选项补丁（替换 / 插入 / 移除 / 格式保留）");
const pReplace = planPropertyPatch(PROP_SRC, stmts[0], "lineWidth", "very thick");
check(pReplace.status === "ok", "替换线宽生成补丁");
if (pReplace.status === "ok") {
  const next = applyPatchToSource(PROP_SRC, pReplace.patch);
  check(next.includes("[very thick, blue, ->, dashed]"), "只替换 thick，其余选项原样保留");
  check(pReplace.patch.to - pReplace.patch.from === 5, "补丁跨度恰为 thick 的 5 个字符");
  check(next.split("\n").length === PROP_SRC.split("\n").length, "换行数量不变");
  check(next.includes("% 保留这一行注释"), "注释一字不改");
  const rr = await renderTikz(next);
  check(readProperty(rr.statements[0], "lineWidth") === "very thick", "重渲染后新源码属性已生效");
  check(rr.svg.includes("<path"), "补丁后源码仍可渲染");
}
const pColor = planPropertyPatch(PROP_SRC, stmts[0], "stroke", "red");
check(pColor.status === "ok", "替换裸颜色生成补丁");
if (pColor.status === "ok") {
  const next = applyPatchToSource(PROP_SRC, pColor.patch);
  check(next.includes("[thick, red, ->, dashed]"), "blue → red 保持裸颜色写法");
  const rr = await renderTikz(next);
  check(rr.svg !== propRender.svg, "画布 SVG 随颜色变化（即时反映）");
}
const pInsertNew = planPropertyPatch(PROP_SRC, stmts[2], "stroke", "green");
check(pInsertNew.status === "ok", "无选项语句可插入新选项");
if (pInsertNew.status === "ok") {
  check(pInsertNew.patch.insert === "[green]", "插入完整方括号选项");
  check(
    applyPatchToSource(PROP_SRC, pInsertNew.patch).includes("\\draw[green] (2,0) -- (3,1);"),
    "[green] 精确插在 \\draw 之后"
  );
}
const pAppend = planPropertyPatch(PROP_SRC, stmts[0], "fill", "gray!20");
check(pAppend.status === "ok", "已有选项块可追加新属性");
if (pAppend.status === "ok") {
  check(
    applyPatchToSource(PROP_SRC, pAppend.patch).includes("[thick, blue, ->, dashed, fill=gray!20]"),
    "追加 fill=gray!20 且保留原有逗号风格"
  );
}
const pRemoveLast = planPropertyPatch(PROP_SRC, stmts[0], "dash", null);
check(pRemoveLast.status === "ok", "移除末位选项生成补丁");
if (pRemoveLast.status === "ok") {
  check(
    applyPatchToSource(PROP_SRC, pRemoveLast.patch).includes("[thick, blue, ->]"),
    "移除 dashed 时连前面的逗号一起删掉"
  );
}
const pRemoveMid = planPropertyPatch(PROP_SRC, stmts[0], "stroke", null);
check(pRemoveMid.status === "ok", "移除中间选项生成补丁");
if (pRemoveMid.status === "ok") {
  check(
    applyPatchToSource(PROP_SRC, pRemoveMid.patch).includes("[thick, ->, dashed]"),
    "移除 blue 时连后面的逗号一起删掉"
  );
}
const pRemoveFill = planPropertyPatch(PROP_SRC, stmts[1], "fill", null);
check(
  pRemoveFill.status === "ok" &&
    applyPatchToSource(PROP_SRC, pRemoveFill.patch).includes("[draw, circle]"),
  "node 的 fill=... 可单独移除"
);
check(
  planPropertyPatch(PROP_SRC, stmts[2], "stroke", null).status === "noop",
  "原本就没设置时移除不产生补丁"
);
check(
  planPropertyPatch(PROP_SRC, stmts[0], "lineWidth", "thick").status === "noop",
  "设为当前值不产生补丁"
);

console.log("F2-2 · 歧义 / 锁定 / 过期 / 输入安全");
const AMB_SRC = String.raw`\begin{tikzpicture}
  \draw[thick, line width=1pt] (0,0) -- (1,1);
\end{tikzpicture}`;
const ambRender = await renderTikz(AMB_SRC);
const ambPlan = planPropertyPatch(AMB_SRC, ambRender.statements[0], "lineWidth", "thin");
check(ambPlan.status === "error", "同类选项出现多个时拒绝猜测");
if (ambPlan.status === "error") check(ambPlan.reason.includes("同类选项"), "歧义理由可读");
const FOREACH_SRC = String.raw`\begin{tikzpicture}
  \foreach \x in {1,2} \draw (\x,0) circle (2pt);
\end{tikzpicture}`;
const foreachRender = await renderTikz(FOREACH_SRC);
const foreachStmt = foreachRender.statements.find((s) => s.kind === "Foreach");
check(!!foreachStmt && !statementEditability(foreachStmt).editable, "\\foreach 展开语句被锁定");
if (foreachStmt) {
  check(statementEditability(foreachStmt).reason.includes("foreach"), "锁定理由说明是循环展开");
  check(
    planPropertyPatch(FOREACH_SRC, foreachStmt, "stroke", "red").status === "error",
    "锁定语句不生成补丁"
  );
}
const shifted = "% X\n" + PROP_SRC;
check(
  planPropertyPatch(shifted, stmts[0], "lineWidth", "very thick").status === "error",
  "源码在选择期间变化后旧 span 被拒绝"
);
check(
  planPropertyPatch(PROP_SRC, stmts[2], "stroke", "blue, ->]").status === "error",
  "含 ] / , 的自定义值被拒绝，不写坏选项结构"
);
check(
  planPropertyPatch(PROP_SRC, stmts[2], "stroke", "\\mycolor").status === "error",
  "含反斜杠的自定义值被拒绝"
);
const customWidth = normalizeCustomValue("lineWidth", "1.2pt");
check("value" in customWidth && customWidth.value === "line width=1.2pt", "线宽简写补全为合法 TikZ");
const customColor = normalizeCustomValue("fill", "blue!40");
check("value" in customColor && customColor.value === "blue!40", "自定义混色值通过校验");
check("error" in normalizeCustomValue("arrow", "boom"), "未知箭头样式被拒绝");

// ─────────────────────────────────────────────────────────────────────────────
// F2-3 · 编辑能力锁定（capabilityMatrix / featureUsage → 语句 / 控制点归因）
// ─────────────────────────────────────────────────────────────────────────────
console.log("F2-3 · compat 纯逻辑（注释掩码 / 评级 / 归属）");
check(maskComments("a\\foreach b").length === "a\\foreach b".length, "maskComments 保持索引不变");
const maskedLine = maskComments("% \\foreach \\x in {1,2}\n\\node (a) at (1,1) {A};");
check(!maskedLine.includes("\\foreach"), "注释里的 \\foreach 被掩码掉");
check(maskedLine.includes("\\node"), "下一行代码未被误伤");
check(maskComments("50\\% \\foreach").includes("\\foreach"), "\\% 转义不算注释起点");
const miniMatrix: Record<string, CompatCapabilityRow> = {
  foreach_statement: { edit: "none" },
  foreach_path_operation: { edit: "stable" },
  let_operation: { edit: "none" },
  calc_coordinates: { edit: "partial" },
};
check(readSupport(miniMatrix, ["foreach_statement"]) === "none", "readSupport 读出 none");
check(
  readSupport(miniMatrix, ["foreach_path_operation", "foreach_statement"]) === "none",
  "多个 feature 里只要有一个 none 就按最保守计"
);
check(readSupport(null, ["foreach_statement"]) === "unknown", "矩阵缺失返回 unknown");
check(readUsage({ foreach_statement: "used-supported" }, ["foreach_statement"]) === "used-supported", "readUsage 读出 used-supported");
check(readUsage(null, ["foreach_statement"]) === "unknown", "featureUsage 缺失返回 unknown");
check(effectiveSeverity("warn", "partial", "used-unsupported") === "lock", "used-unsupported 升级为锁定");
check(effectiveSeverity("lock", "stable", "used-supported") === "warn", "上游 stable 降级为提示，不误锁");
check(effectiveSeverity("lock", "none", "used-supported") === "lock", "edit=none 维持锁定");
const nested: CompatStatement[] = [
  { id: "scope:0", span: { from: 0, to: 100 } },
  { id: "path:1", span: { from: 20, to: 60 } },
];
check(owningStatement(nested, 30)?.id === "path:1", "归属取最内层语句");
check(owningStatement(nested, 60)?.id === "scope:0", "span.to 为开区间边界，回落到外层语句");
check(owningStatement(nested, 100) === null, "超出所有语句范围返回 null");
check(owningStatement([], 5) === null, "无语句时返回 null");
check(featureLabel("foreach_statement").includes("foreach"), "feature 中文标签可读");

const C_FOREACH_SRC = String.raw`\begin{tikzpicture}
  \foreach \x in {1,2,3} \draw (\x,0) circle (2pt);
  \node (a) at (1,1) {A};
\end{tikzpicture}`;
const C_FEATURE_USAGE: Record<string, string> = {
  foreach_statement: "used-supported",
  foreach_path_operation: "unused",
  foreach_node_operation: "unused",
  let_operation: "used-unsupported",
  calc_coordinates: "used-supported",
};
const C_FOREACH_STMTS: CompatStatement[] = [
  { id: "foreach:0", kind: "Foreach", span: { from: 22, to: 71 } },
  { id: "path:1", kind: "Path", span: { from: 74, to: 97 } },
];
const C_FOREACH_HANDLES: CompatHandle[] = [
  { id: "h1", sourceRef: { sourceId: "foreach:0", sourceSpan: { from: 51, to: 57 } } },
  { id: "h2", sourceRef: { sourceId: "foreach:0", sourceSpan: { from: 51, to: 57 } } },
  { id: "h3", sourceRef: { sourceId: "foreach:0", sourceSpan: { from: 51, to: 57 } } },
  { id: "h4", sourceRef: { sourceId: "path:1", sourceSpan: { from: 87, to: 92 } } },
];

console.log("F2-3 · buildCompatReport（构造归因 / 不误伤 / 降级）");
const rep = buildCompatReport({
  source: C_FOREACH_SRC,
  statements: C_FOREACH_STMTS,
  handles: C_FOREACH_HANDLES,
  featureUsage: C_FEATURE_USAGE,
  capabilityMatrix: miniMatrix,
  featureIds: Object.keys(C_FEATURE_USAGE),
});
check(rep.issues.some((i) => i.ruleKey === "foreach" && i.statementId === "foreach:0"), "\\foreach 命中并归属到 Foreach 语句");
check(rep.lockReasons["foreach:0"]?.includes("循环") === true, "锁定理由说明是循环展开");
check(!rep.lockReasons["path:1"], "未受影响的 \\node 语句不被误锁");
check(Object.keys(rep.handleReasons).length === 3, "3 个展开控制点全被锁");
check(!rep.handleReasons["h4"], "node 控制点仍可拖，不误伤 F2-1");
check(rep.lockedHandleCount === 3 && rep.lockedStatementCount === 1, "锁定计数正确");
check(rep.summary.includes("3 个控制点"), "摘要含锁定数");
check(allReasonsNonEmpty(rep), "所有锁定理由都非空");
check(rep.issues[0]?.detail.includes("edit=none"), "长说明里带上游能力矩阵评级");
check(rep.hasUnsupported, "used-unsupported 触发还原导向");
check(rep.unsupportedFeatures.some((f) => f.id === "let_operation"), "used-unsupported 构造被收集");

const C_PLAIN_SRC = String.raw`\begin{tikzpicture}
  \draw[thick, rounded corners] (0,0) rectangle (3,2);
  \node[draw, circle] (a) at (1,1) {A};
  \draw[->] (a) -- (2.5,1);
\end{tikzpicture}`;
const plainRep = buildCompatReport({
  source: C_PLAIN_SRC,
  statements: [{ id: "path:0", span: { from: 20, to: 130 } }],
  handles: [{ id: "h", sourceRef: { sourceId: "path:0" } }],
  featureUsage: {
    arrow_tips: "used-supported",
    named_coordinates: "used-supported",
    path_statement: "used-supported",
  },
  capabilityMatrix: { arrow_tips: { edit: "none" }, named_coordinates: { edit: "none" } },
});
check(plainRep.empty, "默认示例图零锁定：edit=none 的箭头 / 命名坐标不误锁");
check(Object.keys(plainRep.handleReasons).length === 0, "默认示例控制点全部可拖");
check(!plainRep.lockReasons["path:0"], "默认示例语句不被锁");

const commentRep = buildCompatReport({
  source: String.raw`\begin{tikzpicture}
  % \foreach \x in {1,2} \draw (\x,0) circle (2pt);
  \node (a) at (1,1) {A};
\end{tikzpicture}`,
  statements: [{ id: "path:0", span: { from: 20, to: 100 } }],
  handles: [],
  featureUsage: { foreach_statement: "used-supported" },
  capabilityMatrix: miniMatrix,
});
check(!commentRep.issues.some((i) => i.ruleKey === "foreach"), "注释里的 \\foreach 不产生锁定");

const calcRep = buildCompatReport({
  source: String.raw`\begin{tikzpicture}\draw ($(a)+(1,0)$) -- (2,2);\end{tikzpicture}`,
  statements: [{ id: "path:0", span: { from: 0, to: 55 } }],
  handles: [{ id: "h", sourceRef: { sourceId: "path:0" } }],
  featureUsage: { calc_coordinates: "used-supported" },
  capabilityMatrix: miniMatrix,
});
check(calcRep.issues.some((i) => i.ruleKey === "calc" && i.severity === "warn"), "calc 表达式只给提示不硬锁");
check(!calcRep.lockReasons["path:0"], "warn 级构造不写入语句锁定表");

const noMeta = buildCompatReport({ source: C_FOREACH_SRC, statements: C_FOREACH_STMTS, handles: C_FOREACH_HANDLES });
check(noMeta.lockReasons["foreach:0"]?.includes("循环") === true, "矩阵 / featureUsage 缺失时仍保守锁定");
const emptyRep = buildCompatReport({ source: "", statements: [], handles: [] });
check(emptyRep.empty && emptyCompatReport().empty, "空源码返回空报告，不抛异常");
check(
  emptyRep.summary === "" && emptyRep.lockedHandleCount === 0,
  "空报告摘要与计数干净"
);

console.log("F2-3 · resolveHandleLock（能力矩阵优先于 rewriteMode 兜底）");
check(
  resolveHandleLock(rep, "h1", true, "F2-1 兜底理由")?.includes("循环") === true,
  "可拖但被能力矩阵锁定时用具体理由"
);
check(
  resolveHandleLock(null, "h", false, "命名坐标兜底") === "命名坐标兜底",
  "无报告时回落到 F2-1 兜底理由"
);
check(resolveHandleLock(null, "h", true, "兜底") === null, "可拖且无报告时不锁");
check(compatHandleReason(rep, "h4", "兜底") === "兜底", "compatHandleReason 未命中时回落");
check(compatHandleReason(rep, "h1", "兜底").includes("循环"), "compatHandleReason 命中时返回具体理由");

console.log("F2-3 · renderTikz 真实接线（compat 随 LRU 缓存同源）");
const compatPlain = await renderTikz(C_PLAIN_SRC);
check(compatPlain.compat.empty, "真实渲染：默认示例零锁定，F2-1/F2-2 无回归");
const compatForeach = await renderTikz(C_FOREACH_SRC);
check(
  compatForeach.compat.lockReasons["foreach:0"]?.includes("循环") === true,
  "真实渲染：\\foreach 语句带 capabilityMatrix 归因理由"
);
check(
  Object.keys(compatForeach.compat.handleReasons).length === 3,
  "真实渲染：3 个展开控制点被锁，避免改写循环变量"
);
check(
  compatForeach.compat.issues[0]?.support === "none",
  "真实渲染：capabilityMatrix.foreach_statement.edit = none"
);
const compatForeachCached = await renderTikz(C_FOREACH_SRC);
check(
  compatForeachCached.fromCache &&
    compatForeachCached.compat.summary === compatForeach.compat.summary,
  "compat 随 LRU 缓存返回，不重复计算"
);
const C_COMPAT_LET = String.raw`\begin{tikzpicture}
  \draw let \p1=(1,1) in (0,0) -- (\x1,\y1);
\end{tikzpicture}`;
const compatLet = await renderTikz(C_COMPAT_LET);
check(compatLet.compat.lockReasons["path:0"]?.includes("let") === true, "真实渲染：let … in 被锁定");
check(
  compatLet.compat.unsupportedFeatures.some((f) => f.id === "let_operation"),
  "真实渲染：used-unsupported 构造被列出，可导向 XeLaTeX"
);
check(allReasonsNonEmpty(compatLet.compat), "真实渲染：所有理由非空");

console.log("F2-4 · planHistoryMerge（连续微调分组边界）");
const H_SRC0 = String.raw`\draw (1,1) -- (2,2);`;
const H_SRC1 = String.raw`\draw (1,1) -- (3,2);`;
const H_SRC2 = String.raw`\draw (1,1) -- (4,2);`;
const H_SRC3 = String.raw`\draw (1,1) -- (5,2);`;
const H_SRC4 = String.raw`\draw (1,1) -- (6,2);`;
const H_SRC5 = String.raw`\draw (1,1) -- (7,2);`;
const p0 = planHistoryMerge(null, "drag:h1", H_SRC0, H_SRC1, 1000);
check(p0.kind === "new" && p0.group.steps === 1, "首次微调开新组");
check(
  p0.group.baseSource === H_SRC0 && p0.group.currentSource === H_SRC1,
  "组内基准 / 当前源码记账正确"
);
check(
  p0.kind === "new" && p0.patch.insert === "3" && p0.patch.to - p0.patch.from === 1,
  "首次补丁仍是最小单点替换，不整篇重写"
);
const p1 = planHistoryMerge(p0.group, "drag:h1", H_SRC1, H_SRC2, 1200);
check(p1.kind === "merge" && p1.patch?.insert === "4", "窗口内同 key 微调并组，补丁从组内基准出发");
check(
  p1.kind === "merge" &&
    p1.replace?.baseSource === H_SRC0 &&
    p1.replace?.currentSource === H_SRC1,
  "并组替换带上基准 / 当前源码供 CM6 校验"
);
check(p1.group.steps === 2, "并组后步数累加");
check(
  planHistoryMerge(p0.group, "drag:h1", H_SRC1, H_SRC2, 1000 + MERGE_WINDOW_MS + 1).kind === "new",
  "超过合并窗口不并组"
);
check(
  planHistoryMerge(p0.group, "drag:h1", H_SRC1, H_SRC2, 999).kind === "new",
  "时间倒退不并组"
);
check(
  planHistoryMerge(p0.group, "prop:path:0:stroke", H_SRC1, H_SRC2, 1200).kind === "new",
  "换对象 / 换属性 key 不并组"
);
check(
  planHistoryMerge(p0.group, "drag:h1", H_SRC0, H_SRC2, 1200).kind === "new",
  "中途源码被外部改动（currentSource 不匹配）绝不并组"
);
const capped: MergeGroup = { ...p0.group, steps: MAX_MERGE_STEPS, currentSource: H_SRC1 };
check(
  planHistoryMerge(capped, "drag:h1", H_SRC1, H_SRC2, 1200).kind === "new",
  "达到步数上限后开新组，避免一次 Ctrl+Z 回退过多"
);
const rewind = planHistoryMerge(p0.group, "drag:h1", H_SRC1, H_SRC0, 1200);
check(
  rewind.kind === "merge" && rewind.patch === null,
  "连续微调恰好回到组内起点时只撤销整组、不新增空历史"
);
const rs: MergeSession = { group: p0.group };
resetMergeSession(rs);
check(rs.group === null, "resetMergeSession 断开合并组");

console.log("F2-4 · commitWithMerge（并组写回 / 逐级降级）");
function makeFake(initial: string) {
  let doc = initial;
  let failReplace = false;
  let failPatch = false;
  const log: string[] = [];
  const applier: HistoryPatchApplier = {
    patch(p, expected) {
      if (failPatch || doc !== expected) {
        failPatch = false;
        log.push("patch-fail");
        return false;
      }
      log.push("patch");
      doc = doc.slice(0, p.from) + p.insert + doc.slice(p.to);
      return true;
    },
    // 模拟真实契约：成功 = undo 回到 base 再重放合并补丁；失败 = 文档保持 current 不变
    replaceLast(p, base, current, target) {
      if (failReplace || doc !== current) {
        failReplace = false;
        log.push("replace-fail");
        return false;
      }
      log.push("replace");
      doc = p === null ? base : base.slice(0, p.from) + p.insert + base.slice(p.to);
      return doc === target;
    },
  };
  return {
    applier,
    log,
    getDoc: () => doc,
    failNextReplace() {
      failReplace = true;
    },
    failNextPatch() {
      failPatch = true;
    },
  };
}

const fake = makeFake(H_SRC0);
const hs: MergeSession = { group: null };
let hNow = 1000;
const hApply = (source: string, nextSource: string, key = "drag:h1") => {
  const out = commitWithMerge(hs, fake.applier, {
    key,
    source,
    nextSource,
    now: hNow,
    fallback: () => undefined,
  });
  hNow += 200;
  return out;
};
hApply(H_SRC0, H_SRC1);
hApply(fake.getDoc(), H_SRC2);
const r3 = hApply(fake.getDoc(), H_SRC3);
check(fake.log.join(",") === "patch,replace,replace", "三次连续微调：1 次新补丁 + 2 次并组替换");
check(fake.getDoc() === H_SRC3 && r3.written && r3.merged, "并组后文档等于最新源码，一次 Ctrl+Z 回到组内起点");
check(hs.group?.baseSource === H_SRC0 && hs.group?.steps === 3, "会话基准始终是组内起点");
const r4 = hApply(fake.getDoc(), H_SRC4, "prop:path:0:stroke");
check(fake.log[fake.log.length - 1] === "patch" && !r4.merged, "换 key 后另起一组");
resetMergeSession(hs);
hApply(fake.getDoc(), H_SRC5);
check(fake.log[fake.log.length - 1] === "patch", "撤销 / 重做后会话失效，下一次微调新开一组");

const fakeTimeout = makeFake(H_SRC0);
const hsTimeout: MergeSession = { group: null };
commitWithMerge(hsTimeout, fakeTimeout.applier, {
  key: "drag:h1", source: H_SRC0, nextSource: H_SRC1, now: 1000, fallback: () => undefined,
});
const rTimeout = commitWithMerge(hsTimeout, fakeTimeout.applier, {
  key: "drag:h1", source: H_SRC1, nextSource: H_SRC2,
  now: 1000 + MERGE_WINDOW_MS + 1, fallback: () => undefined,
});
check(
  fakeTimeout.log.join(",") === "patch,patch" && !rTimeout.merged,
  "超窗口的两次微调各自独立成一条 history"
);

const fakeFail = makeFake(H_SRC0);
const hsFail: MergeSession = { group: null };
commitWithMerge(hsFail, fakeFail.applier, {
  key: "drag:h1", source: H_SRC0, nextSource: H_SRC1, now: 1000, fallback: () => undefined,
});
fakeFail.failNextReplace();
const rFail = commitWithMerge(hsFail, fakeFail.applier, {
  key: "drag:h1", source: H_SRC1, nextSource: H_SRC2, now: 1200, fallback: () => undefined,
});
check(
  fakeFail.log.join(",") === "patch,replace-fail,patch" && rFail.written && !rFail.merged,
  "并组替换失败（历史顶端不是本组）后回滚并降级为独立一步"
);
check(fakeFail.getDoc() === H_SRC2 && hsFail.group?.steps === 1, "降级后文档与会话状态一致");

let fallbackCalls = 0;
const rDeg = commitWithMerge({ group: null }, null, {
  key: "k", source: H_SRC0, nextSource: H_SRC1, now: 1,
  fallback: () => { fallbackCalls += 1; },
});
check(rDeg.degraded && !rDeg.written && fallbackCalls === 1, "源码栏未就绪时整篇降级且明确标记");
const fakeStale = makeFake(H_SRC0);
fakeStale.failNextPatch();
const rStale = commitWithMerge({ group: null }, fakeStale.applier, {
  key: "k", source: H_SRC0, nextSource: H_SRC1, now: 1,
  fallback: () => { fallbackCalls += 1; },
});
check(rStale.degraded && fallbackCalls === 2, "CM6 拒绝过期补丁时降级写回，不静默丢改动");
const fakeNoop = makeFake(H_SRC0);
const rNoop = commitWithMerge({ group: null }, fakeNoop.applier, {
  key: "k", source: H_SRC0, nextSource: H_SRC0, now: 1, fallback: () => undefined,
});
check(
  !rNoop.written && !rNoop.degraded && fakeNoop.log.length === 0,
  "源码无变化时不入 history 也不降级"
);
const fakeCap = makeFake(H_SRC0);
const hsCap: MergeSession = { group: null };
for (let i = 1; i <= MAX_MERGE_STEPS + 1; i += 1) {
  const next = H_SRC0.replace("2,2", `${2 + i},2`);
  commitWithMerge(hsCap, fakeCap.applier, {
    key: "drag:h1", source: fakeCap.getDoc(), nextSource: next,
    now: 1000 + i * 100, fallback: () => undefined,
  });
}
check(
  fakeCap.log.filter((s) => s === "patch").length === 2,
  "超过 MAX_MERGE_STEPS 自动开新组，防止一次撤销回退过长历史"
);

console.log("F2-4 · resolveHistoryShortcut（全局撤销键判定）");
const H_OK: HistoryKeyContext = {
  tabVisible: true, dragging: false, inCodeMirror: false, inTextInput: false, dialogOpen: false,
};
const hkey = (over: Partial<HistoryKeyLike> = {}): HistoryKeyLike => ({
  key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
  defaultPrevented: false, ...over,
});
check(resolveHistoryShortcut(hkey(), H_OK) === "undo", "Ctrl+Z → 撤销");
check(resolveHistoryShortcut(hkey({ ctrlKey: false, metaKey: true }), H_OK) === "undo", "Cmd+Z → 撤销");
check(resolveHistoryShortcut(hkey({ shiftKey: true }), H_OK) === "redo", "Ctrl+Shift+Z → 重做");
check(resolveHistoryShortcut(hkey({ key: "y" }), H_OK) === "redo", "Ctrl+Y → 重做");
check(resolveHistoryShortcut(hkey({ key: "Z" }), H_OK) === "undo", "大写 Z（CapsLock）不漏判");
check(resolveHistoryShortcut(hkey({ ctrlKey: false, metaKey: false }), H_OK) === null, "无修饰键不接管");
check(resolveHistoryShortcut(hkey({ altKey: true }), H_OK) === null, "Alt 组合不接管");
check(resolveHistoryShortcut(hkey({ defaultPrevented: true }), H_OK) === null, "已被处理的事件不重复接管");
check(resolveHistoryShortcut(hkey({ key: "a" }), H_OK) === null, "Ctrl+A 等其它快捷键不接管");
check(resolveHistoryShortcut(hkey({ key: "y", shiftKey: true }), H_OK) === null, "Ctrl+Shift+Y 不误判重做");
check(resolveHistoryShortcut(hkey(), { ...H_OK, tabVisible: false }) === null, "绘图 Tab 未激活不抢主文档 Ctrl+Z");
check(resolveHistoryShortcut(hkey(), { ...H_OK, dragging: true }) === null, "拖拽中不打断指针会话");
check(resolveHistoryShortcut(hkey(), { ...H_OK, inCodeMirror: true }) === null, "焦点在 CM6 交回 historyKeymap");
check(resolveHistoryShortcut(hkey(), { ...H_OK, inTextInput: true }) === null, "文本框内归还浏览器撤销");
check(resolveHistoryShortcut(hkey(), { ...H_OK, dialogOpen: true }) === null, "模态对话框打开时不接管");

console.log("F2-4 · shouldHandleHistoryKey（真实 DOM 上下文）");
(globalThis as unknown as { Element: unknown }).Element = (dom.window as unknown as { Element: unknown }).Element;
const host = g.document.getElementById("host")!;
const mkKey = (target: Element, over: Record<string, unknown> = {}): KeyboardEvent =>
  ({
    key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false, target, ...over,
  }) as unknown as KeyboardEvent;
host.innerHTML = '<div class="cm-editor"><div contenteditable="true"></div></div>';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector("[contenteditable]")!), true, false) === null,
  "焦点在隐藏 / 可见 CM6 内都交回编辑器，不重复撤销"
);
host.innerHTML = '<input type="text" />';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector("input")!), true, false) === null,
  "caption 等文本框内按 Ctrl+Z 只撤销输入"
);
host.innerHTML = '<select><option>blue</option></select>';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector("select")!), true, false) === "undo",
  "属性下拉上按 Ctrl+Z 撤销刚才的绘图改动"
);
host.innerHTML = '<div class="modal-layer" role="dialog"></div>';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector(".modal-layer")!), true, false) === null,
  "模态框（.modal-layer）打开时不抢快捷键"
);
host.innerHTML = '<div class="modal sm" role="dialog"></div>';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector(".modal")!), true, false) === null,
  "内层 .modal[role=dialog] 形式的对话框也能识别"
);
// 项目里 role="dialog" 还用于常驻非模态面板，绝不能因此让全局撤销键永远失效
host.innerHTML = '<div class="math-prefs" role="dialog"></div>';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector(".math-prefs")!), true, false) === "undo",
  "公式模块常驻 .math-prefs[role=dialog] 不误判为模态框"
);
host.innerHTML = '<div class="ref-preview" role="dialog"></div>';
check(
  shouldHandleHistoryKey(mkKey(host.querySelector(".ref-preview")!), true, false) === "undo",
  "引用预览卡等浮动面板不误判为模态框"
);
host.innerHTML = '<div class="dg-canvas"></div>';
const canvasEl = host.querySelector(".dg-canvas")!;
check(
  shouldHandleHistoryKey(mkKey(canvasEl), true, false) === "undo",
  "仅画布布局（CM6 无焦点）由全局快捷键接管撤销"
);
check(
  shouldHandleHistoryKey(mkKey(canvasEl, { shiftKey: true }), true, false) === "redo",
  "仅画布布局下 Ctrl+Shift+Z 接管重做"
);
check(
  shouldHandleHistoryKey(mkKey(canvasEl), false, false) === null,
  "切到 .tex / PDF 后不抢主文档的撤销栈"
);

// ── F3-1 · 基础图元工具 ────────────────────────────────────────────────────
const S_CM = TIKZ_PT_PER_CM;
const S_P = (x: number, y: number) => ({ x, y });

console.log("\nF3-1 · 单位换算与数值格式化（探针实测 1cm = 28.4527559055pt）");
check(Math.abs(S_CM - 28.45275590551181) < 1e-9, "TIKZ_PT_PER_CM 与 TeX 定义一致");
check(Math.abs(ptToCm(S_CM) - 1) < 1e-9, "28.4528pt → 1cm");
check(fmtTikzNumber(0) === "0" && fmtTikzNumber(-0.001) === "0", "整数不带小数、-0 归一为 0");
check(fmtTikzNumber(1.234) === "1.23" && fmtTikzNumber(-2.5) === "-2.5", "保留 2 位小数、负数正常");
check(fmtTikzNumber(NaN) === "0" && fmtTikzNumber(Infinity) === "0", "非法数值兜底为 0");
check(fmtCoord(S_P(0, S_CM)) === "(0,1)", "world pt 点 → TikZ 坐标 (0,1)");
check(fmtCoord(S_P(S_CM * 1.41, S_CM * 2.11)) === "(1.41,2.11)", "小数 cm 坐标格式干净");
check(fmtLength(S_CM * 0.75) === "0.75", "半径 / 轴长换算为 cm 数值");
check(
  !/[{}%\\\n]/.test(sanitizeNodeText("中文{a}\\b%c\n")) && sanitizeNodeText("中文{a}\\b%c\n").includes("中文"),
  "文本节点去掉破坏源码的字符、保留中文"
);
check(sanitizeNodeText("{}%\\") === "text" && sanitizeNodeText("x".repeat(80)).length === 40,
  "文本节点空值兜底 + 40 字截断");

console.log("F3-1 · 九类形状语句生成");
const S_LINE = buildShapeStatement("line", [S_P(0, 0), S_P(2 * S_CM, S_CM)]);
check(S_LINE.ok && S_LINE.statement === String.raw`\draw (0,0) -- (2,1);`, "直线语句");
const S_ARROW = buildShapeStatement("arrowLine", [S_P(0, 0), S_P(2 * S_CM, S_CM)]);
check(S_ARROW.ok && S_ARROW.statement === String.raw`\draw[->] (0,0) -- (2,1);`, "带箭头直线语句");
const S_RECT = buildShapeStatement("rectangle", [S_P(0, 0), S_P(2 * S_CM, S_CM)]);
check(S_RECT.ok && S_RECT.statement === String.raw`\draw (0,0) rectangle (2,1);`, "矩形语句");
const S_RECT_S = buildShapeStatement("rectangle", [S_P(0, 0), S_P(3 * S_CM, S_CM)], { shift: true });
check(S_RECT_S.ok && S_RECT_S.statement.endsWith("rectangle (3,3);"), "Shift 矩形约束为正方形");
const S_CIRCLE = buildShapeStatement("circle", [S_P(0, 0), S_P(2 * S_CM, 0)]);
check(S_CIRCLE.ok && S_CIRCLE.statement === String.raw`\draw (0,0) circle (2);`, "圆：圆心拖出半径");
const S_CIRCLE_S = buildShapeStatement("circle", [S_P(0, 0), S_P(2 * S_CM, S_CM)], { shift: true });
check(S_CIRCLE_S.ok && S_CIRCLE_S.statement === String.raw`\draw (1,1) circle (1);`, "Shift 圆：从边界起算的正圆");
const S_ELL = buildShapeStatement("ellipse", [S_P(0, 0), S_P(2 * S_CM, S_CM)]);
check(S_ELL.ok && S_ELL.statement === String.raw`\draw (1,0.5) ellipse (1 and 0.5);`, "椭圆：对角拖拽求中心与双轴");
const S_ELL_S = buildShapeStatement("ellipse", [S_P(0, 0), S_P(2 * S_CM, S_CM)], { shift: true });
check(S_ELL_S.ok && S_ELL_S.statement.endsWith("ellipse (1 and 1);"), "Shift 椭圆约束为正圆");
const S_POLY = buildShapeStatement("polygon", [S_P(0, 0), S_P(S_CM, S_CM), S_P(2 * S_CM, 0)]);
check(S_POLY.ok && S_POLY.statement === String.raw`\draw (0,0) -- (1,1) -- (2,0) -- cycle;`, "多边形以 -- cycle 闭合");
const S_POLYLINE = buildShapeStatement("polyline", [S_P(0, 0), S_P(2 * S_CM, S_CM)]);
check(S_POLYLINE.ok && S_POLYLINE.statement === String.raw`\draw (0,0) -- (2,1);`, "折线不闭合");
const S_ARC = buildShapeStatement("arc", [S_P(S_CM, 0), S_P(0, 0), S_P(0, S_CM)]);
check(S_ARC.ok && S_ARC.statement === String.raw`\draw (1,0) arc (0:90:1);`, "圆弧：起点 / 圆心 / 终止角");
const S_ARC_REV = buildShapeStatement("arc", [S_P(S_CM, 0), S_P(0, 0), S_P(0, -S_CM)]);
check(S_ARC_REV.ok && S_ARC_REV.statement === String.raw`\draw (1,0) arc (0:270:1);`, "圆弧角度按逆时针归一到 0–360");
check(arcSweepDegrees(S_P(S_CM, 0), S_P(0, 0), S_P(0, S_CM)) === 90, "预览弧角度与语句一致");
const S_DOT = buildShapeStatement("dot", [S_P(S_CM, 2 * S_CM)]);
check(S_DOT.ok && S_DOT.statement === String.raw`\node[circle,fill] at (1,2) {};`, "圆点节点");
const S_TEXT = buildShapeStatement("text", [S_P(S_CM, 2 * S_CM)], { text: "hello" });
check(S_TEXT.ok && S_TEXT.statement === String.raw`\node at (1,2) {hello};`, "文本节点");
const S_TEXT_DEF = buildShapeStatement("text", [S_P(0, 0)]);
check(S_TEXT_DEF.ok && S_TEXT_DEF.statement.includes("{text}"), "文本节点默认占位文本");
check(!buildShapeStatement("select", [S_P(0, 0)]).ok, "选择工具不生成语句");
check(!buildShapeStatement("rectangle", [S_P(0, 0)]).ok, "拖拽类工具点数不足时拒绝");
check(!buildShapeStatement("line", [S_P(0, 0), S_P(0, 0)]).ok, "拖拽距离过小时拒绝");
check(!buildShapeStatement("polygon", [S_P(0, 0), S_P(S_CM, 0)]).ok, "多边形少于 3 点时拒绝");
check(!buildShapeStatement("line", [S_P(NaN, 0), S_P(1, 1)]).ok, "非法坐标拒绝");

console.log("F3-1 · 插入点 / 最小补丁 / 自动选中");
const S_BASE = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (3,2);
\end{tikzpicture}`;
const S_PT = findInsertionPoint(S_BASE);
check(S_PT.mode === "inside" && S_PT.indent === "  ", "完整环境：插在 \\end 行前且沿用正文缩进");
check(S_BASE.slice(S_PT.at).startsWith(String.raw`\end{tikzpicture}`), "插入点正好是 \\end 行首");
const S_INS = insertShapeStatement(S_BASE, S_RECT.ok ? S_RECT.statement : "");
check(S_INS.mode === "inside" && S_INS.note === null, "完整环境无需补结尾、无额外说明");
check(
  S_INS.source.slice(S_INS.selection.from, S_INS.selection.to) === (S_RECT.ok ? S_RECT.statement : ""),
  "selection 精确覆盖新语句"
);
const S_MIN = singleSpanPatch(S_BASE, S_INS.source);
check(!!S_MIN && S_MIN.from === S_PT.at && S_MIN.to === S_PT.at, "插入是单点纯插入补丁，其余源码零改动");
check(S_INS.source.includes(S_BASE.split("\n")[1]), "原有语句一字不动");
const S_INS2 = insertShapeStatement(S_INS.source, S_ARROW.ok ? S_ARROW.statement : "");
check(S_INS2.source.includes(S_RECT.ok ? S_RECT.statement : "") && S_INS2.source.includes(S_ARROW.ok ? S_ARROW.statement : ""), "连续插入两条形状互不覆盖");
check((S_INS2.source.match(/\\end\{tikzpicture\}/g) ?? []).length === 1, "连续插入不会重复补 \\end");
const S_OPEN = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);`;
const S_PT_OPEN = findInsertionPoint(S_OPEN);
const S_INS_OPEN = insertShapeStatement(S_OPEN, S_LINE.ok ? S_LINE.statement : "");
check(S_PT_OPEN.mode === "append" && S_INS_OPEN.source.includes(String.raw`\end{tikzpicture}`) && !!S_INS_OPEN.note, "残缺源码自动补齐环境结尾并给出说明");
const S_EMPTY_PT = findInsertionPoint("  \n ");
const S_INS_EMPTY = insertShapeStatement("", S_RECT.ok ? S_RECT.statement : "");
check(S_EMPTY_PT.mode === "wrap" && S_INS_EMPTY.mode === "wrap" && !!S_INS_EMPTY.note, "空白源码直接生成完整 tikzpicture 环境");
check(S_INS_EMPTY.source.startsWith(String.raw`\begin{tikzpicture}`) && S_INS_EMPTY.source.endsWith(String.raw`\end{tikzpicture}`), "wrap 产物自包含");
check(S_INS_EMPTY.source.slice(S_INS_EMPTY.selection.from, S_INS_EMPTY.selection.to) === (S_RECT.ok ? S_RECT.statement : ""), "wrap 模式 selection 仍精确覆盖语句");
check(pickInsertedStatementId([{ id: "path:1", span: { from: 10, to: 40 } }], { from: 5, to: 50 }) === "path:1", "按 span 命中新语句 id");
check(pickInsertedStatementId([{ id: "path:0", span: { from: 0, to: 4 } }], { from: 10, to: 40 }) === null, "区间外的旧语句不会被误选中");
check(pickInsertedStatementId([], { from: 0, to: 10 }) === null, "空语句清单安全返回 null");

console.log("F3-1 · 工具定义与多点会话状态机");
check(TOOL_DEFS.length === 11 && new Set(TOOL_DEFS.map((d) => d.id)).size === 11, "11 个工具定义且 id 唯一（选择 + 9 类图元 + 箭头线）");
check(DEFAULT_TOOL_MODE === "select" && isToolMode("rectangle") && !isToolMode("bogus") && !isToolMode(null), "默认工具与 localStorage 白名单校验");
check(toolDef("arc").exactPoints === 3 && toolDef("polygon").exactPoints === null, "圆弧固定三点、多边形点数开放");
let S_SESS = createShapeSession("polygon");
S_SESS = addShapePoint(S_SESS, S_P(0, 0));
S_SESS = addShapePoint(S_SESS, S_P(S_CM, 0));
check(!canFinishShape(S_SESS) && S_SESS.points.length === 2, "多边形 2 点还不能闭合");
S_SESS = addShapePoint(S_SESS, S_P(S_CM, S_CM));
check(canFinishShape(S_SESS), "多边形 3 点可闭合");
check(popShapePoint(S_SESS).points.length === 2, "Backspace 退一点");
check(addShapePoint(S_SESS, S_P(NaN, 0)).points.length === S_SESS.points.length, "非法点不会进入会话");
check(shapeSessionHint(S_SESS).includes("双击 / Enter 闭合") && shapeSessionHint(S_SESS).includes("Esc"), "会话提示常驻说明闭合 / 取消方式");
let S_ARC_SESS = createShapeSession("arc");
S_ARC_SESS = addShapePoint(S_ARC_SESS, S_P(0, 0));
S_ARC_SESS = addShapePoint(S_ARC_SESS, S_P(S_CM, 0));
check(!isShapeComplete(S_ARC_SESS), "圆弧 2 点不自动提交");
S_ARC_SESS = addShapePoint(S_ARC_SESS, S_P(0, S_CM));
check(isShapeComplete(S_ARC_SESS) && addShapePoint(S_ARC_SESS, S_P(1, 1)).points.length === 3, "圆弧集满 3 点自动完成且不再加点");
let S_MANY = createShapeSession("polyline");
for (let i = 0; i < MAX_SHAPE_POINTS + 6; i++) S_MANY = addShapePoint(S_MANY, S_P(i, i));
check(S_MANY.points.length === MAX_SHAPE_POINTS, "多点工具有点数上限，避免画布被拖垮");

console.log("F3-1 · 屏幕绝对坐标反算");
const S_IDM = { a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 };
const S_Q1 = clientToSvgPoint(S_IDM, 110, 60);
check(!!S_Q1 && S_Q1.x === 10 && S_Q1.y === 10, "含 e/f 平移的绝对点换算（相对位移算法会漏掉平移）");
const S_Q2 = clientToSvgPoint({ a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }, 120, 70);
check(!!S_Q2 && S_Q2.x === 10 && S_Q2.y === 10, "缩放矩阵下的绝对点换算");
const S_Q3 = clientToSvgPoint({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, 10, 20);
check(!!S_Q3 && S_Q3.x === 20 && S_Q3.y === -10, "旋转 / 剪切矩阵也能求逆");
check(clientToSvgPoint({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 1, 2) === null, "退化矩阵返回 null 供调用方取消");
const S_VB = { x: -12, y: -12, width: 124, height: 124 };
const S_WP = { x: S_CM, y: S_CM * 2 };
const S_BACK = svgToWorldPoint(worldToSvgPoint(S_WP, S_VB), S_VB);
check(Math.abs(S_BACK.x - S_WP.x) < 1e-9 && Math.abs(S_BACK.y - S_WP.y) < 1e-9, "world ↔ SVG 绝对点互逆（viewBox 非 0 起点）");

console.log("F3-1 · 真实引擎接线：九类语句可渲染 / 可写回 / 自动选中 / 不误锁");
const S_STMTS: { label: string; statement: string }[] = [
  S_LINE, S_ARROW, S_RECT, S_CIRCLE, S_ELL, S_POLY, S_POLYLINE, S_ARC, S_DOT, S_TEXT,
].filter((r): r is { ok: true; statement: string; label: string } => r.ok).map((r) => ({ label: r.label, statement: r.statement }));
check(S_STMTS.length === 10, "九类图元 + 箭头线全部生成成功");
for (const item of S_STMTS) {
  const rr = await renderTikz(`\\begin{tikzpicture}\n  ${item.statement}\n\\end{tikzpicture}`);
  check(
    rr.statements.length > 0 && rr.svg.includes("data-source-id") && !rr.diagnostics.some((d) => d.severity === "error"),
    `${item.label}：上游可解析 / 有 data-source-id / 无 error 诊断`
  );
}
const S_END = await renderTikz(S_INS.source);
const S_NEW_ID = pickInsertedStatementId(S_END.statements, S_INS.selection);
check(!!S_NEW_ID && S_END.svg.includes(`data-source-id="${S_NEW_ID}"`), "插入后按 span 自动选中新语句（id 与 SVG 一致）");
check(S_END.compat.empty === true, "新插入的基础图元不会被 F2-3 能力矩阵误锁");
const S_NEW_HANDLE = S_END.handles.find(
  (h) => h.sourceRef?.sourceId === S_NEW_ID && (h.rewriteMode === "direct" || h.rewriteMode === "delta")
);
check(!!S_NEW_HANDLE, "新形状立即产生可拖拽控制点");
if (S_NEW_HANDLE) {
  const S_MOVED = await applyDragEdit(S_INS.source, S_END.handles, S_NEW_HANDLE.id, {
    x: S_NEW_HANDLE.world.x + S_CM,
    y: S_NEW_HANDLE.world.y + S_CM,
  });
  check(S_MOVED.status === "ok" && S_MOVED.newSource !== S_INS.source, "新形状的控制点可立即拖拽写回（F2-1 无回归）");
}

// ── F3-2 · 控制点视觉与命中（纯数值 + jsdom 真实 DOM 结构） ─────────────────
console.log("\n[F3-2] 控制点视觉与命中");

check(DEFAULT_HANDLE_SIZE === "medium", "默认控制点档位为中（比 F2-1 的 4.2px 小）");
check(LOCK_BASE_PX === 10, "F2-3 挂锁基准为屏幕 10px 见方，不随节点档位缩小");
check(isHandleSize("small") && isHandleSize("medium") && isHandleSize("large"), "节点档位白名单识别三档");
check(!isHandleSize("huge") && !isHandleSize(null) && !isHandleSize(3), "节点档位拒绝非法值（防手改 localStorage）");
check(
  (Object.keys(HANDLE_SIZE_LABELS) as HandleSize[]).length === 3 &&
    HANDLE_SIZE_LABELS.medium === "中",
  "三档中文标签齐全"
);
check(handleSizeSummary("small").includes("2.6px") && handleSizeSummary("small").includes("9px"), "档位摘要含视觉与命中两套尺寸");

const H_SIZES: HandleSize[] = ["small", "medium", "large"];
check(
  H_SIZES.every((s) => {
    const p = HANDLE_SIZE_SPECS[s];
    return p.hitR >= p.visualR * 2 && p.hitR >= 9;
  }),
  "三档命中半径均 ≥ 2× 视觉半径且不小于 9px（小而好点）"
);
check(HANDLE_SIZE_SPECS.medium.visualR < 4.2, "默认视觉半径确实小于 F2-1 的 4.2px（用户反馈「节点太大」）");
check(
  HANDLE_SIZE_SPECS.small.visualR < HANDLE_SIZE_SPECS.medium.visualR &&
    HANDLE_SIZE_SPECS.medium.visualR < HANDLE_SIZE_SPECS.large.visualR,
  "三档视觉半径单调递增，large 回到旧尺寸供习惯旧手感的用户"
);

const H_M05 = handleMetrics("medium", 0.5);
const H_M1 = handleMetrics("medium", 1);
const H_M2 = handleMetrics("medium", 2);
const H_KEYS = [
  "visualR", "hitR", "stroke", "lockOffset", "boxStroke", "boxCorner", "boxPad",
] as const;
check(
  H_KEYS.every(
    (k) => Math.abs(H_M05[k] * 0.5 - H_M1[k]) < 1e-9 && Math.abs(H_M2[k] * 2 - H_M1[k]) < 1e-9,
  ),
  "单位比 0.5–2 下所有手柄 / 包围盒尺寸的屏幕像素量恒定"
);
check(
  H_M1.visualR === 3.3 && H_M1.hitR === 10 && H_M1.lockOffset === 15,
  "medium@单位比 1 的数值：视觉 3.3 / 命中 10 / 挂锁上移 15（命中+余量）"
);
check(H_M1.lockScale === 1, "挂锁缩放系数恒为 1，理由图标不会随节点缩小而看不清");
const H_BAD = handleMetrics("bogus" as HandleSize, 0);
check(
  H_BAD.size === "medium" && H_BAD.unitScale === 1 && H_KEYS.every((k) => Number.isFinite(H_BAD[k]) && H_BAD[k] > 0),
  "非法档位 / 零单位比降级为 medium@1，绝不产出 NaN / Infinity 打进 SVG 属性"
);

// ── F3-2 后续修复：viewBox→px 的比例不能漏乘 ───────────────────────────────
// 用户第二次反馈「控制点还是太大」：旧口径把屏幕 px 只除以 UI zoom（截图是 100%），
// 但 SVG viewBox 124 单位被 width:100% 铺进约 400px 画布 → 1 单位 ≈ 3.2 屏幕 px，
// 于是「3.3px 半径」实际显示成约 21px 直径。以下断言锁死这条换算链。
const H_VB = { width: 124, height: 124 };
check(unitScaleFromCtm({ a: 3.2, b: 0, c: 0, d: 3.2, e: 240, f: 180 }) === 3.2, "CTM 行列式平方根给出真实单位比（平移 e/f 不影响）");
check(unitScaleFromCtm({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }) === null, "退化 CTM 返回 null，交由布局回退");
check(unitScaleFromCtm(null) === null && unitScaleFromCtm({ a: NaN, b: 0, c: 0, d: 2, e: 0, f: 0 }) === null, "缺失 / 非有限 CTM 返回 null");
check(Math.abs((unitScaleFromRect({ width: 400, height: 400 }, H_VB, 1) ?? 0) - 400 / 124) < 1e-9, "布局回退按 preserveAspectRatio=meet 取 min(宽比, 高比)");
check(Math.abs((unitScaleFromRect({ width: 400, height: 400 }, H_VB, 2) ?? 0) - 800 / 124) < 1e-9, "stage 回退要乘 UI zoom（svg width = zoom × stage）");
check(unitScaleFromRect({ width: 0, height: 0 }, H_VB, 1) === null, "零尺寸布局（Tab 隐藏 / jsdom）返回 null");
check(unitScaleFromRect({ width: 400, height: 400 }, { width: 0, height: 124 }, 1) === null, "零宽 viewBox 返回 null，不产出 Infinity");
check(
  svgUnitScale(
    { isConnected: true, getScreenCTM: () => ({ a: 3.2, b: 0, c: 0, d: 3.2, e: 1, f: 2 }), getBoundingClientRect: () => ({ width: 400, height: 400 }) },
    H_VB, 1, { width: 400, height: 400 },
  ) === 3.2,
  "已挂载 SVG 优先用 CTM 实测值，不再依赖 UI zoom 猜测"
);
check(
  Math.abs(svgUnitScale({ isConnected: true, getBoundingClientRect: () => ({ width: 400, height: 400 }) }, H_VB, 1) - 400 / 124) < 1e-9,
  "CTM 不可用时回退 svg 自身 rect（已含 zoom，故不再重复乘）"
);
check(
  Math.abs(
    svgUnitScale(
      { isConnected: true, getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), getBoundingClientRect: () => ({ width: 400, height: 400 }) },
      H_VB, 1,
    ) - 400 / 124,
  ) < 1e-9,
  "CTM 与布局相差过大（某些环境不含 viewBox 变换）时以布局为准，不退回放大 3 倍的老 bug"
);
check(
  Math.abs(svgUnitScale({ isConnected: false }, H_VB, 2, { width: 400, height: 400 }) - 800 / 124) < 1e-9,
  "SVG 未挂载时回退 stage rect × zoom"
);
check(svgUnitScale(null, H_VB, 1) === 1, "全部测量手段失效时降级为 1（旧口径），绝不产出 NaN 打进 SVG 属性");
const H_REAL = handleMetrics("medium", 3.2);
check(
  Math.abs(H_REAL.visualR * 3.2 - 3.3) < 1e-9 && Math.abs(H_REAL.hitR * 3.2 - 10) < 1e-9,
  "真实比例 3.2 下：视觉半径 3.3px / 命中半径 10px 都是**屏幕**尺寸，不再被放大 3.2 倍"
);
check(Math.abs(H_REAL.visualR * 2 * 3.2 - 6.6) < 1e-9, "修复后默认控制点屏幕直径 6.6px（用户截图里的 21px 是漏乘比例所致）");
check(Math.abs(H_REAL.hitR * 2 * 3.2 - 20) < 1e-9, "命中圈屏幕直径 20px 且完全透明，视觉不变但更好点中");
check(Math.abs(H_REAL.boxCorner * 3.2 - 6) < 1e-9 && Math.abs(H_REAL.boxStroke * 3.2 - 1.2) < 1e-9, "包围盒角块 6px / 虚线 1.2px 也按实测比例回到屏幕尺寸");

check(
  JSON.stringify(unionBoxes([{ x: 0, y: 0, width: 10, height: 5 }, { x: -2, y: 3, width: 4, height: 8 }])) ===
    JSON.stringify({ x: -2, y: 0, width: 12, height: 11 }),
  "包围盒并集取外接矩形（多段路径同属一个 sourceId 时求整体）"
);
const H_ZERO = unionBoxes([null, { x: 4, y: 4, width: 0, height: 0 }]);
check(!!H_ZERO && H_ZERO.width === 0 && H_ZERO.height === 0, "零宽高的真实直线 bbox 不被丢弃（由 padBox 撑出可见框）");
check(
  unionBoxes([null, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: -1, height: 2 }]) === null,
  "非有限值 / 负尺寸 / 空输入一律返回 null，不画 NaN 框"
);
const H_PAD = padBox({ x: 0, y: 0, width: 10, height: 0 }, 3);
check(
  H_PAD.x === -3 && H_PAD.y === -3 && H_PAD.width === 16 && H_PAD.height === 6,
  "padBox 给零高度直线撑出可见厚度且四边等量外扩"
);
const H_CORNERS = selectionCorners({ x: 10, y: 20, width: 30, height: 10 }, 6);
check(
  H_CORNERS.length === 4 &&
    H_CORNERS[0].x === 7 && H_CORNERS[0].y === 17 &&
    H_CORNERS[2].x === 37 && H_CORNERS[2].y === 27,
  "四角小方块以角点为中心、边长按恒屏尺寸给出"
);

const H_CTM = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
const H_BOX = clientRectToSvgBox({ left: 110, top: 70, right: 150, bottom: 110 }, H_CTM);
check(
  !!H_BOX && H_BOX.x === 5 && H_BOX.y === 10 && H_BOX.width === 20 && H_BOX.height === 20,
  "clientRectToSvgBox 完整仿射逆含 e/f 平移（2× 缩放 + 页面偏移被抵消）"
);
check(
  clientRectToSvgBox({ left: 0, top: 0, right: 1, bottom: 1 }, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }) === null,
  "退化矩阵返回 null，调用方不画包围盒"
);
check(
  clientRectToSvgBox({ left: NaN, top: 0, right: 1, bottom: 1 }, H_CTM) === null,
  "非有限屏幕矩形返回 null（jsdom 未布局时不会画出错误包围盒）"
);
const H_ROT = clientRectToSvgBox(
  { left: 10, top: 20, right: 30, bottom: 40 },
  { a: 0, b: 1, c: -1, d: 0, e: 5, f: 5 },
);
check(!!H_ROT && H_ROT.width > 0 && H_ROT.height > 0, "旋转矩阵下取外接盒且尺寸为正");

// ── 真实引擎渲染句柄 + jsdom DOM 层 ────────────────────────────────────────
const H_NS = "http://www.w3.org/2000/svg";
const H_SRC = "\\begin{tikzpicture}\n  \\draw (0,0) -- (2,1);\n\\end{tikzpicture}";
const H_R = await renderTikz(H_SRC);
check(H_R.handles.length >= 2 && H_R.compat.empty === true, "探针：简单直线产出可拖拽句柄且不被 F2-3 误锁");
const H_SVG = g.document.createElementNS(H_NS, "svg");
const H_SEL = createSelectionLayer(H_SVG);
const H_LAYER = buildHandleLayer(H_SVG, H_R.handles, H_R.viewBox, H_R.compat, H_M1);
check(H_SVG.children[0] === H_SEL && H_SVG.children[1] === H_LAYER, "选中层先于控制点层挂载，手柄画在虚线框之上");
const H_VALID = H_R.handles
  .slice(0, MAX_VISIBLE_HANDLES)
  .filter((h) => h.world && Number.isFinite(h.world.x) && Number.isFinite(h.world.y));
const H_NODES = Array.from(H_LAYER.querySelectorAll("g.dg-handle-node"));
check(H_NODES.length === H_VALID.length && H_NODES.length > 0, "每个有效句柄只生成一个 <g> 节点");
check(
  H_LAYER.querySelectorAll("circle[data-dg-handle-id]").length === H_NODES.length,
  "circle[data-dg-handle-id] 仍唯一 —— F2-1 拖拽 marker 查找零回归"
);
check(H_LAYER.querySelectorAll(".dg-handle-hit").length === H_NODES.length, "每个控制点都有独立的透明命中圈");
const H_G = H_NODES[0];
const H_VIS = H_G.querySelector("circle.dg-handle")!;
const H_HIT = H_G.querySelector("circle.dg-handle-hit")!;
check(Number(H_HIT.getAttribute("r")) > Number(H_VIS.getAttribute("r")) * 2, "DOM 实测：命中半径 > 2× 视觉半径");
check(H_HIT.getAttribute("pointer-events") === "all", "命中圈 fill:none 仍用 pointer-events=all 接收指针");
check(
  H_HIT.getAttribute("data-dg-hit-id") === H_VIS.getAttribute("data-dg-handle-id"),
  "视觉圆与命中圈共享同一 handleId"
);
check(
  H_HIT.closest("[data-dg-handle-id]") === H_G,
  "点中透明命中圈时 closest() 仍落到带 id 的 <g>（F2-1 startDragFromEvent 零回归）"
);
check(H_G.getAttribute("data-dg-source-id") === H_VALID[0].sourceRef?.sourceId, "<g> 带 sourceId，供 F3-2 选中态联动");
check(!!H_G.querySelector("title"), "hover tooltip 仍在 <g> 内，锁定理由不丢");
check(H_VIS.hasAttribute("data-dg-locked"), "data-dg-locked 属性保留");
check(
  !!H_LAYER.querySelector("[data-dg-guide]") &&
    H_LAYER.querySelector("[data-dg-guide]")!.getAttribute("visibility") === "hidden",
  "拖拽虚线引导仍在控制点层且默认隐藏"
);
check(H_LAYER.querySelectorAll(".dg-handle-lock").length === 0, "未锁定句柄不画挂锁（默认示例零回归）");
check(
  resolveHandleLock(H_R.compat, H_VALID[0].id, true, "") === null,
  "F2-3 能力矩阵对新层仍判定可拖拽，不误锁"
);

// 锁定场景：小档 + 50% 缩放，挂锁仍按屏幕 10px 清晰显示
const H_LOCK_ID = H_VALID[0].id;
const H_LOCK_REPORT = {
  ...emptyCompatReport(),
  empty: false,
  handleReasons: { [H_LOCK_ID]: "测试：展开型构造已锁定，不能安全改写" },
};
const H_SVG2 = g.document.createElementNS(H_NS, "svg");
const H_M_S05 = handleMetrics("small", 0.5);
buildHandleLayer(H_SVG2, H_R.handles.slice(0, 1), H_R.viewBox, H_LOCK_REPORT, H_M_S05);
const H_LOCK = H_SVG2.querySelector(".dg-handle-lock");
check(!!H_LOCK, "能力矩阵锁定的句柄仍画 F2-3 挂锁图标");
check(
  !!H_LOCK && (H_LOCK.getAttribute("transform") ?? "").includes("scale(2)"),
  "50% 缩放下挂锁 transform 为 scale(2)，屏幕尺寸恒定清晰"
);
check(
  !!H_SVG2.querySelector(".dg-handle.is-compat-locked") &&
    !!H_SVG2.querySelector(".dg-handle-node.is-locked, .dg-handle-hit.is-locked"),
  "锁定态 class 同时作用于视觉圆与命中圈（cursor 也变 not-allowed）"
);
check(
  (H_SVG2.querySelector("g.dg-handle-node")!.textContent ?? "").includes("展开型构造"),
  "锁定理由写进 <g> 的 <title>，hover 可见"
);
const H_VIS2 = H_SVG2.querySelector("circle.dg-handle")!;
const H_HIT2 = H_SVG2.querySelector("circle.dg-handle-hit")!;
check(
  Math.abs(Number(H_VIS2.getAttribute("r")) - 5.2) < 1e-6 &&
    Math.abs(Number(H_HIT2.getAttribute("r")) - 18) < 1e-6,
  "small@单位比 0.5 的 SVG 用户单位半径 = 屏幕 px / unitScale（视觉 5.2 / 命中 18）"
);
// 真实画布比例下挂锁也必须保持 10px 见方（旧口径会被放大 3.2 倍到 32px）
const H_SVG3 = g.document.createElementNS(H_NS, "svg");
buildHandleLayer(H_SVG3, H_R.handles.slice(0, 1), H_R.viewBox, H_LOCK_REPORT, H_REAL);
const H_LOCK3 = H_SVG3.querySelector(".dg-handle-lock");
check(
  !!H_LOCK3 && (H_LOCK3.getAttribute("transform") ?? "").includes("scale(0.3125)"),
  "实测单位比 3.2 时挂锁 transform = scale(1/3.2)，抵消 viewBox→px 放大"
);
check(
  Math.abs(LOCK_BASE_PX * (H_REAL.lockScale / H_REAL.unitScale) * H_REAL.unitScale - LOCK_BASE_PX) < 1e-9,
  "挂锁屏幕尺寸恒为 10px，不随画布比例 / UI 缩放 / 节点档位变化"
);

// 选中包围盒层
drawSelectionBox(H_SEL, { x: 10, y: 20, width: 30, height: 0 }, H_M1);
const H_FRAME = H_SEL.querySelector("[data-dg-selection-box]");
check(!!H_FRAME && H_SEL.querySelectorAll(".dg-sel-corner").length === 4, "包围盒 = 1 个虚线框 + 4 个角柄");
check(
  !!H_FRAME && Number(H_FRAME.getAttribute("width")) === 36 && Number(H_FRAME.getAttribute("height")) === 6,
  "包围盒按 metrics.boxPad 外扩，零高度直线也有可见厚度"
);
check(
  H_SEL.getAttribute("class") === "dg-selection-layer" &&
    H_FRAME?.getAttribute("class") === "dg-sel-box",
  "包围盒层与框都带既有 CSS 类名（pointer-events:none 不抢命中）"
);
drawSelectionBox(H_SEL, null, H_M1);
check(H_SEL.children.length === 0, "点空白 / 切精确通道时包围盒被清空，不留残影");

// ── F3-2 后续修复 · 拖拽实时几何预览（纯逻辑 + jsdom DOM） ───────────────────
console.log("\nF3-2 后续修复 · 拖拽实时几何预览");

// 1) viewBox 补偿：上游会按包围盒重算 viewBox，直接换根 SVG 会让画布跳一下
const P_VB0 = { x: -12.2, y: -12.2, width: 81.3055, height: 52.8528 };
const P_VB1 = { x: -12.2, y: -42.0754, width: 81.3055, height: 82.7281 };
const P_SAME = previewGeometryOffset(P_VB0, P_VB0);
check(P_SAME.dx === 0 && P_SAME.dy === 0, "同一 viewBox 不做补偿（横向拖拽只改 x/width 时就是这种情形）");
const P_OFF = previewGeometryOffset(P_VB0, P_VB1);
check(
  P_OFF.dx === 0 && Math.abs(P_OFF.dy - ((2 * P_VB0.y + P_VB0.height) - (2 * P_VB1.y + P_VB1.height))) < 1e-9,
  "纵向 viewBox 变化：dy = 两个 Y 基准差；X 方向上游无偏移，dx 恒为 0"
);
const P_WORLD_Y = 28.4528;
const P_BASE_Y = 2 * P_VB0.y + P_VB0.height - P_WORLD_Y;
const P_CAND_Y = 2 * P_VB1.y + P_VB1.height - P_WORLD_Y;
check(
  Math.abs(P_CAND_Y + P_OFF.dy - P_BASE_Y) < 1e-9,
  "候选几何整体平移 dy 后，同一个 world 点仍落在基准 viewBox 的 SVG 坐标（画布不跳）"
);
const P_DEGENERATE = previewGeometryOffset(
  { x: 0, y: Number.NaN, width: 10, height: 10 },
  { x: 0, y: 0, width: 0, height: 0 },
);
check(
  P_DEGENERATE.dx === 0 && Number.isFinite(P_DEGENERATE.dy),
  "退化 / NaN viewBox 不产出 NaN transform（引擎返回异常结果时的护栏）"
);

// 2) 源码去重：上游坐标量化到 cm 两位小数，很多 pointermove 会得到同一份源码
check(shouldRenderPreview(null, "S1", "S0") === true, "第一帧候选源码与基准不同 → 需要重渲染");
check(shouldRenderPreview("S1", "S1", "S0") === false, "同一份候选源码连续多帧 → 跳过，不重复解析渲染");
check(shouldRenderPreview(null, "S0", "S0") === false, "候选源码等于基准（位移太小）→ 不预览");
check(shouldRenderPreview("S1", "", "S0") === false, "空候选源码 → 不预览");

// 3) 真实引擎：候选源码 / 候选 viewBox / 补偿量三者自洽
const P_SRC = H_SRC;
const P_BASE = await renderTikz(P_SRC);
const P_HANDLE = P_BASE.handles.find((h) => h.rewriteMode === "direct")!;
const P_INTENT = await applyDragEdit(P_SRC, P_BASE.handles, P_HANDLE.id, {
  x: P_HANDLE.world.x,
  y: P_HANDLE.world.y - 30,
});
check(P_INTENT.status === "ok", "探针：纵向拖拽命中圈仍走同一份 applyEditIntent 得到候选源码");
if (P_INTENT.status === "ok") {
  const P_CAND = await renderTikz(P_INTENT.newSource);
  check(
    P_BASE.viewBox.y !== P_CAND.viewBox.y || P_BASE.viewBox.height !== P_CAND.viewBox.height,
    "实证：上游按新包围盒重算 viewBox —— 实时预览必须做 Y 基准补偿"
  );
  const P_REAL_OFF = previewGeometryOffset(P_BASE.viewBox, P_CAND.viewBox);
  check(
    Math.abs(P_REAL_OFF.dy) > 1 && P_REAL_OFF.dx === 0,
    "实证：候选几何需要非零 dy 补偿，且 X 方向不需要"
  );

  // 4) DOM：只换几何子节点，控制点层 / 选中层的 DOM 引用一个都不丢
  const P_SVG = sanitizeSvg(P_BASE.svg, P_BASE.viewBox, 1)!;
  const P_VIEWBOX_TEXT = P_SVG.getAttribute("viewBox");
  const P_SEL = createSelectionLayer(P_SVG);
  const P_LAYER = buildHandleLayer(P_SVG, P_BASE.handles, P_BASE.viewBox, P_BASE.compat, H_M1);
  const P_OK = applyPreviewGeometry(P_SVG, {
    markup: P_CAND.svg,
    baseViewBox: P_BASE.viewBox,
    candidateViewBox: P_CAND.viewBox,
    zoom: 1,
    live: true,
  });
  check(P_OK === true, "候选 SVG 经白名单消毒后成功替换几何");
  check(
    P_SVG.children.length === 3 &&
      P_SVG.children[0].hasAttribute("data-dg-preview-geometry") &&
      P_SVG.children[1] === P_SEL &&
      P_SVG.children[2] === P_LAYER,
    "预览几何插在辅助层之前，选中层 / 控制点层仍是原来的 DOM 节点（拖拽引用不丢）"
  );
  check(
    P_SVG.getAttribute("viewBox") === P_VIEWBOX_TEXT,
    "根 SVG 的 viewBox 全程保持基准值，不因候选包围盒变化而跳动"
  );
  check(
    isPreviewActive(P_SVG) && P_SVG.getAttribute("overflow") === "visible",
    "预览态标记 + overflow:visible，拖出基准 viewBox 也不被裁掉"
  );
  const P_WRAP = P_SVG.querySelector("[data-dg-preview-geometry]")!;
  check(
    Math.abs(Number((P_WRAP.getAttribute("transform") ?? "").replace(/translate\(0\s+/, "").replace(")", "")) - P_REAL_OFF.dy) < 1e-3,
    "预览包裹层的 translate dy 与纯逻辑算出的补偿量一致"
  );
  check(
    P_WRAP.querySelectorAll("[data-source-id]").length > 0,
    "候选几何仍带 data-source-id：点选 / 属性区 / 选中高亮语义不丢"
  );

  // 连续多帧：旧包裹层被替换，辅助层引用仍不变
  const P_INTENT2 = await applyDragEdit(P_SRC, P_BASE.handles, P_HANDLE.id, {
    x: P_HANDLE.world.x,
    y: P_HANDLE.world.y - 10,
  });
  if (P_INTENT2.status === "ok") {
    const P_CAND2 = await renderTikz(P_INTENT2.newSource);
    applyPreviewGeometry(P_SVG, {
      markup: P_CAND2.svg,
      baseViewBox: P_BASE.viewBox,
      candidateViewBox: P_CAND2.viewBox,
      zoom: 1,
      live: true,
    });
    check(
      P_SVG.querySelectorAll("[data-dg-preview-geometry]").length === 1,
      "连续多帧只保留一个预览包裹层，不会层层嵌套"
    );
    check(
      P_SVG.children[1] === P_SEL && P_SVG.children[2] === P_LAYER,
      "连续预览不重建控制点 / 选中层，Esc 与松手提交拿到的还是同一批 DOM"
    );
  }

  // 5) 非活动控制点跟着候选几何挪，活动控制点继续跟指针
  const P_NODES = Array.from(P_LAYER.querySelectorAll("g.dg-handle-node"));
  const P_ACTIVE_NODE = P_NODES.find((n) => n.getAttribute("data-dg-handle-id") === P_HANDLE.id)!;
  const P_OTHER_NODE = P_NODES.find((n) => n.getAttribute("data-dg-handle-id") !== P_HANDLE.id)!;
  const P_ACTIVE_CX0 = Number(P_ACTIVE_NODE.querySelector("circle.dg-handle")!.getAttribute("cx"));
  const P_MOVED = updateHandleLayerPositions(
    P_LAYER,
    P_CAND.handles,
    P_BASE.viewBox,
    H_M1,
    P_HANDLE.id,
  );
  check(P_MOVED >= 1, "至少有一个非活动控制点按候选句柄重新定位");
  const P_OTHER_ID = P_OTHER_NODE.getAttribute("data-dg-handle-id")!;
  const P_OTHER_H = P_CAND.handles.find((h) => h.id === P_OTHER_ID)!;
  const P_EXPECT = worldToSvgPoint(P_OTHER_H.world, P_BASE.viewBox);
  const P_OTHER_CIRCLE = P_OTHER_NODE.querySelector("circle.dg-handle")!;
  const P_OTHER_HIT = P_OTHER_NODE.querySelector("circle.dg-handle-hit")!;
  check(
    Math.abs(Number(P_OTHER_CIRCLE.getAttribute("cx")) - P_EXPECT.x) < 1e-3 &&
      Math.abs(Number(P_OTHER_CIRCLE.getAttribute("cy")) - P_EXPECT.y) < 1e-3,
    "非活动控制点视觉圆按候选 world 坐标落到基准 viewBox 位置"
  );
  check(
    P_OTHER_HIT.getAttribute("cx") === P_OTHER_CIRCLE.getAttribute("cx") &&
      P_OTHER_HIT.getAttribute("cy") === P_OTHER_CIRCLE.getAttribute("cy"),
    "视觉圆与透明命中圈同步移动，拖拽时两者不错位"
  );
  check(
    Number(P_ACTIVE_NODE.querySelector("circle.dg-handle")!.getAttribute("cx")) === P_ACTIVE_CX0,
    "活动控制点被 skipId 跳过，继续由 onMove 跟指针（更顺滑）"
  );

  // 6) 挂锁按 data-dg-lock-for 同步（F2-3 锁定提示不留在旧位置）
  const P_LOCK_SVG = g.document.createElementNS(H_NS, "svg");
  const P_LOCK_LAYER = buildHandleLayer(
    P_LOCK_SVG,
    P_BASE.handles.slice(0, 1),
    P_BASE.viewBox,
    { ...emptyCompatReport(), empty: false, handleReasons: { [P_BASE.handles[0].id]: "测试：已锁定" } },
    H_M1,
  );
  const P_LOCK_GLYPH = P_LOCK_LAYER.querySelector("g.dg-handle-lock")!;
  check(
    P_LOCK_GLYPH.getAttribute("data-dg-lock-for") === P_BASE.handles[0].id,
    "挂锁带 data-dg-lock-for，实时预览可按句柄 id 一起挪"
  );
  const P_LOCK_T0 = P_LOCK_GLYPH.getAttribute("transform");
  updateHandleLayerPositions(P_LOCK_LAYER, P_CAND.handles, P_BASE.viewBox, H_M1);
  check(
    P_LOCK_GLYPH.getAttribute("transform") !== P_LOCK_T0 &&
      (P_LOCK_GLYPH.getAttribute("transform") ?? "").startsWith("translate("),
    "挂锁 transform 随候选句柄更新，且保持 translate+scale 恒屏结构"
  );

  // 7) 还原：Esc / pointercancel / 提交失败时回到拖拽开始前的几何
  const P_RESTORED = applyPreviewGeometry(P_SVG, {
    markup: P_BASE.svg,
    baseViewBox: P_BASE.viewBox,
    candidateViewBox: P_BASE.viewBox,
    zoom: 1,
    live: false,
  });
  check(P_RESTORED === true, "还原操作成功把基准 SVG 消毒挂回");
  check(
    !isPreviewActive(P_SVG) && P_SVG.querySelectorAll("[data-dg-preview-geometry]").length === 0,
    "还原后清掉预览标记与包裹层，不留残影"
  );
  check(
    P_SVG.children.length >= 3 &&
      P_SVG.children[P_SVG.children.length - 2] === P_SEL &&
      P_SVG.children[P_SVG.children.length - 1] === P_LAYER,
    "还原后几何回到最前，辅助层仍是原 DOM 节点且「选中层在控制点层之下」"
  );
  check(
    P_SVG.getAttribute("viewBox") === P_VIEWBOX_TEXT && !P_SVG.hasAttribute("overflow"),
    "还原后 viewBox 保持基准、overflow 恢复默认"
  );
  check(
    P_SVG.querySelector("[data-source-id]") !== null,
    "还原后基准几何仍在，可直接继续下一次拖拽"
  );
  check(
    applyPreviewGeometry(P_SVG, {
      markup: "<not-svg",
      baseViewBox: P_BASE.viewBox,
      candidateViewBox: P_BASE.viewBox,
      zoom: 1,
      live: true,
    }) === false,
    "候选 SVG 无法解析时返回 false，调用方保留上一帧、不打断拖拽"
  );
}

// ── F3-3 选择 · 分组 · 图层 ────────────────────────────────────────────────
console.log("F3-3 · 虚拟分组数据模型（编辑器侧元数据，源码零污染）");
const G_IDS = ["path:0", "path:1", "path:2", "path:3"];
check(
  groupingStorageKey("abc") === groupingStorageKey("abc") &&
    groupingStorageKey("abc") !== groupingStorageKey("abd"),
  "groupingStorageKey 同源稳定、换源码换命名空间"
);
const G_EMPTY = normalizeGrouping(null, G_IDS);
check(G_EMPTY.groups.length === 0 && G_EMPTY.seq === 0, "空 / 非对象输入归一化为 EMPTY_GROUPING");
const G_DIRTY = normalizeGrouping(
  {
    groups: [
      {
        id: "group:1",
        name: "x".repeat(200),
        parentId: "group:2",
        memberIds: ["path:0", "path:0", "ghost"],
        collapsed: 1,
        locked: true,
        hidden: false,
      },
      { id: "group:2", name: "B", parentId: "group:1", memberIds: ["path:1"] },
      { id: "bad", name: "bad", parentId: null, memberIds: [] },
      { id: "group:3", name: "C", parentId: "group:404", memberIds: ["path:2"] },
    ],
    hiddenIds: ["ghost", "path:0"],
    lockedIds: ["path:9", "path:1"],
    seq: -5,
  },
  G_IDS,
);
check(G_DIRTY.groups.length === 3, "非法 group id 被丢弃，合法组保留");
check(
  G_DIRTY.groups.every((g) => g.name.length <= 60 && g.collapsed === false),
  "名称截断到 60 字符、非布尔 collapsed 降级为 false"
);
check(
  G_DIRTY.groups[0].memberIds.join("|") === "path:0",
  "成员去重 + 按 validElementIds 白名单裁剪（ghost 被剔除）"
);
check(
  G_DIRTY.hiddenIds.join("|") === "path:0" && G_DIRTY.lockedIds.join("|") === "path:1",
  "hiddenIds / lockedIds 同样按白名单裁剪"
);
check(G_DIRTY.groups[2].parentId === null, "不存在的 parentId 提到顶层");
check(G_DIRTY.groups[0].parentId === null, "parentId 成环时断环，绝不无限递归");
check(G_DIRTY.seq === 3 && G_DIRTY.groups[0].locked === true, "seq 由现存组 id 推导且不低于 0");
check(G_EMPTY.groups.length === 0, "normalizeGrouping 不 mutate 常量 EMPTY_GROUPING");

const G_A = createGroup(G_EMPTY, ["path:0", "path:1"], "第一组");
check(G_A.groupId === "group:1" && G_A.state.groups[0].name === "第一组", "编组生成 group:1 与自定义组名");
check(G_A.state.groups[0].memberIds.length === 2 && G_A.state.seq === 1, "成员数与 seq 同步推进");
check(createGroup(G_A.state, ["path:0"]).groupId === null, "少于 2 个元素不编组");
check(createGroup(G_A.state, ["path:0", "path:0"]).groupId === null, "去重后不足 2 个不编组");
const G_N = createGroup(G_A.state, ["path:0", "path:1"], "内层");
check(
  G_N.groupId === "group:2" && G_N.state.groups[1].parentId === "group:1",
  "对同组成员再次编组 → 生成嵌套子组"
);
check(G_N.state.groups[0].memberIds.length === 0, "成员从父组移出，绝不重复归属");
check(
  expandGroupElements(G_N.state.groups, "group:1").join("|") === "path:0|path:1",
  "展开父组含嵌套子组成员且去重"
);
check(groupAncestors(G_N.state.groups, "path:0").length === 2, "元素祖先链 = 内层 + 外层");
check(
  expandGroupElements(
    [
      { id: "group:1", parentId: "group:2", memberIds: ["path:0"], name: "", collapsed: false, locked: false, hidden: false },
      { id: "group:2", parentId: "group:1", memberIds: ["path:1"], name: "", collapsed: false, locked: false, hidden: false },
    ],
    "group:1",
  ).length === 2,
  "成环的脏数据展开也能终止（visited 去重）"
);
const G_RENAMED = patchGroup(G_N.state, "group:2", { name: "改名", collapsed: true, locked: true, hidden: true });
check(
  G_RENAMED.groups[1].name === "改名" &&
    G_RENAMED.groups[1].collapsed &&
    G_RENAMED.groups[1].locked &&
    G_RENAMED.groups[1].hidden,
  "patchGroup 一次性改命名 / 折叠 / 锁定 / 隐藏"
);
check(
  isManuallyLocked(G_RENAMED, "path:0") && isManuallyHidden(G_RENAMED, "path:0"),
  "组级锁定 / 隐藏由成员继承（递归祖先链）"
);
check(G_N.state.groups[1].locked === false, "patchGroup 不 mutate 入参");
const G_DEL = deleteGroup(G_N.state, "group:2");
check(
  G_DEL.groups.length === 1 && G_DEL.groups[0].memberIds.join("|") === "path:0|path:1",
  "解组把成员归还父组，源码零改动"
);
check(
  findGroupByMembers(G_A.state.groups, ["path:1", "path:0"]) === "group:1" &&
    findGroupByMembers(G_A.state.groups, ["path:0"]) === null,
  "findGroupByMembers 按集合匹配（顺序无关），单元素不认组"
);
const G_PRUNED = pruneGrouping(G_A.state, []);
check(
  G_PRUNED.groups.length === 0 && G_PRUNED.hiddenIds.length === 0,
  "语句消失时空组 / 悬空隐藏态被裁掉"
);
check(toggleId(["a", "b"], "b").join("|") === "a" && toggleId(["a"], "c").join("|") === "a|c", "toggleId 增删幂等");

console.log("F3-3 · 多选 / 框选命中");
check(toggleSelection(["a"], "b", false).join("|") === "b", "非 Shift 点选 = 单选替换");
check(toggleSelection(["a", "b"], "b", true).join("|") === "a", "Shift 点已选中项 = 减选");
check(toggleSelection(["a"], "b", true).join("|") === "a|b", "Shift 点未选中项 = 加选");
check(toggleSelection(["a", "b"], null, false).length === 0, "点空白清空选择");
check(toggleSelection(["a", "b"], null, true).length === 2, "Shift + 点空白保留已有选择");
check(
  applyMarqueeSelection(["a"], ["b", "c"], false).join("|") === "b|c" &&
    applyMarqueeSelection(["a"], ["b", "c"], true).join("|") === "a|b|c",
  "框选结果替换 / 并入已有选择"
);
const G_BOX = marqueeBox(120, 90, 20, 10);
check(
  G_BOX.left === 20 && G_BOX.top === 10 && G_BOX.right === 120 && G_BOX.bottom === 90,
  "反向拖出的 marquee 归一化为左上 / 右下"
);
const rect = (l: number, t: number, r: number, b: number): RectLike => ({
  left: l, top: t, right: r, bottom: b, width: r - l, height: b - t,
});
check(rectIntersectsBox(rect(15, 15, 30, 30), G_BOX), "相交命中：部分压到框边也算选中");
check(!rectInsideBox(rect(15, 15, 30, 30), G_BOX), "包含命中：部分越界则不算");
check(rectInsideBox(rect(30, 20, 60, 60), G_BOX), "完全框住的图元被 contain 命中");
check(!rectIntersectsBox(rect(30, 30, 30, 30), G_BOX), "零尺寸矩形不参与命中（防 (0,0) 误选）");
const G_ITEMS = [
  { id: "a", rect: rect(15, 15, 30, 30) },
  { id: "a", rect: rect(30, 20, 60, 60) },
  { id: "b", rect: rect(30, 20, 60, 60) },
  { id: "c", rect: rect(200, 200, 220, 220) },
];
check(marqueeHits(G_ITEMS, G_BOX).join("|") === "a|b", "intersect 模式去重后只返回命中的图元 id");
check(marqueeHits(G_ITEMS, G_BOX, "contain").join("|") === "a|b", "contain 模式排除越界图元");
check(
  marqueeHits(G_ITEMS, G_BOX, "intersect", new Set(["c"])).length === 0,
  "allowedIds 过滤掉隐藏 / 不可选图元"
);
check(marqueeHits(G_ITEMS, marqueeBox(10, 10, 10, 10)).length === 0, "零面积框选不选中任何东西");

console.log("F3-3 · 图层树");
const G_STMTS = G_IDS.map((id) => ({
  id,
  kind: "Path",
  command: "draw",
  span: { from: 0, to: 1 },
  optionsSpan: null,
  optionsRaw: null,
  entries: [],
  insertOffset: -1,
}));
const G_ROWS0 = buildLayerRows(G_STMTS, G_A.state);
check(
  G_ROWS0[0].kind === "group" && G_ROWS0[0].label === "第一组" && G_ROWS0[0].count === 2,
  "顶层组行带组名与成员数"
);
check(
  G_ROWS0[1].kind === "element" && G_ROWS0[1].depth === 1 && G_ROWS0[1].groupId === "group:1",
  "组成员缩进一层并标注所属组"
);
check(
  G_ROWS0.filter((r) => r.kind === "element").map((r) => r.id).join("|") ===
    "path:0|path:1|path:2|path:3",
  "未分组元素按源码语句顺序排在组之后"
);
const G_ROWS1 = buildLayerRows(G_STMTS, patchGroup(G_A.state, "group:1", { collapsed: true }));
check(
  G_ROWS1.filter((r) => r.kind === "group").length === 1 && G_ROWS1.length === 3,
  "折叠组只出一行（组行 + 2 个未分组元素），成员行隐藏"
);
const G_ROWS2 = buildLayerRows(G_STMTS, G_N.state);
check(
  G_ROWS2.some((r) => r.kind === "group" && r.depth === 1),
  "嵌套子组按 depth 缩进"
);
const G_ROWS3 = buildLayerRows(G_STMTS, {
  ...G_A.state,
  groups: G_A.state.groups.map((x) => ({ ...x, locked: true, hidden: true })),
});
check(
  G_ROWS3.filter((r) => r.kind === "element" && r.locked && r.hidden).length >= 2,
  "元素行显示继承来的组级锁定 / 隐藏态"
);
const G_ORPHAN: GroupingState = {
  ...G_A.state,
  groups: G_A.state.groups.map((x) => ({ ...x, parentId: "group:999" })),
};
check(
  buildLayerRows(G_STMTS, G_ORPHAN).some((r) => r.kind === "group"),
  "parentId 指向已删除组时仍显示，不把用户的组藏没"
);

console.log("F3-3 · 多段最小补丁（拖组一次写回 = 一条 history）");
const G_SRC = "A(0,0) B(1,1) C(2,2)";
const G_PATCHES = [
  { from: 16, to: 19, insert: "7,7" },
  { from: 2, to: 5, insert: "9,9" },
  { from: 9, to: 12, insert: "8,8" },
];
const G_MERGED = mergeSourcePatches(G_SRC, G_PATCHES);
check(G_MERGED !== null, "正常多段补丁合并成功");
check(
  G_MERGED!.patches.map((p) => p.from).join("|") === "2|9|16",
  "补丁按 from 排序后再应用"
);
check(
  G_MERGED!.nextSource === "A(9,9) B(8,8) C(7,7)",
  "合并结果逐段替换，未改动的字符一字不动"
);
check(mergeSourcePatches(G_SRC, [{ from: 2, to: 6, insert: "x" }, { from: 5, to: 8, insert: "y" }]) === null, "重叠区间返回 null，绝不静默改语义");
check(mergeSourcePatches(G_SRC, [{ from: 2, to: 999, insert: "x" }]) === null, "越界区间返回 null");
check(
  mergeSourcePatches(G_SRC, [{ from: Number.NaN, to: 3, insert: "x" }])!.nextSource === G_SRC,
  "非有限值补丁被过滤，不产出 NaN 打进 CM6"
);
const G_HANDLES = [
  { id: "h:a", kind: "path-point", rewriteMode: "direct", world: { x: 0, y: 0 }, sourceRef: { sourceId: "a" } },
  { id: "h:b", kind: "path-point", rewriteMode: "direct", world: { x: 10, y: 10 }, sourceRef: { sourceId: "b" } },
  { id: "h:c", kind: "path-point", rewriteMode: "direct", world: { x: 20, y: 20 }, sourceRef: { sourceId: "c" } },
  { id: "h:d", kind: "path-point", rewriteMode: "unsupported", world: { x: 30, y: 30 }, sourceRef: { sourceId: "d" } },
];
const G_SPANS: Record<string, { from: number; to: number; insert: string }> = {
  "h:a": { from: 2, to: 5, insert: "9,9" },
  "h:b": { from: 9, to: 12, insert: "8,8" },
  "h:c": { from: 16, to: 19, insert: "7,7" },
};
const G_INTENT = (_src: string, _hs: unknown, id: string) =>
  G_SPANS[id] ? { ok: true as const, patches: [G_SPANS[id]] } : { ok: false as const, reason: "上游不支持" };
const G_PLAN = planGroupMove({
  source: G_SRC,
  handles: G_HANDLES as never,
  elementIds: ["a", "b", "c"],
  delta: { x: 5, y: 5 },
  compat: null,
  grouping: G_EMPTY,
  intent: G_INTENT as never,
});
check(G_PLAN.status === "ok", "三个可写图元整体平移规划成功");
check(
  G_PLAN.status === "ok" && G_PLAN.patches.length === 3 && G_PLAN.movedElements.length === 3,
  "每个可写图元各产一段最小补丁，共 3 段"
);
check(
  G_PLAN.status === "ok" && G_PLAN.nextSource === "A(9,9) B(8,8) C(7,7)",
  "规划出的 nextSource 与逐段应用结果一致"
);
check(
  planGroupMove({ source: G_SRC, handles: G_HANDLES as never, elementIds: ["a"], delta: { x: 0, y: 0 }, compat: null, grouping: G_EMPTY, intent: G_INTENT as never }).status === "empty",
  "零位移直接短路，不白跑上游 intent"
);
const G_LOCKED: GroupingState = { ...G_EMPTY, lockedIds: ["b"], hiddenIds: ["c"] };
const G_PLAN2 = planGroupMove({
  source: G_SRC, handles: G_HANDLES as never, elementIds: ["a", "b", "c"], delta: { x: 5, y: 5 },
  compat: null, grouping: G_LOCKED, intent: G_INTENT as never,
});
check(
  G_PLAN2.status === "ok" && G_PLAN2.movedElements.join("|") === "a" && G_PLAN2.skipped.length === 2,
  "主动锁定 / 隐藏的图元跳过并在 skipped 里给出理由"
);
const G_COMPAT_LOCK = { ...emptyCompatReport(), handleReasons: { "h:a": "\\foreach 展开会静默改语义" } };
const G_PLAN3 = planGroupMove({
  source: G_SRC, handles: G_HANDLES as never, elementIds: ["a", "b"], delta: { x: 5, y: 5 },
  compat: G_COMPAT_LOCK, grouping: G_EMPTY, intent: G_INTENT as never,
});
check(
  G_PLAN3.status === "ok" && G_PLAN3.skipped.some((s) => s.id === "a" && s.reason.includes("静默改语义")),
  "F2-3 能力矩阵锁定的句柄不参与组拖，理由透传"
);
const G_PLAN4 = planGroupMove({
  source: G_SRC, handles: G_HANDLES as never, elementIds: ["a", "b", "d"], delta: { x: 5, y: 5 },
  compat: null, grouping: G_EMPTY, intent: G_INTENT as never,
});
check(
  G_PLAN4.status === "ok" && G_PLAN4.skipped.some((s) => s.id === "d"),
  "rewriteMode=unsupported 的句柄被跳过，不静默改语义"
);
const G_CONFLICT_INTENT = (_s: string, _h: unknown, id: string) => ({
  ok: true as const,
  patches: [{ from: 2, to: 8, insert: id === "h:a" ? "x" : "y" }],
});
check(
  planGroupMove({ source: G_SRC, handles: G_HANDLES as never, elementIds: ["a", "b"], delta: { x: 5, y: 5 }, compat: null, grouping: G_EMPTY, intent: G_CONFLICT_INTENT as never }).status === "conflict",
  "补丁区间重叠时整次写回判为 conflict，绝不部分提交"
);
check(
  planGroupMove({ source: G_SRC, handles: G_HANDLES as never, elementIds: ["a"], delta: { x: 5, y: 5 }, compat: null, grouping: G_EMPTY, intent: (() => ({ ok: false as const, reason: "上游拒绝" })) as never }).status === "empty",
  "所有 intent 都失败时放弃写回（不产生半截源码）"
);

console.log("F3-3 · 真实引擎：整体平移 3 个图元且源码零 scope");
const G_TIKZ = [
  "\\begin{tikzpicture}",
  "  \\draw[thick] (0,0) rectangle (1,1);",
  "  \\draw (2,0) circle (0.5cm);",
  "  \\node[draw] (a) at (3,2) {A};",
  "\\end{tikzpicture}",
].join("\n");
const G_RENDER = await renderTikz(G_TIKZ);
const G_REAL = await applyGroupEdit({
  source: G_TIKZ,
  handles: G_RENDER.handles,
  elementIds: G_RENDER.statements.map((s) => s.id),
  delta: { x: 12, y: -8 },
  compat: G_RENDER.compat,
  grouping: G_EMPTY,
});
check(G_REAL.status === "ok", "真实引擎对 3 个图元整体平移返回 ok");
check(
  G_REAL.status === "ok" && G_REAL.patches.length === 4 && G_REAL.movedElements.length === 3,
  "矩形 2 个端点 + 圆 1 个 + node 1 个 = 4 段补丁，覆盖全部 3 图元"
);
check(
  G_REAL.status === "ok" && !G_REAL.nextSource.includes("scope"),
  "编组 / 拖组后源码不出现 \\begin{scope}（虚拟分组零源码污染）"
);
check(
  G_REAL.status === "ok" && G_REAL.nextSource.includes("(0.42,") && G_REAL.nextSource.includes("(3.42,"),
  "每个图元的坐标都按同一 world delta 改写"
);
const G_RENDER2 = await renderTikz(G_REAL.status === "ok" ? G_REAL.nextSource : G_TIKZ);
check(G_RENDER2.diagnostics.length === 0 && G_RENDER2.handles.length === 4, "平移后的源码仍可正常渲染且句柄数不变");
const G_REAL_ONE = await applyGroupEdit({
  source: G_TIKZ, handles: G_RENDER.handles, elementIds: [G_RENDER.statements[2].id],
  delta: { x: 12, y: -8 }, compat: G_RENDER.compat, grouping: G_EMPTY,
});
check(
  G_REAL_ONE.status === "ok" && G_REAL_ONE.patches.length === 1,
  "只选 1 个图元时只改它的坐标，不牵连其它语句"
);

console.log("F3-3 · 多段写回桥 / 主动隐藏 DOM");
let GM_CALLS = 0;
let GM_FALLBACK = 0;
const GM_UNREG = registerDiagramSourceBridge({
  getView: () => null,
  patch: () => true,
  patchMany: (ps) => {
    GM_CALLS += 1;
    return ps.length === 3;
  },
  replaceLast: () => true,
  undo: () => true,
  redo: () => true,
});
const GM_WRITE = commitDiagramPatches({
  patches: G_MERGED!.patches,
  source: G_SRC,
  nextSource: G_MERGED!.nextSource,
  fallback: () => { GM_FALLBACK += 1; },
});
check(
  GM_WRITE.written && !GM_WRITE.merged && !GM_WRITE.degraded && GM_CALLS === 1 && GM_FALLBACK === 0,
  "commitDiagramPatches 一次 patchMany 写回，不并入 F2-4 微调会话"
);
const GM_BAD = commitDiagramPatches({
  patches: [{ from: 2, to: 5, insert: "9,9" }],
  source: G_SRC,
  nextSource: "A(8,8) B(1,1) C(2,2)",
  fallback: () => { GM_FALLBACK += 1; },
});
check(
  !GM_BAD.written && GM_BAD.degraded && GM_FALLBACK === 1,
  "nextSource 与补丁不一致时拒绝写回并降级（防规划 / 写回错位）"
);
GM_UNREG();
const GM_NO_BRIDGE = commitDiagramPatches({
  patches: G_MERGED!.patches,
  source: G_SRC,
  nextSource: G_MERGED!.nextSource,
  fallback: () => { GM_FALLBACK += 1; },
});
check(!GM_NO_BRIDGE.written && GM_NO_BRIDGE.degraded && GM_FALLBACK === 2, "桥未注册时降级 setSource，功能不丢");

const L_SVG = g.document.createElementNS(H_NS, "svg");
const L_SHAPE = g.document.createElementNS(H_NS, "g");
L_SHAPE.setAttribute("data-source-id", "path:0");
L_SVG.appendChild(L_SHAPE);
const L_NODE = g.document.createElementNS(H_NS, "g");
L_NODE.setAttribute("class", "dg-handle-node");
L_NODE.setAttribute("data-dg-handle-id", "h:0");
L_NODE.setAttribute("data-dg-source-id", "path:0");
L_SVG.appendChild(L_NODE);
const L_LOCK = g.document.createElementNS(H_NS, "g");
L_LOCK.setAttribute("class", "dg-handle-lock");
L_LOCK.setAttribute("data-dg-lock-for", "h:0");
L_SVG.appendChild(L_LOCK);
applyLayerVisibility(L_SVG, new Set(["path:0"]));
check(
  L_SHAPE.classList.contains("dg-hidden") &&
    L_NODE.classList.contains("dg-hidden") &&
    L_LOCK.classList.contains("dg-hidden"),
  "隐藏同时作用于几何 / 控制点 / F2-3 挂锁（按 data-dg-lock-for 匹配）"
);
applyLayerVisibility(L_SVG, new Set());
check(
  !L_SHAPE.classList.contains("dg-hidden") && !L_LOCK.classList.contains("dg-hidden"),
  "取消隐藏幂等恢复，不重建 SVG"
);

console.log("F3-4 · 对齐 / 分布纯逻辑（锚点包围盒同源）");
const F3_BOXES: ElementBox[] = [
  { id: "a", box: makeWorldBox(0, 0, 2, 2)! },
  { id: "b", box: makeWorldBox(5, 1, 7, 3)! },
  { id: "c", box: makeWorldBox(10, 5, 13, 8)! },
];
const f3Left = planAlignDeltas(F3_BOXES, "left");
check(f3Left.status === "ok", "左对齐状态 ok");
check(
  f3Left.deltas["a"].x === 0 && f3Left.deltas["b"].x === -5 && f3Left.deltas["c"].x === -10,
  "左对齐 delta 把三个左边缘都移到联合 minX=0"
);
check(f3Left.guides.length === 1 && f3Left.guides[0].axis === "x" && f3Left.guides[0].at === 0, "左对齐给出 x=0 参考线");
const f3Right = planAlignDeltas(F3_BOXES, "right");
check(f3Right.deltas["a"].x === 11 && f3Right.deltas["c"].x === 0, "右对齐把右边缘都移到联合 maxX=13");
const f3Top = planAlignDeltas(F3_BOXES, "top");
check(f3Top.deltas["a"].y === 6 && f3Top.deltas["c"].y === 0, "上对齐把顶边都移到联合 maxY=8");
const f3VC = planAlignDeltas(F3_BOXES, "vcenter");
check(Math.abs(f3VC.deltas["a"].y - 3) < 1e-9, "垂直居中把各自中心移到联合中心 y=4");
const f3Single = planAlignDeltas([F3_BOXES[0]], "left");
check(f3Single.status === "error" && f3Single.reason.includes("2"), "单元素对齐被拒（需 ≥2）");
const f3Dist = planDistributeDeltas(F3_BOXES, "vertical");
check(f3Dist.status === "ok", "垂直等距分布状态 ok");
check(Math.abs(f3Dist.deltas["b"].y - 1.75) < 1e-9, "垂直等距把中间元素移到等距位（step=2.75）");
const f3DistFew = planDistributeDeltas([F3_BOXES[0], F3_BOXES[1]], "horizontal");
check(f3DistFew.status === "error", "双元素分布被拒（需 ≥3）");

console.log("F3-4 · 变换选项补丁（rotate/scale/xshift/yshift 写入 options）");
const TV_SRC = String.raw`\begin{tikzpicture}
  \draw[rotate=30] (0,0) rectangle (1,1);
  \draw (3,2) rectangle (4,3);
  \draw[fill=red] (6,4) rectangle (7,5);
\end{tikzpicture}`;
const tv = await renderTikz(TV_SRC);
const tvIds = tv.statements.map((s) => s.id);
check(tv.statements.length >= 3, "渲染得到 ≥3 条语句");
const tvRot = planTransformPatches({ source: TV_SRC, statements: tv.statements, elementIds: [tvIds[1]], key: "rotate", value: "45", compat: tv.compat, grouping: EMPTY_GROUPING });
check(tvRot.status === "ok" && tvRot.nextSource.includes("rotate=45"), "对第二图元应用 rotate=45（插入选项）");
const tvRem = planTransformPatches({ source: TV_SRC, statements: tv.statements, elementIds: [tvIds[0]], key: "rotate", value: null, compat: tv.compat, grouping: EMPTY_GROUPING });
check(tvRem.status === "ok" && !tvRem.nextSource.includes("rotate"), "移除第一图元 rotate 后源码不含 rotate");
const tvX = planTransformPatches({ source: TV_SRC, statements: tv.statements, elementIds: tvIds, key: "xshift", value: "1cm", compat: tv.compat, grouping: EMPTY_GROUPING });
check(tvX.status === "ok" && tvX.changedIds.length === 3, "对全部 3 图元应用 xshift=1cm");
const tvNoop = planTransformPatches({ source: TV_SRC, statements: tv.statements, elementIds: [tvIds[0]], key: "rotate", value: "30", compat: tv.compat, grouping: EMPTY_GROUPING });
check(tvNoop.status === "empty", "已为 rotate=30 时再次应用等同 noop（empty）");
const tvLock = planTransformPatches({ source: TV_SRC, statements: tv.statements, elementIds: [tvIds[0]], key: "rotate", value: "60", compat: { ...emptyCompatReport(), lockReasons: { [tvIds[0]]: "测试锁定" } }, grouping: EMPTY_GROUPING });
check(tvLock.skipped.length === 1 && tvLock.changedIds.length === 0, "能力矩阵锁定被跳过、不写回");

console.log("F3-4 · 数值白名单");
check(normalizeTransformValue("rotate", "30").value === "30", "rotate 30 规范化为 30");
check("error" in normalizeTransformValue("rotate", "abc"), "rotate 非数字报错");
check("error" in normalizeTransformValue("scale", "-1"), "scale 负数报错");
check(normalizeTransformValue("xshift", "1cm").value === "1cm", "xshift 1cm 通过");
check("error" in normalizeTransformValue("xshift", "1"), "xshift 缺单位报错");

console.log("F3-4 · 智能参考线 / 吸附（world 阈值，与写回句柄同源）");
const vb0 = { x: 0, y: 0, width: 10, height: 10 };
const snapHit = planSnap({ moving: makeWorldBox(0, 0, 2, 2)!, others: [makeWorldBox(2.05, 0, 4, 2)!], threshold: DEFAULT_SNAP_THRESHOLD_PT });
check(Math.abs(snapHit.delta.x - 0.05) < 1e-9 && snapHit.guides.length >= 1, "planSnap 吸附到邻近右边并给出参考线");
const snapMiss = planSnap({ moving: makeWorldBox(0, 0, 2, 2)!, others: [makeWorldBox(50, 50, 52, 52)!], threshold: 6 });
check(snapMiss.delta.x === 0 && snapMiss.delta.y === 0 && snapMiss.guides.length === 0, "远离时不吸附");
const dragSnap = planDragSnap({ selectedBoxes: [{ id: "s", box: makeWorldBox(0, 0, 2, 2)! }], otherBoxes: [{ id: "o", box: makeWorldBox(2.05, 0, 4, 2)! }], delta: { x: 0, y: 0 }, threshold: DEFAULT_SNAP_THRESHOLD_PT });
check(Math.abs(dragSnap.delta.x - 0.05) < 1e-9, "planDragSnap 在拖拽位移上叠加吸附修正");
const segX = guideToSvgSegment({ axis: "x", at: 3, kind: "edge" }, vb0);
check(!!segX && segX.x1 === 3 && segX.x2 === 3 && segX.y1 === 0 && segX.y2 === 10, "guideToSvgSegment x 线贯穿视口");
const segY = guideToSvgSegment({ axis: "y", at: 4, kind: "center" }, vb0);
check(!!segY && Math.abs(segY.y1 - (2 * vb0.y + vb0.height - 4)) < 1e-9, "guideToSvgSegment y 按 viewBox 翻转");
const wb = makeWorldBox(1, 2, 3, 4)!;
const sb = worldBoxToSvgBox(wb, vb0);
const back = svgBoxToWorldBox(sb!, vb0);
check(!!back && Math.abs(back.minX - 1) < 1e-9 && Math.abs(back.minY - 2) < 1e-9 && Math.abs(back.maxX - 3) < 1e-9 && Math.abs(back.maxY - 4) < 1e-9, "worldBox↔svgBox 往返一致");

console.log("F3-4 · 旋转 / 缩放手势纯逻辑");
check(snapAngle(14) === 15 && snapAngle(89) === 90, "snapAngle 接近 15° 网格点吸附");
check(snapAngle(7) === 7 && snapAngle(20) === 20, "snapAngle 远离网格点不吸附（保留原值）");
const rb = makeWorldBox(-1, -1, 1, 1)!;
check(Math.abs(rotationFromDrag(rb, { x: 1, y: 0 }, { x: 0, y: 1 }) - 90) < 1e-6, "rotationFromDrag 0°→90°=90");
const sbx = makeWorldBox(0, 0, 2, 2)!;
const sc = scaleFromDrag({ box: sbx, corner: 4, pointer: { x: 4, y: 0 }, uniform: false, center: false });
check(!!sc && Math.abs(sc.sx - 2) < 1e-6 && Math.abs(sc.sy - 1) < 1e-6, "scaleFromDrag 角柄得到 sx=2,sy=1");
check(formatCm(TIKZ_PT_PER_CM) === "1.00 cm", "formatCm 1cm 显示");

console.log("F3-4 · 锚点包围盒 + 端到端对齐写回（一次 dispatch）");
const CE_SRC = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
  \draw (3,2) rectangle (4,3);
  \draw (6,4) rectangle (9,5);
\end{tikzpicture}`;
const ce = await renderTikz(CE_SRC);
const ceIds = Array.from(new Set(ce.handles.map((h) => h.sourceRef?.sourceId).filter(Boolean) as string[]));
const cb = collectElementBoxes({ handles: ce.handles, elementIds: ceIds, compat: ce.compat, grouping: EMPTY_GROUPING });
check(cb.boxes.length === 3, `collectElementBoxes 收 3 个锚点包围盒（实得 ${cb.boxes.length}）`);
const ceLeft = planAlignDeltas(cb.boxes, "left");
const ceMove = await applyDeltaEdit({ source: CE_SRC, handles: ce.handles, deltas: ceLeft.deltas, compat: ce.compat, grouping: EMPTY_GROUPING });
check(ceMove.status === "ok", "applyDeltaEdit 对齐 ok");
const ceRe = await renderTikz(ceMove.nextSource);
const ceReIds = Array.from(new Set(ceRe.handles.map((h) => h.sourceRef?.sourceId).filter(Boolean) as string[]));
const ceReBoxes = collectElementBoxes({ handles: ceRe.handles, elementIds: ceReIds, compat: ceRe.compat, grouping: EMPTY_GROUPING });
const minXs = ceReBoxes.boxes.map((b) => b.box.minX);
check(minXs.length === 3 && minXs.every((x) => Math.abs(x - minXs[0]) < 1e-6), "对齐写回后三图元左边缘一致");

console.log("F3-5 · z-order 整段重排 + 复制插入（纯逻辑）");
{
  const Z_SRC = `\\begin{tikzpicture}
  \\draw (0,0) rectangle (1,1);
  % a comment between
  \\begin{scope}[fill=red]
    \\draw (2,0) rectangle (3,1);
  \\end{scope}
  \\fill (4,0) circle (0.5);
\\end{tikzpicture}`;
  const zRender = await renderTikz(Z_SRC);
  const zStmts = zRender.statements.filter((s) => s.topLevel).sort((a, b) => a.span.from - b.span.from);
  const zBlocks = topLevelBlocks(Z_SRC, zRender.statements);
  check(zBlocks.length === 3, `顶层 3 段块（实得 ${zBlocks.length}）`);
  const rebuilt =
    Z_SRC.slice(0, zBlocks[0].from) +
    zBlocks.map((b) => b.text).join("") +
    Z_SRC.slice(zBlocks[zBlocks.length - 1].to);
  check(rebuilt === Z_SRC, "head + 块文本 + tail 可无损重建源码");
  check(
    zBlocks.every((b, i) => i === 0 || b.from === zBlocks[i - 1].to),
    "块间无缝（每段 from = 上一段 to）",
  );

  // 语句 body 文本是跨重渲染稳定的标识（renderTikz 的 id 会随位置重分配，不可作为跨次比较键）。
  const bodyOrder = (src: string, render: Awaited<ReturnType<typeof renderTikz>>): string[] =>
    topLevelBlocks(src, render.statements).map((b) => {
      const st = render.statements.find((s) => s.id === b.id && s.topLevel);
      return st ? src.slice(st.span.from, st.span.to).trim() : "";
    });
  const origBodies = bodyOrder(Z_SRC, zRender);

  // 置顶：把第一段移到最后
  const frontOrder = planZOrder(zBlocks, zBlocks[0].id, "front")!;
  const zFront = applyBlockOrder(Z_SRC, zBlocks, frontOrder);
  const zFrontRender = await renderTikz(zFront);
  const zFrontBlocks = topLevelBlocks(zFront, zFrontRender.statements);
  check(zFrontBlocks.length === 3, "置顶后仍是 3 段块");
  const frontBodies = bodyOrder(zFront, zFrontRender);
  check(frontBodies[2] === origBodies[0], "置顶后该段（draw）移到了最后绘制");
  check(
    [...frontBodies].sort().join("|") === [...origBodies].sort().join("|"),
    "重排后各语句本体集合不变（仅顺序变化）",
  );
  check(zFront.includes("% a comment between"), "注释随所属块一起移动，未丢失");
  check(zFront.includes("\\draw (2,0) rectangle (3,1)"), "嵌套 scope 内容完整保留");

  // 置底：把最后一段移到最前
  const backOrder = planZOrder(zBlocks, zBlocks[2].id, "back")!;
  const zBack = applyBlockOrder(Z_SRC, zBlocks, backOrder);
  const zBackRender = await renderTikz(zBack);
  const zBackBlocks = topLevelBlocks(zBack, zBackRender.statements);
  const backBodies = bodyOrder(zBack, zBackRender);
  check(backBodies[0] === origBodies[2], "置底后该段（fill）移到了最前绘制");

  // 上移 / 下移相邻交换
  const fwd = planZOrder(zBlocks, zBlocks[1].id, "forward")!;
  check(fwd[2] === zBlocks[1].id, "上移后该段与下一段交换位置");
  const bwd = planZOrder(zBlocks, zBlocks[1].id, "backward")!;
  check(bwd[0] === zBlocks[1].id, "下移后该段与上一段交换位置");

  // 已在最底再下移 → 无变化，返回 null（UI 据此提示不报错）
  check(planZOrder(zBlocks, zBlocks[0].id, "backward") === null, "已在最底再下移返回 null");
  check(planZOrder(zBlocks, zBlocks[2].id, "front") === null, "已在最顶再置顶返回 null");
  check(planZOrder(zBlocks, "nope", "front") === null, "不存在的 id 返回 null");

  // 复制插入：克隆第一段，matchClones 找回克隆 id
  const dup = planDuplicate(Z_SRC, zBlocks, [zBlocks[0].id]);
  check(dup !== null, "planDuplicate 返回新源码");
  const dupRender = await renderTikz(dup!.source);
  const dupBlocks = topLevelBlocks(dup!.source, dupRender.statements);
  const clones = matchClones(zBlocks, dupBlocks);
  check(clones.has(zBlocks[0].id), "matchClones 找回克隆 id");
  check(clones.get(zBlocks[0].id) !== zBlocks[0].id, "克隆 id 与原 id 不同");
  const txt = zBlocks[0].text.trim();
  const before = zBlocks.filter((b) => b.text.trim() === txt).length;
  const after = dupBlocks.filter((b) => b.text.trim() === txt).length;
  check(after === before + 1, "复制后该语句出现次数 +1");
  check(dupBlocks.length === 4, "复制后顶层块数量 +1");

  // Ctrl+D 核心：克隆图元可整体位移（delta 按元素 id 索引，vendor 写回）
  const cloneId = clones.get(zBlocks[0].id)!;
  const cloneHandles = dupRender.handles.filter((h) => h.sourceRef?.sourceId === cloneId);
  const dmove = await applyDeltaEdit({
    source: dup!.source,
    handles: cloneHandles,
    deltas: { [cloneId]: { x: 10, y: 0 } },
    compat: dupRender.compat,
    grouping: EMPTY_GROUPING,
  });
  check(dmove.status === "ok", "克隆图元可整体位移（Ctrl+D 核心路径）");
}

console.log("F3-5 · 层级重排 / 复制粘贴 / 网格吸附（编辑层纯逻辑）");
{
  const SRC = `\\begin{tikzpicture}
  \\draw (0,0) rectangle (1,1);
  \\draw (2,0) circle (1);
  \\node at (4,0) {X};
\\end{tikzpicture}`;
  const r = await renderTikz(SRC);
  const blocks = topLevelBlocks(SRC, r.statements);
  check(blocks.length === 3, `顶层 3 段块（实得 ${blocks.length}）`);

  // minimalSourcePatch：单段最小补丁可无损重建
  const nextSrc = SRC.replace("(0,0)", "(0.5,0)");
  const p = minimalSourcePatch(SRC, nextSrc)!;
  check(p !== null, "minimalSourcePatch 返回补丁");
  check(
    SRC.slice(0, p.from) + p.insert + SRC.slice(p.to) === nextSrc,
    "最小补丁可无损重建新源码",
  );
  check(minimalSourcePatch(SRC, SRC) === null, "相同源码返回 null");

  // planZOrderMany：多选整体重排（保持相对顺序）
  const manyFront = planZOrderMany(blocks, [blocks[0].id, blocks[1].id], "front")!;
  check(
    manyFront.slice(-2).join(",") === [blocks[0].id, blocks[1].id].join(","),
    "多选置顶后保持相对顺序放在末尾",
  );
  const manyBack = planZOrderMany(blocks, [blocks[1].id, blocks[2].id], "back")!;
  check(
    manyBack.slice(0, 2).join(",") === [blocks[1].id, blocks[2].id].join(","),
    "多选置底后放在最前",
  );
  check(planZOrderMany(blocks, [blocks[2].id], "front") === null, "单元素已在最顶置顶返回 null");

  // planZOrderEdit：置顶第一段 → 该段落在最后绘制，补丁可无损重建
  const edit = planZOrderEdit(SRC, r.statements, [blocks[0].id], "front")!;
  check(edit !== null, "planZOrderEdit 产出补丁 + 新源码");
  check(edit.nextSource !== SRC, "重排后源码变化");
  check(
    edit.patches.length === 1 &&
      SRC.slice(0, edit.patches[0].from) + edit.patches[0].insert + SRC.slice(edit.patches[0].to) ===
        edit.nextSource,
    "planZOrderEdit 补丁可无损重建新源码",
  );
  const rEdit = await renderTikz(edit.nextSource);
  const editBodies = topLevelBlocks(edit.nextSource, rEdit.statements).map((b) => {
    const st = rEdit.statements.find((s) => s.id === b.id && s.topLevel);
    return st ? edit.nextSource.slice(st.span.from, st.span.to).trim() : "";
  });
  check(
    editBodies[editBodies.length - 1].includes("rectangle"),
    "置顶后矩形语句移到末尾绘制",
  );

  // planDuplicateEdit：返回克隆区间，克隆文本出现 +1
  const dupEdit = planDuplicateEdit(SRC, r.statements, [blocks[0].id])!;
  check(dupEdit !== null && dupEdit.clones.length === 1, "planDuplicateEdit 返回 1 个克隆区间");
  const dupRender = await renderTikz(dupEdit.nextSource);
  const dupBlocks = topLevelBlocks(dupEdit.nextSource, dupRender.statements);
  check(dupBlocks.length === 4, "复制后顶层块 +1");
  check(
    dupBlocks.some((b) => b.from === dupEdit.clones[0].from),
    "克隆区间起点对应一个新顶层块",
  );

  // 剪贴板 + planPaste：复制第一段、锚点第二段粘贴 → 顶层块 +1
  setClipboard([blocks[0].text]);
  check(hasClipboard() && getClipboard().length === 1, "剪贴板写入 1 段");
  const paste = planPaste(SRC, r.statements, getClipboard(), [blocks[1].id])!;
  check(paste !== null, "planPaste 产出补丁 + 新源码");
  const pasteRender = await renderTikz(paste.nextSource);
  const pasteBlocks = topLevelBlocks(paste.nextSource, pasteRender.statements);
  check(pasteBlocks.length === 4, "粘贴后顶层块 +1");
  const inserted = pasteBlocks.filter((b) => b.from >= paste.from && b.from < paste.to);
  check(inserted.length === 1, "粘贴插入区间内恰好一个新块");
  setClipboard([]);
  check(!hasClipboard(), "清空剪贴板");

  // 上次位移记录（Ctrl+D 复用），零位移不覆盖
  clearLastMoveDelta();
  check(getLastMoveDelta() === null, "初始无上次位移");
  setLastMoveDelta(5, -3);
  check(getLastMoveDelta()?.x === 5 && getLastMoveDelta()?.y === -3, "记录上次位移");
  setLastMoveDelta(0, 0);
  check(getLastMoveDelta()?.x === 5, "零位移不覆盖已有记录");
}

console.log("F3-5 · 网格 / 标尺 / 吸附（纯逻辑）");
{
  const snapped = snapToGrid({ x: 30, y: -20 }, GRID_STEP_PT);
  check(snapped.x === GRID_STEP_PT && snapped.y === -GRID_STEP_PT, "吸附到最近网格交点");
  const near = snapToGrid({ x: 0.4, y: 0.4 }, 1);
  check(near.x === 0 && near.y === 0, "1 步长吸附 0.4 → 0");
  const half = snapToGrid({ x: 0.6, y: 0.6 }, 1);
  check(half.x === 1 && half.y === 1, "1 步长吸附 0.6 → 1");

  const vb = { x: 0, y: 0, width: GRID_STEP_PT * 3, height: GRID_STEP_PT * 2 };
  const gl = gridLines(vb, GRID_STEP_PT);
  check(gl.xs.includes(0) && gl.xs.includes(GRID_STEP_PT * 3), "竖网格线覆盖左右边界");
  check(gl.ys.length >= 3, "横网格线覆盖高度范围");
  check(gl.ys.includes(vb.height), "world y=0 的横线在 SVG 中位于底边");

  const ticks = rulerTicks(vb, GRID_STEP_PT);
  check(ticks.length === gl.xs.length, "标尺刻度数与竖网格线一致");
  check(ticks[0].cm === 0, "首个刻度 cm=0");
  check(ticks[ticks.length - 1].cm === 3, "末个刻度 cm=3（3 格）");
}

console.log("F3-6 · 统一只读判定 + 精确通道编辑键拦截（纯逻辑）");
{
  const ok = canEditDiagramSource({ previewMode: "local" });
  check(ok.ok && ok.reason === "", "本地即时通道可写源码");
  const precise = canEditDiagramSource({ previewMode: "precise" });
  check(!precise.ok && precise.reason === PRECISE_READONLY_REASON, "精确通道只读且理由统一");
  check(isPreciseReadonly(precise), "精确通道理由可被 isPreciseReadonly 识别");
  check(
    !isPreciseReadonly(canEditDiagramSource({ previewMode: "local", inGesture: true })),
    "手势理由不算精确只读（静默放行，不弹提示）",
  );
  check(
    canEditDiagramSource({ previewMode: "local", tabVisible: false }).reason === "绘图 Tab 未激活",
    "Tab 隐藏给出独立理由",
  );
  check(!canEditDiagramSource({ previewMode: "local", inTextEntry: true }).ok, "焦点在文本框不可写");
  check(!canEditDiagramSource({ previewMode: "local", inGesture: true }).ok, "手势中不可写");
  check(
    canEditDiagramSource({ previewMode: "precise", inGesture: true, inTextEntry: true }).reason ===
      PRECISE_READONLY_REASON,
    "精确通道理由优先级高于手势 / 焦点",
  );

  const ek = (key: string, o: Partial<EditKeyLike> = {}): EditKeyLike => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  });
  check(isDiagramEditKey(ek("ArrowLeft")), "方向键是编辑键");
  check(isDiagramEditKey(ek("ArrowUp", { shiftKey: true })), "Shift+方向键仍是编辑键（放大步长）");
  check(isDiagramEditKey(ek("d", { ctrlKey: true })), "Ctrl+D 是编辑键");
  check(isDiagramEditKey(ek("V", { metaKey: true })), "Cmd+V 是编辑键（大小写无关）");
  check(isDiagramEditKey(ek("c", { ctrlKey: true })), "Ctrl+C 是编辑键");
  check(!isDiagramEditKey(ek("z", { ctrlKey: true })), "Ctrl+Z 归 F2-4 撤销栈，不作为编辑键拦截");
  check(!isDiagramEditKey(ek("ArrowLeft", { altKey: true })), "Alt+方向键不拦截");
  check(!isDiagramEditKey(ek("d", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+D 不拦截");
  check(!isDiagramEditKey(ek("a")), "普通字母不是编辑键");
  // 全章收口：精确通道下每个 F3-5 编辑键都必须「只读 + 被识别为编辑键」
  const f35Keys: EditKeyLike[] = [
    ek("ArrowLeft"), ek("ArrowRight"), ek("ArrowUp"), ek("ArrowDown"),
    ek("ArrowDown", { shiftKey: true }),
    ek("c", { ctrlKey: true }), ek("v", { ctrlKey: true }), ek("d", { ctrlKey: true }),
  ];
  check(
    isPreciseReadonly(precise) && f35Keys.every((k) => isDiagramEditKey(k)),
    "精确通道只读覆盖 F3-5 全部编辑键（方向键 / Shift 方向键 / Ctrl+C/V/D）",
  );
}

console.log("F3-6 · 相邻控制点命中圈距离择优（纯逻辑）");
{
  const cands = [
    { id: "h0", x: 0, y: 0 },
    { id: "h1", x: 3, y: 0 },
    { id: "h2", x: 30, y: 0 },
  ];
  const none = pickNearestHandle(cands, { x: 100, y: 100 }, 8);
  check(none.id === null && none.overlapping === 0, "指针在全部命中圈外返回 null");
  const solo = pickNearestHandle(cands, { x: 30, y: 0 }, 8);
  check(solo.id === "h2" && solo.overlapping === 1, "不重叠时只有一个候选（调用方保持 DOM 分发零回归）");
  // 两个命中圈重叠：指针更靠近 h1，但 DOM 后绘制的 h0 会盖住 —— 择优应取 h1
  const overlap = pickNearestHandle(
    [
      { id: "h0", x: 0, y: 0 },
      { id: "h1", x: 3, y: 0 },
    ],
    { x: 2.6, y: 0 },
    8,
  );
  check(overlap.overlapping === 2, "两个控制点都落在 hitR 内 → 判定为重叠");
  check(overlap.id === "h1", "重叠时选距离指针更近的控制点（不按 DOM 绘制顺序）");
  check(Math.abs(overlap.distance - 0.4) < 1e-9, "返回最近距离便于回归断言");
  const tie = pickNearestHandle(
    [
      { id: "a", x: 1, y: 1 },
      { id: "b", x: 1, y: 1 },
    ],
    { x: 1, y: 1 },
    5,
  );
  check(tie.overlapping === 2 && tie.id === "a", "严格重合时按输入顺序取先者（结果确定）");
  const scaled = pickNearestHandle(
    [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 6, y: 0 },
    ],
    { x: 5.5, y: 0 },
    16,
  );
  check(scaled.id === "b" && scaled.overlapping === 2, "大 hitR（低缩放）下仍能择优");
  const dirty = pickNearestHandle(
    [
      { id: "", x: NaN, y: 0 },
      { id: "ok", x: 1, y: 1 },
    ],
    { x: 1, y: 1 },
    4,
  );
  check(dirty.id === "ok" && dirty.overlapping === 1, "空 id / NaN 坐标候选被过滤");
}

console.log("F3-6 · F2-3 挂锁 / F2-4 撤销栈联动抽查（端到端）");
{
  // F3-5 的 nudge / 对齐 / Ctrl+D 都走 applyDeltaEdit → planGroupMove，
  // 其内部 resolveHandleLock 让能力矩阵锁定的构造被跳过，绝不静默改语义。
  const lockPlan = await applyDeltaEdit({
    source: FOREACH_SRC,
    handles: foreachRender.handles,
    deltas: { "foreach:0": { x: 20, y: 0 } },
    compat: foreachRender.compat,
    grouping: EMPTY_GROUPING,
  });
  check(
    lockPlan.status !== "ok" || lockPlan.movedElements.length === 0,
    "F2-3 挂锁联动：nudge 不会移动 \\foreach 展开构造",
  );
  check(
    lockPlan.skipped.some((s) => s.id === "foreach:0" || s.id === "*"),
    "被跳过的锁定图元给出 skipped 理由（与画布挂锁同源）",
  );
  // 只读判定在入口，写回规划本身仍可独立工作（UI 守卫禁止在精确通道调用它）。
  const zSrc = `\\begin{tikzpicture}\n  \\draw (0,0) circle (1);\n  \\fill (3,0) circle (1);\n\\end{tikzpicture}`;
  const zr = await renderTikz(zSrc);
  const zEdit = planZOrderEdit(zSrc, zr.statements, [topLevelBlocks(zSrc, zr.statements)[0].id], "front");
  check(
    !!zEdit && !canEditDiagramSource({ previewMode: "precise" }).ok,
    "F1-6 精确通道只读在入口拦截：写回规划可用但该通道不允许调用",
  );
}

console.log("F3-6 补充 · 命名坐标重复句柄不再遮挡节点拖拽（F2-3 安全收口）");
{
  const NAMED_SRC = String.raw`\begin{tikzpicture}
\draw[thick, rounded corners] (0,0) rectangle (3,2);
  \node[draw, circle, fill=blue!20] (a) at (0.88,1.31) {A};
  \node[draw, circle, fill=red!20] (b) at (1.96,0.9) {B};
\draw[->, thick] (a) -- (b);
\end{tikzpicture}`;
  const nr = await renderTikz(NAMED_SRC);
  const nodeHandles = nr.handles.filter((h) => h.kind === "node-position");
  const namedHandles = nr.handles.filter((h) => h.coordinateForm === "named");
  check(nodeHandles.length === 2 && namedHandles.length === 2, "箭头两端命名坐标与两个节点 position 句柄同时存在");
  const shadowed = shadowedLockedHandleIds(nr.handles, nr.compat);
  check(shadowed.size === 2 && namedHandles.every((h) => shadowed.has(h.id)), "与可写节点句柄重合的两条命名坐标锁被识别为重复句柄");
  check(nodeHandles.every((h) => !shadowed.has(h.id)), "节点自身 position 句柄绝不进抑制集合");

  const N_SVG = g.document.createElementNS(H_NS, "svg");
  const N_LAYER = buildHandleLayer(N_SVG, nr.handles, nr.viewBox, nr.compat, H_M1);
  check(N_LAYER.querySelectorAll("g.dg-handle-lock").length === 0, "画布上两条重复挂锁不再渲染");
  check(namedHandles.every((h) => !N_SVG.querySelector(`[data-dg-hit-id="${h.id}"]`)), "重复命名坐标句柄的命中圈一并移除，不再抢走节点拖拽");
  check(nodeHandles.every((h) => !!N_SVG.querySelector(`[data-dg-hit-id="${h.id}"]`)), "节点 position 句柄仍完整可点可拖");

  const oneNamed = namedHandles[0];
  const shifted = {
    ...oneNamed,
    id: "handle:named:shifted",
    world: { x: oneNamed.world.x + 5, y: oneNamed.world.y },
  };
  check(!shadowedLockedHandleIds([...nr.handles, shifted], nr.compat).has(shifted.id), "坐标不重合的命名坐标仍保留挂锁");
  const polar = {
    ...oneNamed,
    id: "handle:polar:shifted",
    coordinateForm: "polar" as typeof oneNamed.coordinateForm,
  };
  check(!shadowedLockedHandleIds([...nr.handles, polar], nr.compat).has(polar.id), "极坐标锁定不在抑制范围");
  const sameStmt = {
    ...oneNamed,
    id: "handle:named:same-stmt",
    sourceRef: { ...oneNamed.sourceRef!, sourceId: nodeHandles[0].sourceRef!.sourceId },
  };
  check(!shadowedLockedHandleIds([...nr.handles, sameStmt], nr.compat).has(sameStmt.id), "同一语句内的重合句柄不互相抑制");

  const firstNode = nodeHandles[0];
  const paired = namedHandles.find(
    (h) => Math.abs(h.world.x - firstNode.world.x) <= 1e-6 && Math.abs(h.world.y - firstNode.world.y) <= 1e-6,
  )!;
  const compatLocked = {
    ...nr.compat,
    handleReasons: { ...nr.compat.handleReasons, [firstNode.id]: "测试：能力矩阵锁定" },
  };
  const shLocked = shadowedLockedHandleIds(nr.handles, compatLocked);
  check(shLocked.size === 1 && !shLocked.has(paired.id), "可写节点被能力矩阵锁定时，对应命名坐标挂锁保留");
  check(shadowedLockedHandleIds(nr.handles.filter((h) => h.kind !== "node-position"), nr.compat).size === 0, "没有节点句柄承接时绝不静默解锁命名坐标");
}

console.log("F3-7 · 固定画布尺寸 / 主文档推断 / 视角纯逻辑");
{
  check(
    Math.abs(CM_TO_PT - 28.45275590551181) < 1e-9,
    "cm→pt 与 F3-1 探针实测一致（1cm=28.45275590551181pt）",
  );
  const a4 = normalizeCanvasSize(CANVAS_PRESETS.a4);
  check(a4.preset === "a4" && a4.widthCm === 15, "A4 预设正文宽 15cm");
  check(
    normalizeCanvasSize({ preset: "nonsense", widthCm: 1 }).preset === DEFAULT_CANVAS_SIZE.preset,
    "非法预设回退到 A4 兜底",
  );
  const custom = normalizeCanvasSize({ preset: "custom", widthCm: 12.5, heightCm: 18 });
  check(custom.preset === "custom" && custom.widthCm === 12.5 && custom.heightCm === 18, "自定义 W×H 保留");
  const badCustom = normalizeCanvasSize({ preset: "custom", widthCm: NaN, heightCm: -3 }, custom);
  check(badCustom.widthCm === 12.5 && badCustom.heightCm === 18, "自定义非法数值回退、不产出 NaN");
  check(normalizeCanvasSize({ preset: "auto" }).widthCm === 0, "自适应尺寸为零（不画纸张层）");
  check(canvasSizeForPreset("a5", custom).widthCm === 10.5, "切预设覆盖自定义尺寸");
  const pt = canvasSizeToPt(a4);
  check(Math.abs(pt.widthPt - 15 * CM_TO_PT) < 1e-6, "A4 正文宽换算为 world pt");
  const vb = { x: -10, y: -10, width: 100, height: 80 };
  const paper = canvasPaperRect(a4, vb);
  check(!!paper && Math.abs(paper.width - pt.widthPt) < 1e-6, "纸张框宽=正文宽 pt");
  check(
    !!paper &&
      Math.abs(paper.x - (vb.x + vb.width / 2 - pt.widthPt / 2)) < 1e-6 &&
      Math.abs(paper.y - (vb.y + vb.height / 2 - pt.heightPt / 2)) < 1e-6,
    "纸张框以图形包围盒中心为纸面中心（不再锚在 world 原点）",
  );
  const paperShift = canvasPaperRect(a4, { x: 200, y: 120, width: 60, height: 40 });
  check(
    !!paperShift &&
      Math.abs(paperShift.x + paperShift.width / 2 - 230) < 1e-6 &&
      Math.abs(paperShift.y + paperShift.height / 2 - 140) < 1e-6,
    "图元整体平移后纸张框仍跟着内容居中",
  );
  check(canvasPaperRect({ preset: "auto", widthCm: 0, heightCm: 0 }, vb) === null, "自适应不生成纸张框");
  check(canvasSizeLabel(a4).includes("15.0×10.0"), "尺寸说明含正文宽高");
  check(a4.heightCm === DEFAULT_CANVAS_HEIGHT_CM, "预设高度取默认工作区高度，不铺满整张纸");
  check(
    normalizeCanvasSize({ preset: "a4", heightCm: 99 }).heightCm === presetMaxHeightCm("a4"),
    "高度被钳制在该纸张正文高以内",
  );
  check(
    canvasSizeForPreset("a4", a4).heightCm === DEFAULT_CANVAS_HEIGHT_CM &&
      !("maxHeightCm" in canvasSizeForPreset("a4", a4)),
    "预设切换不把 maxHeightCm 带进存储的尺寸对象",
  );

  check(lengthToCm("15cm") === 15, "cm 长度解析");
  check(Math.abs((lengthToCm("150mm") ?? 0) - 15) < 1e-9, "mm 长度解析");
  check(Math.abs((lengthToCm("425.2pt") ?? 0) - 15) < 0.01, "pt 长度解析");
  check(lengthToCm("not-a-length") === null, "非法长度返回 null");
  const docA4 = inferDocumentPaper("\\documentclass[a4paper,11pt]{article}\n\\begin{document}x\\end{document}");
  check(docA4.preset === "a4" && docA4.source === "document", "从 documentclass 推断 A4");
  check(docA4.widthCm === 15 && docA4.detail.includes("a4paper"), "推断值取正文宽且给出来源");
  check(
    docA4.heightCm === DEFAULT_CANVAS_HEIGHT_CM && docA4.maxHeightCm === presetMaxHeightCm("a4"),
    "推断高度取默认工作区并带出纸张正文高上限",
  );
  const docA5 = inferDocumentPaper("\\documentclass[a5paper]{article}");
  check(
    docA5.preset === "a5" && docA5.heightCm <= presetMaxHeightCm("a5"),
    "A5 文档的默认高度不超过 A5 正文高",
  );
  const docGeom = inferDocumentPaper(
    "\\documentclass{article}\n\\usepackage[textwidth=14cm]{geometry}\n\\setlength{\\textwidth}{13cm}",
  );
  check(docGeom.widthCm === 14, "geometry 的 textwidth 优先于 setlength");
  const docFallback = inferDocumentPaper("\\begin{tikzpicture}\\draw(0,0)--(1,1);\\end{tikzpicture}");
  check(
    docFallback.preset === "a4" && docFallback.source === "fallback" && docFallback.detail.includes("A4"),
    "片段 / 无声明兜底 A4 并提示",
  );

  check(clampZoom(99) === MAX_ZOOM && clampZoom(0) === MIN_ZOOM, "缩放钳位在 25%–1600%");
  check(clampZoom(NaN) === 1, "非法缩放回落到 1");
  const pv = normalizeViewport({ zoom: 99, panX: NaN, panY: 12 });
  check(pv.zoom === MAX_ZOOM && pv.panX === 0 && pv.panY === 12, "视角归一化逐字段收敛");
  check(panBy(pv, 10, -5).panX === 10 && panBy(pv, 10, -5).panY === 7, "平移只改 pan");
  check(viewportTransform({ zoom: 1, panX: 24, panY: -8 }).includes("24.00px"), "容器 transform 含 pan");
  check(
    !viewportTransform({ zoom: 1, panX: 0, panY: 0 }).includes("50%"),
    "容器 transform 不带 -50% 位移（容器已 inset:0，否则内容整体偏左上）",
  );
  check(centerViewport().zoom === 1 && centerViewport().panX === 0, "居中重置视角");

  const stage = { x: 100, y: 50, width: 400, height: 300 };
  const ptr = { x: 380, y: 120 };
  const v0 = { zoom: 1, panX: 20, panY: -10 };
  const v1 = zoomAtPointer(v0, ptr, stage, 2);
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  check(
    Math.abs((ptr.x - cx - v1.panX) - (ptr.x - cx - v0.panX) * 2) < 1e-6 &&
      Math.abs((ptr.y - cy - v1.panY) - (ptr.y - cy - v0.panY) * 2) < 1e-6,
    "指针锚点缩放：锚点下 SVG 点屏幕偏移按 zoom 比例保持",
  );
  check(zoomStep(v0, -100, ptr, stage).zoom > v0.zoom, "滚轮向上放大");
  check(zoomStep(v0, 100, ptr, stage).zoom < v0.zoom, "滚轮向下缩小");
  check(zoomAtPointer(v0, ptr, { x: 0, y: 0, width: 0, height: 0 }, 2).panX === v0.panX, "退化 stage 不移动 pan");
  const fitContent = fitTo(vb, vb);
  check(fitContent.zoom === 1 && fitContent.panX === 0, "适应内容 = 适应窗口（zoom 1）");
  check(fitTo({ width: 200, height: 160 }, vb).zoom === 0.5, "适应画布按 target/viewBox 比例缩放");
  check(pointerFromStageCenter(ptr, stage, v0).x === 60, "指针相对中心偏移已扣 pan");

  // F3-7：zoom=1 必须是「整张固定画布完整可见」，而不是「内容包围盒铺满窗口」。
  const st = { x: 0, y: 0, width: 800, height: 600 };
  const vb2 = { x: -12, y: -12, width: 110, height: 82 };
  const paper2 = { x: 0, y: 0, width: 426, height: 702 };
  const baseContent = Math.min(st.width / vb2.width, st.height / vb2.height);
  const baseCanvas = Math.min(st.width / paper2.width, st.height / paper2.height);
  const pct1 = renderScale(1, st, vb2, paper2);
  check(Math.abs(pct1 - baseCanvas / baseContent) < 1e-9, "zoom=1 → pct = 画布基准/内容基准");
  check(
    paper2.width * pct1 * baseContent <= st.width + 1e-6 &&
      paper2.height * pct1 * baseContent <= st.height + 1e-6,
    "zoom=1 时整张纸宽高都不超出视口（不再一放大就裁）",
  );
  check(renderScale(1, st, vb2, null) === 1, "无固定画布时 pct 退回 zoom（F1-6 现状）");
  check(renderScale(2, st, vb2, paper2) > pct1, "放大提高 pct（推近）");
  const contentZoom = fitContentZoom(st, vb2, paper2);
  check(contentZoom > 1, "适应内容倍率 > 1（内容比纸小）");
  check(Math.abs(renderScale(contentZoom, st, vb2, paper2) - 1) < 1e-9, "适应内容时 pct=1（内容铺满窗口）");
  check(fitContentZoom(st, vb2, null) === 1, "无画布时适应内容 = 1");

  // 纸张框不以 viewBox 中心对称：适应画布必须同时把纸张中心平移到窗口中心。
  const fitCv = fitCanvasViewport(st, vb2, paper2);
  const canvasScale = Math.min(st.width / paper2.width, st.height / paper2.height);
  const screenCx = st.width / 2 + fitCv.panX + (paper2.x + paper2.width / 2 - (vb2.x + vb2.width / 2)) * canvasScale;
  const screenCy = st.height / 2 + fitCv.panY + (paper2.y + paper2.height / 2 - (vb2.y + vb2.height / 2)) * canvasScale;
  check(fitCv.zoom === 1, "适应画布 zoom=1");
  check(Math.abs(screenCx - st.width / 2) < 1e-6, "适应画布：纸张中心对齐窗口中心（X）");
  check(Math.abs(screenCy - st.height / 2) < 1e-6, "适应画布：纸张中心对齐窗口中心（Y）");
  check(fitCanvasViewport(st, vb2, null).panX === 0, "无画布时适应画布不偏移");

  const keyCanvasOn = previewKey(LIB_SRC, "xelatex", {
    widthPt: pt.widthPt,
    heightPt: pt.heightPt,
    useCanvas: true,
  });
  const keyCanvasOther = previewKey(LIB_SRC, "xelatex", {
    widthPt: 400,
    heightPt: pt.heightPt,
    useCanvas: true,
  });
  const keyCanvasOff = previewKey(LIB_SRC, "xelatex", {
    widthPt: pt.widthPt,
    heightPt: pt.heightPt,
    useCanvas: false,
  });
  check(keyCanvasOn !== keyA, "按画布导出打开时缓存 key 与现状不同");
  check(keyCanvasOn !== keyCanvasOther, "画布尺寸变化 key 变化（防串图）");
  check(keyCanvasOff === keyA, "开关关闭时 key 与现状完全一致（零回归）");
}


console.log("\nF4-1 · 节点尺寸键 / 最小补丁 / 按轴拖拽 / 共享样式");
{
  // ① 尺寸键与数值白名单（含空格键、正向白名单天然拒绝注入字符）
  check(SIZE_KEYS.includes("text width") && SIZE_KEYS.includes("minimum height"), "尺寸键白名单含空格键 text width / minimum height");
  check(isSizeKey("inner sep") && !isSizeKey("scale"), "isSizeKey 只认尺寸键、不认 F3-4 的 scale");
  const nOk = normalizeSizeValue("text width", "3cm");
  check("value" in nOk && nOk.value === "3cm", "text width=3cm 放行（含空格键）");
  const nPt = normalizeSizeValue("minimum height", "40");
  check("value" in nPt && nPt.value === "40pt", "纯数字按 pt 补全");
  check("error" in normalizeSizeValue("text width", "3cm, red"), "含逗号的值被拒绝");
  check("error" in normalizeSizeValue("text width", "\\mywidth"), "含反斜杠的值被拒绝");
  check("error" in normalizeSizeValue("text width", "3cm}"), "含花括号的值被拒绝");
  check("error" in normalizeSizeValue("text width", "-2cm"), "负数尺寸被拒绝");
  check(Math.abs(Number(ptToSizeString(28.45275590551181, "cm").replace("cm", "")) - 1) < 1e-6, "world pt → cm 字符串换算正确");
  check(Math.abs((sizeValueToPt("3cm") ?? 0) - 3 * 28.45275590551181) < 1e-6, "读取 text width=3cm 换算回 world pt");
  check(sizeValueToPt("40pt") === 40, "读取 40pt 换算正确");
  check(sizeValueToPt("bad") === null && sizeValueToPt(null) === null, "非法 / 空尺寸值返回 null（回退到视觉外接框）");

  // ② 按轴拖拽：边中柄只改一个轴，角柄两键分别写、绝不合并成 scale
  const axisX = sizeValuesFromDrag({ baseWidthPt: 100, baseHeightPt: 60, sx: 1.5, sy: 2.2, corner: 3 });
  check(axisX.width !== null && axisX.height === null, "右中柄只写 text width（X 轴）");
  const axisY = sizeValuesFromDrag({ baseWidthPt: 100, baseHeightPt: 60, sx: 1.5, sy: 2.2, corner: 1 });
  check(axisY.width === null && axisY.height !== null, "上中柄只写 minimum height（Y 轴）");
  const cornerBoth = sizeValuesFromDrag({ baseWidthPt: 100, baseHeightPt: 60, sx: 1.5, sy: 2.2, corner: 4 });
  check(cornerBoth.width !== null && cornerBoth.height !== null, "角柄两轴都写");
  check(cornerBoth.width !== cornerBoth.height, "角柄 sx/sy 分别生效，不合并成单一比例");
  check(sizeValuesFromDrag({ baseWidthPt: 0, baseHeightPt: 0, sx: 1, sy: 1, corner: 0 }).width === null, "零基准不产出非法尺寸");

  // ③ 单语句最小 span 补丁：插入 / 替换 / 移除 / 保持其余选项与注释
  const SZ_SRC = String.raw`\begin{tikzpicture}
  % 保留这一行注释
  \node[draw] (a) at (0,0) {A};
  \node[draw, text width=2cm] (b) at (3,0) {B};
  \node[draw] (c) at (6,0) {C};
  \draw (0,-1) -- (6,-1);
\end{tikzpicture}`;
  const sz = await renderTikz(SZ_SRC);
  const nodes = sz.statements.filter((s) => s.command === "node");
  check(nodes.length === 3, "解析出 3 条 \\node 语句");
  const pIns = planSizePatch(SZ_SRC, nodes[0], { "text width": "4cm", "minimum height": "2cm" });
  check(pIns.status === "ok" && pIns.patches.length === 1, "两个新增尺寸键合并成单个不重叠补丁");
  if (pIns.status === "ok") {
    const merged = mergeSourcePatches(SZ_SRC, pIns.patches);
    check(!!merged && merged.nextSource.includes("[draw, text width=4cm, minimum height=2cm]"), "新增 W/H 写进同一选项块");
    check(!!merged && merged.nextSource.includes("% 保留这一行注释"), "注释一字不改");
    check(!!merged && merged.nextSource.split("\n").length === SZ_SRC.split("\n").length, "换行数量不变");
  }
  const pRep = planSizePatch(SZ_SRC, nodes[1], { "text width": "4cm" });
  check(pRep.status === "ok", "已有 text width 走替换");
  if (pRep.status === "ok") {
    const merged = mergeSourcePatches(SZ_SRC, pRep.patches);
    check(!!merged && merged.nextSource.includes("text width=4cm") && !merged.nextSource.includes("text width=2cm"), "替换后旧值消失、无重复键");
  }
  const pDel = planSizePatch(SZ_SRC, nodes[1], { "text width": null });
  check(pDel.status === "ok", "移除尺寸键生成补丁");
  if (pDel.status === "ok") {
    const merged = mergeSourcePatches(SZ_SRC, pDel.patches);
    check(!!merged && !merged.nextSource.includes("text width"), "移除后源码不含该键");
    check(!!merged && merged.nextSource.includes("[draw]"), "移除时其余选项原样保留");
  }
  check(planSizePatch(SZ_SRC, nodes[1], { "text width": "2cm" }).status === "noop", "已是该值时 noop");
  check(planSizePatch(SZ_SRC, nodes[1], { "text width": "3cm, red" }).status === "error", "非法值整次不写");
  const drawStmt = sz.statements.find((s) => s.command === "draw");
  check(!!drawStmt && planSizePatch(SZ_SRC, drawStmt!, { "text width": "3cm" }).status === "error", "\\draw 不写节点尺寸选项");

  // ④ 批量：一次 dispatch = 一条 Ctrl+Z；锁定逐元素 skip、不半写
  const pAll = planSizePatches({
    source: SZ_SRC, statements: sz.statements,
    elementIds: nodes.map((n) => n.id),
    values: { "text width": "4cm", "minimum height": "2cm" },
    compat: sz.compat, grouping: EMPTY_GROUPING,
  });
  check(pAll.status === "ok" && pAll.changedIds.length === 3, "3 个节点批量改尺寸");
  check(pAll.nextSource.split("text width=4cm").length - 1 === 3, "批量后 3 处 text width 生效");
  check(pAll.patches.length > 0 && !!mergeSourcePatches(SZ_SRC, pAll.patches), "批量补丁互不重叠、可一次合并");
  const pLocked = planSizePatches({
    source: SZ_SRC, statements: sz.statements,
    elementIds: nodes.map((n) => n.id),
    values: { "text width": "4cm" },
    compat: { ...emptyCompatReport(), lockReasons: { [nodes[0].id]: "测试锁定" } },
    grouping: EMPTY_GROUPING,
  });
  check(pLocked.skipped.length === 1 && pLocked.changedIds.length === 2, "能力矩阵锁定逐元素跳过、其余照常写");
  const pManual = planSizePatches({
    source: SZ_SRC, statements: sz.statements,
    elementIds: nodes.map((n) => n.id),
    values: { "text width": "4cm" },
    compat: sz.compat,
    grouping: { ...EMPTY_GROUPING, lockedIds: [nodes[1].id] },
  });
  check(pManual.skipped.length === 1 && pManual.skipped[0].reason.includes("锁定"), "主动锁定跳过并给理由");

  // ⑤ 共享 .style 只读扫描：UI 提示 + 同类集合，绝不伪装成 TikzStatement
  const SS_SRC = String.raw`\begin{tikzpicture}[box/.style={draw, text width=2cm, minimum height=1cm}]
  \node[box] (a) at (0,0) {A};
  \node[box] (b) at (3,0) {B};
  \node[draw] (c) at (6,0) {C};
\end{tikzpicture}`;
  const defs = scanSharedStyles(SS_SRC);
  const boxDef = defs.find((d) => d.name === "box");
  check(!!boxDef, "扫描到环境选项里的 box/.style 定义");
  check(!!boxDef && boxDef.sizeKeys.includes("text width") && boxDef.sizeKeys.includes("minimum height"), "共享样式含 text width / minimum height");
  check(!!boxDef && boxDef.definitionSpan.from > 0 && boxDef.definitionSpan.to > boxDef.definitionSpan.from, "定义处 span 合法");
  const ss = await renderTikz(SS_SRC);
  const ssNodes = ss.statements.filter((s) => s.command === "node");
  check(ssNodes.length === 3, "带环境选项的源码仍被上游解析（探针结论）");
  check(styleNamesForStatement(ssNodes[0], defs).includes("box"), "选中节点继承共享样式 box");
  check(!styleNamesForStatement(ssNodes[2], defs).includes("box"), "未使用 box 的节点不被误判为同类");
  check(findStyleUsers(defs, ss.statements, ["box"]).length === 2, "同类集合恰好是 2 个 box 节点");
  const hint = sharedStyleHint(defs, ["box"]);
  check(!!hint && hint.includes("共享 .style"), "属性坞提示条含共享样式名");
  check(scanSharedStyles(SZ_SRC).length === 0, "无共享样式时零命中、不抛异常");
  check(sharedStyleHint(defs, []) === null, "未继承样式时不显示提示条");
  const TIKZSET_SRC = String.raw`\tikzset{frame/.style={draw, inner sep=4pt}}
\begin{tikzpicture}
  \node[frame] at (0,0) {A};
\end{tikzpicture}`;
  const setDefs = scanSharedStyles(TIKZSET_SRC);
  check(setDefs.some((d) => d.name === "frame" && d.sizeKeys.includes("inner sep")), "扫描 \\tikzset 里的 .style 尺寸定义");

  // ⑥ 精确通道只读：统一判定覆盖所有写源码入口
  const precise = canEditDiagramSource({ previewMode: "precise" });
  check(!precise.ok && isPreciseReadonly(precise), "精确通道返回统一只读理由（尺寸柄 / W-H 面板 / 应用开关共用）");
  check(canEditDiagramSource({ previewMode: "local" }).ok, "本地即时通道可写尺寸");
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
