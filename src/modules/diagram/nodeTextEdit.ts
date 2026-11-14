// M2·F4-3：画布内节点文字 / 公式就地编辑的纯逻辑（不依赖 DOM / React / vendor）。
//
// 唯一真源：内容 span 直接取上游 `parse.figure.body[].items[].textSpan`
// （见 optionsEdit.collectStatements 的 `nodeTexts`），写回只生成**一个最小 span 补丁**，
// 由 DiagramCanvas 经 commitDiagramPatch → sourceBridge dispatch 到 CM6，
// 与 F2-1 拖拽 / F2-2 属性编辑共用同一条撤销栈。绝不整篇替换、绝不实例化 EditorSession。
//
// 两套白名单严格分离（计划 §8「F4-3 内容区白名单被误用成选项区」）：
//   · 内容区允许中文 / 常规标点 / 空格 / `$...$` 公式 / `\\` 换行 / 成对花括号；
//   · 拒绝任何未列入数学白名单的 LaTeX 命令（含 \write18）、未配对 `}` / `$` / `%` 注释；
//   · 选项区的 DANGEROUS（optionsEdit.normalizeCustomValue）保持原样，不放宽 `{}` `$`。
import type { SourceSpanPatch } from "./dragEdit.ts";
import type { NodeTextSpan, TikzStatement } from "./optionsEdit.ts";

/** 节点文字上限（TikZ 节点不是正文段落，超长文本应移到主文档）。 */
export const MAX_NODE_TEXT_LENGTH = 200;

/**
 * 内容区允许的 LaTeX 命令：数学常用命令 + 定界符 + TikZ 换行（单独处理）。
 * 刻意是白名单而非黑名单 —— 新增命令要明确登记，避免 `\write18` / `\input` 之类注入。
 */
const ALLOWED_COMMANDS = new Set([
  // 希腊字母
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi",
  "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi",
  "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
  // 运算符 / 关系
  "times", "cdot", "ast", "star", "div", "pm", "mp", "odot", "otimes", "oplus",
  "leq", "le", "geq", "ge", "neq", "ne", "equiv", "approx", "sim", "simeq",
  "cong", "propto", "ll", "gg", "subset", "supset", "subseteq", "supseteq",
  "in", "ni", "notin", "cup", "cap", "setminus", "wedge", "vee", "neg", "lnot",
  "forall", "exists", "nexists", "infty", "partial", "nabla", "emptyset", "varnothing",
  "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow", "Leftrightarrow",
  "to", "mapsto", "uparrow", "downarrow", "updownarrow", "nearrow", "searrow",
  "ldots", "cdots", "vdots", "ddots", "dots",
  // 函数 / 排版
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "exp", "det", "dim", "min", "max", "arg",
  "lim", "limsup", "liminf", "sup", "inf", "sqrt", "frac", "dfrac", "tfrac",
  "binom", "dbinom", "text", "textrm", "textsf", "textbf", "textit", "mathrm",
  "mathbf", "mathit", "mathsf", "mathtt", "mathbb", "mathcal", "operatorname",
  "hat", "widehat", "bar", "overline", "vec", "dot", "ddot", "tilde", "widetilde",
  "underline", "overbrace", "underbrace", "stackrel", "overset", "underset",
  "left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr",
  "quad", "qquad", "thinspace", "medspace", "thickspace", "enspace", "hspace",
  // 定界符
  "langle", "rangle", "lceil", "rceil", "lfloor", "rfloor", "lbrace", "rbrace",
  "lbrack", "rbrack", "lVert", "rVert", "lvert", "rvert", "vert", "Vert",
]);

/** `\` 后允许直接跟随的符号（配对花括号 / `$` 在扫描里单独计数）。 */
const SYMBOL_ESCAPES = new Set([
  "{", "}", "$", "%", "&", "#", "_", ",", ";", "!", ":", " ", "/", "|", "-", ".",
]);

export type NodeTextCheck =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * 内容区校验 + 规范化。返回规范化后的文本供写回，失败时给出**可直接展示**的理由。
 * 纯字符串运算：不碰 source、不碰 SVG、不猜用户意图。
 */
