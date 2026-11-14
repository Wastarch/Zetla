// M2·F2-4：统一撤销栈收尾的纯逻辑（无 DOM / React / zustand 依赖，Node 侧可直接回归）。
//
// 背景：F2-1 拖拽与 F2-2 属性编辑已经通过 sourceBridge 的最小 span dispatch 并入
// 同一条 CM6 history。剩下两个体验缺口：
//   ① 「仅画布」布局下源码栏 hidden，CM6 没有键盘焦点，Ctrl+Z 不会命中 historyKeymap；
//   ② 连续微调（反复拖同一个点 / 连改同一个属性下拉）会产生一长串撤销记录，
//      用户要按很多次 Ctrl+Z 才能回到调整前。
//
// 本文件只负责「判断」与「协调」，不碰 DOM：
//   · planHistoryMerge：判断这次补丁能否并入上一组，并算出从组内基准源码到新源码的
//     最小单点补丁（交给 CM6 的 replaceLast 一次性替换上一组历史记录）；
//   · commitWithMerge：按决策调用注入的 applier；合并失败 / 视图不可用逐级降级；
//   · resolveHistoryShortcut：把全局快捷键的判定条件做成纯函数，方便回归覆盖。
//
// 为什么不直接调 CM6 的 newGroupDelay / joinableUserEvent：
//   @codemirror/commands 只把 /^(input\.type|delete)($|\.)/ 的相邻事务在 500ms 内
//   自动并组，且 newGroupDelay 由 basicSetup 的 history() 固定（多配置取 Math.min）。
//   拖拽 / 下拉微调的间隔普遍 > 500ms，改全局配置还会把键盘直编的撤销粒度一起变粗。
//   因此在 Zetla 侧显式维护一个「窗口 + key + 源码一致性」的合并会话更可控。
import { singleSpanPatch, type SourceSpanPatch } from "./dragEdit.ts";

/** 连续微调合并窗口；覆盖人手连拖 / 连改下拉的节奏，又不至于把相隔很久的两次操作并成一步。 */
export const MERGE_WINDOW_MS = 1500;
/** 单组最多合并多少步，防止一次 Ctrl+Z 回退掉过长的编辑历史。 */
export const MAX_MERGE_STEPS = 12;

export interface MergeGroup {
  /** 同一对象 / 同一属性的标识，例如 `drag:h3`、`prop:path:0:stroke` */
  key: string;
  /** 本组开始前的源码（撤销一次应回到的位置） */
  baseSource: string;
  /** 本组最近一次写回后的源码；与调用方传入的 source 不一致就说明中途另有改动 */
  currentSource: string;
  lastAt: number;
  steps: number;
}

export interface MergeSession {
  group: MergeGroup | null;
}

/** CM6 侧能力的最小抽象；DiagramSourceBridge 结构上兼容，测试可用 fake 实现。 */
export interface HistoryPatchApplier {
  patch: (patch: SourceSpanPatch, expectedSource: string) => boolean;
  /**
   * 在一个同步流程里「撤销上一组 → 应用从基准源码出发的合并补丁」。
   * 任何校验失败都必须自行 redo 回滚到 expectedCurrentSource 并返回 false。
   * patch 为 null 表示本组回到了基准源码（只需撤销，无需再 dispatch）。
   */
  replaceLast: (
    patch: SourceSpanPatch | null,
    expectedBaseSource: string,
    expectedCurrentSource: string,
    expectedTargetSource: string,
  ) => boolean;
}

export interface MergeReplace {
  baseSource: string;
  currentSource: string;
}

export type MergePlan =
  | { kind: "new"; group: MergeGroup; patch: SourceSpanPatch; replace: null }
  | { kind: "merge"; group: MergeGroup; patch: SourceSpanPatch | null; replace: MergeReplace };

/**
 * 并组条件（全部满足才合并）：
 *   · key 相同（同一个控制点 / 同一条语句的同一个属性）；
 *   · 组内存活且未超步数上限、未超时间窗（now 倒退也视为新组）；
 *   · `group.currentSource === source` —— 中途键盘改源码、撤销 / 重做、并发写回
 *     都会让源码偏离，此时必须开新组，绝不能拿旧基准去替换历史。
 */
