// P0 spike · 探针 A：上游 vendor 引擎能否承载「图片节点」+ 本地 SVG 坐标口径
// 跑法：node scripts/diagram-image-engine-probe.mjs
// 只读：仅 import vendor bundle 并在内存里渲染，不写任何文件、不改产品代码。
// 结论写回 docs/dev/绘图模块/绘图模块-图片插入切片计划.md §3「实证结论」。
const VENDOR = new URL("../src/modules/diagram/tikzEditor/vendor/engine.bundle.js", import.meta.url);
const mod = await import(VENDOR.href);

const env = (body) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
const compact = (v) => JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : x));

/** 从 SVG 字符串里抽取根层 transform / path d / 文本，供坐标口径与「字面量」判定 */
function inspectSvg(svg) {
  const rootAttrs = (svg.match(/<svg\b[^>]*>/i) ?? [""])[0];
  const transforms = [...svg.matchAll(/<g\b[^>]*\btransform="([^"]*)"/gi)].map((m) => m[1]);
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/gi)].map((m) => m[1]);
  const textTags = [...svg.matchAll(/<text\b[^>]*>/gi)].map((m) => m[0]);
  const texts = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, "").trim(),
  );
  const sourceIds = [...new Set([...svg.matchAll(/data-source-id="([^"]*)"/gi)].map((m) => m[1]))];
  return {
    rootAttrs: rootAttrs.slice(0, 260),
    transforms: transforms.slice(0, 4),
    paths: paths.slice(0, 3),
    textTags: textTags.slice(0, 4),
    texts: texts.slice(0, 6),
    sourceIds,
    hasImageTag: /<image\b/i.test(svg),
    includesLatexLiteral: /includegraphics|pgfimage/i.test(svg),
  };
}

function probe(label, body) {
  const src = env(body);
  let r;
  try {
    r = mod.renderTikzToSvg(src);
  } catch (e) {
    console.log(`\n### ${label}\n  渲染抛错: ${e.message}`);
    return { label, error: e.message };
  }
  const svgText = r.svg?.svg ?? "";
  const figure = r.parse?.figure;
  const statements = (figure?.body ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    command: s.command ?? s.type,
    span: s.span,
    hasOptions: !!s.options,
    items: (s.items ?? []).map((i) => i.kind),
    text: s.text ?? s.content ?? undefined,
  }));
  const handles = (r.semantic?.editHandles ?? []).map((h) => ({
    id: h.id,
    world: h.world,
    rewriteMode: h.rewriteMode,
    sourceText: h.sourceText,
  }));
  const diags = [
    ...(r.parse?.diagnostics ?? []),
    ...(r.semantic?.diagnostics ?? []),
    ...(r.svg?.diagnostics ?? []),
    ...(r.renderDiagnostics ?? []),
  ].map((d) => `${d.severity ?? "?"}:${d.code ?? ""}:${d.message ?? ""}`);
  const usage = Object.entries(r.semantic?.featureUsage ?? {}).filter(([, v]) => v && v !== "unused");
  const svgInfo = inspectSvg(svgText);

  console.log(`\n### ${label}`);
  console.log("  src:", src.replace(/\n/g, " | "));
  console.log("  viewBox:", compact(r.svg?.viewBox));
  console.log("  svg.root:", svgInfo.rootAttrs);
  console.log("  g[transform]:", compact(svgInfo.transforms));
  console.log("  path[d]:", compact(svgInfo.paths));
  console.log("  <text> 开标签:", compact(svgInfo.textTags));
  console.log("  text[]:", compact(svgInfo.texts));
  console.log("  data-source-id:", compact(svgInfo.sourceIds));
  console.log("  <image> 标签:", svgInfo.hasImageTag, " / 含 includegraphics 字面量:", svgInfo.includesLatexLiteral);
  console.log("  statements:", compact(statements));
  console.log("  editHandles:", compact(handles));
  console.log("  semantic 字段:", compact(Object.keys(r.semantic ?? {})));
  console.log("  nodeTexts:", compact(r.semantic?.nodeTexts ?? null));
  console.log("  diagnostics:", compact(diags));
  console.log("  featureUsage(used):", compact(usage));

  return { label, src, r, statements, handles, diags, usage, svgInfo };
}

