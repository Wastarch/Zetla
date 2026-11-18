// Zotero 联动 · P9 BibTeX ↔ biblatex 格式纯逻辑（无 @/ 别名、无 store / Tauri 依赖）
//
// 需求：导出的 .bib 字段格式跟随项目实际引擎；中途换引擎时把已有 .bib 条目
// 「原地转换」成新格式（只改字段名，值 / citekey / 条目类型 / 独有字段 / note 全保留）。
//
// 两种引擎的字段名差异集中在一小撮别名上（journal↔journaltitle、year↔date）。
// 原地转换 = 逐字段定位字段名 span → 按目标格式改名；目标名已存在则跳过该字段
// （不覆盖用户数据），保证幂等、可预览、可撤销（由 UI 层用 view.dispatch 承接）。
import type { BibEngine } from "./zoteroStyleMap.ts";
import { maskTexComments } from "./zoteroStyleMap.ts";
import { parseBibEntries, type ParsedBibEntry } from "./zoteroMerge.ts";

// 字段别名表与 mapFieldName 定义在上游 zoteroMerge（避免循环依赖），此处 re-export。
import { mapFieldName } from "./zoteroMerge.ts";
export { FIELD_ALIASES, mapFieldName } from "./zoteroMerge.ts";

/** 用户配置：跟随项目检测 / 锁定某引擎 */
export type BibFormatConfig = "auto" | "bibtex" | "biblatex";

/** 可用的具体引擎（不含 none） */
export type ConcreteBibFormat = Exclude<BibEngine, "none">;

/** 运行时格式解析结果（UI 态，不落盘） */
export interface EffectiveFormat {
  /** 项目配置值 */
  configured: BibFormatConfig;
  /** 主 .tex 检测结果 */
  detected: BibEngine;
  /** 实际生效格式；none 且未锁定时为 null（需用户选一次） */
  effective: ConcreteBibFormat | null;
  /** 是否需要用户选一次（auto + 检测不到） */
  needsChoice: boolean;
}

/** 该字段在目标格式下是否需要改名（含已是目标名 → false） */
export function needsRename(name: string, target: ConcreteBibFormat): boolean {
  const mapped = mapFieldName(name, target);
  return mapped.toLowerCase() !== name.toLowerCase();
}

// ── 原地转换：字段名 span 定位 ────────────────────────────────

interface FieldSpan {
  /** 字段名在全文中的起止（不含前后空白、不含 '='） */
  from: number;
  to: number;
  name: string;
}

/**
 * 在单个条目文本区间 [start,end) 内定位所有「需要改名」的字段 span。
 * 复用与 zoteroMerge.parseBibFields 相同的扫描口径：跳空白/逗号、读字段名到 '='，
 * 值部分跳过 {...} / "..." / bare，避免把值里的等号误当字段。
 */
function fieldSpansInEntry(text: string, e: ParsedBibEntry, target: ConcreteBibFormat): FieldSpan[] {
  const out: FieldSpan[] = [];
  // 条目体：citekey 之后的第一个逗号 + 1，到闭符之前
  let i = e.start + 1 + e.typeRaw.length;
  while (i < e.end && /\s/.test(text[i])) i += 1;
  if (text[i] !== e.open) return out;
  i += 1; // 越过开符
  while (i < e.end && /\s/.test(text[i])) i += 1;
  while (i < e.end && !/[\s,}]/.test(text[i]) && text[i] !== ")") i += 1; // citekey
  while (i < e.end && text[i] !== "," && text[i] !== e.close) i += 1;
  if (i >= e.end || text[i] !== ",") return out;
  const bodyStart = i + 1;
  const bodyEnd = e.end - 1;

  i = bodyStart;
  while (i < bodyEnd) {
    while (i < bodyEnd && (/\s/.test(text[i]) || text[i] === ",")) i += 1;
    if (i >= bodyEnd) break;
    const nameFrom = i;
    while (i < bodyEnd && text[i] !== "=" && !/[\s,]/.test(text[i])) i += 1;
    const nameEnd = i; // 字段名 end（不含其与 '=' 之间的空白）
    const name = text.slice(nameFrom, nameEnd).toLowerCase();
    while (i < bodyEnd && /\s/.test(text[i])) i += 1;
    if (i >= bodyEnd || text[i] !== "=") {
      while (i < bodyEnd && text[i] !== ",") i += 1;
      continue;
    }
    // 越过 '=' 与后续空白，跳过值
    i += 1;
    while (i < bodyEnd && /\s/.test(text[i])) i += 1;
    if (text[i] === "{") {
      let depth = 0;
      while (i < bodyEnd) {
        const c = text[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "{") { depth += 1; i += 1; continue; }
        if (c === "}") { depth -= 1; i += 1; if (depth === 0) break; continue; }
        i += 1;
      }
    } else if (text[i] === '"') {
      i += 1;
      while (i < bodyEnd) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === '"') { i += 1; break; }
        i += 1;
      }
    } else {
      while (i < bodyEnd && text[i] !== "," && text[i] !== "\n") i += 1;
    }
    if (name && needsRename(name, target)) {
      out.push({ from: nameFrom, to: nameEnd, name });
    }
  }
  return out;
}

