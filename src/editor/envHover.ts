// 环境反向编辑 · hover ✎ 标记扩展（M1-19）。
// 悬停在可编辑环境（公式/表格，注册于 envEdit.ts）上时浮出「✎ 环境名」标记，
// 点击标记才进入编辑（load + setSidebarView）。不做常驻装饰，不拦截编辑器内
// mousedown —— 与 \Box 槽位点击（mathSlots.ts slotClickHandler）互不冲突。
// 让位规则：按住 Ctrl 时主动返回 null（\cite/\input 的「Ctrl+点击跳转」提示优先，
// 互斥避免叠加）。经 view.dom 的 .ctrl-held 类判断（ctrlHeldPlugin 所加），
// 避免 editor → modules 反向依赖。
import { hoverTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import { collectEnvHitsAt, openEnvEditor } from "./envEdit";

function envHoverSource(view: EditorView, pos: number): Tooltip | null {
  // Ctrl 按住时让位：synctex/\cite 跳转手势优先
  if (view.dom.classList.contains("ctrl-held")) return null;
  const hits = collectEnvHitsAt(view.state.doc.toString(), pos);
  if (hits.length === 0) return null;

  const dom = document.createElement("div");
  dom.className = "cm-env-tooltip";
  for (const hit of hits) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-env-btn";
    btn.textContent = `✎ ${hit.label}`;
    btn.title = `点击载入${hit.label}到编辑面板`;
    // mousedown（而非 click）：在编辑器失焦时序之前完成载入
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEnvEditor(hit);
    });
    dom.appendChild(btn);
  }
  // 内层优先 → 锚定最内层环境的起点
  return { pos: hits[0].from, create: () => ({ dom }), above: true };
}

/** 仅 LaTeX 文档挂载（LaTeXEditor.tsx 的 lang==="latex" 分支） */
export const envHoverExtension = hoverTooltip(envHoverSource);
