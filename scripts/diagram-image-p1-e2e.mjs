// P1 · 端到端探针：模拟 Rust prepare_assets + standalone 编译，验证 token 映射真的能吃图。
// 跑法：node --experimental-strip-types scripts/diagram-image-p1-e2e.mjs [--keep]
// 只读产品代码：只在系统临时目录造素材，结束自动清理（--keep 保留复核）。
//
// 覆盖：
//  1) imageRefs.scanImageRefs 产出的 token / assets 与「行数不变」契约；
//  2) 把真实图片按 token 拷进编译工作区后，XeLaTeX 能找到它（相对路径基准 = CWD）；
//  3) pdftocairo -svg 输出里位图仍是 base64 内嵌 → 精确预览能显示真图；
//  4) 对照组：不拷图时同一片段必须报 File not found（证明注入确实是必要条件）。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import path from "node:path";
import { scanImageRefs } from "../src/modules/diagram/imageRefs.ts";

const KEEP = process.argv.includes("--keep");
const isWin = platform() === "win32";
const XELATEX = isWin ? "xelatex.exe" : "xelatex";
const PDFTOCAIRO = isWin ? "pdftocairo.exe" : "pdftocairo";
const work = mkdtempSync(path.join(tmpdir(), "zetla-image-p1-"));

// 32×32 合法 PNG（内嵌，避免依赖 pdftocairo -jpeg 等平台差异）
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAA10lEQVR4nNXWvQ2DQAwF4MMzZIhU1EyQEajfLJkkdepUmSB15qCgTpUOmYMcZ/uhiKvgLN3Hj2S/Zhw/ac8lu56e/gAMXcsFGv0PptNxuUcOfVzPK2+gn/327BNpyXR1er11gWWIvsm+DMWQ7J5uyHKLa8jqLtGQXwWWIYUaxZByGWFjuxchZlQ1OwSM2m4Kr2Fo13AZtnkAu2EeODAanokGi+Ecmag2/DMZdUZo6KPCiKYKbBmE2IKiwclFmBs6P9CCF5Sh88MsF8XX0LVZOiEDabGOH36/sQZY92rOE6kAAAAASUVORK5CYII=";

const run = (bin, args) => {
  const r = spawnSync(bin, args, { cwd: work, timeout: 90_000, encoding: "utf8" });
  return {
    ok: r.status === 0 && !r.error,
    out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim(),
    status: r.status,
  };
};

let failed = 0;
function check(cond, msg) {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failed += 1;
}

console.log("=== 环境 ===");
console.log("  platform:", platform(), " work:", work);
console.log("  xelatex:", run(XELATEX, ["--version"]).out.split(/\r?\n/)[0] ?? "(未找到)");

mkdirSync(path.join(work, "figure"), { recursive: true });
const realPath = path.join(work, "figure", "probe.png");
writeFileSync(realPath, Buffer.from(PNG_BASE64, "base64"));

const SOURCE = [
  "\\begin{tikzpicture}",
  "  \\draw (0,0) -- (2,0);",
  "  \\node at (1,1) {\\includegraphics[width=2cm]{figure/probe.png}};",
  "\\end{tikzpicture}",
].join("\n");

console.log("\n=== 1. imageRefs 派生 ===");
const prepared = scanImageRefs(SOURCE, work, work);
check(prepared.assets.length === 1, "一条图片引用 → 一个 asset");
check(prepared.skipped.length === 0, `无跳过项（${JSON.stringify(prepared.skipped)}）`);
check(
  /^zetla-img-[0-9a-f]{12}\.png$/.test(prepared.assets[0]?.token ?? ""),
  "token 合规：" + prepared.assets[0]?.token,
);
check(
  prepared.sourceWithTokens.split("\n").length === SOURCE.split("\n").length,
  "替换后行数不变（行号映射契约）",
);
check(SOURCE.includes("figure/probe.png"), "CM6 原源码未被改动");

// Rust build_document_with_canvas 的包装（无 ctex / 无 canvas / 无额外库），导言区 5 行
const wrap = (body) =>
  [
    "\\documentclass[tikz,border=4pt]{standalone}",
    "\\usepackage{tikz}",
    "\\usepackage{amsmath,amssymb}",
    "\\usepackage{graphicx}",
    "\\begin{document}",
    body,
    "\\end{document}",
    "",
  ].join("\n");

const compileSnippet = (name, body) => {
  writeFileSync(path.join(work, `${name}.tex`), wrap(body), "utf8");
  const r = run(XELATEX, [
    "-no-shell-escape",
    "-interaction=nonstopmode",
    "-halt-on-error",
    `${name}.tex`,
  ]);
  let log = "";
  const logPath = path.join(work, `${name}.log`);
  if (existsSync(logPath)) {
    log = readFileSync(logPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => /File .* not found|Cannot determine size|LaTeX Error/i.test(l))
      .slice(0, 3)
      .join(" | ");
  }
  return { ok: r.ok && existsSync(path.join(work, `${name}.pdf`)), log, out: r.out.slice(-300) };
};

console.log("\n=== 2. 对照组：token 化但不注入资源 ===");
const missing = compileSnippet("no-asset", prepared.sourceWithTokens);
check(!missing.ok, "未注入资源时编译失败（符合预期）");
check(/not found|Cannot determine/i.test(missing.log), "失败原因确实是找不到图：" + (missing.log || missing.out));

console.log("\n=== 3. 注入资源后编译（模拟 Rust prepare_assets） ===");
for (const a of prepared.assets) {
  copyFileSync(a.realPath, path.join(work, a.token));
}
check(existsSync(path.join(work, prepared.assets[0].token)), "token 文件已落在编译 CWD");
const okRun = compileSnippet("with-asset", prepared.sourceWithTokens);
check(okRun.ok, "注入后 XeLaTeX 编译成功：" + (okRun.log || okRun.out));

console.log("\n=== 4. SVG 位图内嵌性（精确预览通道） ===");
if (okRun.ok) {
  const svgRun = run(PDFTOCAIRO, ["-svg", "-f", "1", "-l", "1", "with-asset.pdf", "preview.svg"]);
  let svgPath = path.join(work, "preview.svg");
  if (!existsSync(svgPath) && existsSync(path.join(work, "preview-1.svg"))) {
    svgPath = path.join(work, "preview-1.svg");
  }
  if (existsSync(svgPath)) {
    const svg = readFileSync(svgPath, "utf8");
    const hrefs = [...svg.matchAll(/<image\b[^>]*>/gi)]
      .map((m) => (m[0].match(/(?:xlink:)?href="([^"]*)"/i) ?? [])[1] ?? "");
    check(hrefs.length > 0, `SVG 里有 <image>（${hrefs.length} 个）`);
    check(
      hrefs.some((h) => /^data:image\/png;base64,/i.test(h)),
      "位图是 base64 内嵌（<img data:image/svg+xml> 能显示真图）",
    );
    check(!hrefs.some((h) => h && !/^data:image\//i.test(h)), "无外链资源");
  } else {
    check(false, "pdftocairo -svg 未产出 SVG：" + svgRun.out.slice(-200));
  }
}

console.log(`\n结果：${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
if (!KEEP) rmSync(work, { recursive: true, force: true });
else console.log("（--keep：工作区保留 " + work + "）");
if (failed > 0) process.exit(1);
