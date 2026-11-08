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
  dragDeltaLabel,
  isDraggableHandle,
  lockedHandleReason,
  singleSpanPatch,
  svgDeltaToWorldDelta,
  worldToSvgPoint,
} from "../src/modules/diagram/dragEdit.ts";
import {
  hasDrawableContent,
  sanitizeSvg,
} from "../src/modules/diagram/tikzEditor/svg.ts";
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

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