export interface BibConvertResult {
  text: string;
  /** 实际发生改名：citeKey -> 改名的字段列表 */
  renamed: Record<string, string[]>;
  /** 改名后目标名已存在、为避免覆盖而跳过的：citeKey -> 字段名列表 */
  conflicts: Record<string, string[]>;
}

/**
 * 把 .bib 全文原地转换成目标格式：只重命名字段名。
 * - 目标字段已在该条目存在 → 跳过（不覆盖用户数据），记入 conflicts；
 * - 值 / citekey / 类型 / 定界符 / 独有字段 / note 全部不动；
 * - 从后往前应用 span 补丁，偏移不失效；重复调用幂等（已是目标名则无 span）。
 */
export function convertBibFormat(text: string, target: ConcreteBibFormat): BibConvertResult {
  const entries = parseBibEntries(text);
  const renamed: Record<string, string[]> = {};
  const conflicts: Record<string, string[]> = {};
  const edits: { from: number; to: number; insert: string }[] = [];

  for (const e of entries) {
    const existing = new Set(e.fields.map((f) => f.name.toLowerCase()));
    for (const span of fieldSpansInEntry(text, e, target)) {
      const targetName = mapFieldName(span.name, target);
      if (existing.has(targetName.toLowerCase())) {
        (conflicts[e.citeKey] ??= []).push(`${span.name}→${targetName}`);
        continue;
      }
      edits.push({ from: span.from, to: span.to, insert: targetName });
      (renamed[e.citeKey] ??= []).push(`${span.name}→${targetName}`);
    }
  }

  let out = text;
  for (const ed of edits.sort((a, b) => b.from - a.from)) {
    out = out.slice(0, ed.from) + ed.insert + out.slice(ed.to);
  }
  return { text: out, renamed, conflicts };
}

// ── effective 格式解析 ────────────────────────────────────────

/** NaN / 未知值一律回落 "auto"（配置读取的防御性归一） */
export function normalizeBibFormat(v: unknown): BibFormatConfig {
  return v === "bibtex" || v === "biblatex" ? v : "auto";
}

/**
 * 由「项目配置 + 主 .tex 检测结果」算出实际生效格式。
 * - 锁定值优先；
 * - auto + 检测到具体引擎 → 跟随检测；
 * - auto + none → effective=null、needsChoice=true（UI 提示选一次）。
 */
export function detectEffectiveFormat(
  configured: BibFormatConfig,
  detected: BibEngine,
): EffectiveFormat {
  if (configured !== "auto") {
    return { configured, detected, effective: configured, needsChoice: false };
  }
  if (detected !== "none") {
    return { configured, detected, effective: detected, needsChoice: false };
  }
  return { configured, detected, effective: null, needsChoice: true };
}

// ── 导言区引擎互转（最小 span 补丁） ──────────────────────────

export interface EngineSwitchPlan {
  ok: boolean;
  message: string;
  /** 已是目标引擎：不产生补丁 */
  noop?: boolean;
  from: BibEngine;
  to: ConcreteBibFormat;
  /** 字段转换是否需要在 .bib 上执行（目标非 none 且非 noop 时 true） */
  convertBib: boolean;
  /** 导言区补丁列表（按 from 从大到小应用）；可能为空（纯字段转换） */
  edits: { from: number; to: number; insert: string; label: string }[];
  before: string[];
  after: string[];
}

