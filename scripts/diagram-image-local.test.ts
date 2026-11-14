// M2 · 图片插入 TikZ · P4：本地即时显示的纯逻辑回归（Node --experimental-strip-types 直测）。
// 只覆盖无 DOM / Tauri 依赖的 imageSize.ts；DOM 注入层 localImageInject.ts 由真机冒烟覆盖。
import {
  CM_TO_PT,
  MAX_EXPLICIT_PT,
  MAX_NATURAL_PT,
  isSafeAssetHref,
  parseIncludeGraphics,
  resolveImageBoxPt,
} from "../src/modules/diagram/imageSize.ts";

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error("  ✗ " + label);
  }
}
function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

// ── parseIncludeGraphics ──────────────────────────────────────────────
{
  const p = parseIncludeGraphics("\\includegraphics[width=3cm]{figure/x.png}");
  check(p !== null, "能解析基本形态");
  check(p?.relPath === "figure/x.png", "路径提取正确");
  check(p?.widthCm === 3, "width=3cm 提取为 3");
  check(p?.heightCm === null, "未给 height 为 null");
}
{
  const p = parseIncludeGraphics("\\includegraphics[height=2.5cm,width=4cm]{../figure/a.jpg}");
  check(p !== null && p.relPath === "../figure/a.jpg", "上跳路径提取正确");
  check(p?.widthCm === 4 && p?.heightCm === 2.5, "height,width 顺序无关");
}
{
  const p = parseIncludeGraphics("\\includegraphics{img.png}");
  check(p !== null && p.relPath === "img.png", "无选项也能解析");
  check(p?.widthCm === null && p?.heightCm === null, "无选项宽高为 null");
}
{
  const p = parseIncludeGraphics("普通文字节点没有 includegraphics");
  check(p === null, "非图片节点返回 null");
}
{
  // 跨行 opt 仍能解析（与 imageRefs.REF_RE 同口径）
  const p = parseIncludeGraphics("\\includegraphics[\n  width=1cm\n]{a.png}");
  check(p !== null && p.relPath === "a.png" && p.widthCm === 1, "跨行 [opt] 解析");
}

// ── resolveImageBoxPt ─────────────────────────────────────────────────
{
  // 只给 width → 高度按自然比例
  const b = resolveImageBoxPt(
    { relPath: "a.png", widthCm: 3, heightCm: null },
    { width: 100, height: 50 },
  );
  check(approx(b.widthPt, 3 * CM_TO_PT), "width=3cm → 3*28.4528 pt");
  check(approx(b.heightPt, b.widthPt * 0.5), "高度按 2:1 自然比例");
  check(b.stretch === false, "单边给定不拉伸");
}
{
  // 只给 height → 宽度按自然比例
  const b = resolveImageBoxPt(
    { relPath: "a.png", widthCm: null, heightCm: 4 },
    { width: 200, height: 100 },
  );
  check(approx(b.heightPt, 4 * CM_TO_PT), "height=4cm → 4*28.4528 pt");
  check(approx(b.widthPt, b.heightPt * 2), "宽度按 2:1 自然比例");
}
{
  // 同时给 → 拉伸
  const b = resolveImageBoxPt(
    { relPath: "a.png", widthCm: 3, heightCm: 2 },
    { width: 100, height: 100 },
  );
  check(approx(b.widthPt, 3 * CM_TO_PT) && approx(b.heightPt, 2 * CM_TO_PT), "双给按给定框");
  check(b.stretch === true, "双给标记 stretch");
}
{
  // 都没给 → 自然像素（1px≈1pt），封顶 MAX_NATURAL_PT
  const b = resolveImageBoxPt(
    { relPath: "a.png", widthCm: null, heightCm: null },
    { width: 4000, height: 2000 },
  );
  check(b.widthPt === MAX_NATURAL_PT, "超大图宽度封顶 MAX_NATURAL_PT");
  check(approx(b.heightPt, MAX_NATURAL_PT / 2), "高度等比");
  check(b.stretch === false, "自然尺寸不拉伸");
}
{
  // 都没给且拿不到自然尺寸 → 3cm 占位框
  const b = resolveImageBoxPt(
    { relPath: "a.pdf", widthCm: null, heightCm: null },
    null,
  );
  check(approx(b.widthPt, 3 * CM_TO_PT) && approx(b.heightPt, 3 * CM_TO_PT), "无自然尺寸 3cm 占位");
}
{
  // 显式尺寸也封顶 MAX_EXPLICIT_PT（防止 200cm 撑爆）
  const b = resolveImageBoxPt(
    { relPath: "a.png", widthCm: 1e6, heightCm: null },
    { width: 10, height: 10 },
  );
  check(b.widthPt === MAX_EXPLICIT_PT, "显式超大 width 封顶 MAX_EXPLICIT_PT");
}
{
  // 非有限宽高 → 视为未给
  const b = resolveImageBoxPt(
    { relPath: "a.png", widthCm: NaN, heightCm: NaN },
    { width: 80, height: 80 },
  );
  check(approx(b.widthPt, 80) && approx(b.heightPt, 80), "NaN 宽高回落自然尺寸");
}

// ── isSafeAssetHref ───────────────────────────────────────────────────
{
  check(isSafeAssetHref("http://asset.localhost/foo.png"), "Win WebView2 前缀放行");
  check(isSafeAssetHref("asset://localhost/foo.png"), "mac/Linux 前缀放行");
  check(!isSafeAssetHref("https://example.com/foo.png"), "外部 https 拒绝");
  check(!isSafeAssetHref("http://evil/foo.png"), "非 asset 域拒绝");
  check(!isSafeAssetHref("javascript:alert(1)"), "javascript: 拒绝");
  check(!isSafeAssetHref("/abs/path/foo.png"), "绝对路径拒绝");
}

console.log(`diagram-image-local: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
