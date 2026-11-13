// P0 spike · 探针 B：XeLaTeX / pdftocairo 对「TikZ 里插图」的实际行为
// 跑法：node scripts/diagram-image-tex-probe.mjs [--keep]
// 只读产品代码：只在系统临时目录造素材并编译，结束自动清理（--keep 保留复核）。
// 结论写回 docs/dev/绘图模块/绘图模块-图片插入切片计划.md §3「实证结论」。
//
// 覆盖：
//   P0-3  pdftocairo -svg 输出的位图是 base64 内嵌还是外链（决定精确预览能否显示真图）
//   P0-4  \usepackage{graphicx} 是否必需；PNG / JPG / PDF 三种源图格式支持情况
// 三平台可复跑：Windows / Linux / macOS 只是工具名与 PATH 不同，脚本用同一套命令。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import path from "node:path";

const KEEP = process.argv.includes("--keep");
const isWin = platform() === "win32";
const XELATEX = isWin ? "xelatex.exe" : "xelatex";
const PDFTOCAIRO = isWin ? "pdftocairo.exe" : "pdftocairo";
const work = mkdtempSync(path.join(tmpdir(), "zetla-image-probe-"));

// 某些发行版（如 TeX Live 2024 Windows 自带 poppler）没有 -jpeg，此时用内嵌的
// 32×32 合法 JPEG 兜底，保证 P0-4 的「JPG 格式支持」是真实测量而非假失败。
const FALLBACK_JPG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDJ5hb1U1MCCMjkUEAjB5FQ8wt6qa9r3sDLvTf/AJL/AMD+vXX3cyj2rL/yf/7b8/ynopAQRkcilr0001dHitOLs9wpCARg8ilooaTVmCbi7rcg5hb1U1MCCMjkUEAjB5FQ8wt6qa8z3sDLvTf/AJL/AMD+vX2vdzKPasv/ACf/AO2/P8v/2Q==";

const run = (bin, args) => {
  const r = spawnSync(bin, args, { cwd: work, timeout: 90_000, encoding: "utf8" });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
  return {
    ok: r.status === 0 && !r.error,
    out,
    status: r.status,
    message: r.error?.message,
  };
};

const tex = (name, body) => {
  const p = path.join(work, name);
  writeFileSync(p, body, "utf8");
  return p;
};

const logTail = (base) => {
  const p = path.join(work, `${base}.log`);
  if (!existsSync(p)) return "(无 log)";
  const text = readFileSync(p, "utf8");
  const hits = text
    .split(/\r?\n/)
    .filter((l) => /! LaTeX Error|not found|Unknown graphics extension|Cannot determine size|Unable to load|Missing character|Package .* Error|No pages of output|Fatal|Error:/i.test(l))
    .slice(0, 6);
  return hits.length ? hits.join(" | ") : "(log 中无错误行)";
};

