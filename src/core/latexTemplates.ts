// M2-5d · LaTeX 片段模板的唯一来源。
// 目的：让「点按插入」（图片导入 M1-7 / 表格面板 M1-8）与「键盘展开」（M2-5 Snippets）
// 共用同一份模板骨架，避免两套写法在缩进、宽度、环境顺序上漂移。
//
// 约定：
// - 缩进统一 2 个空格（面板插入与片段展开完全一致，展开后不必再格式化）；
// - 图片宽度统一 \\linewidth（比 \\textwidth 更稳：在 minipage/分栏里自动适配）；
// - 模板占位符（${n:默认} / $SELECTION）由调用方以普通字符串传入，
//   本文件只做拼装，不解析 CM snippet 语法。

/** 浮动体内缩进单位（2 空格，与面板生成器一致） */
export const INDENT = "  ";

/** 图片默认宽度比例（面板插入与 fig 片段共用） */
export const FIGURE_WIDTH = "0.8\\linewidth";

/** 表格线样式 → LaTeX 规则（tableGen 与 table 片段共用，避免两处各写一份） */
export const TABLE_RULES = {
  booktabs: { top: "\\toprule", mid: "\\midrule", bottom: "\\bottomrule" },
  grid: { top: "\\hline", mid: "\\hline", bottom: "\\hline" },
  plain: { top: "", mid: "", bottom: "" },
} as const;

export type TableRuleStyle = keyof typeof TABLE_RULES;

// ── 浮动体 ──────────────────────────────────────────────

export interface FigureParts {
  /** 图片路径（相对 .tex；片段模板里传占位符） */
  path: string;
  /** 标题（可为空串；片段模板里传占位符） */
  caption: string;
  /** 标签（含前缀，如 fig:xxx） */
  label: string;
  /** 宽度，默认 FIGURE_WIDTH */
  width?: string;
  /** 位置参数，默认 htbp；传空串则不输出 */
  placement?: string;
}

/** figure 环境（顺序固定：centering → includegraphics → caption → label） */
export function buildFigure(p: FigureParts): string {
  const placement = p.placement === undefined ? "htbp" : p.placement;
  const head = placement ? `\\begin{figure}[${placement}]` : "\\begin{figure}";
  return [
    head,
    `${INDENT}\\centering`,
    `${INDENT}\\includegraphics[width=${p.width ?? FIGURE_WIDTH}]{${p.path}}`,
    `${INDENT}\\caption{${p.caption}}`,
    `${INDENT}\\label{${p.label}}`,
    "\\end{figure}",
  ].join("\n");
}

export interface TableSkeletonParts {
  /** 标题（片段模板里传占位符） */
  caption: string;
  /** 标签（片段模板里传占位符，含 tab: 前缀） */
  label: string;
  /** 列规格，如 lll / |c|c| / lX */
  cols: string;
  /** 线型，默认 booktabs 三线表 */
  style?: TableRuleStyle;
  /** 位置参数，默认 htbp；传空串则不输出 */
  placement?: string;
  /** 是否 table*（跨栏不编号），默认 false = table */
  star?: boolean;
  /** 表头行内容（不含结尾 \\\\） */
  header: string;
  /** 数据行内容（不含结尾 \\\\） */
  row: string;
}

/**
 * table 浮动体骨架（caption → label → tabular → 三线表）。
 * 与 tableGen.generateTable 的版式一致：面板按模型生成，片段给骨架。
 */
export function buildTableSkeleton(p: TableSkeletonParts): string {
  const rules = TABLE_RULES[p.style ?? "booktabs"];
  const placement = p.placement === undefined ? "htbp" : p.placement;
  const env = p.star ? "table*" : "table";
  const head = placement ? `\\begin{${env}}[${placement}]` : `\\begin{${env}}`;

  const body: string[] = [];
  if (rules.top) body.push(`${INDENT}${INDENT}${rules.top}`);
  if (p.header) body.push(`${INDENT}${INDENT}${p.header} \\\\`);
  if (rules.mid) body.push(`${INDENT}${INDENT}${rules.mid}`);
  if (p.row) body.push(`${INDENT}${INDENT}${p.row} \\\\`);
  if (rules.bottom) body.push(`${INDENT}${INDENT}${rules.bottom}`);

  return [
    head,
    `${INDENT}\\centering`,
    `${INDENT}\\caption{${p.caption}}`,
    `${INDENT}\\label{${p.label}}`,
    `${INDENT}\\begin{tabular}{${p.cols}}`,
    ...body,
    `${INDENT}\\end{tabular}`,
    `\\end{${env}}`,
  ].join("\n");
}

// ── 环境与命令 ──────────────────────────────────────────

export interface EnvParts {
  /** 环境名（片段模板里传占位符） */
  env: string;
  /** 环境体（已含缩进意图；空串则留一个空行） */
  body: string;
  /** 位置参数（如 figure 的 htbp）；缺省不输出 */
  placement?: string;
}

/** 通用 \\begin{env} … \\end{env}（环境名可回填同一占位符实现联动；body 多行逐行缩进） */
export function buildEnvironment(p: EnvParts): string {
  const head = p.placement ? `\\begin{${p.env}}[${p.placement}]` : `\\begin{${p.env}}`;
  const body = p.body
    .split("\n")
    .map((line) => (line ? `${INDENT}${line}` : line))
    .join("\n");
  return [head, body, `\\end{${p.env}}`].join("\n");
}

/** 列表环境（itemize / enumerate），首项含占位符 */
export function buildList(env: "itemize" | "enumerate", item: string): string {
  return [ `\\begin{${env}}`, `${INDENT}\\item ${item}`, `\\end{${env}}` ].join("\n");
}

/** 章节命令（section / subsection / subsubsection / paragraph） */
export function buildHeading(cmd: string, title: string): string {
  return `\\${cmd}{${title}}`;
}
