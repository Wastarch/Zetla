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
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Text,
} from "@codemirror/state";
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
 * M1-14d+ · 按住 Ctrl 时的可点击提示（仿 VS Code）：
 * - 模块级 ctrlHeld 标志：由 ctrlHeldPlugin 的 window 监听维护，供悬浮源判断「是否按住了 Ctrl」。
 * - citeLinkDecorations：只给**鼠标悬停的** \cite{...} 命令挂 .cm-cite-link 装饰
 *   （M1-43 追改：用户指令不要全篇下划线，悬停位置由 ctrlHeldPlugin 经 setHoverPos 跟踪）；
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
 * M1-43 追改 · 悬停位置跟踪（Ctrl 链接装饰只在悬停的命令上呈现）。
 * ctrlHeldPlugin 在 Ctrl 按住期间监听 mousemove 维护；鼠标离开 / 文档变化后清空，
 * 两份链接装饰（\cite 与 \input）都从这个字段计算，悬停不在命令上时为空集。
 */
export const setHoverPos = StateEffect.define<number | null>();
export const hoverPosField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let v = value;
    for (const e of tr.effects) if (e.is(setHoverPos)) v = e.value;
    // 文档变化后悬停区间失效，简单重置
    return tr.docChanged && v === value ? null : v;
  },
});

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

/** 悬停于 \cite{...} 上时给该命令整体挂 .cm-cite-link（悬停不在命令上 → 空集） */
function citeDecosAt(state: EditorState): DecorationSet {
  const pos = state.field(hoverPosField, false);
  if (pos == null) return Decoration.none;
  const found = findCiteKeyForJump(state.doc, pos);
  if (!found) return Decoration.none;
  return Decoration.set([
    Decoration.mark({ class: "cm-cite-link" }).range(found.from, found.to),
  ]);
}

/** M1-14d+（M1-43 追改为悬停命中式） · \cite{...} 链接装饰（CSS 仅 ctrl-held 下显示链接态） */
export const citeLinkDecorations = EditorView.decorations.compute(
  [hoverPosField],
  citeDecosAt,
);

/**
 * 监听全局 Ctrl/⌘ 按下/抬起，维护 ctrlHeld 标志，并在编辑器 DOM 上加/去 .ctrl-held 类，
 * 驱动 CSS 把悬停命中的链接显示为「手型光标 + 下划线」。多实例各自挂监听，共享同一标志。
 * M1-43 追改：Ctrl 按住期间额外跟踪鼠标悬停位置（setHoverPos），链接装饰只标悬停命令；
 * Ctrl 状态变化时重发悬停位置并补发一次 mousemove，让 CM 的 hoverTooltip 管线重查源
 * （鼠标已停在命令上再按 Ctrl 也能立即出提示，不必先晃一下鼠标）。
 */
export const ctrlHeldPlugin = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    view: EditorView;
    lastX = 0;
    lastY = 0;
    lastPos: number | null = null;

    onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !ctrlHeld) {
        ctrlHeld = true;
        this.dom.classList.add("ctrl-held");
        this.retarget();
      }
    };
    onKeyUp = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) && ctrlHeld) {
        ctrlHeld = false;
        this.dom.classList.remove("ctrl-held");
        this.retarget();
      }
    };
    onBlur = () => {
      ctrlHeld = false;
      this.dom.classList.remove("ctrl-held");
      if (this.lastPos !== null) {
        this.lastPos = null;
        this.view.dispatch({ effects: setHoverPos.of(null) });
      }
    };
    /** 重算悬停位置并触发一次状态更新（装饰 facet 重算 + tooltip 管线重查） */
    retarget() {
      const pos = this.view.posAtCoords({ x: this.lastX, y: this.lastY });
      if (pos !== this.lastPos) {
        this.lastPos = pos;
      }
      this.view.dispatch({ effects: setHoverPos.of(pos) });
      if (ctrlHeld && this.lastX !== 0 && this.lastY !== 0) {
        this.view.dom.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: this.lastX,
            clientY: this.lastY,
            bubbles: true,
          }),
        );
      }
    };
    onMouseMove = (e: MouseEvent) => {
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (!ctrlHeld) return; // 未按 Ctrl 时不跟踪（装饰反正是隐藏的，省去无谓的事务）
      const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos !== this.lastPos) {
        this.lastPos = pos;
        this.view.dispatch({ effects: setHoverPos.of(pos) });
      }
    };
    onMouseLeave = () => {
      if (this.lastPos !== null) {
        this.lastPos = null;
        if (ctrlHeld) this.view.dispatch({ effects: setHoverPos.of(null) });
      }
    };
    constructor(view: EditorView) {
      this.view = view;
      this.dom = view.dom;
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      window.addEventListener("blur", this.onBlur);
      view.dom.addEventListener("mousemove", this.onMouseMove);
      view.dom.addEventListener("mouseleave", this.onMouseLeave);
    }
    destroy() {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      window.removeEventListener("blur", this.onBlur);
      this.view.dom.removeEventListener("mousemove", this.onMouseMove);
      this.view.dom.removeEventListener("mouseleave", this.onMouseLeave);
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
