// M0-12 · 错误定位 —— 日志面板 → 编辑器跳转桥
// 行号是编译时刻的（编辑再偏移只能钳在文件末尾），高亮口径 = 选中报错整行。
// 文件未打开：openFiles 打开并激活，由 EditorWorkspace 激活 effect 消费 pending 落地。
import { useBuffersStore } from "./useBuffers";
import { getActiveEditorHandle } from "./activeView";

export interface JumpTarget {
  /** 绝对路径（日志里已归一） */
  file: string;
  /** 1-based 行 */
  line: number;
  col?: number;
}

let pending: JumpTarget | null = null;

/**
 * 通用跳转：打开/切到目标文件并跳行选中（不限扩展名，.tex 与 .bib 等均可）。
 * M1-14d 用于从 .tex 的 \cite{key} 跳到 bib 条目；M0-12 错误定位同样复用之。
 */
export function jumpToFile(file: string, line: number, col?: number): void {
  if (line <= 0) return;

  const bs = useBuffersStore.getState();
  const hit = bs.buffers.find((b) => b.path.toLowerCase() === file.toLowerCase());
  if (hit && bs.activePath === hit.path) {
    getActiveEditorHandle()?.gotoLine(line, col, true);
    return;
  }
  pending = { file: file.toLowerCase(), line, col };
  if (hit) {
    // 已打开未激活：激活切换会触发 EditorWorkspace 的跳转消费
    useBuffersStore.getState().setActive(hit.path);
  } else {
    // 未打开：openFiles 会激活第一个路径，同样由激活 effect 落地
    void useBuffersStore.getState().openFiles([file]).then(() => {
      // 打开失败（文件不存在/读取报错）时清掉 pending，防止串到别的标签上
      const st = useBuffersStore.getState();
      if (!st.buffers.some((b) => b.path.toLowerCase() === file.toLowerCase())) pending = null;
    });
  }
}

/** 日志条目点击 → 打开/切到目标文件并跳行选中（无行号/非 .tex 不呼起） */
export function jumpToError(file: string, line: number, col?: number): void {
  // 解析不到行号（line=0）或非 .tex（.sty/生成文件）：只展示不可跳
  if (line <= 0 || !file.toLowerCase().endsWith(".tex")) return;
  jumpToFile(file, line, col);
}

/** EditorWorkspace 激活 effect 调用：目标命中才消费，否则保留 */
export function takePendingJump(file: string): JumpTarget | null {
  if (pending && pending.file === file.toLowerCase()) {
    const j = pending;
    pending = null;
    return j;
  }
  return null;
}