/** 把一条补丁应用到文本（纯函数，与 zoteroStyleMap.applyStyleEdit 同口径） */
export function applyEngineSwitch(tex: string, plan: EngineSwitchPlan): string {
  let out = tex;
  for (const ed of [...plan.edits].sort((a, b) => b.from - a.from)) {
    const from = Math.max(0, Math.min(ed.from, out.length));
    const to = Math.max(from, Math.min(ed.to, out.length));
    out = out.slice(0, from) + ed.insert + out.slice(to);
  }
  return out;
}

/**
 * 规划「把导言区引擎切换到 target」。当前引擎由调用方用 detectPreambleStyle 得到后传入。
 * - bibtex → biblatex：移除 \bibliographystyle{...}，在导言区插入 \usepackage{biblatex}；
 * - biblatex → bibtex：移除 \usepackage[opts]{biblatex}，插入 \bibliographystyle{plain}。
 * 只处理「声明引擎」的两处；样式名细节（bst 参数 / style= 选项）由 P3-4 的样式映射另行负责，
 * 这里不碰，避免一次改太多导致编译失败。
 */
export function planEngineSwitch(
  tex: string,
  from: BibEngine,
  to: ConcreteBibFormat,
): EngineSwitchPlan {
  if (from === to) {
    return {
      ok: true, noop: true, message: `导言区已经是 ${to}，无需切换引擎`,
      from, to, convertBib: false, edits: [], before: [], after: [],
    };
  }
  if (from === "none") {
    return {
      ok: false, message: "导言区未识别到参考文献引擎（既无 \\bibliographystyle 也无 biblatex），无法自动切换",
      from, to, convertBib: true, edits: [], before: [], after: [],
    };
  }

  const edits: EngineSwitchPlan["edits"] = [];
  const before: string[] = [];
  const after: string[] = [];

  let m: RegExpExecArray | null;
  const withBibExt = (f: string) => (/\.bib$/i.test(f) ? f : `${f}.bib`);
  const withoutBibExt = (f: string) => f.replace(/\.bib$/i, "");

  if (from === "bibtex" && to === "biblatex") {
    // 1) 移除 \bibliographystyle{...}（含行首空白与换行，避免留空行）
    const bst = /([ \t]*)\\bibliographystyle\s*\{[^}]*\}[ \t]*(?:\r?\n)?/g;
    while ((m = bst.exec(tex))) {
      edits.push({ from: m.index, to: m.index + m[0].length, insert: "", label: "移除 \\bibliographystyle" });
      before.push(m[0].replace(/\r?\n$/, ""));
    }
    // 2) \bibliography{f1,f2} → \printbibliography；收集资源文件名
    let resourceFiles: string[] = [];
    const biblio = /([ \t]*)\\bibliography\s*\{([^}]*)\}[ \t]*(?:\r?\n)?/g;
    while ((m = biblio.exec(tex))) {
      resourceFiles = (m[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      edits.push({ from: m.index, to: m.index + m[0].length, insert: "\\printbibliography", label: "\\bibliography → \\printbibliography" });
      before.push(m[0].replace(/\r?\n$/, ""));
      after.push("\\printbibliography");
    }
    // 3) 导言区插 \usepackage{biblatex} + \addbibresource{...}（合并一处；文档类之后）
    const doc = /\\documentclass(?:\[[^\]]*\])?\s*\{[^}]*\}/.exec(tex);
    if (doc) {
      const at = doc.index + doc[0].length;
      const lines = ["\\usepackage{biblatex}", ...resourceFiles.map((f) => `\\addbibresource{${withBibExt(f)}}`)];
      edits.push({ from: at, to: at, insert: `\n${lines.join("\n")}`, label: "插入 biblatex 宏包与资源声明" });
      after.push(...lines);
    }
  } else if (from === "biblatex" && to === "bibtex") {
    // 1) 移除 \usepackage[opts]{biblatex}（包名可与其它包并列：只移除 biblatex 项）
    const usepkg = /([ \t]*)\\usepackage\s*(\[[^\]]*\])?\s*\{([^}]*)\}[ \t]*(?:\r?\n)?/g;
    while ((m = usepkg.exec(tex))) {
      const pkgs = (m[3] ?? "").split(",").map((s) => s.trim().toLowerCase());
      if (!pkgs.includes("biblatex")) continue;
      if (pkgs.length === 1) {
        edits.push({ from: m.index, to: m.index + m[0].length, insert: "", label: "移除 biblatex 宏包" });
      } else {
        // 多包并列：只删 biblatex 这一项，保留其它
        const kept = (m[3] ?? "").split(",").map((s) => s.trim()).filter((s) => s.toLowerCase() !== "biblatex").join(",");
        const opts = m[2] ?? "";
        edits.push({ from: m.index, to: m.index + m[0].length, insert: `${m[1]}\\usepackage${opts}{${kept}}`, label: "从宏包列表中移除 biblatex" });
      }
      before.push(m[0].replace(/\r?\n$/, ""));
    }
    // 2) 收集 \addbibresource{f.bib} 的文件名并移除声明
    const resourceFiles: string[] = [];
    const addres = /([ \t]*)\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}[ \t]*(?:\r?\n)?/g;
    while ((m = addres.exec(tex))) {
      resourceFiles.push(...(m[2] ?? "").split(",").map((s) => withoutBibExt(s.trim())).filter(Boolean));
      edits.push({ from: m.index, to: m.index + m[0].length, insert: "", label: "移除 \\addbibresource" });
      before.push(m[0].replace(/\r?\n$/, ""));
    }
    const files = [...new Set(resourceFiles)];
    const bibCmd = files.length ? `\\bibliography{${files.join(",")}}` : "\\bibliography{refs}";
    // 3) \printbibliography → \bibliography{...}；若正文没有输出命令则插到 \end{document} 前
    let hasOutput = false;
    const pb = /([ \t]*)\\printbibliography\b[ \t]*(?:\r?\n)?/g;
    while ((m = pb.exec(tex))) {
      edits.push({ from: m.index, to: m.index + m[0].length, insert: bibCmd, label: "\\printbibliography → \\bibliography" });
      before.push(m[0].replace(/\r?\n$/, ""));
      after.push(bibCmd);
      hasOutput = true;
    }
    if (!hasOutput) {
      const end = /\\end\s*\{document\}/.exec(tex);
      if (end) {
        edits.push({ from: end.index, to: end.index, insert: `${bibCmd}\n`, label: "插入 \\bibliography" });
        after.push(bibCmd);
      }
    }
    // 4) 插 \bibliographystyle{plain}（放在 \begin{document} 之前）
    const beg = /\\begin\s*\{document\}/.exec(tex);
    if (beg) {
      edits.push({ from: beg.index, to: beg.index, insert: "\\bibliographystyle{plain}\n", label: "插入 \\bibliographystyle{plain}" });
      after.push("\\bibliographystyle{plain}");
    }
  }

  const hasEdit = edits.length > 0;
  return {
    ok: hasEdit,
    message: hasEdit
      ? `将改导言区：${edits.map((e) => e.label).join("、")}（样式名细节请按需手动调整）`
      : "未找到可替换的导言区声明，导言区不变",
    from, to, convertBib: true, edits, before, after,
  };
}

