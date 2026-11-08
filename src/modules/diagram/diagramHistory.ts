// M2·F2-4：绘图撤销栈的浏览器侧协调层（薄封装，纯判定在 historyMerge.ts）。
//
// 这里持有**全模块唯一**的合并会话：画布拖拽与侧栏属性区都通过 commitDiagramPatch
// 写回，因此「同一控制点连拖三次」或「同一属性连改三次」共享同一组历史；
// key 不同（换对象 / 换属性）时自然分组，互不干扰。
//
// 刻意不 import store / React：fallback 由调用方注入，模块可在 Node 侧回归。
import { getDiagramSourceBridge } from "./sourceBridge.ts";
import {
  commitWithMerge,
  resetMergeSession,
  resolveHistoryShortcut,
  type HistoryCommandKind,
  type HistoryKeyContext,
  type HistoryKeyLike,
  type MergeCommitResult,
  type MergeSession,
} from "./historyMerge.ts";

const session: MergeSession = { group: null };

/** 写回一次绘图补丁；返回并组 / 降级状态供 UI 提示。 */
export function commitDiagramPatch(args: {
  key: string;
  source: string;
  nextSource: string;
  fallback: (next: string) => void;
  now?: number;
}): MergeCommitResult {
  return commitWithMerge(session, getDiagramSourceBridge(), {
    key: args.key,
    source: args.source,
    nextSource: args.nextSource,
    now: args.now ?? Date.now(),
    fallback: args.fallback,
  });
}

/** 执行撤销 / 重做；成功后立刻让合并会话失效，防止并到已撤销的历史上。 */
export function runDiagramHistoryCommand(kind: HistoryCommandKind): boolean {
  const bridge = getDiagramSourceBridge();
  if (!bridge) return false;
  const ok = kind === "undo" ? bridge.undo() : bridge.redo();
  if (ok) resetMergeSession(session);
  return ok;
}

/** 切换预览通道 / 重载源码等场景下主动断开合并组。 */
export function resetDiagramHistorySession(): void {
  resetMergeSession(session);
}

/**
 * 从真实 KeyboardEvent 收集上下文，再交给纯函数判定。
 * 只有「绘图 Tab 激活 + 焦点不在 CM6 / 文本输入框 + 无模态框 + 不在拖拽中」
 * 才由绘图模块接管；其余情况交还给各自的默认行为，绝不抢主文档的 Ctrl+Z。
 */
export function shouldHandleHistoryKey(
  e: KeyboardEvent,
  tabVisible: boolean,
  dragging: boolean,
): HistoryCommandKind | null {
  const focused = document.activeElement;
  const target = e.target instanceof Element ? e.target : null;
  const el = target ?? (focused instanceof Element ? focused : null);
  const tag = el?.tagName.toLowerCase() ?? "";
  const inputType = el?.getAttribute("type")?.toLowerCase() ?? "";
  const nonTextInputTypes = new Set([
    "button",
    "checkbox",
    "radio",
    "submit",
    "reset",
    "file",
    "range",
    "color",
    "image",
  ]);

  const ctx: HistoryKeyContext = {
    tabVisible,
    dragging,
    // 焦点在 CM6 内时 historyKeymap 已处理，重复撤销会退两步
    inCodeMirror: !!el?.closest(".cm-editor"),
    // select / button 不算文本输入：在属性下拉上按 Ctrl+Z 应撤销刚才的属性改动
    inTextInput:
      !!el?.closest('[contenteditable=""], [contenteditable="true"]') ||
      tag === "textarea" ||
      (tag === "input" && !nonTextInputTypes.has(inputType)),
    // 只认**真正的模态根**。项目里 role="dialog" 还用于常驻的非模态面板
    // （`MathView` 的 `.math-prefs` 插入偏好、`RefPreviewCard` 引用预览卡），
    // 若直接查 `[role="dialog"]` 会让全局撤销键在这些面板存在时永远失效。
    dialogOpen: !!document.querySelector(
      '.modal-layer, .switcher-overlay, .find-panel[role="dialog"], [role="dialog"].modal',
    ),
  };
  const key: HistoryKeyLike = {
    key: e.key,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    defaultPrevented: e.defaultPrevented,
  };
  return resolveHistoryShortcut(key, ctx);
}
