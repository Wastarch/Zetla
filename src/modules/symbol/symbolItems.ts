// M1-12b · 符号面板统一插入项（symbols.json 符号 + builderTypes.TPLS 模板）
// 10 分类体系（对齐 Formula.html 快捷工具）：
//   常用符号 / 希腊字母 / 分数微分 / 根式角标 / 极限对数 / 三角函数 / 积分运算 / 大型运算 / 括号取整 / 数组矩阵
// 交互定稿（用户 2026-10-25）：单击 → 写入侧栏编写区；右键 → 直插菜单。
import symbolsData from "./symbols.json";
import { TPLS } from "@/modules/formula/builderTypes";
import { SLOT_MARK } from "@/editor/slotRange";

/** 插入项：符号（cmd 原样插入）或模板（latex 含 \Box 槽位，插入后可 Tab 跳填） */
export interface InsertItem {
  /** 稳定 key（符号 cmd / tpl:<id>；recent 去重） */
  key: string;
  kind: "symbol" | "template";
  /** 10 分类之一 */
  cat: string;
  /** 展示名 */
  name: string;
  /** 按钮预览（符号 = Unicode 字形，缺省回退 cmd；模板 = ASCII 示意） */
  glyph: string;
  /** 插入的 LaTeX（符号 = cmd；模板含 \Box） */
  latex: string;
  /** \Box 槽数（模板；符号为 0） */
  slots: number;
  /** 名称备注（符号 = \cmd；模板 = 槽位名，参与搜索） */
  note: string;
}

/** 10 分类（顺序即大钮排列，2 行 × 5） */
export const CATEGORIES = [
  "常用符号",
  "希腊字母",
  "分数微分",
  "根式角标",
  "极限对数",
  "三角函数",
  "积分运算",
  "大型运算",
  "括号取整",
  "数组矩阵",
] as const;

/** 分类大钮图标（代表字形，与 Formula.html 快捷工具一一对应） */
export const CAT_ICONS: Record<string, string> = {
  常用符号: "±",
  希腊字母: "α",
  分数微分: "a/b",
  根式角标: "√",
  极限对数: "lim",
  三角函数: "sin",
  积分运算: "∫",
  大型运算: "∑",
  括号取整: "( )",
  数组矩阵: "▦",
};

const SYMBOL_ITEMS: InsertItem[] = (
  symbolsData as { name: string; cmd: string; category: string; glyph?: string }[]
).map((s) => ({
  key: s.cmd,
  kind: "symbol",
  cat: s.category,
  name: s.name,
  glyph: s.glyph ?? s.cmd,
  latex: s.cmd,
  slots: 0,
  note: s.cmd,
}));

const TEMPLATE_ITEMS: InsertItem[] = TPLS.map((t) => ({
  key: `tpl:${t.id}`,
  kind: "template",
  cat: t.cat,
  name: t.name,
  glyph: t.icon,
  latex: t.latex(t.slotLabels.map(() => SLOT_MARK)),
  slots: t.slotLabels.length,
  note: t.slotLabels.join("/"),
}));

/** 全部插入项（符号 191 + 模板 24） */
export const INSERT_ITEMS: InsertItem[] = [...SYMBOL_ITEMS, ...TEMPLATE_ITEMS];

/** 按分类取项（保持数据序：符号按 cmd、模板按 TPLS 定义序） */
export function itemsByCat(cat: string): InsertItem[] {
  return INSERT_ITEMS.filter((it) => it.cat === cat);
}

/** 全库搜索（name/latex/note/cat 命中；符号额外匹配字形，如直接输 ≤） */
export function searchItems(kw: string): InsertItem[] {
  const k = kw.trim().toLowerCase();
  if (!k) return [];
  return INSERT_ITEMS.filter(
    (it) =>
      it.name.toLowerCase().includes(k) ||
      it.latex.toLowerCase().includes(k) ||
      it.note.toLowerCase().includes(k) ||
      it.cat.includes(k) ||
      (it.kind === "symbol" && it.glyph.includes(k)),
  );
}
