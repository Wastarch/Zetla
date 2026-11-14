// M2 · 绘图模块 F5-2：把已导出的图片组装成主文档 figure 片段。
// 纯字符串逻辑（不依赖 DOM / React / store），Node 侧可直接回归，便于锁住
// 「相对路径折算 / label slug / caption 落点 / 宽度」这几处易错口径。
//
// 与 R5 拖拽导入共用 core/latexTemplates.buildFigure，保证三种入口
// （拖拽选图 / 拼图模块 / 绘图导出）产出的 figure 版式完全一致。
import { buildFigure } from "../../core/latexTemplates.ts";
import { relativePath, slugify } from "../../editor/image/pathUtils.ts";

export interface DiagramFigureParts {
  /** 目标 .tex 所在目录（绝对值）。用于折算 \includegraphics 的相对路径 */
  texDir: string;
  /** 导出产物的绝对路径 */
  imageAbsPath: string;
  /** LaTeX 宽度串（如 "8cm"）。省略则回落 buildFigure 默认的 0.8\linewidth */
  width?: string;
}

export interface DiagramFigureSnippet {
  /** 待插入的 figure 环境源码 */
  snippet: string;
  /** 光标相对插入文本的偏移：落在空的 `\caption{ }` 内，方便直接敲图题 */
  captionOffset: number;
}

/**
 * 组装 figure 片段。
 *
 * 相对路径口径：`\includegraphics` 按**目标 .tex 所在目录**解析，故必须用
 * `relativePath(texDir, imageAbsPath)`，统一正斜杠（Windows 反斜杠在 LaTeX 里
 * 会被当成转义字符）。
 *
 * label 口径：由文件名 slug 生成 `fig:<slug>`。同一文件名重复导出会覆盖同名图片，
 * label 也随之稳定，便于正文 `\ref` 引用。
 */
export function buildDiagramFigureSnippet(p: DiagramFigureParts): DiagramFigureSnippet {
  const relPath = relativePath(p.texDir, p.imageAbsPath);
  const fileName = p.imageAbsPath.split(/[\\/]/).pop() || "figure";
  const snippet = buildFigure({
    path: relPath,
    caption: "",
    label: `fig:${slugify(fileName)}`,
    width: p.width,
  });
  const capIdx = snippet.indexOf("\\caption{");
  const captionOffset = capIdx >= 0 ? capIdx + "\\caption{".length : snippet.length;
  return { snippet, captionOffset };
}
