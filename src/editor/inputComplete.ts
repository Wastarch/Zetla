// M1-44 · \input 类命令花括号内的文件路径补全（纯前端，零 Rust 改动）
// 候选来自 useProjectStore 项目树缓存，基准目录 = 主文件目录（编译工作目录口径，
// 与 M1-43 跳转/一键创建一致）；触发判定/候选收集/前缀过滤的纯逻辑见 inputSpec.ts。
// 与 citeCompletionSource 并列挂在唯一的 autocompletion({override}) 里：
// 两者的触发上下文（\cite{ vs \input{）不重叠，顺序无关。
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import {
  collectRelPaths,
  completionCandidatesFor,
  filterByPrefix,
  inComment,
  matchInputTargetBefore,
} from "./inputSpec";
import { parentOf, useProjectStore } from "@/project/useProject";

/**
 * 互斥守卫（用户指令 2026-11-22：光标在 \input 类花括号里「只弹文件路径」）：
 * 光标处于引入文件命令的花括号内（且不在注释里）时让被包装的补全源沉默，
 * 否则原样转发。用于包住 latexCompletionSource 与 snippetCompletionSource——
 * 前者会在 \input{sec 里弹 \section 等命令候选，后者会被 typed 前缀误撞触发词。
 */
export function notInsideInputBraces(
  base: (context: CompletionContext) => CompletionResult | null,
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);
    const hit = matchInputTargetBefore(textBefore);
    if (hit && !inComment(textBefore, hit.slashIdx)) return null;
    return base(context);
  };
}

/**
 * 补全源：光标处于 \input/\include/\subfile/\lstinputlisting/\verbatiminput/
 * \bibliography/\addbibresource/\includegraphics 的花括号内时，按命令规格给出
 * 项目内文件路径候选（tex 目标不带 .tex 后缀插入；目录候选带尾 / 供逐级下钻）。
 * 注释里的命令、无项目/无树时不触发。
 */
export function inputPathCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  const hit = matchInputTargetBefore(textBefore);
  if (!hit || inComment(textBefore, hit.slashIdx)) return null;

  const st = useProjectStore.getState();
  const nodes = st.tree?.nodes;
  const baseDir = st.tree?.mainFile ? parentOf(st.tree.mainFile) : st.root;
  if (!nodes || !baseDir) return null;

  const cands = completionCandidatesFor(hit.cmd, collectRelPaths(nodes, baseDir));
  if (cands.length === 0) return null;

  // 过滤用 / 归一（用户可能敲 \）；插入回 from..pos 的 from 按 typed 原样长度算
  const { files, dirs } = filterByPrefix(cands, hit.typed.replace(/\\/g, "/"));
  if (files.length === 0 && dirs.length === 0) return null;

  const options = [
    ...dirs.map((d) => ({ label: d, detail: "目录", apply: d })),
    ...files.map((f) => ({ label: f, detail: `\\${hit.cmd} 目标`, apply: f })),
  ];
  return { from: pos - hit.typed.length, options, filter: true };
}