export function validateNodeText(raw: string): NodeTextCheck {
  const text = String(raw ?? "").replace(/[\r\n\t]/g, " ").trim();
  if (text.length === 0) return { ok: false, reason: "文字不能为空；要删除节点请在源码栏操作。" };
  if (text.length > MAX_NODE_TEXT_LENGTH) {
    return { ok: false, reason: `节点文字最多 ${MAX_NODE_TEXT_LENGTH} 字符，当前 ${text.length} 字符。` };
  }

  let brace = 0;
  let dollars = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "\\") {
        i += 1; // TikZ 节点内换行 \\，整体消费
        continue;
      }
      if (next && SYMBOL_ESCAPES.has(next)) {
        i += 1; // \{ \} \$ 等转义：跳过，不参与花括号 / $ 计数
        continue;
      }
      if (next && /[A-Za-z]/.test(next)) {
        let j = i + 1;
        while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
        const cmd = text.slice(i + 1, j);
        if (!ALLOWED_COMMANDS.has(cmd)) {
          return { ok: false, reason: `节点文字不允许 \\${cmd} 命令（含 \\write18 / \\input 等）；公式请只用常见数学命令。` };
        }
        i = j - 1;
        continue;
      }
      return { ok: false, reason: "反斜杠后请接数学命令或 \\\\ 换行。" };
    }
    if (ch === "{") {
      brace += 1;
      continue;
    }
    if (ch === "}") {
      brace -= 1;
      if (brace < 0) return { ok: false, reason: "存在未配对的 }，请检查花括号。" };
      continue;
    }
    if (ch === "$") {
      dollars += 1;
      continue;
    }
    if (ch === "%") {
      return { ok: false, reason: "节点文字不能包含 % 注释符（会吃掉后面的源码）。" };
    }
    if ((ch === "^" || ch === "_") && dollars % 2 === 0) {
      return { ok: false, reason: "上下标请写在 $...$ 公式里，例如 $x^2$。" };
    }
  }
  if (brace !== 0) return { ok: false, reason: "存在未闭合的 {，请检查花括号。" };
  if (dollars % 2 !== 0) return { ok: false, reason: "公式的 $ 没有成对出现，请补全 $...$。" };
  return { ok: true, text };
}

export type NodeTextEditPlan =
  | { status: "ok"; patch: SourceSpanPatch; nodeText: NodeTextSpan; label: string }
  | { status: "noop" }
  | { status: "error"; reason: string };

/**
 * 生成「一次文字改动」的最小 span 补丁。只替换 `{...}` 内部，坐标 / 选项 / 语句其余部分一字不动。
 */
export function planNodeTextEdit(
  source: string,
  stmt: TikzStatement,
  nodeTextId: string,
  raw: string,
): NodeTextEditPlan {
  const nt = stmt.nodeTexts.find((n) => n.id === nodeTextId);
  if (!nt) return { status: "error", reason: "该文字没有可定位的源码范围，请在源码栏修改。" };
  if (nt.source && nt.source !== "group") {
    return { status: "error", reason: "该节点的文字由宏 / 样式提供，请在源码栏修改。" };
  }
  if (source.slice(nt.span.from, nt.span.to) !== nt.text) {
    return { status: "error", reason: "源码在编辑期间已变化，请重新双击节点。" };
  }
  const checked = validateNodeText(raw);
  if (!checked.ok) return { status: "error", reason: checked.reason };
  if (checked.text === nt.text) return { status: "noop" };
  return {
    status: "ok",
    patch: { from: nt.span.from, to: nt.span.to, insert: checked.text },
    nodeText: nt,
    label: `文字：${nt.text || "空"} → ${checked.text}`,
  };
}

/**
 * 把双击命中的 SVG data-source-id 映射到具体 nodeText：
 *   · 路径中间的 node：SVG 直接用 node item id（如 `node:2:2`）；
 *   · 顶层 \node：SVG 用 statement id（如 `path:0`），该语句一般只有一段文字。
 * 找不到时返回 null，UI 给「请在源码栏修改」提示而不是弹空输入框。
 */
export function findEditableNodeText(
  statements: readonly TikzStatement[],
  hitId: string,
): { statement: TikzStatement; nodeText: NodeTextSpan } | null {
  if (!hitId) return null;
  for (const stmt of statements) {
    const nt = stmt.nodeTexts.find(
      (n) => n.id === hitId && (!n.source || n.source === "group"),
    );
    if (nt) return { statement: stmt, nodeText: nt };
  }
  const stmt = statements.find((s) => s.id === hitId);
  if (!stmt) return null;
  const nt = stmt.nodeTexts.find((n) => !n.source || n.source === "group");
  return nt ? { statement: stmt, nodeText: nt } : null;
}
