// M1-4+ · \input / \include 文件跳转（Ctrl+点击打开目标 .tex，交互与 \cite 跳转一致）
// 与 \cite 跳转的差别：没有引用索引可查，目标靠「项目树 + LaTeX 相对路径口径」定位：
//   \input{chapter/chap01} 相对当前文件目录 / 主文件目录 / 项目根依次尝试，缺省补 .tex 后缀。
// 纯前端（零 Rust 改动），只读 useProjectStore 的树，不落盘。
import { RangeSetBuilder, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { jumpToFile } from "./jump";
import { notify, parentOf, useProjectStore } from "@/project/useProject";
import { isCtrlHeld } from "@/modules/reference/citeSupport";

/** \input{...} / \include{...} / \subfile{...}（花括号内不跨行、不吃嵌套括号） */
const INPUT_RE = /\\(?:input|include|subfile)\s*\{([^{}\n]+)\}/g;

/** 当前文档路径（悬浮提示解析相对路径用；由 LaTeXEditor 在每次渲染时同步，避免切换文件重建扩展） */
let currentPath: string | undefined;

export function setInputJumpPath(p?: string): void {
  currentPath = p;
}

export interface InputRef {
  /** 命令起点（反斜杠） */
  from: number;
  /** 命令终点（右花括号之后） */
  to: number;
  /** 命令名（input / include / subfile） */
  cmd: string;
  /** 花括号内的原始目标（已 trim） */
  target: string;
}

/** 项目内统一的路径分隔（Windows 树用 `\`，类 Unix 用 `/`） */
function toProjectSep(p: string): string {
  const root = useProjectStore.getState().root ?? "";
  const win = root.includes("\\") || /^[A-Za-z]:/.test(p);
  return win ? p.replace(/\//g, "\\") : p.replace(/\\/g, "/");
}

/** 项目内相对展示路径（提示气泡用）；不在项目内则原样返回 */
function displayPath(abs: string): string {
  const root = useProjectStore.getState().root;
  if (root && abs.toLowerCase().startsWith(root.toLowerCase())) {
    return abs.slice(root.length).replace(/^[\\/]/, "");
  }
  return abs;
}

function fileInTree(path: string): boolean {
  const nodes = useProjectStore.getState().tree?.nodes;
  const want = path.toLowerCase();
  const walk = (arr?: typeof nodes): boolean => {
    if (!arr) return false;
    for (const n of arr) {
      if (n.type === "file" && n.path.toLowerCase() === want) return true;
      if (n.type === "dir" && n.children && walk(n.children)) return true;
    }
    return false;
  };
  return walk(nodes);
}

/** 行内偏移 idx 之前是否有未转义的 `%`（注释掉的命令不参与跳转） */
function inComment(text: string, idx: number): boolean {
  for (let i = 0; i < idx; i++) {
    if (text[i] === "%" && text[i - 1] !== "\\") return true;
  }
  return false;
}

/**
 * 解析 \input 目标 → 项目内绝对路径（找不到返回 null）。
 * 候选顺序：当前文件目录 → 主文件目录 → 项目根；每个目录先试原样（含已写 .tex），再试补 `.tex`。
 * LaTeX 实际按编译工作目录（主文件目录）解析，这里把当前文件目录排前面兼容「相对当前文件」写法。
 */
export function resolveInputPath(
  target: string,
  curPath?: string,
): string | null {
  const raw = target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw) return null;
  const st = useProjectStore.getState();
  const bases = [
    curPath ? parentOf(curPath) : null,
    st.tree?.mainFile ? parentOf(st.tree.mainFile) : null,
    st.root,
  ].filter((b): b is string => !!b);
  const seen = new Set<string>();
  for (const base of bases) {
    if (seen.has(base.toLowerCase())) continue;
    seen.add(base.toLowerCase());
    for (const suffix of ["", ".tex"]) {
      const cand = toProjectSep(`${base}/${raw}${suffix}`);
      if (fileInTree(cand)) return cand;
    }
  }
  return null;
}

/** 定位光标所在行的 \input 命令（pos 需落在整条命令内，供点击与悬浮判定） */
export function findInputAt(doc: Text, pos: number): InputRef | null {
  const line = doc.lineAt(pos);
  INPUT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INPUT_RE.exec(line.text))) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to && !inComment(line.text, m.index)) {
      return {
        from,
        to,
        cmd: m[0].slice(1, m[0].indexOf("{")).trim(),
        target: m[1].trim(),
      };
    }
  }
  return null;
}

/**
 * Ctrl+点击 \input{...} → 打开目标文件并跳到首行（复用 jumpToFile，未打开则开标签）。
 * 命中命令即消费事件（目标缺失也只 toast，不回落到 synctex 正向跳转，避免跳到 PDF 误导）。
 * 未命中任何 \input → 返回 false，交还上层继续判定 \cite / synctex。
 */
export function inputJumpAtCursor(
  doc: Text,
  pos: number,
  curPath?: string,
): boolean {
  const hit = findInputAt(doc, pos);
  if (!hit) return false;
  const abs = resolveInputPath(hit.target, curPath);
  if (abs) {
    jumpToFile(abs, 1);
  } else {
    notify(`未找到 \\${hit.cmd} 目标文件：${hit.target}`, "err");
  }
  return true;
}

/** 扫描可见范围，把 \input{...} 整体标为 .cm-input-link（仅 ctrl-held 时由 CSS 呈现链接态） */
function buildInputLinkDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of view.visibleRanges) {
    let pos = r.from;
    while (pos <= r.to) {
      const line = view.state.doc.lineAt(pos);
      INPUT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = INPUT_RE.exec(line.text))) {
        const from = line.from + m.index;
        const to = from + m[0].length;
        if (to > r.from && from < r.to && !inComment(line.text, m.index)) {
          builder.add(from, to, Decoration.mark({ class: "cm-input-link" }));
        }
      }
      pos = line.to + 1;
      if (line.to + 1 > view.state.doc.length) break;
    }
  }
  return builder.finish();
}

/** \input{...} 可点链接装饰（与 citeLinkDecorations 同款：平时无样式，Ctrl 按住才显链接） */
export const inputLinkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildInputLinkDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildInputLinkDecos(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Ctrl 悬停提示：按住 Ctrl 悬停在 \input{...} 上时显示「Ctrl+点击跳转到 <文件>」。
 * 未按住 Ctrl 时不出现（不影响阅读）。
 */
export function inputJumpHint(view: EditorView, pos: number): Tooltip | null {
  if (!isCtrlHeld()) return null;
  const hit = findInputAt(view.state.doc, pos);
  if (!hit) return null;

  const abs = resolveInputPath(hit.target, currentPath);
  const dom = document.createElement("div");
  dom.className = "cm-input-jump-hint";
  dom.textContent = abs
    ? `Ctrl+点击跳转到 ${displayPath(abs)}`
    : `Ctrl+点击：未找到 ${hit.target}（可尝试补全路径）`;

  return { pos: hit.from, create: () => ({ dom }), above: true };
}
