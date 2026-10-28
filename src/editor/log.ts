// M1-14i · LaTeX 编译日志（.log）语法高亮（纯前端，零新依赖）
// 识别编译错误（行首 !）、Overfull/Underfull 等排版告警、行号引用（l.123）与文件作用域括号。
// 复用 CM6 StreamLanguage（与 bibtex.ts 同源）。
import { StreamLanguage, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { EffectiveTheme } from "@/types/settings";

const LOG_WARN = /^(Overfull|Underfull|Warning|Error)\b/;

export const logLanguage = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;

    // 编译错误：行首 !（其后整行标红）
    if (stream.sol() && stream.peek() === "!") {
      stream.skipToEnd();
      return "invalid";
    }

    // 排版告警 / 错误关键字
    if (stream.match(LOG_WARN)) return "keyword";

    // 行号引用 l.123（用于跳转定位）
    if (stream.match(/^l\.\d+/)) return "number";

    // 文件作用域括号（./file.tex … )
    if (stream.match(/^[()]/)) return "meta";

    // 普通数字
    if (stream.match(/^\d+/)) return "number";

    // 其余片段（路径、消息正文）不着色
    if (stream.match(/^\S+/)) return null;

    stream.next();
    return null;
  },
});

export const LOG_HIGHLIGHT: Record<EffectiveTheme, HighlightStyle> = {
  light: HighlightStyle.define([
    { tag: t.invalid, color: "#c0392b" }, // 行首 ! 错误
    { tag: t.keyword, color: "#b9770e" }, // Overfull/Underfull/Warning
    { tag: t.number, color: "#0d7a6e" }, // l.123 / 数字
    { tag: t.meta, color: "#7a828c" }, // 文件作用域括号
  ]),
  dark: HighlightStyle.define([
    { tag: t.invalid, color: "#ff6b6b" },
    { tag: t.keyword, color: "#e0b169" },
    { tag: t.number, color: "#6fd3c4" },
    { tag: t.meta, color: "#7e8794" },
  ]),
};
