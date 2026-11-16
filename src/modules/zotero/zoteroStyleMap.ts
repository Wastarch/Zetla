// Zotero 联动 · P3-4 样式映射纯逻辑
// （无 @/ 别名、无 store / Tauri 依赖，node --experimental-strip-types 可直接跑）
//
// 职责：把「CSL 预览样式」映射成 LaTeX 真正生效的样式，并算出**最小 span 补丁**。
//    bibtex   → 改 \bibliographystyle{...} 的参数
//    biblatex → 改 \usepackage[style=...]{biblatex} 的 style 选项（缺选项则插入）
//
// 铁律：只改导言区这一处；探测不到导言区样式时**不改文件**，只返回原因；
//       绝不猜测行号、绝不整段重写 preamble（否则丢用户格式与 CM6 撤销栈）。

export interface StyleMapping {
  /** Zotero Style Repository 样式 id（与 zoteroCitation.ts 的 CSL_STYLES 对齐） */
  csl: string;
  /** 展示名（用于提示文案，避免 UI 层再查一次表） */
  label: string;
  /** BibTeX：\bibliographystyle{...} 的参数 */
  bst: string;
  /** biblatex：style= 选项值 */
  biblatex: string;
  /** 依赖说明（缺宏包时用户需要自己装） */
  note: string;
}

/** 内置映射表：只覆盖 CSL_STYLES 里的 7 个常用样式，不做任意样式猜测 */
export const STYLE_MAPPINGS: StyleMapping[] = [
  {
    csl: "china-national-standard-gb-t-7714-2015-numeric",
    label: "GB/T 7714—2015（顺序编码）",
    bst: "gbt7714-numerical",
    biblatex: "gb7714-2015",
    note: "bst 需 gbt7714 宏包；biblatex 需 biblatex-gb7714-2015",
  },
  {
    csl: "apa",
    label: "APA 7th（作者-年）",
    bst: "apa",
    biblatex: "apa",
    note: "biblatex-apa 的 style=apa",
  },
  {
    csl: "chicago-author-date",
    label: "Chicago（作者-年）",
    bst: "chicago",
    biblatex: "chicago-authordate",
    note: "biblatex-chicago 的 style=chicago-authordate",
  },
  {
    csl: "ieee",
    label: "IEEE（数字）",
    bst: "IEEEtran",
    biblatex: "ieee",
    note: "bst 需 IEEEtran 宏包",
  },
  {
    csl: "modern-language-association",
    label: "MLA 9th",
    bst: "mla",
    biblatex: "mla",
    note: "bst 为 mla.bst；biblatex-mla 的 style=mla",
  },
  {
    csl: "vancouver",
    label: "Vancouver（数字）",
    bst: "vancouver",
    biblatex: "vancouver",
    note: "需对应 vancouver.bst / biblatex-vancouver",
  },
  {
    csl: "nature",
    label: "Nature（上标数字）",
    bst: "naturemag",
    biblatex: "nature",
    note: "bst 为 naturemag.bst；biblatex-nature 的 style=nature",
  },
];

/** 按 CSL id 查映射；不在表里返回 null（UI 据此禁用按钮） */
export function styleMappingFor(cslId: unknown): StyleMapping | null {
  const id = String(cslId ?? "").trim().toLowerCase();
  if (!id) return null;
  return STYLE_MAPPINGS.find((m) => m.csl === id) ?? null;
}

/** 反向查：LaTeX 里已写的样式名属于哪个 CSL 样式（大小写不敏感） */
export function cslForLatexStyle(style: unknown): string | null {
  const s = String(style ?? "").trim().toLowerCase();
  if (!s) return null;
  const hit = STYLE_MAPPINGS.find(
    (m) => m.bst.toLowerCase() === s || m.biblatex.toLowerCase() === s,
  );
  return hit ? hit.csl : null;
}

export type BibEngine = "bibtex" | "biblatex" | "none";

