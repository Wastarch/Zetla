// M2 · 绘图模块 F1-4：插入主文档的纯字符串逻辑。
// 独立成文件是为了不依赖 CodeMirror / zustand / IPC，便于在 Node 里直接跑回归
// （scripts/diagram-render.test.ts 用 --experimental-strip-types 直接导入）。
// 副作用部分（取 editor view、dispatch、notify）留在 insert.ts。
// 带 .ts 扩展名：tsconfig 已开 allowImportingTsExtensions，Vite 可解析；
// 这样 scripts/diagram-render.test.ts 用 node --experimental-strip-types 直接导入也能跑。
import { hasPackage, packageSnippet } from "../../core/preamble.ts";

/** 扫描源码里的 \usetikzlibrary{...}，去重后给导言区补依赖 */
export function collectTikzLibraries(source: string): string[] {
  const out: string[] = [];
  const re = /\\usetikzlibrary\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    for (const lib of m[1].split(",")) {
      const t = lib.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * 计算需要追加到导言区的片段（幂等）：
 *  - 缺 \usepackage{tikz} → 补一行；
 *  - P3：插入的代码含 \includegraphics 且缺 \usepackage{graphicx} → 补一行
 *    （P0 实测 standalone+tikz 会隐式加载，但主文档的包装方式不可控，显式补更稳妥）；
 *  - 源码用到的 tikzlibrary 若文档已有 \usetikzlibrary 未包含 → 补一条新行（TikZ 允许多次加载）。
 * 返回空串表示导言区已齐备。
 *
 * needsGraphicx 由调用方按「本次真正写进主文档的代码」判定，第三参数可选，
 * 既有两参数调用（F1-4 回归）行为完全不变。
 */
export function ensureTikzPreamble(
  tex: string,
  libs: string[],
  needsGraphicx = false,
): string {
  const lines: string[] = [];
  if (!hasPackage(tex, "tikz")) lines.push(packageSnippet("tikz"));
  if (needsGraphicx) {
    const gx = ensureGraphicxPreamble(tex);
    if (gx) lines.push(gx);
  }
  const existing = new Set<string>();
  const re = /\\usetikzlibrary\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tex)) !== null) {
    for (const lib of m[1].split(",")) {
      const t = lib.trim();
      if (t) existing.add(t);
    }
  }
  const missing = libs.filter((l) => !existing.has(l));
  if (missing.length > 0) lines.push(`\\usetikzlibrary{${missing.join(",")}}`);
  return lines.join("\n");
}

/**
 * P3 / F5-2：**只**补 graphicx，不碰 tikz。
 * 「导出并插入」写进主文档的是 figure + \includegraphics 成品图，主文档未必用 tikz，
 * 若走 ensureTikzPreamble 会凭空多一行 \usepackage{tikz}（无谓改动甚至宏包冲突）。
 */
export function ensureGraphicxPreamble(tex: string): string {
  return hasPackage(tex, "graphicx") ? "" : packageSnippet("graphicx");
}

/** 组装插入代码：可直接插 tikzpicture，也可套 figure + caption/label */
export function buildDiagramInsertCode(
  source: string,
  wrapFigure: boolean,
  caption: string,
  label: string,
): string {
  const body = source.trim();
  if (!wrapFigure) return body;
  const indented = body
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : line))
    .join("\n");
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    indented,
    `  \\caption{${caption.trim() || "图形标题"}}`,
    `  \\label{${label.trim() || "fig:diagram"}}`,
    "\\end{figure}",
  ].join("\n");
}