const compileTex = (base) =>
  run(XELATEX, ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", `${base}.tex`]);

const round = (n) => Math.round(n * 100) / 100;

console.log("=== 环境 ===");
console.log("  platform:", platform(), " work:", work);
console.log("  xelatex:", run(XELATEX, ["--version"]).out.split(/\r?\n/)[0] ?? "(未找到)");
console.log("  pdftocairo:", run(PDFTOCAIRO, ["-v"]).out.split(/\r?\n/)[0] ?? "(未找到)");

console.log("\n=== 0. 造三种测试图片素材（PNG / JPG / PDF） ===");
const baseTex = String.raw`\documentclass[tikz,border=4pt]{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
  \fill[blue!60] (0,0) rectangle (2,2);
  \draw[red,thick] (0,0) -- (2,2);
\end{tikzpicture}
\end{document}
`;
tex("base.tex", baseTex);
const baseRun = compileTex("base");
const basePdf = path.join(work, "base.pdf");
console.log("  base.pdf:", existsSync(basePdf) ? `${round(readFileSync(basePdf).length / 1024)} kB` : "未生成", "/ exit:", baseRun.ok);
if (!existsSync(basePdf)) {
  console.log("  base 编译输出:", baseRun.out.slice(-500), "\n  log:", logTail("base"));
  console.log("  ⇒ 工具链不可用，探针终止。");
  if (!KEEP) rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const pngRun = run(PDFTOCAIRO, ["-png", "-singlefile", "-r", "72", "base.pdf", "probe"]);
const jpgRun = run(PDFTOCAIRO, ["-jpeg", "-singlefile", "-r", "72", "base.pdf", "probe"]);
copyFileSync(basePdf, path.join(work, "probe.pdf"));
// -jpeg 在部分 poppler 发行版里不存在；产物也可能带 -1 后缀
let jpegFallbackUsed = false;
if (!existsSync(path.join(work, "probe.jpg")) && existsSync(path.join(work, "probe-1.jpg"))) {
  copyFileSync(path.join(work, "probe-1.jpg"), path.join(work, "probe.jpg"));
}
if (!existsSync(path.join(work, "probe.jpg"))) {
  writeFileSync(path.join(work, "probe.jpg"), Buffer.from(FALLBACK_JPG_BASE64, "base64"));
  jpegFallbackUsed = true;
}
const assets = ["png", "jpg", "pdf"].map((ext) => {
  const p = path.join(work, `probe.${ext}`);
  return { ext, exists: existsSync(p), bytes: existsSync(p) ? readFileSync(p).length : 0 };
});
console.log("  素材:", JSON.stringify(assets));
console.log("  pdftocairo -png -singlefile exit:", pngRun.ok, "/ -jpeg exit:", jpgRun.ok, "/ JPG 兜底:", jpegFallbackUsed);

console.log("\n=== P0-4 · graphicx 必要性 × 格式支持（6 组） ===");
const matrix = [];
for (const ext of ["png", "jpg", "pdf"]) {
  for (const graphicx of [false, true]) {
    const tag = `${ext}-${graphicx ? "with" : "without"}-graphicx`;
    const doc =
      String.raw`\documentclass[tikz,border=4pt]{standalone}
\usepackage{tikz}
\usepackage{amsmath,amssymb}
` +
      (graphicx ? "\\usepackage{graphicx}\n" : "") +
      String.raw`\begin{document}
\begin{tikzpicture}
  \node at (0,0) {\includegraphics[width=2cm]{probe.${ext}}};
\end{tikzpicture}
\end{document}
`;
    tex(`${tag}.tex`, doc);
    const res = compileTex(tag);
    const pdf = path.join(work, `${tag}.pdf`);
    const generated = existsSync(pdf) && readFileSync(pdf).length > 500;
    const log = logTail(tag);
    const row = { ext, graphicx, exitOk: res.ok, pdfGenerated: generated, log };
    matrix.push(row);
    console.log(`  ${tag.padEnd(24)} exit=${res.ok ? "OK" : "FAIL"} pdf=${generated ? "YES" : "NO"}  ${log}`);
  }
}

console.log("\n=== P0-4 补充 · 相对路径基准 / SVG 是否被排除 ===");
// ① 相对路径基准：把同一张 PNG 放到 work/figure/ 下，源码写 figure/probe.png
mkdirSync(path.join(work, "figure"), { recursive: true });
copyFileSync(path.join(work, "probe.png"), path.join(work, "figure", "probe.png"));
const pathBaseDoc =
  String.raw`\documentclass[tikz,border=4pt]{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
  \node at (0,0) {\includegraphics[width=2cm]{figure/probe.png}};
\end{tikzpicture}
\end{document}
`;
tex("path-base.tex", pathBaseDoc);
const pathBaseRun = compileTex("path-base");
const pathBaseGenerated = existsSync(path.join(work, "path-base.pdf"));
console.log(`  相对路径 figure/probe.png: exit=${pathBaseRun.ok} pdf=${pathBaseGenerated ? "YES" : "NO"} ${logTail("path-base")}`);

// ② SVG 源图：给 §4「明确不做」一个可复跑的实证
const minimalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#446ed2"/></svg>`;
writeFileSync(path.join(work, "probe.svg"), minimalSvg, "utf8");
const svgCaseDoc =
  String.raw`\documentclass[tikz,border=4pt]{standalone}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
  \node at (0,0) {\includegraphics[width=2cm]{probe.svg}};
\end{tikzpicture}
\end{document}
`;
tex("svg-case.tex", svgCaseDoc);
const svgCaseRun = compileTex("svg-case");
const svgCaseGenerated = existsSync(path.join(work, "svg-case.pdf"));
console.log(`  SVG 源图（无 svg 宏包 / -no-shell-escape）: exit=${svgCaseRun.ok} pdf=${svgCaseGenerated ? "YES" : "NO"} ${logTail("svg-case")}`);

console.log("\n=== P0-3 · pdftocairo -svg 位图内嵌性（三种源图各测） ===");
function probeSvg(ext) {
  const src = `${ext}-with-graphicx`;
  if (!existsSync(path.join(work, `${src}.pdf`))) return { ext, checked: false, reason: "源 PDF 未生成" };
  const outName = `preview-${ext}.svg`;
  const res = run(PDFTOCAIRO, ["-svg", "-f", "1", "-l", "1", `${src}.pdf`, outName]);
  let p = path.join(work, outName);
  // 与 Rust find_product 一致：产物名可能被改写成 <name>-1.svg
  if (!existsSync(p)) {
    const alt = path.join(work, `preview-${ext}-1.svg`);
    if (existsSync(alt)) p = alt;
  }
  if (!existsSync(p)) return { ext, checked: false, reason: "未生成 SVG", output: res.out.slice(-300) };
  const svg = readFileSync(p, "utf8");
  const images = [...svg.matchAll(/<image\b[^>]*>/gi)].map((m) => m[0]);
  const hrefs = images.map((tag) => (tag.match(/(?:xlink:)?href="([^"]*)"/i) ?? [])[1] ?? "");
  const embedded = hrefs.filter((h) => /^data:image\//i.test(h));
  const external = hrefs.filter((h) => h && !/^data:image\//i.test(h));
  return {
    ext,
    checked: true,
    exitOk: res.ok,
    svgBytes: svg.length,
    imageTagCount: images.length,
    embeddedCount: embedded.length,
    externalCount: external.length,
    embeddedMime: [...new Set(embedded.map((h) => (h.match(/^data:(image\/[^;,]+)/i) ?? [])[1]))],
    hrefPrefix: hrefs[0]?.slice(0, 42) ?? null,
    firstImageTag: images[0]?.slice(0, 150) ?? null,
  };
}
const svgConclusions = ["png", "jpg", "pdf"].map(probeSvg);
for (const c of svgConclusions) {
  console.log(
    `  ${c.ext}: checked=${c.checked} svg=${c.svgBytes ?? "-"}B <image>=${c.imageTagCount ?? "-"} ` +
      `base64=${c.embeddedCount ?? "-"} 外链=${c.externalCount ?? "-"} ` +
      `MIME=${JSON.stringify(c.embeddedMime ?? [])} href=${c.hrefPrefix ?? c.reason}`,
  );
}
const allSelfContained =
  svgConclusions.every((c) => c.checked && c.externalCount === 0);
console.log("  判据：所有 <image> 的 href 均以 data:image/ 开头（或没有 <image>）⇒ SVG 自包含，");
console.log("        精确预览 <img src=\"data:image/svg+xml,…\"> 能显示真图，P1 无需「SVG 位图内联化」子任务。");
console.log("  三种格式自包含:", allSelfContained);

console.log("\n=== 汇总（机器可读） ===");
console.log(
  JSON.stringify(
    {
      platform: platform(),
      toolchain: {
        xelatex: run(XELATEX, ["--version"]).out.split(/\r?\n/)[0] ?? null,
        pdftocairo: run(PDFTOCAIRO, ["-v"]).out.split(/\r?\n/)[0] ?? null,
      },
      assets,
      jpegFallbackUsed,
      formatMatrix: matrix,
      pathBase: { exitOk: pathBaseRun.ok, pdfGenerated: pathBaseGenerated, log: logTail("path-base") },
      svgSourceRejected: !svgCaseGenerated,
      svgSourceCase: { exitOk: svgCaseRun.ok, pdfGenerated: svgCaseGenerated, log: logTail("svg-case") },
      svg: svgConclusions,
      allSvgSelfContained: allSelfContained,
      workKept: KEEP ? work : "(已清理)",
    },
    null,
    2,
  ),
);

if (!KEEP) rmSync(work, { recursive: true, force: true });
console.log("\n探针 B 结束（未改任何产品代码）。");
