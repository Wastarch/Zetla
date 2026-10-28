// M1-14i · 编辑器语言映射表（纯前端，零新依赖）
// 按扩展名选择语法高亮档位，取代原先「.bib → BibTeX / 其余一律 LaTeX」的二值判断。
// 第 1 档：补齐 BibTeX 风格/日志的专属着色，并把 BibLaTeX / docTeX / ConTeXt 显式归到 LaTeX。
// M1-14j：未收录的扩展名不再强行按 LaTeX 高亮，改为「纯文本」渲染（plain），状态栏可手动切换。
import { extOf } from "@/project/useProject";

export type EditorLang = "latex" | "bib" | "bst" | "log" | "plain";

/** 语言档位的展示信息（状态栏「文档语言」与切换菜单共用，避免各处写死文案） */
export interface LangMeta {
  id: EditorLang;
  /** 状态栏展示名 */
  label: string;
  /** 一句话说明（菜单 title） */
  desc: string;
  /** 归一为「自动识别」的扩展名（仅用于说明文案） */
  exts: string[];
}

/** LaTeX 文档与 LaTeX 方言（类/宏包/BibLaTeX 控制文件/docTeX/ConTeXt）—— 统一按 LaTeX 高亮 */
const LATEX_EXTS = [
  "tex",
  "ltx",
  "cls",
  "sty",
  "bbx", // BibLaTeX  bibliography 样式
  "cbx", // BibLaTeX citation 样式
  "lbx", // BibLaTeX 本地化
  "dtx", // docTeX 文档源
  "ins", // docstrip 安装脚本
  "ctx", // ConTeXt
];

const BIB_EXTS = ["bib"];
const BST_EXTS = ["bst"]; // BibTeX 样式（PostScript 风格语言）
const LOG_EXTS = ["log"]; // 编译日志

/** 可手动切换的语言档位（顺序即菜单顺序） */
export const LANG_META: Record<EditorLang, LangMeta> = {
  latex: {
    id: "latex",
    label: "LaTeX",
    desc: "LaTeX 源文件 / 类 / 宏包 / BibLaTeX 控制文件 / docTeX / ConTeXt",
    exts: LATEX_EXTS,
  },
  bib: {
    id: "bib",
    label: "BibTeX",
    desc: "BibTeX 文献库（.bib），含重复 key 与 \\cite 缺失告警",
    exts: BIB_EXTS,
  },
  bst: {
    id: "bst",
    label: "BibTeX 样式",
    desc: "BibTeX 样式语言（.bst，PostScript 风格）",
    exts: BST_EXTS,
  },
  log: {
    id: "log",
    label: "TeX 日志",
    desc: "编译日志（.log），错误/告警/行号着色",
    exts: LOG_EXTS,
  },
  plain: {
    id: "plain",
    label: "纯文本",
    desc: "纯文本：不做语法着色（自动识别时用于未收录的扩展名）",
    exts: [],
  },
};

/** 菜单/展示用顺序 */
export const LANG_ORDER: EditorLang[] = ["latex", "bib", "bst", "log", "plain"];

/** 按扩展名返回高亮档位；无扩展名/未收录的扩展名一律「纯文本」（不再强行按 LaTeX 着色） */
export function langOf(path: string | undefined): EditorLang {
  const ext = path ? extOf(path) : "";
  if (!ext) return "plain";
  if (BIB_EXTS.includes(ext)) return "bib";
  if (BST_EXTS.includes(ext)) return "bst";
  if (LOG_EXTS.includes(ext)) return "log";
  if (LATEX_EXTS.includes(ext)) return "latex";
  return "plain";
}

/** 语言档位的中文展示名（状态栏/菜单统一出口） */
export function langLabel(lang: EditorLang): string {
  return LANG_META[lang].label;
}

/** 该扩展名是否被映射表显式识别（未识别 = 按纯文本渲染） */
export function isKnownExt(path: string | undefined): boolean {
  const ext = path ? extOf(path) : "";
  if (!ext) return false;
  return (
    BIB_EXTS.includes(ext) ||
    BST_EXTS.includes(ext) ||
    LOG_EXTS.includes(ext) ||
    LATEX_EXTS.includes(ext)
  );
}
