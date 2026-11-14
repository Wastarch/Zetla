// M2 · 图片插入 TikZ · P3：图片 node 语句 / 路径白名单 / graphicx 导言区 / CM6 最小补丁回归
// 跑法：node --experimental-strip-types scripts/diagram-image-node.test.ts
// 只测纯逻辑（无 DOM / Tauri / React / store 依赖）。
import {
  buildImageNodeStatement,
  DEFAULT_IMAGE_WIDTH_CM,
  sourceNeedsGraphicx,
  validateImageRelPath,
} from "../src/modules/diagram/imageNodeInsert.ts";
import {
  ensureGraphicxPreamble,
  ensureTikzPreamble,
  buildDiagramInsertCode,
} from "../src/modules/diagram/diagramSnippet.ts";
import { insertShapeStatement, TIKZ_PT_PER_CM } from "../src/modules/diagram/shapeInsert.ts";
import { assetSignature, scanImageRefs } from "../src/modules/diagram/imageRefs.ts";
import { hasImageRefs } from "../src/modules/diagram/imageStagingPlan.ts";
import { insertBeforeDocument } from "../src/core/preamble.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.log("  ✗ " + msg);
  }
}

const ROOT = "E:\\Project\\Zetla";
const TEX_DIR = "E:\\Project\\Zetla\\chapters";
const BASE_SRC = "\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}";

console.log("=== 1. 图片 node 语句：P0 定稿形态 / world pt → cm ===");
{
  const b = buildImageNodeStatement({ relPath: "figure/x.png", x: 0, y: 0 });
  check(b.ok, "(0,0) 合法路径生成成功");
  if (b.ok) {
    check(
      b.statement === "\\node at (0,0) {\\includegraphics[width=3cm]{figure/x.png}};",
      "语句逐字匹配 P0 定稿形态：" + b.statement,
    );
    check(b.statement.includes("width=3cm"), "默认宽度 3cm");
    check(!b.statement.includes("\\pgfimage"), "不使用 \\pgfimage（P0 实测不可用）");
  }
  const cm = buildImageNodeStatement({
    relPath: "figure/x.png",
    x: TIKZ_PT_PER_CM,
    y: TIKZ_PT_PER_CM * 2,
  });
  check(cm.ok && cm.statement.startsWith("\\node at (1,2) "), "world pt 28.4528 → 1cm、56.9055 → 2cm");
  const frac = buildImageNodeStatement({
    relPath: "figure/x.png",
    x: -TIKZ_PT_PER_CM * 1.5,
    y: TIKZ_PT_PER_CM * 2.25,
    widthCm: 2.5,
  });
  check(frac.ok && frac.statement.startsWith("\\node at (-1.5,2.25) "), "负坐标 + 两位小数正确");
  check(frac.ok && frac.statement.includes("[width=2.5cm]"), "自定义宽度生效");
  const negZero = buildImageNodeStatement({ relPath: "figure/x.png", x: -0.0001, y: 0 });
  check(negZero.ok && negZero.statement.includes("(0,0)"), "绝不产生 -0");
  check(DEFAULT_IMAGE_WIDTH_CM === 3, "默认宽度常量为 3cm");
}

console.log("=== 2. 合法路径：中文 / 上跳 / 大小写扩展名 ===");
{
  for (const p of [
    "figure/x.png",
    "../figure/x.png",
    "figure/示意图.png",
    "assets/sub_dir/my-photo.JPG",
    "figure/x.jpeg",
    "figure/x.pdf",
  ]) {
    const v = validateImageRelPath(p);
    check(v.ok && v.path === p, `放行 ${p}`);
  }
  const trimmed = validateImageRelPath("  figure/x.png  ");
  check(trimmed.ok && trimmed.path === "figure/x.png", "首尾空白被 trim，路径本体不变");
}

console.log("=== 3. 非法路径：与 P1 resolveImagePath 同一口径 ===");
{
  const bad: [string, string][] = [
    ["", "空路径"],
    ["   ", "全空白路径"],
    ["figure/my pic.png", "含空格"],
    ["figure\\x.png", "反斜杠"],
    ["/abs/x.png", "Unix 绝对路径"],
    ["E:/abs/x.png", "Windows 盘符绝对路径"],
    ["figure/x%20y.png", "TeX 特殊字符 %"],
    ["figure/x#y.png", "TeX 特殊字符 #"],
    ["figure/x$y.png", "TeX 特殊字符 $"],
    ["figure/x&y.png", "TeX 特殊字符 &"],
    ["figure/{x}.png", "花括号"],
    ["figure/x.svg", "SVG（-no-shell-escape 不可用）"],
    ["figure/x.eps", "EPS"],
    ["figure/x.bmp", "BMP"],
    ["figure/x.png\n", "路径跨行"],
    ["figure/\nx.png", "路径内部换行"],
  ];
  for (const [p, label] of bad) {
    check(!validateImageRelPath(p).ok, `拒绝 ${label}`);
    check(!buildImageNodeStatement({ relPath: p, x: 0, y: 0 }).ok, `语句生成同样拒绝 ${label}`);
  }
}

console.log("=== 4. 坐标 / 宽度边界 ===");
{
  for (const [x, y, label] of [
    [Number.NaN, 0, "NaN 坐标"],
    [0, Number.POSITIVE_INFINITY, "Infinity 坐标"],
  ] as [number, number, string][]) {
    check(!buildImageNodeStatement({ relPath: "figure/x.png", x, y }).ok, `拒绝 ${label}`);
  }
  for (const w of [0, -1, Number.NaN, 999]) {
    check(
      !buildImageNodeStatement({ relPath: "figure/x.png", x: 0, y: 0, widthCm: w }).ok,
      `拒绝越界宽度 ${w}`,
    );
  }
}

