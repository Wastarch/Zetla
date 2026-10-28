// M1-14i · BibTeX 样式文件（.bst）语法高亮（纯前端，零新依赖）
// .bst 是 PostScript 风格的后缀式语言（ENTRY/FUNCTION/INTEGERS/STRINGS 声明 + 内建函数以 $
// 结尾），与 BibTeX 条目（.bib）不同，故单独写轻量词法，避免被错当 LaTeX 高亮。
// 复用 CM6 StreamLanguage（与 bibtex.ts 同源）。
import { StreamLanguage, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { EffectiveTheme } from "@/types/settings";

const BST_KEYWORDS =
  /^(ENTRY|FUNCTION|INTEGERS|STRINGS|MACRO|READ|ITERATE|REVERSE|EXECUTE|SORT|CALL)\b/;

export const bstLanguage = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;

    // 注释（% 到行尾）
    if (stream.peek() === "%") {
      stream.skipToEnd();
      return "comment";
    }

    // 字符串字面量 "…"
    if (stream.peek() === '"') {
      stream.next();
      if (stream.skipTo('"')) stream.next();
      else stream.skipToEnd();
      return "string";
    }

    // 整数字面量 #123（BST 中 # 引入整型）
    if (stream.match(/^#\d+/)) return "number";

    // 全局声明关键字
    if (stream.match(BST_KEYWORDS)) return "keyword";

    // 内建/用户函数（以 $ 结尾的后缀式函数名，如 format.name$ / if$ / skip$）
    if (stream.match(/^[A-Za-z][\w.]*\$/)) return "macroName";

    // 结构标点
    if (stream.match(/^[{()}.,]/)) return "meta";

    // 赋值 / 连接操作符
    if (stream.match(/^[=]/)) return "operator";

    // 其余单词（字段名 / 变量等）
    if (stream.match(/^\w+/)) return "atom";

    stream.next();
    return null;
  },
});

export const BST_HIGHLIGHT: Record<EffectiveTheme, HighlightStyle> = {
  light: HighlightStyle.define([
    { tag: t.comment, color: "#8d959e" },
    { tag: t.keyword, color: "#2b62cf" }, // ENTRY/FUNCTION/…
    { tag: t.macroName, color: "#8a3df0" }, // $ 后缀函数
    { tag: t.string, color: "#1e7a4f" },
    { tag: t.number, color: "#9a5b0d" },
    { tag: t.atom, color: "#444c56" },
    { tag: t.operator, color: "#9a5b0d" },
    { tag: t.meta, color: "#7a828c" },
  ]),
  dark: HighlightStyle.define([
    { tag: t.comment, color: "#6b7480" },
    { tag: t.keyword, color: "#7fb0ff" },
    { tag: t.macroName, color: "#c39bff" },
    { tag: t.string, color: "#7fdca0" },
    { tag: t.number, color: "#e0b169" },
    { tag: t.atom, color: "#c8ccd2" },
    { tag: t.operator, color: "#e0b169" },
    { tag: t.meta, color: "#7e8794" },
  ]),
};
