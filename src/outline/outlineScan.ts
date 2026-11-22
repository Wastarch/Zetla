// M1-5/M1-28 · 大纲扫描纯逻辑（2026-11-22 从 useOutline.ts 抽出，零 import 供 Node 单测）
// 本轮修复（用户真机反馈，2026-11-22）：
//   1) 注释内容不再收录——章节命令 / \input 落在「未转义 % 之后（同行）」一律跳过，
//      否则 `% 章节（……在对应章节前加 \part{...}）` 这类说明注释会混进大纲；
//   2) 条目按文档真实位置排序——原实现把主文件全部标题先 push 完才递归 \input 子文件，
//      主文件的 \part 会整体排到章节文件内容之前；改为扫描到 \input 处**就地递归**，
//      子文件条目插在该位置，全局即文档顺序。
// 层级映射 / 标题清洗 / 路径解析等沿用原实现口径。

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

/** 读取文件回调（真实实现接 projectApi.readFile；测试传内存映射） */
export type OutlineReadFile = (path: string) => Promise<{ content: string } | null>;

const CMD_LEVEL: Record<string, number> = {
  part: 0, addpart: 0,
  chapter: 1, addchap: 1,
  section: 2, addsec: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/**
 * 组合扫描正则（一次遍历，事件按 index 天然有序）：
 *   组1 = input|include（花括号形式命令名），组2 = 其目标 spec；
 *   组3 = input|include（空格形式 `\input foo`）目标 spec；
 *   组4 = 章节命令名（CMD_LEVEL 键）。花括号形式整体消费到 `}`，防 spec 内文字再被当命令。
 */
export const SCAN_RE = new RegExp(
  "\\\\(input|include)\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}" +
    "|\\\\(?:input|include)\\s+([^\\s{}%]+)" +
    "|\\\\((?:" +
    Object.keys(CMD_LEVEL).join("|") +
    "))\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{",
  "g",
);

/**
 * idx 是否处于行内注释（其前、同行存在未转义 %；\% 不算注释起点）。
 * 与 inputSpec.ts inComment 同口径，但以「行首」为界（大纲扫描有全局文本上下文）。
 */
export function isCommented(text: string, idx: number): boolean {
  const ls = text.lastIndexOf("\n", idx - 1) + 1;
  for (let i = ls; i < idx; i++) {
    if (text[i] === "%" && text[i - 1] !== "\\") return true;
  }
  return false;
}

/** 计算下标处的行号（1-based） */
export function lineOf(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

/** 从 `{`（open 指向它）起做括号匹配，返回闭合前的参数字串与 `}` 下标 */
export function readBraced(text: string, open: number): { arg: string; end: number } | null {
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
export function normalizePath(p: string): string {
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

/** 路径的父目录（无分隔符返回空串） */
export function parentDirOf(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : "";
}

/** \input/\include 规格 → 绝对路径（相对当前文件目录解析；缺扩展名补 .tex） */
export function resolveInput(dir: string, spec: string): string {
  let p = spec.trim();
  if (!/\.[a-zA-Z0-9]{1,}$/.test(p)) p += ".tex";
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\")) {
    return normalizePath(p);
  }
  return dir ? normalizePath(`${dir}/${p}`) : normalizePath(p);
}

/** 标题轻量清洗：去 \label/\index/\footnote、展平字体命令、去转义与多余空白 */
export function cleanTitle(raw: string): string {
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

/**
 * 从主文件出发递归扫描，返回按文档顺序的章节条目：
 * 单文件内事件按文本 index 顺序处理——扫到 \input/\include 即就地递归子文件
 * （子文件条目插在该位置，\part 等主文件标题与章节内容正确交错）；
 * 同一文件只递归一次（visited），深度 ≤14、总量 ≤200 防失控。
 */
export async function scanOutlineDocs(
  mainFile: string,
  readFile: OutlineReadFile,
): Promise<OutlineItem[]> {
  const items: OutlineItem[] = [];
  const visited = new Set<string>();

  async function walk(file: string, depth: number): Promise<void> {
    if (visited.has(file) || depth > 14 || visited.size > 200) return;
    visited.add(file);
    const doc = await readFile(file);
    if (!doc) return;
    const text = doc.content;

    // 每次调用独立正则实例：嵌套递归（扫到 \input 就地进入子文件）会重入本循环，
    // 共享实例的 lastIndex 会被子文件的扫描进度打乱，导致主文件事件重放（真机 bug 2 根因之一）
    const re = new RegExp(SCAN_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // 注释一律跳过：章节命令与 \input 都不收录（2026-11-22 用户反馈）
      if (isCommented(text, m.index)) continue;
      if (m[4] !== undefined) {
        const open = m.index + m[0].length - 1; // '{' 位置
        const r = readBraced(text, open);
        if (!r) break;
        items.push({
          file,
          line: lineOf(text, m.index),
          level: CMD_LEVEL[m[4]] ?? 2,
          depth: CMD_LEVEL[m[4]] ?? 2,
          title: cleanTitle(r.arg),
        });
        re.lastIndex = r.end + 1;
      } else {
        const spec = (m[2] ?? m[3] ?? "").trim();
        if (!spec) continue;
        await walk(resolveInput(parentDirOf(file), spec), depth + 1);
      }
    }
  }

  await walk(mainFile, 0);
  return items;
}
