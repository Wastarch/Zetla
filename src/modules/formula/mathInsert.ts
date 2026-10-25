// M1-12a · 编写区提交与复制（插入编辑器按钮 / Ctrl+Enter / 输出区动作条共用）
// M1-12b：submitCompose 增加 display 环境判定——编写区含 align/cases 等 display 级环境时
//          原样插入（套 $/equation 会嵌套编译报错；matrix 等 inline 环境仍可套）。
import { insertSnippetWithSlots } from "@/editor/mathSlots";
import { useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import { useComposeStore } from "./composeStore";

/**
 * 按「行内/编号」偏好包裹公式体（与 FormulaPanel.wrapFormula 同口径；
 * M1-12c 公式库收敛时统一改走此处，删除面板内的那份副本）。
 */
export function wrapFormula(latex: string, numbered: boolean, inline: boolean): string {
  if (inline) return `$${latex}$`;
  if (numbered) return `\\begin{equation}\n${latex}\n\\end{equation}`;
  return `\\begin{equation*}\n${latex}\n\\end{equation*}`;
}

/** display 级环境（inline 模式下 KaTeX 报 katex-error；与 FormulaKaTeX.needsDisplayMode 同口径） */
const DISPLAY_ENV_RE = /\\begin\{(align\*?|gather\*?|cases|multline\*?|flalign\*?|eqnarray\*?|CD|split|alignedat)/;

/** 含 display 级环境 → 提交时原样插入，不套 $/equation 包裹（matrix 等 inline 环境不触发） */
export function needsRawInsert(body: string): boolean {
  return DISPLAY_ENV_RE.test(body);
}

/**
 * 提交编写区内容到主编辑器光标处。
 * \Box 槽位选中 + Tab 导航由 insertSnippetWithSlots 负责；空内容返回 false。
 */
export function submitCompose(): boolean {
  const body = useComposeStore.getState().text.trim();
  if (!body) return false;
  const { formula } = useSettingsStore.getState().settings;
  const code = needsRawInsert(body)
    ? body
    : wrapFormula(body, formula.numbered, formula.inline);
  return insertSnippetWithSlots(code);
}

/** 复制编写区 LaTeX 到剪贴板（空内容静默跳过） */
export async function copyCompose(): Promise<void> {
  const body = useComposeStore.getState().text.trim();
  if (!body) return;
  try {
    await navigator.clipboard.writeText(body);
    notify("已复制 LaTeX 到剪贴板");
  } catch (e) {
    notify(`复制失败：${String(e)}`, "err");
  }
}
