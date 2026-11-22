// M1-43 · \input 类「引入文件」命令规格表（纯逻辑，供 inputJump 与 Node 测试共用）
// 跳转目标未找到时，按此表决定：能不能弹窗确认后一键创建、创建时补什么后缀。
// 约束：本文件零 import（node --experimental-strip-types 直接跑测试，不带 store/editor 依赖）。

export interface InputCmdSpec {
  /** 路径解析时的后缀候选（原样优先，逐个试到命中） */
  suffixes: string[];
  /** 未找到时是否支持「弹窗二次确认 → 创建 → 开标签」 */
  createable: boolean;
  /** 创建时传给 createEntry 的 kind（tex 会由 Rust 补 .tex） */
  createKind?: "tex" | "file";
  /** 创建时目标终段未写后缀则补这个 */
  createExt?: string;
}

// 创建统一走 kind="file" + createExt：不用 kind="tex"——Rust 的 tex 分支会
// set_extension("tex") 把 lstinputlisting 的 list.txt 之类任意后缀目标改写成 list.tex。
const TEX: InputCmdSpec = {
  suffixes: ["", ".tex"],
  createable: true,
  createKind: "file",
  createExt: ".tex",
};
const BIB: InputCmdSpec = {
  suffixes: ["", ".bib"],
  createable: true,
  createKind: "file",
  createExt: ".bib",
};
const IMG: InputCmdSpec = {
  suffixes: ["", ".png", ".jpg", ".jpeg", ".pdf", ".eps"],
  createable: false,
};
const CLS: InputCmdSpec = { suffixes: ["", ".cls"], createable: false };

// 注意（用户指令 2026-11-22）：\usepackage 不参与文件跳转——未收录即返回 null，
// 点击会交还上层继续判定 \cite / synctex，不会误弹创建框。
const SPECS: Record<string, InputCmdSpec> = {
  input: TEX,
  include: TEX,
  subfile: TEX,
  lstinputlisting: TEX,
  verbatiminput: TEX,
  bibliography: BIB,
  addbibresource: BIB,
  includegraphics: IMG,
  documentclass: CLS,
};

/** 引入文件命令规格；未收录命令返回 null */
export function inputCmdSpec(cmd: string): InputCmdSpec | null {
  return SPECS[cmd.toLowerCase()] ?? null;
}

/** 所有已收录命令键（inputJump 拼正则时再按长度降序排，防止 include 抢先吃掉 includegraphics） */
export function inputCmdKeys(): string[] {
  return Object.keys(SPECS);
}

/**
 * 把命令目标整理成可创建的项目相对路径（正斜杠、去 ./ 前缀、终段缺后缀补 createExt）。
 * 返回 null 表示不可创建：空、以 / 结尾、多目标（逗号）、终段以点/空格结尾（validateName 必拒）。
 * 终段已带后缀则原样创建——LaTeX 对带后缀目标不再补全，照写即编译语义。
 */
export function createTargetFor(target: string, spec: InputCmdSpec): string | null {
  if (!spec.createable) return null;
  const raw = target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw.endsWith("/") || raw.includes(",")) return null;
  const name = raw.slice(raw.lastIndexOf("/") + 1);
  if (!name || name === "." || name === ".." || /[. ]$/.test(name)) return null;
  return name.includes(".") ? raw : raw + (spec.createExt ?? "");
}

/** 相对路径拆成「父目录（项目相对，空串表示就在基准目录）+ 最终段名」 */
export function splitTargetDir(rel: string): { dirRel: string; name: string } {
  const i = rel.lastIndexOf("/");
  return i >= 0 ? { dirRel: rel.slice(0, i), name: rel.slice(i + 1) } : { dirRel: "", name: rel };
}
