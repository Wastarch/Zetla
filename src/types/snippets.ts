// M2-5a · 快捷输入片段（Snippets）类型 + 内置默认片段包
// 与 src-tauri/src/commands/snippets.rs 的 SnippetDef 一一对应，camelCase。
// 存储于独立文件（非 AppSettings）：用户自定义存 config_dir/Zetla/snippets.json（Rust 读写），
// 内置包随前端打包；两者在 M2-5b 合并进补全源。

/** 片段定义 */
export interface SnippetDef {
  /** 稳定 id（自定义：s-<时间戳>-<随机>；内置：sn-<trigger>） */
  id: string;
  /** 触发词（非空、不含反斜杠与空白；命令补全都带 \ 前缀，二者天然区分） */
  trigger: string;
  /** 展开模板：CodeMirror snippet 语法 ${n:默认} / $n / $0（终点）；$SELECTION 由 M2-5b 展开 */
  body: string;
  /** 描述（可选；补全弹窗/设置页展示） */
  desc?: string;
  /** 分类（如「结构」「浮动体」「数学」） */
  category: string;
}

/** 用户自定义片段数量上限（与 Rust MAX_SNIPPETS 一致） */
export const MAX_SNIPPETS = 500;

/** 触发词合法性校验（与 Rust valid_trigger 一致）：非空、无反斜杠、无空白 */
export function isValidTrigger(trigger: string): boolean {
  return (
    trigger.length > 0 && !trigger.includes("\\") && !/\s/.test(trigger)
  );
}

/**
 * 生成自定义片段稳定 id（s-<时间戳>-<随机>，与公式模块 c- 前缀策略一致）
 */
export function newSnippetId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 内置默认片段包（开箱即用；body 为 CodeMirror snippet 语法）。
 * M2-5d 会继续与公式/表格面板的模板字符串复用收敛，此处先手写自包含。
 */
export const DEFAULT_SNIPPETS: SnippetDef[] = [
  {
    id: "sn-beg",
    trigger: "beg",
    desc: "通用环境（\\begin/\\end，光标在环境名）",
    category: "结构",
    body: "\\begin{${1:env}}\n\t${2}\n\\end{${1:env}}$0",
  },
  {
    id: "sn-item",
    trigger: "itemize",
    desc: "无序列表环境",
    category: "结构",
    body: "\\begin{itemize}\n\t\\item ${1:内容}\n\\end{itemize}$0",
  },
  {
    id: "sn-enum",
    trigger: "enumerate",
    desc: "有序列表环境",
    category: "结构",
    body: "\\begin{enumerate}\n\t\\item ${1:内容}\n\\end{enumerate}$0",
  },
  {
    id: "sn-sec",
    trigger: "sec",
    desc: "一级标题",
    category: "结构",
    body: "\\section{${1:标题}}$0",
  },
  {
    id: "sn-ssec",
    trigger: "ssec",
    desc: "二级标题",
    category: "结构",
    body: "\\subsection{${1:标题}}$0",
  },
  {
    id: "sn-sssec",
    trigger: "sssec",
    desc: "三级标题",
    category: "结构",
    body: "\\subsubsection{${1:标题}}$0",
  },
  {
    id: "sn-para",
    trigger: "para",
    desc: "四级标题（段落标题）",
    category: "结构",
    body: "\\paragraph{${1:标题}}$0",
  },
  {
    id: "sn-fig",
    trigger: "fig",
    desc: "插图（figure + includegraphics）",
    category: "浮动体",
    body:
      "\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{${1:图片路径}}\n\t\\caption{${2:图片标题}}\n\t\\label{fig:${3:标签}}\n\\end{figure}$0",
  },
  {
    id: "sn-tab",
    trigger: "tab",
    desc: "三线表（booktabs）",
    category: "浮动体",
    body:
      "\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${1:表标题}}\n\t\\label{tab:${2:标签}}\n\t\\begin{tabular}{${3:lll}}\n\t\t\\toprule\n\t\t${4:表头} \\\\\n\t\t\\midrule\n\t\t${5:内容} \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}$0",
  },
  {
    id: "sn-eq",
    trigger: "eq",
    desc: "编号公式环境",
    category: "数学",
    body: "\\begin{equation}\n\t\\label{eq:${1:标签}}\n\t${2}\n\\end{equation}$0",
  },
  {
    id: "sn-algn",
    trigger: "algn",
    desc: "多行对齐公式（align）",
    category: "数学",
    body: "\\begin{align}\n\t${1} &= ${2} \\\\\n\t${3} &= ${4}\n\\end{align}$0",
  },
  {
    id: "sn-cases",
    trigger: "cases",
    desc: "分段函数",
    category: "数学",
    body:
      "\\begin{cases}\n\t${1:表达式}, & \\text{若 ${2:条件}} \\\\\n\t${3:表达式}, & \\text{其他}\n\\end{cases}$0",
  },
  {
    id: "sn-mat",
    trigger: "pmat",
    desc: "圆括号矩阵（pmatrix）",
    category: "数学",
    body:
      "\\begin{pmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{pmatrix}$0",
  },
  {
    id: "sn-txt",
    trigger: "text",
    desc: "数学环境内插入中文文本（\\text）",
    category: "数学",
    body: "\\text{${1:文本}}$0",
  },
  {
    id: "sn-footnote",
    trigger: "fn",
    desc: "脚注",
    category: "结构",
    body: "\\footnote{${1:脚注内容}}$0",
  },
  {
    id: "sn-bf",
    trigger: "bf",
    desc: "加粗（\\textbf；选中文字后 Ctrl+Space 选本项即包裹）",
    category: "文本",
    body: "\\textbf{$SELECTION}",
  },
  {
    id: "sn-it",
    trigger: "it",
    desc: "斜体（\\textit；选中文字后 Ctrl+Space 选本项即包裹）",
    category: "文本",
    body: "\\textit{$SELECTION}",
  },
];

/**
 * 前端兜底归一化（与 Rust normalize_snippets 同口径）：
 * 去空白 + 必填/合法性校验 + 按 trigger 去重（后者覆盖）+ 空位 id 兜底。
 * 正常路径以 Rust 返回为准，此函数供设置页草稿本地即时校验与导入预检用。
 */
export function normalizeSnippets(list: SnippetDef[]): SnippetDef[] {
  const byTrigger = new Map<string, SnippetDef>();
  for (const raw of list) {
    const d: SnippetDef = {
      id: raw.id.trim(),
      trigger: raw.trigger.trim(),
      body: raw.body.trim(),
      desc: raw.desc?.trim() || undefined,
      category: raw.category.trim(),
    };
    if (!d.body || !d.category || !isValidTrigger(d.trigger)) continue;
    if (!d.id) d.id = `s-${d.trigger}`;
    byTrigger.set(d.trigger, d);
  }
  return Array.from(byTrigger.values())
    .sort((a, b) => a.id.localeCompare(b.id) || a.trigger.localeCompare(b.trigger))
    .slice(0, MAX_SNIPPETS);
}
