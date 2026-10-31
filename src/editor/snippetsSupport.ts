// M2-5b · Snippets 编辑器接线：补全源 + Tab 直展 + $SELECTION 选中包裹
// 架构：内置包（DEFAULT_SNIPPETS）+ 用户自定义（Rust snippets.json）合并为模块级片段表；
// 补全走唯一 autocompletion({override}) 追加的第三个 source（LaTeX 命令 / \cite 之后），
// Tab 直展挂最低优先级 keymap（补全弹窗 accept、公式槽位导航、缩进均先于它）。
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { snippet, nextSnippetField, prevSnippetField } from "@codemirror/autocomplete";
import { indentWithTab, indentLess } from "@codemirror/commands";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import {
  DEFAULT_SNIPPETS,
  normalizeSnippets,
  type SnippetDef,
} from "@/types/snippets";
import { snippetsApi } from "@/ipc/invoke";

// ── 片段表（模块级；补全/展开在调用时读取，不触发编辑器重建） ──

let userSnippets: SnippetDef[] = [];

/** 覆盖用户自定义片段表（归一化；启动加载与 M2-5c 设置页保存后调用） */
export function setUserSnippets(list: SnippetDef[]): void {
  userSnippets = normalizeSnippets(list);
}

/** 全量片段表（内置 + 用户自定义） */
export function allSnippets(): SnippetDef[] {
  return [...DEFAULT_SNIPPETS, ...userSnippets];
}

/** 启动时从后端加载用户自定义片段（失败静默，仅内置包可用） */
export async function refreshUserSnippets(): Promise<void> {
  try {
    setUserSnippets(await snippetsApi.loadUserSnippets());
  } catch (e) {
    console.warn("[snippets] 用户片段加载失败，仅内置包可用", e);
  }
}

// ── 展开引擎 ──

/**
 * 展开片段：处理 $SELECTION（选中包裹）后交给 CM snippet()（占位符 ${n:} / Tab 跳转原生支持）。
 * - 选中文字 + 模板含 $SELECTION → 选中内容替换 $SELECTION，整体替换选区（包裹语义）；
 *   流程：选中文字 → Ctrl+Space 唤起补全（选区保留）→ 选片段项；
 * - 无选区 + 模板含 $SELECTION → $SELECTION 变为首个占位符 ${1:内容}；
 * - 其余模板直接在 [from, to]（触发词区间）上展开。
 * 选中内容里的 `$` 会破坏 snippet 模板语法，先转义。
 */
export function expandSnippet(
  view: EditorView,
  snip: SnippetDef,
  from: number,
  to: number,
): boolean {
  const sel = view.state.selection.main;
  const selected = sel.empty ? "" : view.state.doc.sliceString(sel.from, sel.to);
  const hasSelTok = snip.body.includes("$SELECTION");
  let template = snip.body;
  if (hasSelTok && selected) {
    template = snip.body.replace(/\$SELECTION/g, selected.replace(/\$/g, "\\$"));
    snippet(template)(view, null, sel.from, sel.to); // 包裹：替换选区本身
    return true;
  }
  if (hasSelTok) {
    template = snip.body.replace(/\$SELECTION/g, "${1:内容}");
  }
  snippet(template)(view, null, from, to);
  return true;
}

/** 光标前触发词精确命中 → Tab 直展；否则返回 false 交还缩进 */
export function expandTriggerAtCursor(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const before = line.text.slice(0, sel.head - line.from);
  const m = /[A-Za-z]+$/.exec(before);
  if (!m) return false;
  const word = m[0].toLowerCase();
  const snip = allSnippets().find((s) => s.trigger.toLowerCase() === word);
  if (!snip) return false;
  return expandSnippet(view, snip, sel.head - m[0].length, sel.head);
}

// ── 补全源 ──

/**
 * 片段补全源（追加为 override 第三项）。按触发词前缀匹配；
 * type="text" 与 LaTeX 命令（function/keyword）视觉区分；boost=-99 让命令补全优先。
 * detail 展示 desc（缺省分类）。explicit=true 时（Ctrl+Space）空前缀也列出全部片段。
 */
export function snippetCompletionSource(
  ctx: CompletionContext,
): CompletionResult | null {
  const word = ctx.matchBefore(/[A-Za-z]+/);
  if (!word) return null;
  if (word.from === word.to && !ctx.explicit) return null;
  const typed = word.text.toLowerCase();
  const options = allSnippets()
    .filter((s) => s.trigger.toLowerCase().startsWith(typed))
    .map((s) => ({
      label: s.trigger,
      detail: s.desc ?? s.category,
      type: "text" as const,
      boost: -99,
      apply: (view: EditorView, _c: unknown, from: number, to: number) =>
        expandSnippet(view, s, from, to),
    }));
  if (options.length === 0) return null;
  return { from: word.from, options, validFor: /^[A-Za-z]*$/ };
}

/**
 * Tab 直展 keymap：先尝试触发词直展，未命中回落默认缩进（indentMore/indentLess）。
 * 注意：@uiw/react-codemirror 自带 indentWithTab=true 且置于扩展数组最前（最高优先级），
 * 会在 LaTeXEditor 侧以 indentWithTab={false} 关闭，缩进职责由本 keymap 内的 fallback 接管——
 * 顺序：补全弹窗 accept / 公式槽位导航（更高优先级 keymap）→ 直展 → 缩进。
 */
export const snippetTabKeymap = keymap.of([
  // 片段占位符跳转（snippet() 展开后 ${n:} 字段导航；无活动片段返回 false 自然落空）
  { key: "Tab", run: nextSnippetField },
  { key: "Shift-Tab", run: prevSnippetField },
  {
    key: "Tab",
    run: (view) => expandTriggerAtCursor(view),
  },
  indentWithTab, // {Tab: indentMore}（新版 @codemirror/commands 为单对象；Shift-Tab 缩进不在其中）
  { key: "Shift-Tab", run: indentLess },
]);