/** 供 UI 预览：切到目标格式后 .bib 前若干条字段改名摘要 + 导言区 before/after */
export function formatPreview(text: string, tex: string, from: BibEngine, to: ConcreteBibFormat): {
  bib: BibConvertResult;
  engine: EngineSwitchPlan;
} {
  return { bib: convertBibFormat(text, to), engine: planEngineSwitch(tex, from, to) };
}

// ── 引用环境补齐（新建 .bib 后消除「\cite used but no \bibliography」） ──

export interface BibliographySetupPlan {
  ok: boolean;
  message: string;
  /** 已配置完整引用环境，无需改动 */
  noop?: boolean;
  from: BibEngine;
  to: ConcreteBibFormat;
  /** 文档类型：bibtex → \bibliography{name}；biblatex → \addbibresource{name.bib} */
  bibName: string;
  edits: { from: number; to: number; insert: string; label: string }[];
  before: string[];
  after: string[];
}

/**
 * 规划「让主 .tex 具备目标引擎的完整参考文献环境」。缺什么补什么、可重复调用（幂等）：
 * - bibtex：导言区 \bibliographystyle{plain}（缺则补）+ 正文末 \bibliography{name}（缺则补）；
 * - biblatex：导言区 \usepackage{biblatex} + \addbibresource{name.bib}（缺则补）+ 正文末 \printbibliography（缺则补）。
 * 注释里的声明用 maskTexComments 遮掉，不算生效。不碰样式名细节（由 P3-4 样式映射另行负责）。
 */
