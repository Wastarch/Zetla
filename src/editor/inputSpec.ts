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

// 注意（用户指令 2026-11-22）：\usepackage / \documentclass 均不参与文件跳转——
// 未收录即返回 null，点击交还上层继续判定 \cite / synctex，不会误弹创建框。
const SPECS: Record<string, InputCmdSpec> = {
  input: TEX,
  include: TEX,
  subfile: TEX,
  lstinputlisting: TEX,
  verbatiminput: TEX,
  bibliography: BIB,
  addbibresource: BIB,
  includegraphics: IMG,
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

// ── M1-44 · \input 类命令花括号内的文件路径补全（纯逻辑，CM 接线见 inputComplete.ts） ──

/** 补全候选用的最小树节点结构（与 ProjectNode 同构，避免引入 store/类型依赖） */
export interface TreeNodeLite {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNodeLite[];
}

/** 行内 idx 之前是否有未转义的 `%`（注释掉的命令不补全/不跳转） */
export function inComment(text: string, idx: number): boolean {
  for (let i = 0; i < idx; i++) {
    if (text[i] === "%" && text[i - 1] !== "\\") return true;
  }
  return false;
}

/**
 * 补全触发前缀：`\cmd*?[..]{已输入目标$`（目标不含 }、不跨行；可选参数可有可无）。
 * 组 1 = 命令名，组 2 = 已输入目标；键按长度降序防 include 抢吃 includegraphics。
 * 注意必须是「行尾锚定」而非完整命令匹配——补全发生在右花括号还没打出来的时候。
 */
export const INPUT_TARGET_RE = new RegExp(
  `\\\\((?:${inputCmdKeys()
    .sort((a, b) => b.length - a.length)
    .join("|")}))(?:\\[[^\\]\\n]*\\])?\\{([^{}\\n]*)$`,
);

export interface InputTargetHit {
  /** 命令名 */
  cmd: string;
  /** 花括号内已输入的目标前缀（原样，未 trim） */
  typed: string;
  /** 命令反斜杠在 textBefore 中的下标（供调用方做注释判定） */
  slashIdx: number;
}

/** 光标前文本是否处于「引入文件命令的花括号内」（是则返回命令名与已输入目标） */
export function matchInputTargetBefore(textBefore: string): InputTargetHit | null {
  const m = INPUT_TARGET_RE.exec(textBefore);
  if (!m) return null;
  return { cmd: m[1], typed: m[2], slashIdx: m.index };
}

/** 收集 baseDir 下所有文件的相对路径（/ 分隔；baseDir 之外的文件不收集） */
export function collectRelPaths(nodes: TreeNodeLite[], baseDir: string): string[] {
  const out: string[] = [];
  const base = baseDir.replace(/[\\/]+$/, "");
  if (!base) return out;
  const sep = base.includes("\\") || /^[A-Za-z]:/.test(base) ? "\\" : "/";
  const lowerPrefix = (base + sep).toLowerCase();
  const walk = (arr: TreeNodeLite[]) => {
    for (const n of arr) {
      if (n.type === "file") {
        if (n.path.toLowerCase().startsWith(lowerPrefix)) {
          out.push(n.path.slice(lowerPrefix.length).replace(/\\/g, "/"));
        }
      } else if (n.children) {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

/** 按命令规格过滤相对路径并整理成插入形式（tex 命令按 LaTeX 惯例去 .tex 后缀，其余保留） */
export function completionCandidatesFor(cmd: string, rels: string[]): string[] {
  const spec = inputCmdSpec(cmd);
  if (!spec) return [];
  const exts = spec.suffixes.filter((s) => s !== "");
  const out: string[] = [];
  for (const r of rels) {
    const lower = r.toLowerCase();
    if (!exts.some((e) => lower.endsWith(e))) continue;
    // tex 目标去 .tex（\input{sections/exps} 编译等效且是 LaTeX 惯例）；其余命令保留原样
    out.push(exts.includes(".tex") && lower.endsWith(".tex") ? r.slice(0, -4) : r);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

/**
 * 收集 baseDir 下的全部目录相对路径（/ 分隔、带尾 /；**目录节点直采**——
 * 用户指令 2026-11-22：不管目录里有没有文件都弹，空目录也能下钻）。
 * baseDir 自身不收。
 */
export function collectRelDirs(nodes: TreeNodeLite[], baseDir: string): string[] {
  const out: string[] = [];
  const base = baseDir.replace(/[\\/]+$/, "");
  if (!base) return out;
  const sep = base.includes("\\") || /^[A-Za-z]:/.test(base) ? "\\" : "/";
  const lowerPrefix = (base + sep).toLowerCase();
  const walk = (arr: TreeNodeLite[]) => {
    for (const n of arr) {
      if (n.type !== "dir") continue;
      if (n.path.toLowerCase().startsWith(lowerPrefix)) {
        out.push(n.path.slice(lowerPrefix.length).replace(/\\/g, "/") + "/");
      }
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

/**
 * 过滤掉与已输入目标「全等」的文件候选（\→/ 归一、大小写不敏感）。
 * 场景（用户指令 2026-11-22：文件成功插入后不要再弹提示）：CM 接受补全后会对
 * 新状态再查询一次（目录候选下钻连弹靠它），但接受文件候选时 typed 恰等于
 * 刚插入的完整目标——此时弹出的「候选」就是已插入内容本身，纯噪音。
 */
export function dropExactFiles(files: string[], typed: string): string[] {
  const t = typed.replace(/\\/g, "/").toLowerCase();
  return files.filter((f) => f.toLowerCase() !== t);
}

/**
 * 花括号内完整路径是否已指向一个真实存在的文件（用户指令 2026-11-22：
 * 「先检查 {} 中的路径是否完整——指向最终的某个具体文件就不弹；指向目录、
 * 或指向的文件名存在但不完整就弹；指向的文件名不存在就不弹」）。
 * 完整判定按命令规格逐个后缀试（\input 的 `chapters/chapter1` 等效
 * `chapter1.tex`、\includegraphics 的 `fig1` 可对应 `fig1.png`；已带后缀原样命中）。
 * \→/ 归一、去 `./` 前缀、大小写不敏感；空串/不在树内 → 不完整。
 */
export function targetPointsToFile(
  nodes: TreeNodeLite[],
  baseDir: string,
  cmd: string,
  target: string,
): boolean {
  const spec = inputCmdSpec(cmd);
  if (!spec) return false;
  const norm = target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!norm) return false;
  const set = new Set(collectRelPaths(nodes, baseDir).map((s) => s.toLowerCase()));
  return spec.suffixes.some((suf) => set.has((norm + suf).toLowerCase()));
}

/**
 * 前缀过滤（路径补全惯例，模仿 VS Code）：
 * - files：typed 之后不再有 / 的直接命中（typed="sections/e" → sections/exps）；
 * - dirs：typed 当前层的下一级目录（带尾 /；typed="" → 第一层，typed="sec" → section/，
 *   typed="sections/" → section/sub/）。**层级式**：深一层目录下钻后才出现。
 * dirs 参数来自 collectRelDirs（目录节点直采，含空目录；用户指令 2026-11-22）；
 * files 仍按命令规格过滤。
 */
export function filterByPrefix(
  files: string[],
  typed: string,
  dirs: string[] = [],
): { files: string[]; dirs: string[] } {
  // typed 里的 \ 视为 /（用户可能敲反斜杠）；files/dirs 已是 / 归一形式
  const norm = typed.replace(/\\/g, "/");
  const t = norm.toLowerCase();
  const outDirs = new Set<string>();
  const outFiles: string[] = [];
  for (const f of files) {
    const lc = f.toLowerCase();
    if (!lc.startsWith(t)) continue;
    const rest = f.slice(norm.length);
    const slash = rest.indexOf("/");
    if (slash === -1) outFiles.push(f);
    else outDirs.add(f.slice(0, norm.length + slash + 1));
  }
  for (const d of dirs) {
    // 长度须大于 typed：typed="section/" 时不把 section/ 自己再列一遍
    if (d.length <= norm.length) continue;
    if (!d.toLowerCase().startsWith(t)) continue;
    // 层级式：去掉尾 / 后，typed 之后的段不得再含 /（深一层目录下钻后才出现）
    const inner = d.slice(norm.length, -1);
    if (!inner.includes("/")) outDirs.add(d);
  }
  return {
    files: [...new Set(outFiles)].sort((a, b) => a.localeCompare(b)),
    dirs: [...outDirs].sort((a, b) => a.localeCompare(b)),
  };
}
