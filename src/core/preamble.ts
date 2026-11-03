// P2 · 导言区宏包共享 helper（拼图 subcaption 检测 + 表格模块可复用）。
// 纯字符串操作，不依赖 React / store；编辑器落盘由调用方负责。

/** 检测导言区是否已 \usepackage[opts]{pkg}（忽略顺序与可选参数） */
export function hasPackage(tex: string, pkg: string): boolean {
  const re = new RegExp(
    `\\\\usepackage(?:\\s*\\[[^\\]]*\\])?\\s*\\{\\s*${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`,
    "m",
  );
  return re.test(tex);
}

/** 生成 `\usepackage{pkg}`（含可选参数时带 [opts]） */
export function packageSnippet(pkg: string, opts?: string): string {
  const opt = opts ? `[${opts}]` : "";
  return `\\usepackage${opt}{${pkg}}`;
}

/** subcaption 宏包（拼图 subfigure 必需） */
export const SUBCAPTION_PACKAGE = "subcaption";
export const SUBCAPTION_SNIPPET = packageSnippet(SUBCAPTION_PACKAGE);

/**
 * 把一段导言区片段插入到 `\begin{document}` 之前（独占一行）。
 * 找不到 `\begin{document}` 时追加到文末（兜底，不丢内容）。
 * 返回新源码；调用方负责落盘 / 插入编辑器。
 */
export function insertBeforeDocument(tex: string, snippet: string): string {
  const m = tex.match(/\\begin\{document\}/);
  if (!m) return tex.trimEnd() + "\n" + snippet + "\n";
  const idx = m.index!;
  // 找到该匹配所在行的行首，整行前插入片段
  const lineStart = tex.lastIndexOf("\n", idx - 1) + 1;
  const before = tex.slice(0, lineStart);
  const after = tex.slice(lineStart);
  return before + snippet + "\n" + after;
}