export function planBibliographySetup(
  tex: string,
  bibName: string,
  from: BibEngine,
  to: ConcreteBibFormat,
): BibliographySetupPlan {
  const masked = maskTexComments(tex);
  const name = bibName.replace(/\.bib$/i, "");
  const base = { ok: true, from, to, bibName: name, edits: [] as BibliographySetupPlan["edits"], before: [] as string[], after: [] as string[] };
  const doc = /\\documentclass(?:\[[^\]]*\])?\s*\{[^}]*\}/.exec(masked);
  const beg = /\\begin\s*\{document\}/.exec(masked);
  const end = /\\end\s*\{document\}/.exec(masked);
  const pushEdit = (from: number, to: number, insert: string, label: string, beforeLine: string, afterLines: string[]) => {
    base.edits.push({ from, to, insert, label });
    base.before.push(beforeLine);
    base.after.push(...afterLines);
  };
  // 导言区插入点：\documentclass 之后 → \begin{document} 之前 → 文首
  const headAt = doc ? doc.index + doc[0].length : beg ? beg.index : 0;
  const headInsert = (lines: string[]) => `\n${lines.join("\n")}`;

  if (to === "bibtex") {
    const hasBst = /\\bibliographystyle\s*\{[^}]*\}/.test(masked);
    const hasOutput = /\\bibliography\s*\{[^}]*\}/.test(masked) || /\\begin\s*\{thebibliography\}/.test(masked);
    if (!hasBst) {
      pushEdit(headAt, headAt, headInsert(["\\bibliographystyle{plain}"]), "插入 \\bibliographystyle{plain}", "（导言区缺样式声明）", ["\\bibliographystyle{plain}"]);
    }
    if (!hasOutput) {
      const cmd = `\\bibliography{${name}}`;
      if (end) pushEdit(end.index, end.index, `${cmd}\n`, "插入 \\bibliography", "（正文末缺参考文献命令）", [cmd]);
      else pushEdit(tex.length, tex.length, `\n${cmd}\n`, "追加 \\bibliography", "（未找到 \\end{document}）", [cmd]);
    }
  } else {
    const hasPkg = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\bbiblatex\b[^}]*\}/.test(masked);
    const hasRes = /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/.test(masked) || /\\bibliography\s*\{[^}]*\}/.test(masked);
    const hasOutput = /\\printbibliography\b/.test(masked) || /\\begin\s*\{thebibliography\}/.test(masked);
    const headLines: string[] = [];
    if (!hasPkg) headLines.push("\\usepackage{biblatex}");
    if (!hasRes) headLines.push(`\\addbibresource{${name}.bib}`);
    if (headLines.length > 0) {
      pushEdit(headAt, headAt, headInsert(headLines), "插入 biblatex 宏包与资源声明", "（导言区缺 biblatex 配置）", headLines);
    }
    if (!hasOutput) {
      const cmd = "\\printbibliography";
      if (end) pushEdit(end.index, end.index, `${cmd}\n`, "插入 \\printbibliography", "（正文末缺参考文献输出）", [cmd]);
      else pushEdit(tex.length, tex.length, `\n${cmd}\n`, "追加 \\printbibliography", "（未找到 \\end{document}）", [cmd]);
    }
  }

  const noop = base.edits.length === 0;
  return {
    ...base,
    ok: true,
    noop,
    message: noop
      ? "主 .tex 已具备目标引擎的参考文献环境，无需添加"
      : `将补齐引用环境：${base.edits.map((e) => e.label).join("、")}（可撤销，不自动重新编译）`,
  };
}
