// M1-14b · BibTeX 专属语法高亮（纯前端，零新依赖）
// codemirror-lang-latex 不导出 bibtex 语言（legacy-modes 也没有），故用 CM6 StreamLanguage
// 自写轻量词法：覆盖 @type / 引用 key / 字段名 / 值（{...} 与 "..."）/ 注释 / 括号。
import { StreamLanguage, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { EffectiveTheme } from "@/types/settings";

interface BibState {
  /** 是否处于「字段值」上下文（等号之后，直到闭合括号/引号） */
  inValue: boolean;
  /** 跨行花括号深度（支撑多行 {…} 值） */
  braceDepth: number;
}

export const bibtexLanguage = StreamLanguage.define<BibState>({
  startState: () => ({ inValue: false, braceDepth: 0 }),
  copyState: (s) => ({ inValue: s.inValue, braceDepth: s.braceDepth }),
  token(stream, state) {
    if (stream.eatSpace()) return null;

    // 注释（% 到行尾）
    if (stream.peek() === "%") {
      stream.skipToEnd();
      return "comment";
    }

    // 字段值内部：读到闭合引号 / 花括号为止
    if (state.inValue) {
      const ch = stream.peek();
      if (ch === '"') {
        stream.next();
        if (stream.skipTo('"')) stream.next();
        else stream.skipToEnd();
        state.inValue = false;
        return "string";
      }
      // 花括号值：逐字符扫描整行并跟踪 braceDepth，遇到配平的右括号即闭合。
      // 首行以 { 开头时 depth 从 1 计起；跨行续行（depth>0）同样逐字跟踪，
      // 保证嵌套花括号跨行时不会被错误吞掉、右括号能正确闭合 value。
      while (!stream.eol()) {
        const c = stream.next()!;
        if (c === "{") state.braceDepth++;
        else if (c === "}") {
          state.braceDepth--;
          if (state.braceDepth <= 0) {
            state.inValue = false;
            break;
          }
        }
      }
      return "string";
    }

    // @type 条目类型声明
    if (stream.match(/^@\w+/)) return "keyword";

    // 括号（条目分隔 / 结构）
    if (stream.match(/^[{}()]/)) return "meta";

    // 等号 → 进入字段值上下文
    if (stream.match(/^=/)) {
      state.inValue = true;
      return "operator";
    }

    // 单词：其后紧跟 '=' 的是字段名，否则是引用 key
    if (stream.match(/^\w+/)) {
      const rest = stream.string.slice(stream.pos);
      return /^\s*=/.test(rest) ? "variableName" : "atom";
    }

    stream.next();
    return null;
  },
});

export const BIB_HIGHLIGHT: Record<EffectiveTheme, HighlightStyle> = {
  light: HighlightStyle.define([
    { tag: t.comment, color: "#8d959e" },
    { tag: t.keyword, color: "#2b62cf" }, // @type
    { tag: t.atom, color: "#0d7a6e" }, // 引用 key
    { tag: t.variableName, color: "#9a5b0d" }, // 字段名
    { tag: t.string, color: "#1e7a4f" }, // 值
    { tag: t.operator, color: "#9a5b0d" }, // =
    { tag: t.meta, color: "#7a828c" }, // 括号
  ]),
  dark: HighlightStyle.define([
    { tag: t.comment, color: "#6b7480" },
    { tag: t.keyword, color: "#7fb0ff" },
    { tag: t.atom, color: "#6fd3c4" },
    { tag: t.variableName, color: "#e0b169" },
    { tag: t.string, color: "#7fdca0" },
    { tag: t.operator, color: "#e0b169" },
    { tag: t.meta, color: "#7e8794" },
  ]),
};
