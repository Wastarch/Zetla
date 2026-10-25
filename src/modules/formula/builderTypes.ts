// M1-11 · 图形化公式搭建器 —— 数据模型 / 结构模板库 / 序列化
// 树模型：单根槽 → 嵌套槽位；槽内可并列多个节点（文本 + 结构混合，如 a + \frac{}{}）
//   FSlot   槽位（结构的参数位，如分子/底数；children 空 = 未填充）
//   FText   文本叶子（变量、数字、符号命令）
//   FStruct 结构实例（模板 + 其全部槽位）
// 序列化：空槽 → \Box 占位符（LaTeX 内核命令，编译合法；插入后由编辑器槽位导航跳转）
import { SLOT_MARK } from "@/editor/slotRange";

/** 节点稳定 id（自增计数器，进程内唯一即可） */
let seq = 0;
export function newId(): string {
  seq += 1;
  return `n${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export type FNode = FSlot | FText | FStruct;

/** 槽位：结构的参数位（如「分子」）；children 为空数组 = 未填充的槽 */
export interface FSlot {
  k: "slot";
  id: string;
  /** 展示名（分子 / 底数 / 上限…） */
  label: string;
  /** 槽内并列节点（文本与结构可混排） */
  children: FNode[];
}

/** 文本叶子：LaTeX 源码片段（\alpha、x、+、2…） */
export interface FText {
  k: "text";
  id: string;
  v: string;
}

/** 结构实例：模板 id + 按模板定义的槽位数组 */
export interface FStruct {
  k: "struct";
  id: string;
  tpl: string;
  slots: FSlot[];
}

/** 结构模板定义 */
export interface Tpl {
  id: string;
  /** 展示名 */
  name: string;
  /** 迷你示意（ASCII/Unicode，按钮上用） */
  icon: string;
  /** 分组（模板网格分组标题） */
  group: string;
  /** 各槽位展示名 */
  slotLabels: string[];
  /** 由序列化后的槽位内容生成结构 LaTeX 片段 */
  latex: (s: string[]) => string;
}

/** 行列式 LaTeX 生成辅助（矩阵 / 行列式 / cases 共用） */
function grid(env: string, rows: number, cols: number, s: string[]): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(Array.from({ length: cols }, (_, c) => s[r * cols + c] ?? SLOT_MARK).join(" & "));
  }
  return `\\begin{${env}}\n${lines.join(" \\\\\n")}\n\\end{${env}}`;
}

/** M1-11：结构模板库（约 18 个；icon 为 ASCII 示意，名称说人话） */
export const TPLS: Tpl[] = [
  // ── 结构 ──
  {
    id: "frac", name: "分数", icon: "a/b", group: "结构",
    slotLabels: ["分子", "分母"],
    latex: (s) => `\\frac{${s[0] ?? SLOT_MARK}}{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "sup", name: "上标", icon: "a^b", group: "结构",
    slotLabels: ["底数", "上标"],
    latex: (s) => `{${s[0] ?? SLOT_MARK}}^{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "sub", name: "下标", icon: "a_b", group: "结构",
    slotLabels: ["底数", "下标"],
    latex: (s) => `{${s[0] ?? SLOT_MARK}}_{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "sqrt", name: "根式", icon: "√", group: "结构",
    slotLabels: ["被开方数"],
    latex: (s) => `\\sqrt{${s[0] ?? SLOT_MARK}}`,
  },
  {
    id: "root", name: "n 次根", icon: "ⁿ√", group: "结构",
    slotLabels: ["根指数", "被开方数"],
    latex: (s) => `\\sqrt[${s[0] ?? SLOT_MARK}]{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "binom", name: "二项式", icon: "C()", group: "结构",
    slotLabels: ["上参数", "下参数"],
    latex: (s) => `\\binom{${s[0] ?? SLOT_MARK}}{${s[1] ?? SLOT_MARK}}`,
  },
  // ── 运算 ──
  {
    id: "sum", name: "求和", icon: "∑", group: "运算",
    slotLabels: ["下限", "上限"],
    latex: (s) => `\\sum_{${s[0] ?? SLOT_MARK}}^{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "prod", name: "连乘", icon: "∏", group: "运算",
    slotLabels: ["下限", "上限"],
    latex: (s) => `\\prod_{${s[0] ?? SLOT_MARK}}^{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "int", name: "积分", icon: "∫", group: "运算",
    slotLabels: ["下限", "上限"],
    latex: (s) => `\\int_{${s[0] ?? SLOT_MARK}}^{${s[1] ?? SLOT_MARK}}`,
  },
  {
    id: "lim", name: "极限", icon: "lim", group: "运算",
    slotLabels: ["条件"],
    latex: (s) => `\\lim_{${s[0] ?? SLOT_MARK}}`,
  },
  {
    id: "sin", name: "正弦", icon: "sin", group: "运算",
    slotLabels: ["参数"],
    latex: (s) => `\\sin(${s[0] ?? SLOT_MARK})`,
  },
  {
    id: "cos", name: "余弦", icon: "cos", group: "运算",
    slotLabels: ["参数"],
    latex: (s) => `\\cos(${s[0] ?? SLOT_MARK})`,
  },
  {
    id: "tan", name: "正切", icon: "tan", group: "运算",
    slotLabels: ["参数"],
    latex: (s) => `\\tan(${s[0] ?? SLOT_MARK})`,
  },
  {
    id: "log", name: "对数", icon: "log", group: "运算",
    slotLabels: ["底数", "真数"],
    latex: (s) => `\\log_{${s[0] ?? SLOT_MARK}}(${s[1] ?? SLOT_MARK})`,
  },
  // ── 括号 ──
  {
    id: "paren", name: "圆括号", icon: "( )", group: "括号",
    slotLabels: ["内容"],
    latex: (s) => `\\left( ${s[0] ?? SLOT_MARK} \\right)`,
  },
  {
    id: "brack", name: "方括号", icon: "[ ]", group: "括号",
    slotLabels: ["内容"],
    latex: (s) => `\\left[ ${s[0] ?? SLOT_MARK} \\right]`,
  },
  {
    id: "brace", name: "花括号", icon: "{ }", group: "括号",
    slotLabels: ["内容"],
    latex: (s) => `\\left\\{ ${s[0] ?? SLOT_MARK} \\right\\}`,
  },
  // ── 矩阵 ──
  {
    id: "mat2", name: "矩阵 2×2", icon: "▦", group: "矩阵",
    slotLabels: ["(1,1)", "(1,2)", "(2,1)", "(2,2)"],
    latex: (s) => grid("matrix", 2, 2, s),
  },
  {
    id: "mat3", name: "矩阵 3×3", icon: "▤", group: "矩阵",
    slotLabels: ["(1,1)", "(1,2)", "(1,3)", "(2,1)", "(2,2)", "(2,3)", "(3,1)", "(3,2)", "(3,3)"],
    latex: (s) => grid("matrix", 3, 3, s),
  },
  {
    id: "vmat2", name: "行列式 2×2", icon: "|▦|", group: "矩阵",
    slotLabels: ["(1,1)", "(1,2)", "(2,1)", "(2,2)"],
    latex: (s) => grid("vmatrix", 2, 2, s),
  },
  {
    id: "cases", name: "分段 cases", icon: "{▾", group: "矩阵",
    slotLabels: ["条件 1", "取值 1", "条件 2", "取值 2"],
    latex: (s) => grid("cases", 2, 2, s),
  },
];

export const TPL_MAP: Record<string, Tpl> = Object.fromEntries(
  TPLS.map((t) => [t.id, t]),
);

/** 模板分组（保持 TPLS 定义序） */
export const TPL_GROUPS: string[] = Array.from(new Set(TPLS.map((t) => t.group)));

// ── 构造 ──

export function makeText(v: string): FText {
  return { k: "text", id: newId(), v };
}

export function makeSlot(label: string): FSlot {
  return { k: "slot", id: newId(), label, children: [] };
}

/** 按模板造一个结构实例（槽位全部为空） */
export function makeStruct(tplId: string): FStruct {
  const tpl = TPL_MAP[tplId];
  if (!tpl) throw new Error(`未知模板: ${tplId}`);
  return {
    k: "struct",
    id: newId(),
    tpl: tplId,
    slots: tpl.slotLabels.map((l) => makeSlot(l)),
  };
}

/** 新建一棵空公式树（单根槽） */
export function emptyTree(): FSlot {
  return makeSlot("公式");
}

// ── 查询 ──

/** 深度优先收集全部槽位（根槽在前） */
export function collectSlots(root: FSlot): FSlot[] {
  const out: FSlot[] = [];
  const walk = (s: FSlot) => {
    out.push(s);
    for (const c of s.children) {
      if (c.k === "slot") walk(c);
      else if (c.k === "struct") c.slots.forEach(walk);
    }
  };
  walk(root);
  return out;
}

/** 按 id 找槽；找不到返回 null */
export function findSlot(root: FSlot, id: string): FSlot | null {
  return collectSlots(root).find((s) => s.id === id) ?? null;
}

/** 第一个未填充槽（深度优先）；全部填满返回 null */
export function firstEmptySlot(root: FSlot): FSlot | null {
  return collectSlots(root).find((s) => s.children.length === 0) ?? null;
}

/** 树是否为空（根槽未填充） */
export function isTreeEmpty(root: FSlot): boolean {
  return root.children.length === 0;
}

/** 树中已填充槽的数量（统计用） */
export function filledCount(root: FSlot): number {
  return collectSlots(root).filter((s) => s.children.length > 0).length;
}

// ── 更新（返回新树，不可变；树小，整路径 clone 成本可忽略） ──

/** 对指定槽执行更新（按 id 定位；未命中返回原树） */
export function updateSlot(root: FSlot, id: string, fn: (s: FSlot) => void): FSlot {
  if (root.id === id) {
    const next: FSlot = { ...root, children: [...root.children] };
    fn(next);
    return next;
  }
  let changed = false;
  const children = root.children.map((c) => {
    if (c.k === "slot") {
      const u = updateSlot(c, id, fn);
      if (u !== c) changed = true;
      return u;
    }
    if (c.k === "struct") {
      let structChanged = false;
      const slots = c.slots.map((s) => {
        const u = updateSlot(s, id, fn);
        if (u !== s) structChanged = true;
        return u;
      });
      if (!structChanged) return c;
      changed = true;
      return { ...c, slots };
    }
    return c;
  });
  return changed ? { ...root, children } : root;
}

/** 向活动槽追加一个节点（文本或结构） */
export function appendToSlot(root: FSlot, slotId: string, node: FNode): FSlot {
  return updateSlot(root, slotId, (s) => {
    s.children = [...s.children, node];
  });
}

/** 清空指定槽的内容 */
export function clearSlot(root: FSlot, slotId: string): FSlot {
  return updateSlot(root, slotId, (s) => {
    s.children = [];
  });
}

/**
 * 文本写入活动槽：若槽内最后一个节点是文本则追加，否则新建文本节点。
 * 空白输入被忽略（与自定义公式必填校验同口径）。
 */
export function appendText(root: FSlot, slotId: string, text: string): FSlot {
  const v = text.trim();
  if (!v) return root;
  return updateSlot(root, slotId, (s) => {
    const last = s.children[s.children.length - 1];
    if (last && last.k === "text") {
      s.children = [...s.children.slice(0, -1), { ...last, v: last.v + v }];
    } else {
      s.children = [...s.children, makeText(v)];
    }
  });
}

// ── 序列化 ──

/** 计数器（mark 调用序号 = 空槽 DFS 序，预览协议与 slotIds 对齐依赖此性质） */
interface Count {
  i: number;
}

/**
 * 空槽占位生成器：入参为空槽 DFS 序号与槽节点本身。
 * 默认产出 \Box（插入编辑器协议，见 slotRange.ts）；
 * 预览协议传 slotCmd 形式（见 serializeSlots）。
 */
export type EmptyMark = (i: number, slot: FSlot) => string;

const DEFAULT_MARK: EmptyMark = () => SLOT_MARK;

/** 节点 → LaTeX；空槽经 mark 生成占位 */
export function serNode(n: FNode, mark: EmptyMark = DEFAULT_MARK, ctr: Count = { i: 0 }): string {
  if (n.k === "text") return n.v;
  if (n.k === "slot") return serChildren(n.children, mark, ctr, n);
  const tpl = TPL_MAP[n.tpl];
  if (!tpl) return SLOT_MARK;
  return tpl.latex(n.slots.map((s) => serNode(s, mark, ctr)));
}

/** 并列节点 → LaTeX；空列表 = 该槽未填充，经 mark 生成占位（owner 为所在槽） */
export function serChildren(
  cs: FNode[],
  mark: EmptyMark = DEFAULT_MARK,
  ctr: Count = { i: 0 },
  owner?: FSlot,
): string {
  if (cs.length === 0) return mark(ctr.i++, owner ?? { k: "slot", id: "", label: "", children: cs });
  return cs.map((c) => serNode(c, mark, ctr)).join("");
}

/** 整棵树 → LaTeX 公式体（不含编号/行内包裹）；空槽为 \Box（编辑器协议） */
export function serialize(root: FSlot): string {
  return serChildren(root.children, DEFAULT_MARK, { i: 0 }, root);
}

/**
 * 空槽占位命令（预览专用协议，M1-11 追加）：
 * DFS 序第 i 个空槽 → \za…\zz、\zaa…（bijective base-26，**必须纯字母**——
 * \zs1 形式会被 KaTeX 拆成 \zs + 1 两个 token，数字后缀不可用）。
 * KaTeX 对未定义命令宽容渲染为红字原文 span，FormulaKaTeX 后处理按出现序
 * 替换为可点选槽位节点（.zetla-slot[data-slot]）。
 *
 * M1-12a：实现移至 slotCmd.ts（编写区预览共用，避免 builderTypes 进主 bundle），
 * 此处 re-export 保持既有引用方（serializeSlots / 单测）不变。
 */
export { slotCmd } from "./slotCmd";
import { slotCmd } from "./slotCmd";

/**
 * 预览专用序列化：空槽 → slotCmd(i) 命令，并返回同序空槽 id 列表。
 * tex 中第 i 个 \z 命令必对应 slotIds[i]（mark 调用序 = 文档出现序）。
 * 插入编辑器仍用 serialize() 的纯 \Box 协议（编辑器只认 \Box）。
 */
export function serializeSlots(root: FSlot): { tex: string; slotIds: string[] } {
  const slotIds: string[] = [];
  const mark: EmptyMark = (i, slot) => {
    slotIds[i] = slot.id;
    return slotCmd(i);
  };
  const tex = serChildren(root.children, mark, { i: 0 }, root);
  return { tex, slotIds };
}

/** 节点摘要（树列表行显示）：结构的槽位状态 + 文本内容 */
export function nodeSummary(n: FNode): string {
  if (n.k === "text") return n.v;
  if (n.k === "slot") {
    if (n.children.length === 0) return "空";
    return serChildren(n.children);
  }
  const tpl = TPL_MAP[n.tpl];
  return tpl ? tpl.name : n.tpl;
}

/** 槽位的 LaTeX 片段（树行预览用，截断） */
export function slotLatex(s: FSlot, max = 40): string {
  const raw = s.children.length === 0 ? SLOT_MARK : serChildren(s.children);
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}