export function engineLabel(engine: BibEngine): string {
  return engine === "biblatex" ? "biblatex" : engine === "bibtex" ? "BibTeX" : "未识别";
}

export interface PreambleStyle {
  engine: BibEngine;
  /** 当前样式名（bst 参数 / biblatex 的 style 选项）；未写 style 选项时为 null */
  style: string | null;
  /** 命中方式：bibliographystyle / biblatex 的 style 选项 / 都没有 */
  kind: "bibliographystyle" | "biblatex-option" | "none";
  /** 样式值的起止偏移（不含花括号与引号）；插入模式下为插入点 */
  from: number;
  to: number;
  /** true = 该处尚未写 style 选项，需要插入而不是替换 */
  insertOnly: boolean;
  /** biblatex 的 [] 存在但内容为空（插入时不再补逗号） */
  optsEmpty?: boolean;
  /** 1-based 行号与整行原文（只用于预览，不参与补丁计算） */
  line: number;
  lineText: string;
}

/**
 * 把注释遮成空格（保持字符偏移不变），避免把注释掉的 \bibliographystyle 当生效配置。
 * 规则：`\%` 是转义百分号，不是注释；`\\%` 是先换行再注释，仍按注释处理。
 */
export function maskTexComments(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      // 跳过被转义的下一个字符（可能越界，安全截断）
      i += 2;
      continue;
    }
    if (ch === "%") {
      while (i < src.length && src[i] !== "\n") {
        out[i] = " ";
        i++;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** 导言区终点：首个 \begin{document}；找不到则用全文（片段文件 / 无 document 环境） */
function preambleEnd(masked: string): number {
  const m = /\\begin\s*\{document\}/.exec(masked);
  return m ? m.index : masked.length;
}

function lineAt(text: string, offset: number): { line: number; lineText: string } {
  const upto = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const line = upto.split("\n").length;
  const start = upto.lastIndexOf("\n") + 1;
  const end = text.indexOf("\n", start);
  return { line, lineText: text.slice(start, end === -1 ? text.length : end) };
}

/** 探测导言区当前生效的参考文献样式（biblatex 优先于 BibTeX 的 \bibliographystyle） */
export function detectPreambleStyle(tex: string): PreambleStyle {
  const masked = maskTexComments(tex);
  const limit = preambleEnd(masked);
  const head = masked.slice(0, limit);
  const raw = tex.slice(0, limit);

  // 1) biblatex：\usepackage[opts]{biblatex}（包名可与其他包并列）
  const usepackage = /\\usepackage\s*(\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = usepackage.exec(head))) {
    const opts = m[2] ?? "";
    const pkgs = (m[3] ?? "").split(",").map((s) => s.trim().toLowerCase());
    if (!pkgs.includes("biblatex")) continue;

    const optsStart = m.index + m[0].indexOf("[");
    const styleOpt = /(^|,)\s*style\s*=\s*([A-Za-z0-9._-]+)/.exec(opts);
    if (styleOpt) {
      const valueFrom = optsStart + 1 + styleOpt.index + styleOpt[0].length - styleOpt[2].length;
      const valueTo = valueFrom + styleOpt[2].length;
      const { line, lineText } = lineAt(tex, valueFrom);
      return {
        engine: "biblatex",
        style: styleOpt[2],
        kind: "biblatex-option",
        from: valueFrom,
        to: valueTo,
        insertOnly: false,
        line,
        lineText,
      };
    }

    // 没有 style 选项：在 [ 之后插入（有选项补逗号；无选项就补整个 [style=…]）
    if (m[1] !== undefined) {
      const at = optsStart + 1;
      const { line, lineText } = lineAt(tex, at);
      return {
        engine: "biblatex",
        style: null,
        kind: "biblatex-option",
        from: at,
        to: at,
        insertOnly: true,
        optsEmpty: opts.trim() === "",
        line,
        lineText,
      };
    }
    const at = m.index + m[0].indexOf("{");
    const { line, lineText } = lineAt(tex, at);
    return {
      engine: "biblatex",
      style: null,
      kind: "biblatex-option",
      from: at,
      to: at,
      insertOnly: true,
      line,
      lineText,
    };
  }

  // 2) BibTeX：\bibliographystyle{name}
  const bst = /\\bibliographystyle\s*\{([^}]*)\}/.exec(head);
  if (bst && bst[1] !== undefined) {
    const from = bst.index + bst[0].indexOf("{") + 1;
    const to = from + bst[1].length;
    const { line, lineText } = lineAt(tex, from);
    return {
      engine: "bibtex",
      style: bst[1].trim() || null,
      kind: "bibliographystyle",
      from,
      to,
      insertOnly: false,
      line,
      lineText,
    };
  }

  // 3) 都没有：按 none 返回，调用方不得改文件
  return {
    engine: "none",
    style: null,
    kind: "none",
    from: 0,
    to: 0,
    insertOnly: true,
    line: 1,
    lineText: raw.split("\n")[0] ?? "",
  };
}

