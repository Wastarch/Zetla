// M1-17 · LaTeX 语法高亮「数据驱动」构建器（取代 LaTeXEditor.tsx 内硬编码的 LATEX_HIGHLIGHT）
// 配色数据来自设置（settings.highlight.latex）：每个分组自带 lezer 标签名（tags），
// 此处把「分组 → lezer Tag → HighlightStyle」。分组数量不限（可扩展 / 可来自主题预设）。
// 词法本身由 codemirror-lang-latex 决定（styleTags），本项目不改；本模块只管「上什么色」。
import { HighlightStyle, type TagStyle } from "@codemirror/language";
import { tags as t, Tag } from "@lezer/highlight";
import type { EffectiveTheme } from "@/types/settings";
import { DEFAULT_LATEX_HIGHLIGHT, type HighlightGroup } from "@/types/settings";

/**
 * 把 lezer 标签名（字符串，如 "keyword"、"variableName"）解析为 lezer Tag。
 * 未知标签名、以及标签命名空间里的修饰函数（special/definition/…）一律安全跳过。
 */
export function resolveTags(names: string[] | undefined): Tag[] {
  if (!names || names.length === 0) return [];
  const scope = t as unknown as Record<string, unknown>;
  const out: Tag[] = [];
  for (const n of names) {
    const v = scope[n];
    if (v instanceof Tag) out.push(v);
  }
  return out;
}

/**
 * 除颜色外的样式修饰（按分组 id；保留原 LATEX_HIGHLIGHT 的非颜色属性）。
 * 颜色来自配置，字体类修饰在此处补齐，避免把它们也写进可配置数据。
 */
export const GROUP_EXTRA: Record<string, Partial<TagStyle>> = {
  strong: { fontWeight: "600" },
  emphasis: { fontStyle: "italic" },
  monospace: { fontFamily: "var(--font-mono, monospace)" },
};

/**
 * 由配置分组构建 LaTeX 的 HighlightStyle（亮/暗各取对应颜色）。
 * 空数组或非法数据回落默认配色，保证编辑器始终有完整着色（配置缺失/损坏时不白屏）。
 * 每个分组解析出的 tag 列表为空时（标签名全未知）跳过该组。
 */
export function buildLatexHighlight(
  groups: HighlightGroup[] | undefined,
  theme: EffectiveTheme,
): HighlightStyle {
  const src = groups && groups.length > 0 ? groups : DEFAULT_LATEX_HIGHLIGHT;
  const colorOf = (g: HighlightGroup) => (theme === "dark" ? g.dark : g.light);
  const styles: TagStyle[] = [];
  for (const g of src) {
    const tag = resolveTags(g.tags);
    if (tag.length === 0) continue;
    styles.push({ tag, color: colorOf(g), ...GROUP_EXTRA[g.id] });
  }
  return HighlightStyle.define(styles);
}