export function planHistoryMerge(
  group: MergeGroup | null,
  key: string,
  source: string,
  nextSource: string,
  now: number,
  windowMs: number = MERGE_WINDOW_MS,
): MergePlan {
  const canMerge =
    !!group &&
    group.key === key &&
    group.currentSource === source &&
    group.steps < MAX_MERGE_STEPS &&
    Number.isFinite(now) &&
    now >= group.lastAt &&
    now - group.lastAt <= windowMs;

  if (canMerge && group) {
    // 从「本组起点」到「最新源码」求最小补丁；source 与 nextSource 必然不同，
    // 但 nextSource 可能恰好又等于 baseSource（微调回到原点）→ 返回 null。
    return {
      kind: "merge",
      group: {
        ...group,
        currentSource: nextSource,
        lastAt: now,
        steps: group.steps + 1,
      },
      patch: singleSpanPatch(group.baseSource, nextSource),
      replace: { baseSource: group.baseSource, currentSource: group.currentSource },
    };
  }

  // source !== nextSource 由 commitWithMerge 保证，这里必然拿到非空补丁。
  const patch = singleSpanPatch(source, nextSource) ?? { from: 0, to: 0, insert: "" };
  return {
    kind: "new",
    group: { key, baseSource: source, currentSource: nextSource, lastAt: now, steps: 1 },
    patch,
    replace: null,
  };
}

export interface MergeCommitResult {
  /** 是否通过 CM6 写回（有撤销记录） */
  written: boolean;
  /** 是否并入了上一组 */
  merged: boolean;
  /** 是否降级为整篇 setSource（功能不丢，但无撤销记录） */
  degraded: boolean;
}

export interface MergeCommitArgs {
  key: string;
  source: string;
  nextSource: string;
  now: number;
  fallback: (next: string) => void;
  windowMs?: number;
}

/**
 * 一次写回的完整协调流程。session 由调用方长期持有（拖拽与属性区共享同一会话），
 * applier 为 null 表示源码栏未就绪，直接降级。
 *
 * 合并失败（历史顶端不是本组、基准不匹配等）时 applier 已回滚文档，
 * 这里退回「从当前源码出发的独立一步」，宁可多一条撤销记录也不丢改动。
 */
export function commitWithMerge(
  session: MergeSession,
  applier: HistoryPatchApplier | null,
  args: MergeCommitArgs,
): MergeCommitResult {
  const { key, source, nextSource, now, fallback, windowMs } = args;
  if (source === nextSource) return { written: false, merged: false, degraded: false };

  const plan = planHistoryMerge(session.group, key, source, nextSource, now, windowMs);
  if (applier && plan.kind === "merge") {
    const ok = applier.replaceLast(
      plan.patch,
      plan.replace.baseSource,
      plan.replace.currentSource,
      nextSource,
    );
    if (ok) {
      session.group = plan.group;
      return { written: true, merged: true, degraded: false };
    }
    // applier 契约：失败时文档已回滚到 source，可安全地按独立一步重试。
  }

  if (applier) {
    const patch = singleSpanPatch(source, nextSource);
    if (patch && applier.patch(patch, source)) {
      session.group = {
        key,
        baseSource: source,
        currentSource: nextSource,
        lastAt: now,
        steps: 1,
      };
      return { written: true, merged: false, degraded: false };
    }
  }

  // 视图缺失 / 源码过期：沿用 F2-1 的降级语义（整篇写回，明确提示无撤销记录）。
  fallback(nextSource);
  session.group = null;
  return { written: false, merged: false, degraded: true };
}

/** 撤销 / 重做 / 切换预览通道 / 换图后调用，避免下一轮微调并到已经失效的历史组上。 */
export function resetMergeSession(session: MergeSession): void {
  session.group = null;
}

// ── 全局快捷键判定 ────────────────────────────────────────────────────────────

export interface HistoryKeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}

export interface HistoryKeyContext {
  /** 绘图 Tab 是否真正激活（切到 .tex / PDF 时绝不拦截） */
  tabVisible: boolean;
  /** 正在拖拽控制点，此时 Ctrl+Z 不该打断指针会话 */
  dragging: boolean;
  /** 焦点在 CM6 内：交给 historyKeymap 自己处理，避免撤销两次 */
  inCodeMirror: boolean;
  /** 焦点在文本框 / textarea / contenteditable：让浏览器撤销输入 */
  inTextInput: boolean;
  /** 有模态对话框：快捷键归对话框 */
  dialogOpen: boolean;
}

export type HistoryCommandKind = "undo" | "redo";

/** 返回要执行的命令，null 表示本次按键不属于绘图撤销栈。 */
export function resolveHistoryShortcut(
  e: HistoryKeyLike,
  ctx: HistoryKeyContext,
): HistoryCommandKind | null {
  if (
    !ctx.tabVisible ||
    ctx.dragging ||
    ctx.inCodeMirror ||
    ctx.inTextInput ||
    ctx.dialogOpen ||
    e.defaultPrevented ||
    e.altKey
  ) {
    return null;
  }
  if (!(e.ctrlKey || e.metaKey)) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  // 菜单里「重做」标的是 Ctrl+Y；Ctrl+Shift+Z 也一并支持（VS Code 习惯）
  if (k === "y" && !e.shiftKey) return "redo";
  return null;
}