export interface StyleEdit {
  from: number;
  to: number;
  insert: string;
}

export interface StyleSwitchPlan {
  ok: boolean;
  /** 失败原因 / 无需修改 / 成功预览说明 */
  message: string;
  mapping?: StyleMapping;
  engine?: BibEngine;
  /** true = 导言区已经是目标样式，不需要改 */
  noop?: boolean;
  /** 补丁（ok && !noop 时存在） */
  edit?: StyleEdit;
  /** 目标样式名（bst 参数或 biblatex style 值） */
  target?: string;
  /** 预览：受影响行的改前 / 改后 */
  before?: string;
  after?: string;
  line?: number;
}

/** 把一条补丁应用到文本（纯函数，供 apply 前的二次校验与单测使用） */
export function applyStyleEdit(tex: string, edit: StyleEdit): string {
  const from = Math.max(0, Math.min(edit.from, tex.length));
  const to = Math.max(from, Math.min(edit.to, tex.length));
  return tex.slice(0, from) + edit.insert + tex.slice(to);
}

/**
 * 规划「把导言区样式切到某个 CSL 样式」。
 * 返回的 edit 是最小 span 替换；`noop` 表示已经一致（不产生补丁）。
 */
export function planStyleSwitch(tex: string, cslId: unknown): StyleSwitchPlan {
  const mapping = styleMappingFor(cslId);
  if (!mapping) {
    return { ok: false, message: "该样式没有对应的 LaTeX 样式映射，未做修改" };
  }
  const cur = detectPreambleStyle(tex);
  if (cur.engine === "none") {
    return {
      ok: false,
      mapping,
      engine: cur.engine,
      message:
        "导言区未找到 \\bibliographystyle 或 biblatex，未做修改（请先手动引入参考文献样式）",
    };
  }

  const target = cur.engine === "biblatex" ? mapping.biblatex : mapping.bst;
  const same = (cur.style ?? "").trim().toLowerCase() === target.toLowerCase();
  if (same) {
    return {
      ok: true,
      noop: true,
      mapping,
      engine: cur.engine,
      target,
      message: `导言区已经是 ${target}，无需修改`,
    };
  }

  const insert = cur.insertOnly
    ? cur.engine === "biblatex" && tex[cur.from - 1] === "["
      ? cur.optsEmpty
        ? `style=${target}`
        : `style=${target},`
      : cur.engine === "biblatex"
        ? `[style=${target}]`
        : target
    : target;

  const edit: StyleEdit = { from: cur.from, to: cur.to, insert };
  const next = applyStyleEdit(tex, edit);
  const after = lineAt(next, cur.from).lineText;

  return {
    ok: true,
    mapping,
    engine: cur.engine,
    target,
    edit,
    before: cur.lineText,
    after,
    line: cur.line,
    message: `将把 ${cur.style ? `「${cur.style}」` : "未指定样式"} 切换为「${target}」`,
  };
}
