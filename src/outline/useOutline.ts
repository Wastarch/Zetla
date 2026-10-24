// M1-5 · 大纲导航（轻量 section 扫描 + 层级面板/跳转）
// 纯前端实现（不新增 Rust 命令；完整符号索引 get_symbol_index 为 M2-2 范围）：
//   - 从主文件出发，递归读取 \input/\include 的文件（模拟文档实际结构），
//     每个文件按行号顺序提取章节标题 → 扁平按文档顺序的条目列表；
//   - 条目含 file + line，点击复用 M0-12 的 jumpToError 跳行；
//   - 刷新时机：打开项目、每次成功编译（previewRev）、手动刷新按钮。
import { create } from "zustand";
import { projectApi } from "@/ipc/invoke";
import { parentOf } from "@/project/useProject";
import { base } from "@/project/useProject";
import type { FileDoc } from "@/types";

/** 大纲条目：文档顺序扁平列表，depth 仅用于缩进层级展示 */
export interface OutlineItem {
  /** 绝对路径（可能来自 \input 的子文件） */
  file: string;
  /** 1-based 行号（文件内） */
  line: number;
  /** 章节逻辑层级：part=0 … subparagraph=6 */
  level: number;
  /** 缩进层级（= level，供 UI 计算左缩进） */
  depth: number;
  /** 清洗后的标题文本 */
  title: string;
}

interface OutlineState {
  items: OutlineItem[];
  loading: boolean;
  error: string | null;
  /** 手动刷新计数（变更即重算） */
  manualRev: number;
  /** 扫描（root+mainFile 来自调用方，避免与 store 耦合） */
  recompute: (root: string, mainFile: string) => Promise<void>;
  /** 触发手动刷新 */
  refresh: () => void;
}

// ─────────────────────────────────────────────────────────────
// 扫描
// ─────────────────────────────────────────────────────────────

const CMD_LEVEL: Record<string, number> = {
  part: 0, addpart: 0,
  chapter: 1, addchap: 1,
  section: 2, addsec: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const SECTION_RE = new RegExp(
  "\\\\(" + Object.keys(CMD_LEVEL).join("|") + ")\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{",
  "g",
);
const INPUT_RE = /\\(?:input|include)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const INPUT_RE2 = /\\(?:input|include)\s+([^\s{}]+)/g;

/** 计算下标处的行号（1-based） */
function lineOf(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

/** 从 `{`（open 指向它）起做括号匹配，返回闭合前的参数字串与 `}` 下标 */
function readBraced(text: string, open: number): { arg: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; } // 转义字符不计数
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { arg: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** 路径规范化（处理 . 与 ..，保留盘符 D: 与绝对路径前导 /） */
function normalizePath(p: string): string {
  const segs = p.split(/[\\/]+/).filter(Boolean);
  let drive = "";
  if (segs.length && /^[a-zA-Z]:$/.test(segs[0])) drive = segs.shift()!;
  const out: string[] = [];
  for (const s of segs) {
    if (s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  const sep = p.includes("\\") ? "\\" : "/";
  const lead = drive ? drive + sep : p.startsWith("/") ? "/" : "";
  return lead + out.join(sep);
}

/** \input/\include 规格 → 绝对路径（相对当前文件目录解析；缺扩展名补 .tex） */
function resolveInput(dir: string, spec: string): string {
  let p = spec.trim();
  if (!/\.[a-zA-Z0-9]{1,}$/.test(p)) p += ".tex";
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\")) {
    return normalizePath(p);
  }
  return normalizePath(`${dir}/${p}`);
}

/** 标题轻量清洗：去 \label/\index/\footnote、展平字体命令、去转义与多余空白 */
function cleanTitle(raw: string): string {
  let s = raw
    .replace(/\\label\{[^}]*\}/g, " ")
    .replace(/\\index\{[^}]*\}/g, " ")
    .replace(/\\footnote\{[^}]*\}/g, " ")
    .replace(/\\hypertarget\{[^}]*\}\{[^}]*\}/g, " ")
    .replace(/\r?\n/g, " ")
    // 展平字体/格式命令的「括号内容」为纯文本（最多 4 层嵌套）
    .replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, "$1")
    // 剩余转义：\{ \} \\ → 字面/空格；其余控制词与孤立转义删除
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\\\/g, " ")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\#/g, "#")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\\./g, "")
    .replace(/&/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > 140) s = `${s.slice(0, 138)}…`;
  return s;
}

// 防止并发重算互相覆盖
let runToken = 0;

async function readFileSafe(path: string): Promise<FileDoc | null> {
  try {
    return await projectApi.readFile(path);
  } catch {
    return null;
  }
}

/** 扫描主文件及其 \input 链，返回按文档顺序的章节条目 */
export async function scanOutline(_root: string, mainFile: string): Promise<OutlineItem[]> {
  const items: OutlineItem[] = [];
  const visited = new Set<string>();
  const myToken = ++runToken;

  async function walk(file: string, depth: number): Promise<void> {
    if (visited.has(file) || depth > 14 || visited.size > 200) return;
    visited.add(file);
    const doc = await readFileSafe(file);
    if (!doc) return;
    const text = doc.content;

    SECTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SECTION_RE.exec(text))) {
      const open = m.index + m[0].length - 1; // '{' 位置
      const r = readBraced(text, open);
      if (!r) break;
      const level = CMD_LEVEL[m[1]] ?? 2;
      items.push({
        file,
        line: lineOf(text, m.index),
        level,
        depth: level,
        title: cleanTitle(r.arg),
      });
      SECTION_RE.lastIndex = r.end + 1;
    }

    const refs = new Set<string>();
    for (const re of [INPUT_RE, INPUT_RE2]) {
      re.lastIndex = 0;
      let im: RegExpExecArray | null;
      while ((im = re.exec(text))) {
        const f = resolveInput(parentOf(file), im[1]);
        if (f) refs.add(f);
      }
    }
    for (const f of refs) await walk(f, depth + 1);
  }

  await walk(mainFile, 0);
  // runToken 变化说明又来了一轮更终新的扫描，丢弃本次结果
  if (myToken !== runToken) return [];
  return items;
}

export const useOutlineStore = create<OutlineState>((set) => ({
  items: [],
  loading: false,
  error: null,
  manualRev: 0,
  refresh: () => set((s) => ({ manualRev: s.manualRev + 1 })),
  recompute: async (root: string, mainFile: string) => {
    set({ loading: true, error: null });
    try {
      const items = await scanOutline(root, mainFile);
      // 扫描期间可能已有更新的请求，scanOutline 已按 runToken 丢弃，这里再校一次
      set({ items, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));

export { base };
