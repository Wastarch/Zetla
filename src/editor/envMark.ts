// 环境反向编辑 · 常驻 ✎ 标记扩展（M1-20，取代原 envHover 悬停浮出）。
// 在可编辑环境（公式/表格，注册于 envEdit.ts）的开头定界符右侧常驻一个 ✎ 小徽标，
// 例如 \begin{equation}✎ ；点击（mousedown，先于编辑器失焦）即载入对应面板编辑。
// 不做悬停浮层、不拦截编辑器内 mousedown —— 与 \Box 槽位点击（mathSlots.ts slotClickHandler）
// 互不冲突。嵌套环境（table 套 tabular 套单元格内 $…$）各自开头各一个标记，自动并存。
// 装饰随文档/视口变更重建；扫描由各模块注册时提供的 scan() 闭包完成（editor 不反向
// import modules，依赖方向保持 modules → editor 单向）。
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { collectEnvHits, openEnvEditor, type EnvHit } from "./envEdit";

/** 环境开头的小徽标控件：✎（悬停 title 显示环境名），点击进入编辑 */
class EnvEditWidget extends WidgetType {
  constructor(readonly hit: EnvHit) {
    super();
  }
  eq(other: EnvEditWidget): boolean {
    return (
      other.hit.id === this.hit.id &&
      other.hit.from === this.hit.from &&
      other.hit.to === this.hit.to
    );
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-env-mark";
    span.textContent = "✎";
    span.title = `编辑${this.hit.label}`;
    // mousedown（而非 click）：在编辑器失焦时序之前完成载入；阻止默认选择/冒泡
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEnvEditor(this.hit);
    });
    return span;
  }
  /** 让 CM 忽略控件内的事件，避免点击 ✎ 把光标移入徽标 */
  ignoreEvent(): boolean {
    return true;
  }
}

/** 扫描全文所有环境命中，在每个环境开头定界符右侧（markAt）放置常驻 ✎ 控件 */
function buildEnvDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();
  // 按「实际插入位置」markAt 升序：表格的 markAt 锚定在外层 \begin{table} 处，
  // 早于其内层 tabular 的 from；若仍按 from 排序，markAt 会逆序导致 RangeSetBuilder 抛错。
  const hits = collectEnvHits(doc);
  hits.sort((a, b) => a.markAt - b.markAt || a.from - b.from);
  for (const hit of hits) {
    // 紧接开头定界符之后：\begin{…}✎ / $✎ / $$✎ / \begin{table[htbp]}✎
    const at = hit.markAt;
    if (at < 0 || at > doc.length) continue;
    builder.add(
      at,
      at,
      Decoration.widget({ widget: new EnvEditWidget(hit), side: -1 }),
    );
  }
  return builder.finish();
}

/** 仅 LaTeX 文档挂载（LaTeXEditor.tsx 的 lang==="latex" 分支） */
export const envMarkExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildEnvDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildEnvDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
