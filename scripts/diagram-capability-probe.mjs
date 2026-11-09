// M2·F3-1 前置调研：上游 tikz-editor capability 探针（可重复跑）。
// 跑法：node scripts/diagram-capability-probe.mjs
// 目的：确认「形状工具生成的语句」在上游的解析 / 渲染 / 编辑边界，
//       以及 world(pt) ↔ TikZ(cm) 的换算系数。结论写进 docs/dev/绘图模块开发计划.md §7。
// 注意：不注入 document —— 让引擎走 Node 路径，避免 jsdom 缺少 canvas 文字度量。
const VENDOR = new URL("../src/modules/diagram/tikzEditor/vendor/engine.bundle.js", import.meta.url);
const mod = await import(VENDOR.href);

const env = (body) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
const compact = (v) => JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 10000) / 10000 : x));

function probeShape(label, body) {
  const src = env(body);
  let r;
  try {
    r = mod.renderTikzToSvg(src);
  } catch (e) {
    console.log(`\n### ${label}\n  渲染抛错: ${e.message}`);
    return { label, src, error: e.message };
  }
  const figure = r.parse?.figure;
  const statements = (figure?.body ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    command: s.command ?? s.type,
    span: s.span,
    hasOptions: !!s.options,
    items: (s.items ?? []).map((i) => i.kind),
  }));
  const handles = (r.semantic?.editHandles ?? []).slice(0, 6).map((h) => ({
    id: h.id,
    world: h.world,
    rewriteMode: h.rewriteMode,
    sourceId: h.sourceRef?.sourceId,
    sourceText: h.sourceText,
  }));
  const diags = [
    ...(r.parse?.diagnostics ?? []),
    ...(r.semantic?.diagnostics ?? []),
    ...(r.svg?.diagnostics ?? []),
    ...(r.renderDiagnostics ?? []),
  ].map((d) => `${d.severity ?? "?"}:${d.code ?? ""}:${d.message ?? ""}`);
  const sourceIds = [...new Set((r.svg?.svg ?? "").match(/data-source-id="[^"]*"/g) ?? [])];
  const usage = Object.entries(r.semantic?.featureUsage ?? {}).filter(
    ([, v]) => v && v !== "unused",
  );
  console.log(`\n### ${label}`);
  console.log("  viewBox:", compact(r.svg?.viewBox));
  console.log("  statements:", compact(statements));
  console.log("  handles:", compact(handles));
  console.log("  data-source-id:", compact(sourceIds));
  console.log("  diagnostics:", compact(diags.slice(0, 6)));
  console.log("  featureUsage(used):", compact(usage.slice(0, 12)));
  return { label, src, r, statements, handles, sourceIds, usage, diags };
}

console.log("=== 1. 单位换算与语句归属 ===");
const unit = probeShape("矩形 (0,0)-(1,1) 单位换算", String.raw`  \draw (0,0) rectangle (1,1);`);
probeShape("小数坐标 (1.41,2.11)", String.raw`  \draw (1.41,2.11) rectangle (3.25,4.5);`);
probeShape("带 pt 单位坐标 (20pt,30pt)", String.raw`  \draw (20pt,30pt) rectangle (60pt,80pt);`);

console.log("\n=== 2. 九类基础图元语句 ===");
probeShape("直线", String.raw`  \draw (0,0) -- (2,1);`);
probeShape("带箭头直线", String.raw`  \draw[->] (0,0) -- (2,1);`);
probeShape("圆", String.raw`  \draw (1,1) circle (0.75);`);
probeShape("椭圆", String.raw`  \draw (1,1) ellipse (1.2 and 0.6);`);
probeShape("多边形 -- cycle", String.raw`  \draw (0,0) -- (1,1) -- (2,0) -- cycle;`);
probeShape("折线", String.raw`  \draw (0,0) -- (1,1) -- (2,0);`);
probeShape("圆弧", String.raw`  \draw (1,0) arc (0:90:1);`);
probeShape("圆点 node", String.raw`  \node[circle,fill] at (2,2) {};`);
probeShape("文本 node", String.raw`  \node at (1,1) {text};`);

console.log("\n=== 3. 变换选项评级（capabilityMatrix） ===");
const matrix = mod.capabilityMatrix ?? {};
const keys = Object.keys(matrix).filter((k) =>
  /rotate|scale|shift|transform|arc|circle|ellipse|rectangle|node|path|coordinate/i.test(k),
);
for (const k of keys.slice(0, 30)) {
  const row = matrix[k];
  console.log(`  ${k}: parser=${row.parser} semantic=${row.semantic} svg=${row.svg} edit=${row.edit}`);
}
probeShape(
  "变换选项 rotate/scale/xshift/yshift",
  String.raw`  \draw[rotate=30, scale=1.2, xshift=1cm, yshift=2cm] (0,0) rectangle (1,1);`,
);
probeShape(
  "regular polygon + shapes.geometric",
  String.raw`\usetikzlibrary{shapes.geometric}
\begin{tikzpicture}
  \node[regular polygon,regular polygon sides=5,draw] at (1,1) {};
\end{tikzpicture}`,
);

console.log("\n=== 4. 小数坐标能否拖拽写回（applyEditIntent） ===");
const decimalSrc = env(String.raw`  \draw (1.41,2.11) rectangle (3.25,4.5);`);
const dr = mod.renderTikzToSvg(decimalSrc);
const hs = dr.semantic?.editHandles ?? [];
const h0 = hs.find((h) => h.rewriteMode === "direct" || h.rewriteMode === "delta") ?? hs[0];
if (h0) {
  const intent = mod.applyEditIntent(decimalSrc, hs, {
    kind: "move",
    handleId: h0.id,
    newWorld: { x: h0.world.x + 28.4528, y: h0.world.y + 28.4528 },
  });
  console.log("  handle:", compact({ id: h0.id, world: h0.world, rewriteMode: h0.rewriteMode }));
  console.log("  intent.kind:", intent.kind);
  console.log("  newSource:", intent.kind === "success" ? intent.newSource.replace(/\n/g, " | ") : intent);
} else {
  console.log("  无 editHandle");
}

console.log("\n=== 5. 单位换算系数（由矩形 (0,0)-(1,1) 的 handle 反推） ===");
const uh = (unit.r?.semantic?.editHandles ?? []);
console.log("  handles.world 去重:", compact([...new Set(uh.map((h) => `${h.world?.x},${h.world?.y}`))].slice(0, 8)));
console.log("  TikZ 1cm → pt 理论值 28.45275590551181；实测见上（若出现 28.4528 即吻合）");
console.log("\n=== 6. 空 tikzpicture 环境能否产出可承接指针的 SVG ===");
const blankSrc = "\\begin{tikzpicture}\n  \n\\end{tikzpicture}";
try {
  const br = mod.renderTikzToSvg(blankSrc);
  const svgText = br.svg?.svg ?? "";
  console.log("  svg 长度:", svgText.length, "前 140 字符:", svgText.slice(0, 140));
  console.log("  viewBox:", compact(br.svg?.viewBox));
  console.log(
    "  diagnostics:",
    compact(
      [
        ...(br.parse?.diagnostics ?? []),
        ...(br.semantic?.diagnostics ?? []),
        ...(br.svg?.diagnostics ?? []),
        ...(br.renderDiagnostics ?? []),
      ].map((d) => `${d.severity}:${d.code}:${d.message}`),
    ),
  );
} catch (e) {
  console.log("  渲染抛错:", e.message);
}

console.log("\n探针结束。FEATURE_IDS 数量:", (mod.FEATURE_IDS ?? []).length, "capabilityMatrix 行数:", Object.keys(matrix).length);
