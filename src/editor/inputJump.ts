// M1-4+ · \input / \include 文件跳转（Ctrl+点击打开目标 .tex，交互与 \cite 跳转一致）
// 与 \cite 跳转的差别：没有引用索引可查，目标靠「项目树 + LaTeX 相对路径口径」定位：
//   \input{chapter/chap01} 相对当前文件目录 / 主文件目录 / 项目根依次尝试，缺省补 .tex 后缀。
// 纯前端（零 Rust 改动），只读 useProjectStore 的树，不落盘。
// M1-43：命令面扩到引入文件全家桶（规格表见 ./inputSpec）；目标未找到时弹窗二次确认后
//   在主文件目录（编译工作目录）下创建缺失的 .tex/.bib，取消则什么都不发生。
import {
  Decoration,
  EditorView,
  type DecorationSet,
  type Tooltip,
} from "@codemirror/view";
import { type EditorState, type Text } from "@codemirror/state";
import { jumpToFile } from "./jump";
import {
  createTargetFor,
  inputCmdKeys,
  inputCmdSpec,
  splitTargetDir,
  type InputCmdSpec,
} from "./inputSpec";
import { notify, parentOf, useProjectStore } from "@/project/useProject";
import { hoverPosField, isCtrlHeld } from "@/modules/reference/citeSupport";

/**
 * \input 类命令全家桶（可选参数 [...] 也认，如 \includegraphics[width=3cm]{fig}）。
 * 键按长度降序拼正则：防止 include 抢先吃掉 includegraphics 的前缀。
 * 组 1 = 命令名，组 2 = 花括号目标（花括号内不跨行、不吃嵌套括号）。
 */
const INPUT_RE = new RegExp(
  `\\\\((?:${inputCmdKeys()
    .sort((a, b) => b.length - a.length)
    .join("|")}))(?:\\[[^\\]\\n]*\\])?\\s*\\{([^{}\\n]+)\\}`,
  "g",
);

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
 * 解析引入文件目标 → 项目内绝对路径（找不到返回 null）。
 * 候选顺序：当前文件目录 → 主文件目录 → 项目根；每个目录按命令规格的后缀逐个试
 * （tex：原样 → .tex；bib：原样 → .bib；图：原样 → .png/.jpg/...）。
 * LaTeX 实际按编译工作目录（主文件目录）解析，这里把当前文件目录排前面兼容「相对当前文件」写法。
 */
export function resolveInputPath(
  target: string,
  curPath?: string,
  cmd?: string,
): string | null {
  const spec: InputCmdSpec = (cmd ? inputCmdSpec(cmd) : null) ?? {
    suffixes: ["", ".tex"],
    createable: false,
  };
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
    for (const suffix of spec.suffixes) {
      const cand = toProjectSep(`${base}/${raw}${suffix}`);
      if (fileInTree(cand)) return cand;
    }
  }
  return null;
}

/**
 * M1-43 · 目标未找到 → 打开应用内「创建文件」确认对话框（CreateFileAskDialog，
 * 用户指令不用系统原生 confirm），确认后走 createEntry：自动补缺失父目录、开标签、树中选中。
 */
function offerCreateMissing(
  hit: InputRef,
  rel: string,
  spec: InputCmdSpec,
  curPath?: string,
): void {
  const st = useProjectStore.getState();
  const mainDir = st.tree?.mainFile ? parentOf(st.tree.mainFile) : null;
  const baseDir = mainDir ?? (curPath ? parentOf(curPath) : null) ?? st.root;
  if (!baseDir) {
    notify(`未找到 \\${hit.cmd} 目标文件：${hit.target}`, "err");
    return;
  }
  const { dirRel, name } = splitTargetDir(rel);
  const dir = dirRel ? toProjectSep(`${baseDir}/${dirRel}`) : baseDir;
  const full = toProjectSep(`${dir}/${name}`);
  st.openCreateFileAsk({
    dir,
    name,
    ext: spec.createExt,
    displayPath: displayPath(full),
    withParentHint: !!dirRel,
  });
}

/** 定位光标所在的引入文件命令（pos 需落在整条命令内，供点击与悬浮判定） */
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
        cmd: m[1],
        target: m[2].trim(),
      };
    }
  }
  return null;
}

/**
 * Ctrl+点击引入文件命令 → 打开目标文件并跳到首行（复用 jumpToFile，未打开则开标签）。
 * 目标未找到：可创建命令弹窗二次确认后创建（M1-43），取消/不可创建只 toast。
 * 命中命令即消费事件（目标缺失也不回落到 synctex 正向跳转，避免跳到 PDF 误导）。
 * 未命中任何引入命令 → 返回 false，交还上层继续判定 \cite / synctex。
 */
export function inputJumpAtCursor(
  doc: Text,
  pos: number,
  curPath?: string,
): boolean {
  const hit = findInputAt(doc, pos);
  if (!hit) return false;
  const spec = inputCmdSpec(hit.cmd);
  if (!spec) return false;
  const abs = resolveInputPath(hit.target, curPath, hit.cmd);
  if (abs) {
    jumpToFile(abs, 1);
    return true;
  }
  const rel = createTargetFor(hit.target, spec);
  if (rel) {
    offerCreateMissing(hit, rel, spec, curPath);
  } else {
    const why = hit.target.includes(",") ? "（多目标暂不支持跳转）" : "";
    notify(`未找到 \\${hit.cmd} 目标文件：${hit.target}${why}`, "err");
  }
  return true;
}

/** 悬停于引入文件命令上时给该命令整体挂 .cm-input-link（悬停不在命令上 → 空集） */
function buildInputLinkDecos(state: EditorState): DecorationSet {
  const pos = state.field(hoverPosField, false);
  if (pos == null) return Decoration.none;
  const hit = findInputAt(state.doc, pos);
  if (!hit) return Decoration.none;
  return Decoration.set([
    Decoration.mark({ class: "cm-input-link" }).range(hit.from, hit.to),
  ]);
}

/**
 * \input 类命令可点链接装饰（M1-43 追改为悬停命中式：只标鼠标所在的那一条命令，
 * 与 \cite 一致；平时无样式，仅 ctrl-held 下由 CSS 呈现链接态）。
 */
export const inputLinkDecorations = EditorView.decorations.compute(
  [hoverPosField],
  buildInputLinkDecos,
);

/**
 * Ctrl 悬停提示：按住 Ctrl 悬停在引入文件命令上时显示「Ctrl+点击跳转到 <文件>」。
 * 目标未找到：可创建命令提示「点击可创建」（M1-43），其余提示补全路径。
 * 未按住 Ctrl 时不出现（不影响阅读）。
 */
export function inputJumpHint(view: EditorView, pos: number): Tooltip | null {
  if (!isCtrlHeld()) return null;
  const hit = findInputAt(view.state.doc, pos);
  if (!hit) return null;

  const abs = resolveInputPath(hit.target, currentPath, hit.cmd);
  const spec = inputCmdSpec(hit.cmd);
  const dom = document.createElement("div");
  dom.className = "cm-input-jump-hint";
  dom.textContent = abs
    ? `Ctrl+点击跳转到 ${displayPath(abs)}`
    : spec?.createable && createTargetFor(hit.target, spec)
      ? `Ctrl+点击：未找到 ${hit.target}（点击可创建）`
      : `Ctrl+点击：未找到 ${hit.target}（可尝试补全路径）`;

  return { pos: hit.from, create: () => ({ dom }), above: true };
}