console.log("=== P0-1 · 上游能否解析图片节点 ===");
const imageNode = probe(
  "图片 node（计划里 P3 生成的形态）",
  String.raw`  \node at (1,2) {\includegraphics[width=3cm]{figure/x.png}};`,
);
probe(
  "图片 node + inner sep / 无 width 选项",
  String.raw`  \node[inner sep=0pt] at (0,0) {\includegraphics{x.png}};`,
);
probe("纯文本 node（对照组）", String.raw`  \node at (1,2) {plain text};`);
probe("独立 \\pgfimage 语句（带分号）", String.raw`  \pgfimage[width=3cm]{x.png};`);
probe("图片 node + 普通 node 混排（确认不互相干扰）", String.raw`  \node at (0,0) {A};
  \node at (2,2) {\includegraphics[width=2cm]{x.png}};`);

console.log("\n=== P0-2 · 引擎 SVG 坐标口径 ===");
const axis = probe("坐标轴基准 (0,0) → (1,1)", String.raw`  \draw (0,0) -- (1,1);`);
const yAxis = probe("Y 方向基准 (0,0) → (0,2)", String.raw`  \draw (0,0) -- (0,2);`);
probe("node 在 (1,2) 的位置", String.raw`  \node at (1,2) {P};`);
const mixed = probe(
  "path + node 混排（验证 text 与 path 是否同一套 Y 口径）",
  String.raw`  \draw (0,0) -- (0,2);
  \node at (0,2) {P};`,
);

console.log("\n=== Y 翻转公式验证（svgY = C − worldY） ===");
function deriveAxis(caseInfo) {
  const d = (caseInfo.svgInfo?.paths ?? [])[0] ?? "";
  const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (nums.length < 4) return null;
  // path 的前两个点对应 path:0 语句的两个 path-point 句柄
  const hs = (caseInfo.handles ?? []).slice(0, 2).map((h) => h.world);
  const svgYs = [nums[1], nums[3]];
  const fittedC = hs.map((w, i) => Math.round((svgYs[i] + w.y) * 10000) / 10000);
  return {
    pathD: d,
    worldYs: hs.map((w) => w.y),
    svgYs,
    fittedC,
    consistent: fittedC[0] === fittedC[1],
  };
}
const derived = [deriveAxis(axis), deriveAxis(yAxis), deriveAxis(mixed)];
console.log(compact(derived));
console.log("  纯 path 场景：C = maxWorldY；混排场景 C 由整体 bbox 决定（含文字度量），不等于 maxWorldY。");
console.log("  ⇒ 禁止自行从 world 推 SVG 坐标；P4 应直接复用 <text data-source-id=…> 的 x/y 锚点。");

console.log("\n=== 汇总（机器可读） ===");
const summary = {
  engineHasImageTag: imageNode.svgInfo?.hasImageTag ?? false,
  engineShowsLatexLiteral: imageNode.svgInfo?.includesLatexLiteral ?? null,
  imageNodeStatements: imageNode.statements ?? [],
  imageNodeHandles: (imageNode.handles ?? []).map((h) => ({
    id: h.id, world: h.world, rewriteMode: h.rewriteMode,
  })),
  imageNodeDiagnostics: imageNode.diags ?? [],
  imageNodeFeatureUsage: imageNode.usage ?? [],
  imageNodeTextTag: imageNode.svgInfo?.textTags?.[0] ?? null,
  imageNodeSourceIds: imageNode.svgInfo?.sourceIds ?? [],
  fittedYAxisConstants: derived.map((d) => d?.fittedC ?? null),
  axisViewBox: axis.r?.svg?.viewBox ?? null,
  axisRootAttrs: axis.svgInfo?.rootAttrs ?? null,
  axisGroupTransforms: axis.svgInfo?.transforms ?? [],
  axisPaths: axis.svgInfo?.paths ?? [],
  unitScalePtPerCm: 28.45275590551181,
};
console.log(JSON.stringify(summary, null, 2));
console.log("\n探针 A 结束（未写任何文件）。");
