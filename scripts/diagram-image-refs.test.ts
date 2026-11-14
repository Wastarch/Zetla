// M2 · 图片插入 TikZ · P1：\includegraphics 路径 → token 映射的纯逻辑回归
// 跑法：node --experimental-strip-types scripts/diagram-image-refs.test.ts
// 不依赖 DOM / Tauri / React / store；imageRefs.ts 只用 import type，strip-types 会擦除。
import { scanImageRefs, resolveImagePath, assetSignature, shortHash } from "../src/modules/diagram/imageRefs.ts";
import { previewKey } from "../src/modules/diagram/previewCache.ts";

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

const WIN_ROOT = "E:\\Project\\Zetla";
const WIN_TEX = "E:\\Project\\Zetla\\chapters";
const SRC = "\\begin{tikzpicture}\n  \\node at (0,0) {\\includegraphics[width=3cm]{figure/x.png}};\n\\end{tikzpicture}";

console.log("=== 1. 基本折算与 token 替换 ===");
{
  const r = scanImageRefs(SRC, WIN_TEX, WIN_ROOT);
  check(r.assets.length === 1, "一条引用生成一个 asset");
  check(r.skipped.length === 0, "无跳过项");
  check(
    r.assets[0].realPath === "e:/Project/Zetla/chapters/figure/x.png",
    "Windows 反斜杠归一 + 盘符小写，基准是 targetTex 目录：" + r.assets[0].realPath,
  );
  check(r.sourceWithTokens.includes(`{${r.assets[0].token}}`), "源码副本里路径已换成 token");
  check(!r.sourceWithTokens.includes("figure/x.png"), "源码副本不再含原始相对路径");
  check(r.sourceWithTokens.includes("[width=3cm]"), "[opt] 选项原样保留");
  check(
    r.sourceWithTokens.split("\n").length === SRC.split("\n").length,
    "行数不变（preamble_lines 行号映射不漂移）",
  );
  check(SRC.includes("figure/x.png"), "CM6 原源码未被修改（scan 只返回副本）");
}

console.log("=== 2. token 字符集 / 稳定性 / 去重 ===");
{
  const token = scanImageRefs(SRC, WIN_TEX, WIN_ROOT).assets[0].token;
  check(/^zetla-img-[0-9a-f]{12}\.(png|jpe?g|pdf)$/.test(token), "token 形如 zetla-img-<12hex>.<ext>：" + token);
  check(/^[a-z0-9._-]+$/.test(token), "token 仅含 ASCII 小写安全字符");
  check(
    token === scanImageRefs(SRC, WIN_TEX, WIN_ROOT).assets[0].token,
    "同一路径 token 稳定（可复现）",
  );
  check(shortHash("a") === shortHash("a") && shortHash("a") !== shortHash("b"), "shortHash 确定性且可区分");

  const multi = [
    "\\begin{tikzpicture}",
    "  \\node at (0,0) {\\includegraphics{figure/x.png}};",
    "  \\node at (2,0) {\\includegraphics[width=2cm]{figure/x.png}};",
    "  \\node at (4,0) {\\includegraphics{figure/y.jpg}};",
    "\\end{tikzpicture}",
  ].join("\n");
  const r = scanImageRefs(multi, WIN_TEX, WIN_ROOT);
  check(r.assets.length === 2, "同一图多处引用只生成一个 asset，不同图各一个");
  const hits = r.sourceWithTokens.match(/zetla-img-[0-9a-f]{12}\.(png|jpe?g|pdf)/g) ?? [];
  check(hits.length === 3, "三处引用都换成 token");
  check(hits[0] === hits[1] && hits[1] !== hits[2], "前两处复用同一 token");
}

console.log("=== 3. 跨行 [opt] 与行数 ===");
{
  const src = [
    "\\begin{tikzpicture}",
    "  \\node {\\includegraphics[width=3cm,",
    "      keepaspectratio]{figure/x.png}};",
    "\\end{tikzpicture}",
  ].join("\n");
  const r = scanImageRefs(src, WIN_TEX, WIN_ROOT);
  check(r.assets.length === 1, "跨行 [opt] 仍能解析出图片路径");
  check(
    r.sourceWithTokens.split("\n").length === src.split("\n").length,
    "跨行 [opt] 替换后行数不变",
  );
  check(r.sourceWithTokens.includes("keepaspectratio]"), "跨行选项文本未被改动");
}

