// M1-14c · \cite 补全 + 悬浮预览（纯前端，零 Rust 改动）—— 见 docs/开发计划.md M1-14
// 仅作用于 .tex（\cite 是 LaTeX 命令）；补全与悬浮都只读 useReferenceStore 缓存，不在按键时重解。
// 纯逻辑见 citeLogic.ts（可在 Node 单测）；本文件只做 CM6 接线与读 store。
import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import type { EditorView, Tooltip } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import { useReferenceStore } from "./useReferenceStore";
import { jumpToFile } from "@/editor/jump";
import {
  matchCitePrefix,
  citeCompletionFrom,
  findCiteKeyAt,
  findCiteKeyForJump,
  authorYear,
  citeTooltipHtml,
} from "./citeLogic";

/**
 * \cite{ 补全源：在 .tex 中输入 \cite{（或带可选参数/多 key 逗号后）时，从引用索引给出 key 候选。
 * label=key，detail=作者(年份)，info=标题；选中插入 key（替换光标前已输入的前缀）。
 */
export function citeCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  if (!matchCitePrefix(textBefore)) return null;

  const ref = useReferenceStore.getState();
  if (!ref.ready || ref.byKey.size === 0) return null;

  const from = citeCompletionFrom(textBefore, line.from, pos);
  const options: Completion[] = [];
  for (const [key, arr] of ref.byKey) {
    const entry = arr[0];
    options.push({
      label: key,
      detail: authorYear(entry),
      info: entry.title ? entry.title : undefined,
      type: "variableName",
      apply: key,
    });
  }
  if (options.length === 0) return null;
  return { from, options, filter: true };
}

/** 悬浮源：光标位于 \cite{key} 的 key 上 → 弹作者/标题/年份预览；key 缺失则标「引用缺失」 */
export function citeHoverSource(view: EditorView, pos: number): Tooltip | null {
  const found = findCiteKeyAt(view.state.doc, pos);
  if (!found) return null;

  const ref = useReferenceStore.getState();
  const arr = ref.byKey.get(found.key);

  const dom = document.createElement("div");
  dom.className = "cm-cite-tooltip";
  dom.innerHTML = citeTooltipHtml(
    found.key,
    arr && arr.length > 0 ? arr[0] : undefined,
    arr ? arr.length : 0,
  );

  return {
    pos: found.from,
    create: () => ({ dom }),
    above: true,
  };
}

/**
 * M1-14d · Ctrl+点击 \cite{key} → 跳转到 bib 条目。
 * 命中命令且 key 在引用索引中存在 → 经 jumpToFile 打开/切到 .bib 并选中条目行，返回 true（消费事件）；
 * 命中命令但 key 缺失（引用未定义）→ 仍消费事件（避免回落到 synctex 误导），仅控制台告警；
 * 未命中任何 \cite → 返回 false（交还上层回落到 synctex 正向跳转）。
 * 只读 useReferenceStore 缓存，不在点击时重解。
 */
export function citeJumpAtCursor(doc: Text, pos: number): boolean {
  const found = findCiteKeyForJump(doc, pos);
  if (!found) return false;

  const ref = useReferenceStore.getState();
  const arr = ref.byKey.get(found.key);
  if (arr && arr.length > 0) {
    const e = arr[0];
    jumpToFile(e.file, e.line);
    return true;
  }
  console.warn(`[cite-jump] 引用 key「${found.key}」在 .bib 中未找到，无法跳转`);
  return true;
}
