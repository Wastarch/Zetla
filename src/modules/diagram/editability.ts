// M2·F3-6：绘图模块「此刻能否写 TikZ 源码」的唯一判定口径（纯逻辑，无 DOM / React / vendor）。
//
// F3-1…F3-5 的编辑能力散落在画布键盘、形状工具条、属性区、变换面板、图层面板里，
// 各处各自判 previewMode / 焦点 / 手势，容易漏 —— F3-5 的键盘分支就漏掉了精确通道。
// F3-6 把它收敛成一个函数：所有**会写源码**的入口先过 canEditDiagramSource，
// 只读理由统一给出，UI 常驻提示文案一致。Node strip-types 可直接回归各分支。
//
// 边界（勿扩大）：
//   · 纯编辑器侧元数据（虚拟分组 / 隐藏 / 主动锁定 / 图层显隐 / 缩放 / 切换通道）
//     不写 TikZ 源码，不受此判定约束；
//   · 撤销 / 重做（F2-4）走 shouldHandleHistoryKey 自己的焦点 / 模态判定，不在这里；
//   · 这里只判「能不能写」，不判「某条语句能不能改」—— 后者由 F2-3 capabilityMatrix
//     与 grouping 的主动锁定在写回规划内部处理。

/** 与 store 的 PreviewMode 结构一致；刻意不 import `@/types/diagram`，保证纯逻辑零别名依赖。 */
export type DiagramPreviewMode = "local" | "precise";

export const PRECISE_READONLY_REASON = "XeLaTeX 精确通道只读 · 切回「本地即时」可编辑";

export interface DiagramEditContext {
  previewMode: DiagramPreviewMode;
  /** 绘图 Tab 是否激活（画布常驻挂载，Tab 隐藏时不接管键盘） */
  tabVisible?: boolean;
  /** 焦点是否在源码栏 / 文本框 / 模态框 */
  inTextEntry?: boolean;
  /** 是否正在拖拽 / 框选 / 变换 / 绘制手势 */
  inGesture?: boolean;
}

export interface EditPermission {
  ok: boolean;
  reason: string;
}

const ALLOWED: EditPermission = { ok: true, reason: "" };

/**
 * 判定「此刻是否允许写 TikZ 源码」；返回只读理由供 UI 常驻提示 / toast。
 * 理由优先级：精确通道 > Tab 未激活 > 焦点在文本输入 > 手势中。
 */
export function canEditDiagramSource(ctx: DiagramEditContext): EditPermission {
  if (ctx.previewMode !== "local") {
    return { ok: false, reason: PRECISE_READONLY_REASON };
  }
  if (ctx.tabVisible === false) return { ok: false, reason: "绘图 Tab 未激活" };
  if (ctx.inTextEntry) {
    return { ok: false, reason: "焦点在源码栏 / 输入框，不接管编辑快捷键" };
  }
  if (ctx.inGesture) return { ok: false, reason: "手势进行中，不接管编辑快捷键" };
  return ALLOWED;
}

/**
 * F3-6：区分「精确通道只读」与其它理由 —— 精确通道要**拦截并提示**编辑键，
 * 而焦点 / 手势 / Tab 隐藏时应静默放行，绝不抢键或弹无谓提示。
 */
export function isPreciseReadonly(permission: EditPermission): boolean {
  return !permission.ok && permission.reason === PRECISE_READONLY_REASON;
}

export interface EditKeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * F3-5 引入的编辑快捷键：方向键 nudge（Shift 只是放大步长）、Delete / Backspace
 * 删除选中图元，以及 Ctrl/Cmd+C/V/D。
 * 精确通道下这些键一律拦截并提示只读；Ctrl+Z / Shift+Z / Y 属 F2-4 撤销，不在此列，
 * 仍可撤销切通道前的改动。Shift+方向键仍是 nudge 放大步长；Shift+Delete 等带修饰的
 * 删除组合不拦，交还浏览器。
 */
export function isDiagramEditKey(e: EditKeyLike): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod && !e.altKey) {
    if (
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown"
    ) {
      return true;
    }
    return !e.shiftKey && (e.key === "Delete" || e.key === "Backspace");
  }
  if (mod && !e.shiftKey && !e.altKey) {
    return ["c", "v", "d"].includes(e.key.toLowerCase());
  }
  return false;
}
