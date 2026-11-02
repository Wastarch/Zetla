// M1-12a · 编写区提交与复制（插入编辑器按钮 / Ctrl+Enter / 输出区动作条共用）
// M1-12b：submitCompose 增加 display 环境判定——编写区含 align/cases 等 display 级环境时
//          原样插入（套 $/equation 会嵌套编译报错；matrix 等 inline 环境仍可套）。
// M1-19：updateCompose —— 编辑既有公式（composeStore.editTarget 绑定源码区间），
//          指纹校验通过才原地替换；未修改 no-op；env 原件沿用原环境名重包裹。
import { insertSnippetWithSlots } from "@/editor/mathSlots";
import { getActiveView } from "@/editor/activeView";
import { fingerprintOf } from "@/editor/envEdit";
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

/**
 * 「更新公式」（M1-19）：把编写区内容原地写回 editTarget 绑定的源码区间。
 * - 指纹校验失败（区间被手改）→ 拒绝（与表格 updateTableInPlace 同口径）；
 * - body 与载入时全等（未修改）→ no-op，原包裹原样保留；
 * - 有改动：env 原件沿用原环境名重包裹（保 &/\\ 语义，wrapFormula 按偏好可能
 *   包成 $…$ 会丢对齐语义甚至编译报错）；inline/$$ 原件按插入偏好重包裹
 *   （needsRawInsert 命中的 display 环境原样插入）。
 * 成功后刷新 editTarget（新区间 + 新指纹），可连续微调；无 editTarget 返回 false。
 */
export function updateCompose(): boolean {
  const st = useComposeStore.getState();
  const t = st.editTarget;
  if (!t) return false;
  const view = getActiveView();
  if (!view) {
    notify("没有可更新的编辑器", "err");
    return false;
  }
  const doc = view.state.doc.toString();
  const current = doc.slice(t.from, t.to);
  if (fingerprintOf(current) !== t.fingerprint) {
    notify("公式源码已被修改，已取消更新", "err");
    return false;
  }
  const body = st.text.trim();
  if (!body || body === t.loadedBody) {
    notify("公式未修改");
    return true; // no-op：不 dispatch，原包裹原样保留
  }
  const code =
    t.wrapKind === "env" && t.envName
      ? `\\begin{${t.envName}}\n${body}\n\\end{${t.envName}}`
      : needsRawInsert(body)
        ? body
        : wrapFormula(
            body,
            useSettingsStore.getState().settings.formula.numbered,
            useSettingsStore.getState().settings.formula.inline,
          );
  view.dispatch({ changes: { from: t.from, to: t.to, insert: code } });
  // 更新后重绑区间：wrapKind/envName 沿用（非 env 的重包裹路径与原 kind 无关，仅用于 env 判定）
  st.setEditTarget({
    from: t.from,
    to: t.from + code.length,
    fingerprint: fingerprintOf(code),
    wrapKind: t.wrapKind,
    envName: t.envName,
    loadedBody: body,
    sourceText: code,
  });
  notify("已更新公式", "ok");
  return true;
}
