// M2-5c · 「代码片段」设置页与设置对话框的桥接（极小，仅两处用到）。
// 片段存独立 snippets.json，不走 AppSettings 的 save()；但用户在片段页改完后
// 直接点底部「保存设置 / 取消」时，必须能感知未保存的片段草稿：
// - save()   → 先 flush（有改动则落盘并生效，非法片段自动跳过，不阻塞设置保存）
// - cancel() → 有未保存改动时提示确认，避免静默丢失
let flushFn: (() => Promise<void>) | null = null;
let dirtyFn: (() => boolean) | null = null;

/** 由 SnippetsPane 挂载时注册（返回解绑，页面卸载即失效） */
export function registerSnippetsBridge(
  flush: () => Promise<void>,
  isDirty: () => boolean,
): () => void {
  flushFn = flush;
  dirtyFn = isDirty;
  return () => {
    if (flushFn === flush) flushFn = null;
    if (dirtyFn === isDirty) dirtyFn = null;
  };
}

/** 提交片段草稿（无改动或页面未打开时空转） */
export async function flushSnippets(): Promise<void> {
  await flushFn?.();
}

/** 片段页是否有未保存改动（页面未打开时恒为 false） */
export function hasDirtySnippets(): boolean {
  return dirtyFn?.() ?? false;
}