console.log("=== 4. 保守跳过（绝不猜路径） ===");
{
  const cases: [string, string][] = [
    ["\\includegraphics{\\imgdir/x.png}", "宏拼接"],
    ["\\includegraphics{E:/secret/x.png}", "Windows 绝对路径"],
    ["\\includegraphics{/etc/passwd.png}", "POSIX 绝对路径"],
    ["\\includegraphics{../../outside.png}", ".. 越出项目根"],
    ["\\includegraphics{figure/x.svg}", "SVG（-no-shell-escape 不可插入）"],
    ["\\includegraphics{figure/x.bmp}", "BMP 不在白名单"],
    ["\\includegraphics{figure/my image.png}", "路径含空格"],
    ["\\includegraphics{figure\\x.png}", "反斜杠（请改用正斜杠）"],
    ["\\includegraphics{\n figure/x.png\n}", "路径参数跨行（替换会改变行数）"],
  ];
  for (const [line, label] of cases) {
    const r = scanImageRefs(`\\begin{tikzpicture}\n${line}\n\\end{tikzpicture}`, WIN_TEX, WIN_ROOT);
    check(
      r.assets.length === 0 && r.skipped.length === 1,
      `跳过：${label} → ${r.skipped[0]?.reason ?? "无原因"}`,
    );
  }
  const noRoot = scanImageRefs(SRC, "", "");
  check(noRoot.assets.length === 0 && noRoot.skipped.length === 1, "未打开项目时全部跳过");
  check(noRoot.sourceWithTokens === SRC, "跳过时源码副本与原源码逐字一致");
}

console.log("=== 5. 白名单格式 / 中文文件名 / NFC ===");
{
  for (const ext of ["png", "jpg", "jpeg", "PDF", "PnG"]) {
    const r = scanImageRefs(`\\includegraphics{figure/x.${ext}}`, WIN_TEX, WIN_ROOT);
    check(r.assets.length === 1, `格式 .${ext} 被接受（大小写不敏感）`);
  }
  const cn = scanImageRefs("\\includegraphics{figure/示意图.png}", WIN_TEX, WIN_ROOT);
  check(cn.assets.length === 1, "中文文件名被接受（token 仍是纯 ASCII）");
  check(/^[a-z0-9._-]+$/.test(cn.assets[0].token), "中文名生成的 token 不含非 ASCII");

  // macOS APFS 常以 NFD 存文件名；两端统一 NFC 后应能落在项目根内
  const nfdRoot = "E:/Project/cafe\u0301";
  const nfdDir = "E:/Project/cafe\u0301/ch";
  const r = resolveImagePath(nfdDir, nfdRoot, "figure/x.png");
  check("abs" in r, "NFD 项目根仍能解析出绝对路径");
  if ("abs" in r) check(r.abs === "e:/Project/café/ch/figure/x.png", "路径归一为 NFC：" + r.abs);
}

console.log("=== 6. 相对路径回落 / POSIX 根 ===");
{
  const r = scanImageRefs(SRC, WIN_ROOT, WIN_ROOT);
  check(
    r.assets[0]?.realPath === "e:/Project/Zetla/figure/x.png",
    "未锁定 targetTex 时基准回落到项目根",
  );
  const p = resolveImagePath("/home/u/proj/ch", "/home/u/proj", "figure/x.png");
  check("abs" in p && p.abs === "/home/u/proj/ch/figure/x.png", "POSIX 绝对路径折算正确");
  const up = scanImageRefs("\\includegraphics{../figure/x.png}", WIN_TEX, WIN_ROOT);
  check(up.assets.length === 1, "项目根内的 .. 上跳允许");
  check(
    up.assets[0].realPath === "e:/Project/Zetla/figure/x.png",
    "上跳后落在项目根内：" + up.assets[0].realPath,
  );
}

console.log("=== 7. 预览缓存签名 ===");
{
  const a = scanImageRefs(SRC, WIN_TEX, WIN_ROOT).assets;
  const b = scanImageRefs(
    SRC.replace("x.png", "y.png"),
    WIN_TEX,
    WIN_ROOT,
  ).assets;
  const sigA = assetSignature(a);
  const sigB = assetSignature(b);
  check(sigA.length === 12 && sigB.length === 12, "签名为 12 位短 hash");
  check(sigA === assetSignature(a), "同一资源表签名稳定");
  check(sigA !== sigB, "换图后签名变化");
  check(assetSignature([]) === "", "无资源时签名为空");
  check(assetSignature([...a].reverse()) === assetSignature(a), "两图时签名与顺序无关");

  const engine = "xelatex";
  const base = previewKey(SRC, engine);
  check(base === previewKey(SRC, engine, undefined, ""), "第四参为空串时 key 与 P1 之前逐字一致");
  check(previewKey(SRC, engine, undefined, sigA) !== base, "带资源签名时 key 变化");
  check(
    previewKey(SRC, engine, undefined, sigA) !== previewKey(SRC, engine, undefined, sigB),
    "换图后 key 变化（不会命中旧预览）",
  );
  check(
    previewKey(SRC, engine, { widthPt: 100, heightPt: 100, useCanvas: true }, sigA)
      .endsWith(`|a:${sigA}`),
    "画布尺寸与资源签名可叠加",
  );
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
