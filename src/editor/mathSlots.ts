// M1-11 · 公式搭建器槽位导航（编辑器侧）
// 占位符协议见 slotRange.ts：空槽序列化为 \Box（LaTeX 内核命令「空心方框」，编译合法）
//   1) insertSnippetWithSlots：插入公式后自动选中第一个 \Box（直接打字即替换）
//   2) Tab 键：当前选区恰为 \Box → 跳到下一个 \Box 并选中（循环；无下一个则交还默认行为）
//   3) ViewPlugin：给视口内全部 \Box 加 cm-math-slot 装饰（剩余槽位一目了然）
//   4) 鼠标左键无修饰键点击 \Box 装饰内 → 选中该槽（MathType 式点选）
// 无持久状态：每次按键/点击从当前选区与文档实时推算，编辑漂移天然免疫。
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { getActiveView } from "@/editor/activeView";
import { SLOT_MARK, SLOT_RE } from "./slotRange";

/** 视口内全部 \Box 的装饰（剩余槽高亮） */
function buildSlotDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of view.visibleRanges) {
    const text = view.state.sliceDoc(r.from, r.to);
    SLOT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SLOT_RE.exec(text)) !== null) {
      const from = r.from + m.index;
      builder.add(from, from + SLOT_MARK.length, Decoration.mark({ class: "cm-math-slot" }));
    }
  }
  return builder.finish();
}

const slotPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildSlotDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildSlotDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Tab 槽位跳转：当前选区恰为 \Box 时选中下一个 \Box（文档内循环）。
 * 其余情况返回 false —— 交还 CM6 默认行为（缩进等），不影响正常编辑。
 */
function jumpToNextSlot(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (state.sliceDoc(sel.from, sel.to) !== SLOT_MARK) return false;
  const doc = state.doc.toString();
  let idx = doc.indexOf(SLOT_MARK, sel.to);
  if (idx < 0) idx = doc.indexOf(SLOT_MARK); // 循环到文档开头
  if (idx < 0 || idx === sel.from) return false; // 仅剩当前这一个槽：不拦截
  view.dispatch({
    selection: { anchor: idx, head: idx + SLOT_MARK.length },
    effects: EditorView.scrollIntoView(idx, { y: "center" }),
  });
  return true;
}

/**
 * 纯函数 slotRangeAtDoc 见 slotRange.ts（无框架依赖，可单测）。
 *
 * 鼠标点击 \Box 槽位即选中（MathType 式：点空心槽 → 选中 → 直接打字替换 / Tab 跳下一个）。
 * 仅在无修饰键左键、且点击位置精确落在视口 \Box 装饰内时拦截；
 * Shift/Ctrl/Alt 放行（不破坏扩展选区、Ctrl+点击 synctex 等既有手势）。
 */
const slotClickHandler = EditorView.domEventHandlers({
  mousedown: (e, view) => {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    // 视口内的 \Box 装饰查询（点击必在视口内，装饰覆盖即命中；\Box 不重叠，取首个）
    const hits: { from: number; to: number }[] = [];
    view.plugin(slotPlugin)?.decorations.between(pos, pos + 1, (from, to) => {
      hits.push({ from, to });
    });
    const hit = hits[0];
    if (!hit) return false;
    view.dispatch({ selection: { anchor: hit.from, head: hit.to } });
    view.focus();
    e.preventDefault();
    return true;
  },
});

/** 编辑器扩展（LaTeXEditor 的 extensions 挂载） */
export const mathSlotsExtension = [
  slotPlugin,
  slotClickHandler,
  keymap.of([{ key: "Tab", run: jumpToNextSlot }]),
];

/**
 * 插入公式片段并自动选中第一个 \Box 槽位（从插入点起找）。
 * 无活动编辑器返回 false；无占位符则仅插入（与 insertSnippet 行为一致）。
 */
export function insertSnippetWithSlots(code: string): boolean {
  const view: EditorView | null = getActiveView();
  if (!view) {
    console.warn("[math-slots] insertSnippetWithSlots：无活动编辑器");
    return false;
  }
  const { state } = view;
  const tr = state.replaceSelection(code);
  const nextDoc = state.update(tr).state.doc.toString();
  const idx = nextDoc.indexOf(SLOT_MARK, state.selection.main.from);
  view.dispatch({
    changes: tr.changes,
    selection:
      idx >= 0 ? { anchor: idx, head: idx + SLOT_MARK.length } : tr.selection,
    effects: idx >= 0 ? EditorView.scrollIntoView(idx, { y: "center" }) : undefined,
  });
  view.focus();
  return true;
}
