// M1-14c · \cite 补全 + 悬浮预览（纯前端，零 Rust 改动）—— 见 docs/开发计划.md M1-14
// 仅作用于 .tex（\cite 是 LaTeX 命令）；补全与悬浮都只读 useReferenceStore 缓存，不在按键时重解。
// 纯逻辑见 citeLogic.ts（可在 Node 单测）；本文件只做 CM6 接线与读 store。
import type {
  CompletionContext,
  CompletionResult,
  Completion,
} from "@codemirror/autocomplete";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Text } from "@codemirror/state";
import { useReferenceStore } from "./useReferenceStore";
import { jumpToFile } from "@/editor/jump";
import {
  CITE_FULL_RE,
  matchCitePrefix,
  citeCompletionFrom,
  findCiteKeyAt,
  findCiteKeyForJump,
  authorYear,
  citeTooltipHtml,
} from "./citeLogic";

/**
 * M1-14d+ · 按住 Ctrl 时的可点击提示（仿 VS Code）：
 * - 模块级 ctrlHeld 标志：由 ctrlHeldPlugin 的 window 监听维护，供悬浮源判断「是否按住了 Ctrl」。
 * - citeLinkDecorations：把可见范围内所有 \cite{...} 命令整体标为 .cm-cite-link 装饰；
 *   平时不影响显示，仅在 .cm-editor.ctrl-held 下由 CSS 显示为下划线+手型光标（链接态）。
 * - citeJumpHint：仅在按住 Ctrl 悬停于 \cite 上时出现「Ctrl+点击跳转到引用条目」提示，
 *   此时普通悬浮预览 citeHoverSource 主动让位（返回 null），避免两个提示叠加。
 */
let ctrlHeld = false;

/** 供其它「Ctrl+点击」跳转（如 \input 文件跳转）复用同一按住状态 */
export function isCtrlHeld(): boolean {
  return ctrlHeld;
}

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
  // 按住 Ctrl 时让位给跳转提示（citeJumpHint），避免两个提示叠加
  if (ctrlHeld) return null;
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

/** 扫描可见范围，把所有 \cite{...} 命令整体标为可点链接（.cm-cite-link 装饰） */
function buildCiteLinkDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of view.visibleRanges) {
    let pos = r.from;
    while (pos <= r.to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      CITE_FULL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CITE_FULL_RE.exec(text))) {
        const from = line.from + m.index;
        const to = line.from + m.index + m[0].length;
        if (to > r.from && from < r.to) {
          builder.add(from, to, Decoration.mark({ class: "cm-cite-link" }));
        }
      }
      pos = line.to + 1;
      if (line.to + 1 > view.state.doc.length) break;
    }
  }
  return builder.finish();
}

/** M1-14d+ · \cite{...} 整体作为可点链接的装饰（平时无样式，仅 ctrl-held 下显示为链接态） */
export const citeLinkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildCiteLinkDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildCiteLinkDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * 监听全局 Ctrl/⌘ 按下/抬起，维护 ctrlHeld 标志，并在编辑器 DOM 上加/去 .ctrl-held 类，
 * 驱动 CSS 把 \cite 链接显示为「手型光标 + 下划线」。多实例各自挂监听，共享同一标志。
 */
export const ctrlHeldPlugin = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        ctrlHeld = true;
        this.dom.classList.add("ctrl-held");
      }
    };
    onKeyUp = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        ctrlHeld = false;
        this.dom.classList.remove("ctrl-held");
      }
    };
    onBlur = () => {
      ctrlHeld = false;
      this.dom.classList.remove("ctrl-held");
    };
    constructor(view: EditorView) {
      this.dom = view.dom;
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("blur", this.onBlur);
    }
    destroy() {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      this.dom.classList.remove("ctrl-held");
    }
  },
);

/**
 * 跳转提示：仅在按住 Ctrl 悬停于 \cite{...} 上时显示「Ctrl+点击跳转到引用条目」。
 * 与 citeHoverSource 互斥（后者在 ctrlHeld 时返回 null）。
 */
export function citeJumpHint(view: EditorView, pos: number): Tooltip | null {
  if (!ctrlHeld) return null;
  const found = findCiteKeyForJump(view.state.doc, pos);
  if (!found) return null;

  const ref = useReferenceStore.getState();
  const arr = ref.byKey.get(found.key);
  const label =
    arr && arr.length > 0
      ? `Ctrl+点击跳转到引用条目${arr[0].title ? "：" + arr[0].title : ""}`
      : `Ctrl+点击：引用「${found.key}」缺失（无法跳转）`;

  const dom = document.createElement("div");
  dom.className = "cm-cite-jump-hint";
  dom.textContent = label;

  return {
    pos: found.from,
    create: () => ({ dom }),
    above: true,
  };
}
