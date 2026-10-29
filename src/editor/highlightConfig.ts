// M1-17 · LaTeX 语法高亮「数据驱动」构建器（取代 LaTeXEditor.tsx 内硬编码的 LATEX_HIGHLIGHT）
// 配色数据来自设置（settings.highlight.latex），此处只负责任何把「分组 → lezer tag → HighlightStyle」。
// 词法本身由 codemirror-lang-latex 决定（styleTags），本项目不改；本模块只管「上什么色」。
import { HighlightStyle, type TagStyle } from "@codemirror/language";
import { tags as t, type Tag } from "@lezer/highlight";
import type { EffectiveTheme } from "@/types/settings";
import { DEFAULT_LATEX_HIGHLIGHT, type HighlightGroup, type HighlightGroupId } from "@/types/settings";

/**
 * 每个分组的 lezer tag 映射，与 codemirror-lang-latex 的 styleTags 对齐：
 * keyword=控制序列/\begin/\end、heading=章节、className=环境名、labelName=\label/\ref、
 * quote=\cite、operator/variableName/processingInstruction=数学符号与 $、meta=verbatim 内容、
 * string/number=字面参数、bracket=括号、comment=注释、strong/emphasis/monospace=文本样式、
 * invalid=非法字符。
 */
export const GROUP_TAGS: Record<HighlightGroupId, Tag[]> = {
  meta: [t.meta, t.content],
  comment: [t.comment],
  string: [t.string, t.number],
  keyword: [t.keyword, t.definitionKeyword],
  heading: [t.heading],
  operator: [t.operator, t.variableName, t.processingInstruction],
  bracket: [t.bracket],
  class: [t.className, t.labelName, t.quote],
  strong: [t.strong],
  emphasis: [t.emphasis],
  monospace: [t.monospace],
  invalid: [t.invalid],
};

/**
 * 除颜色外的样式修饰（保留原 LATEX_HIGHLIGHT 的非颜色属性）。
 * 颜色来自配置，其余固定修饰在此处补齐，避免把它们也写进可配置数据。
 */
export const GROUP_EXTRA: Record<HighlightGroupId, Partial<TagStyle>> = {
  meta: {},
  comment: {},
  string: {},
  keyword: {},
  heading: {},
  operator: {},
  bracket: {},
  class: {},
  strong: { fontWeight: "600" },
  emphasis: { fontStyle: "italic" },
  monospace: { fontFamily: "var(--font-mono, monospace)" },
  invalid: {},
};

/**
 * 由配置分组构建 LaTeX 的 HighlightStyle（亮/暗各取对应颜色）。
 * 空数组或非法数据回落默认配色，保证编辑器始终有完整着色（配置缺失/损坏时不白屏）。
 */
export function buildLatexHighlight(
  groups: HighlightGroup[] | undefined,
  theme: EffectiveTheme,
): HighlightStyle {
  const src = groups && groups.length > 0 ? groups : DEFAULT_LATEX_HIGHLIGHT;
  const colorOf = (g: HighlightGroup) => (theme === "dark" ? g.dark : g.light);
  const styles: TagStyle[] = src.map((g) => ({
    tag: GROUP_TAGS[g.id],
    color: colorOf(g),
    ...GROUP_EXTRA[g.id],
  }));
  return HighlightStyle.define(styles);
}
