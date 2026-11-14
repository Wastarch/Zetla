// M2 · 图片插入 TikZ · P2：暂存图「转正判据 / 路径归一 / 延后清理判据」的纯逻辑回归
// 跑法：node --experimental-strip-types scripts/diagram-image-staging.test.ts
// 只测 imageStagingPlan.ts（无 DOM / Tauri / React / store 依赖）。
import {
  hasImageRefs,
  planPromotion,
  stagingPathKey,
} from "../src/modules/diagram/imageStagingPlan.ts";

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
// Rust fs::canonicalize 在 Windows 上返回的 verbatim 形态
const STAGED = ["\\\\?\\E:\\Project\\Zetla\\chapters\\figure\\x.png"];
const IMG = "\\includegraphics[width=3cm]{figure/x.png}";

console.log("=== 1. TikZ 源码模式：命中暂存源图 → 转正 ===");
{
  const p = planPromotion({
    insertedCode: `\\begin{tikzpicture}\n  \\node at (0,0) {${IMG}};\n\\end{tikzpicture}`,
    texDir: WIN_TEX,
    root: WIN_ROOT,
    stagedPaths: STAGED,
  });
  check(!p.uncertain, "路径可解析，不走保守分支");
  check(p.resolved.length === 1, "折算出 1 条绝对路径");
  check(
    p.resolved[0] === "e:/Project/Zetla/chapters/figure/x.png",
    "基准是 targetTex 目录而非项目根：" + p.resolved[0],
  );
  check(
    p.pathsToPromote.some((x) => stagingPathKey(x) === stagingPathKey(STAGED[0])),
    "命中 manifest 里的暂存图（Rust 侧 canonicalize 再精确比对）",
  );
  check(p.skipped.length === 0, "无跳过项");
}

console.log("=== 2. 导出并插入模式：成品图不命中源图 → 留待清理 ===");
{
  const p = planPromotion({
    insertedCode:
      "\\begin{figure}\n\\includegraphics[width=0.8\\linewidth]{figure/diagram.png}\n\\end{figure}",
    texDir: WIN_TEX,
    root: WIN_ROOT,
    stagedPaths: STAGED,
  });
  check(!p.uncertain, "成品路径本身可解析");
  check(
    p.resolved[0] === "e:/Project/Zetla/chapters/figure/diagram.png",
    "折算的是导出成品：",
  );
  check(
    p.pathsToPromote.every((x) => stagingPathKey(x) !== stagingPathKey(STAGED[0])),
    "暂存源图 x.png 不在转正列表（按路径命中，不按插入动作整批转正）",
  );
}

console.log("=== 3. 仅保存 / 纯源码无图片：不转正任何图 ===");
{
  const p = planPromotion({
    insertedCode: "\\begin{tikzpicture}\n\\draw (0,0)--(1,1);\n\\end{tikzpicture}",
    texDir: WIN_TEX,
    root: WIN_ROOT,
    stagedPaths: STAGED,
  });
  check(!p.uncertain, "代码里没有图片引用，不算解析失败");
  check(p.pathsToPromote.length === 0, "没有待转正路径，暂存图留待清理");
  check(!hasImageRefs("\\draw (0,0)--(1,1);"), "hasImageRefs 对普通图元为 false");
  check(hasImageRefs(IMG), "hasImageRefs 对图片节点为 true");
  check(!hasImageRefs("\\pgfimage{x.png};"), "hasImageRefs 不把 pgfimage 当图片引用");
}

console.log("=== 4. 解析不到 → 决策 9①「默认保留」 ===");
{
  const cases: [string, string][] = [
    ["\\includegraphics{\\imgdir/x.png}", "宏拼接路径"],
    ["\\includegraphics{/abs/x.png}", "绝对路径"],
    ["\\includegraphics{figure/x.png\n}", "跨行路径参数"],
    ["\\includegraphics{../../secret.png}", "越出项目根"],
    ["\\includegraphics{figure/x.svg}", "不支持的格式"],
  ];
  for (const [code, label] of cases) {
    const p = planPromotion({
      insertedCode: code,
      texDir: WIN_TEX,
      root: WIN_ROOT,
      stagedPaths: STAGED,
    });
    check(p.uncertain, `${label} → uncertain=true`);
    check(
      p.pathsToPromote.includes(STAGED[0]),
      `${label} → 全部暂存图仍进转正列表（宁留勿删）`,
    );
  }
  const p = planPromotion({
    insertedCode: "\\includegraphics{\\imgdir/x.png}",
    texDir: WIN_TEX,
    root: WIN_ROOT,
    stagedPaths: STAGED,
  });
  check(p.skipped.length === 1, "跳过原因被记录，便于控制台告警");
}

console.log("=== 5. 多图 / 相对上跳 / 去重 ===");
{
  const p = planPromotion({
    insertedCode: [
      "\\includegraphics{figure/x.png}",
      "\\includegraphics{figure/x.png}",
      "\\includegraphics[width=2cm]{figure/y.jpg}",
    ].join("\n"),
    texDir: WIN_TEX,
    root: WIN_ROOT,
    stagedPaths: STAGED,
  });
  check(p.resolved.length === 2, "同一路径多处引用只折算一次");
  check(p.pathsToPromote.length === 2, "去重后待转正列表 2 条");

  const up = planPromotion({
    insertedCode: "\\includegraphics{../figure/x.png}",
    texDir: WIN_TEX,
    root: WIN_ROOT,
    stagedPaths: ["\\\\?\\E:\\Project\\Zetla\\figure\\x.png"],
  });
  check(
    up.resolved[0] === "e:/Project/Zetla/figure/x.png",
    ".. 相对基准目录折叠：",
  );
  check(
    stagingPathKey(up.resolved[0]) ===
      stagingPathKey("\\\\?\\E:\\Project\\Zetla\\figure\\x.png"),
    "上跳结果与 canonical 形态可比对",
  );
}

console.log("=== 6. 跨平台路径归一 ===");
{
  check(
    stagingPathKey("\\\\?\\E:\\Project\\Zetla\\figure\\X.png") ===
      stagingPathKey("e:/project/zetla/figure/x.png"),
    "Windows：剥 \\\\?\\ 前缀 + 大小写不敏感",
  );
  const nfc = "/Users/me/项目/图.png";
  check(
    stagingPathKey(nfc.normalize("NFD")) === stagingPathKey(nfc),
    "macOS：NFD / NFC 归一后一致",
  );
  check(
    stagingPathKey("/Users/me/A.png") !== stagingPathKey("/Users/me/a.png"),
    "macOS / Linux：大小写敏感",
  );
  check(
    stagingPathKey("//server/share/figure/A.png") ===
      stagingPathKey("//server/share/figure/a.png"),
    "UNC：按 Windows 口径大小写不敏感",
  );
  check(
    stagingPathKey("E:\\Project\\Zetla\\figure\\x.png\\") ===
      stagingPathKey("e:/Project/Zetla/figure/x.png"),
    "尾斜杠与盘符差异被吸收",
  );
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
