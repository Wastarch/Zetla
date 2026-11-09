// M2·F1-3 · 绘图引擎纯逻辑回归测试
// 跑法：node --experimental-strip-types scripts/diagram-render.test.ts
// 依赖 node_modules/jsdom（项目已有），不需要浏览器 / Tauri 运行时。
import { JSDOM } from "jsdom";
import {
  renderTikz,
  clearTikzRenderCache,
  applyDragEdit,
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
import { shouldHandleHistoryKey } from "../src/modules/diagram/diagramHistory.ts";
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

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
