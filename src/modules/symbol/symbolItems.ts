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
  /** 二级子类（中文键，见 SUBCATS / SUBCAT_LABEL；模板与无需细分的分类为空串） */
  subcat: string;
  /** 展示名 */
  name: string;
  /**
   * 按钮预览文本。
   * 符号侧（symbols.json）已彻底移除 glyph 字段——符号视觉统一由 KaTeX 渲染 latex（见 SymbolPanel / LazySymbolGlyph）。
   * 此处符号的 glyph 仅作 cmd 的别名（保留字段以兼容接口与搜索），无独立语义，后续可一并删除。
   * 仅「模板」真正使用 glyph（= builderTypes.TPLS 的 icon，如 ∑/∫/a/b），并参与模板搜索。
   */
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

/**
 * 二级子类（分类 → 有序子类中文键）。
 * 顺序即面板内分区出现顺序；仅含当前数据真正存在的子类即可（空子类 UI 自动跳过）。
 * 数组矩阵 用户指定「不加」子类，故不在此表。
 */
export const SUBCATS: Record<string, string[]> = {
  常用符号: ["二元运算符", "二元关系符", "箭头符号", "其他符号"],
  希腊字母: ["小写", "大写", "其他符号"],
  分数微分: ["分数", "导数", "模算术"],
  根式角标: ["根式", "上下标", "重音符及其他"],
  极限对数: ["极限", "对数指数", "界限"],
  三角函数: ["三角函数", "反三角函数", "双曲函数", "反双曲函数"],
  积分运算: ["积分", "双重积分", "三重积分", "曲线积分"],
  大型运算: ["求和", "乘积余积", "并集交集", "析取合取"],
  括号取整: ["括号", "常用"],
};

/** 子类中文键 → 中英双语展示标签 */
export const SUBCAT_LABEL: Record<string, string> = {
  二元运算符: "二元运算符 Binary operations",
  二元关系符: "二元关系符 Binary relations",
  箭头符号: "箭头符号 Arrows",
  其他符号: "其他 Others",
  小写: "小写 Lowercase",
  大写: "大写 Uppercase",
  分数: "分数 Fractions",
  导数: "导数 Derivative",
  模算术: "模算术 Modular arithmetic",
  根式: "根式 Radicals",
  上下标: "上下标 Sub & Super",
  重音符及其他: "重音符及其他 Accents and Others",
  极限: "极限 Limits",
  对数指数: "对数指数 Logarithms and exponentials",
  界限: "界限 Bounds",
  三角函数: "三角函数 Trigonometric functions",
  反三角函数: "反三角函数 Inverse trigonometric functions",
  双曲函数: "双曲函数 Hyperbolic functions",
  反双曲函数: "反双曲函数 Inverse hyperbolic functions",
  积分: "积分 Integral",
  双重积分: "双重积分 Double integral",
  三重积分: "三重积分 Triple integral",
  曲线积分: "曲线积分 Closed line or path integral",
  求和: "求和 Summation",
  乘积余积: "乘积余积 Product and coproduct",
  并集交集: "并集交集 Union and intersection",
  析取合取: "析取合取 Disjunction and conjunction",
  括号: "括号 Brackets",
  常用: "常用 Commons",
};

const SYMBOL_ITEMS: InsertItem[] = (
  symbolsData as { name: string; cmd: string; category: string; subcat: string }[]
).map((s) => ({
  key: s.cmd,
  kind: "symbol",
  cat: s.category,
  subcat: s.subcat,
  name: s.name,
  glyph: s.cmd,
  latex: s.cmd,
  slots: 0,
  note: s.cmd,
}));

const TEMPLATE_ITEMS: InsertItem[] = TPLS.map((t) => ({
  key: `tpl:${t.id}`,
  kind: "template",
  cat: t.cat,
  subcat: "",
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
      // 模板 icon（∑/∫/a/b 等）单独参与检索；符号已无 glyph，Unicode 直搜失效（改用命令/中文名）
      (it.kind === "template" && it.glyph.toLowerCase().includes(k)),
  );
}