console.log("=== 5. 与 P1 token 映射契约兼容（行数不变 / 生成 asset） ===");
{
  const b = buildImageNodeStatement({ relPath: "figure/x.png", x: 0, y: 0 });
  if (!b.ok) throw new Error("基准语句生成失败，无法继续");
  const ins = insertShapeStatement(BASE_SRC, b.statement);
  const scan = scanImageRefs(ins.source, TEX_DIR, ROOT);
  check(scan.assets.length === 1, "P1 扫描出 1 个 asset");
  check(scan.skipped.length === 0, "路径不被保守跳过");
  check(scan.assets[0]?.token.startsWith("zetla-img-") === true, "token 前缀正确");
  check(
    scan.sourceWithTokens.includes("zetla-img-") && !scan.sourceWithTokens.includes("figure/x.png"),
    "源码副本里的路径被替换成 token",
  );
  check(
    scan.sourceWithTokens.split("\n").length === ins.source.split("\n").length,
    "行内替换不增删行（preamble_lines 行号映射不漂移）",
  );
  check(assetSignature(scan.assets).length > 0, "资源签名非空（换图不命中旧预览）");
  check(hasImageRefs(ins.source), "P2「image 模式延后清理」判据识别新语句");
  check(!hasImageRefs(BASE_SRC), "纯 TikZ 源码不误判为含图片");
}

console.log("=== 6. 与 CM6 写回契约：最小补丁 / 自动选中 ===");
{
  const b = buildImageNodeStatement({ relPath: "figure/x.png", x: TIKZ_PT_PER_CM, y: 0 });
  if (!b.ok) throw new Error("基准语句生成失败，无法继续");
  const ins = insertShapeStatement(BASE_SRC, b.statement);
  check(
    ins.source.slice(ins.selection.from, ins.selection.to) === b.statement,
    "selection 精确覆盖新语句（重渲染后自动选中）",
  );
  check(ins.source.includes("\\draw (0,0) -- (1,1);"), "原有语句一字不动");
  check(ins.source.split("\n").length === BASE_SRC.split("\n").length + 1, "只新增一行");
  check(ins.note === null, "完整环境下无补齐提示");
  const broken = insertShapeStatement("\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);", b.statement);
  check(broken.note !== null && broken.source.includes("\\end{tikzpicture}"), "残缺源码自动补齐环境结尾");
  const empty = insertShapeStatement("", b.statement);
  check(empty.note !== null && empty.source.includes("\\begin{tikzpicture}"), "空源码自动新建环境");
}

console.log("=== 7. graphicx 导言区（P3 新增，向后兼容两参数调用） ===");
{
  const bare = "\\documentclass{article}\n\\begin{document}\nhello\n\\end{document}";
  const both = ensureTikzPreamble(bare, [], true);
  check(both.includes("\\usepackage{tikz}") && both.includes("\\usepackage{graphicx}"), "两者都缺时补齐两行");
  check(
    ensureTikzPreamble(bare, [], false) === ensureTikzPreamble(bare, []),
    "两参数旧调用行为不变（不带 graphicx）",
  );
  check(!ensureTikzPreamble(bare, []).includes("graphicx"), "needsGraphicx=false 不补 graphicx");
  const hasTikz = "\\usepackage{tikz}\n\\begin{document}\n\\end{document}";
  const onlyGx = ensureTikzPreamble(hasTikz, [], true);
  check(onlyGx === "\\usepackage{graphicx}", "已有 tikz 时只补 graphicx：" + onlyGx);
  const hasBoth = "\\usepackage{tikz}\n\\usepackage{graphicx}\n\\begin{document}\n\\end{document}";
  check(ensureTikzPreamble(hasBoth, ["arrows.meta"], true).includes("arrows.meta"), "补齐 tikzlibrary 仍生效");
  check(ensureTikzPreamble(hasBoth, [], true) === "", "graphicx 已声明时幂等为空串");
  // F5-2「导出并插入」：主文档未必用 tikz，绝不能顺带补 \usepackage{tikz}
  check(
    ensureGraphicxPreamble(bare) === "\\usepackage{graphicx}" &&
      !ensureGraphicxPreamble(bare).includes("tikz"),
    "figure 插入只补 graphicx，不强加 tikz",
  );
  check(ensureGraphicxPreamble(hasBoth) === "", "figure 插入在 graphicx 已声明时零改动");
  const patched = insertBeforeDocument(bare, both);
  check(patched.indexOf(both) < patched.indexOf("\\begin{document}"), "片段插在 \\begin{document} 之前");
  check(ensureTikzPreamble(patched, [], true) === "", "补齐后再次计算为空串（幂等）");
  check(sourceNeedsGraphicx("\\includegraphics[width=3cm]{figure/x.png}"), "含插图 → 需要 graphicx");
  check(!sourceNeedsGraphicx(BASE_SRC), "纯 TikZ → 不需要 graphicx");
  const figCode = buildDiagramInsertCode(BASE_SRC, true, "图", "fig:x");
  check(figCode.startsWith("\\begin{figure}"), "figure 包裹既有逻辑不受影响");
}

console.log(`\n=== P3 纯逻辑回归：${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
