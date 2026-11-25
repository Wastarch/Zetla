// M0-9a · 资源树自动刷新 —— 全局只挂一次
// Rust 端已按 500ms 防抖推 project_changed（只含文件增减）；
// 这里再做一层合并：刷新在飞时只记一次 pending，避免连续事件堆积全树扫描。
// 编译进行中不刷新（latexmk 会连续产出 .aux/.log/.pdf），改由 compile_finished 统一刷一次。
// 2026-11-14（用户指令）：移除「文件已在编辑器外部被修改，是否重新加载？」提示条。
// 2026-11-18（用户指令）：恢复 file_changed 订阅，改为**静默自动刷新**打开的文本标签——
//  仍然不弹提示条；只重载干净缓冲（未保存改动优先保留），细节见 useBuffers.reloadExternalFile。
//  仍然保留手工重读入口 useBuffers.revertBuffer。Rust 侧事件零改动。
import { useEffect } from "react";
import { RustEvents, onKernelEvent } from "@/ipc/events";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { shouldReloadOnExternalChange } from "@/editor/externalReload";
import { pathKey } from "@/modules/zotero/zoteroSync";
import { useProjectStore } from "./useProject";
import { finishDragOut } from "./dragOut";
import type { DragOutResult, FileChanged, ProjectChanged } from "@/types";

/** 同一文件的 file_changed 合并窗口（原子写一次落盘会触发多条 notify 事件） */
const FILE_RELOAD_DEBOUNCE_MS = 250;

export function useProjectWatch(): void {
  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    let refreshing = false;
    let pending = false;

    const run = async (root: string): Promise<void> => {
      const st = useProjectStore.getState();
      if (st.root !== root) return; // 事件来自上一个项目
      // 编译期间 latexmk 会连续产出 .aux/.log/.pdf：丢弃事件，
      // 由 useCompile 在 compile_finished 时统一刷新一次
      if (useAppStore.getState().compileStatus === "running") return;
      if (refreshing) {
        pending = true;
        return;
      }

      refreshing = true;
      pending = false;
      try {
        await st.refresh(true);
      } finally {
        refreshing = false;
      }
      if (pending && alive) {
        pending = false;
        void run(root);
      }
    };

    void onKernelEvent<ProjectChanged>(RustEvents.projectChanged, (e) => {
      if (alive) void run(e.root);
    }).then((un) => {
      if (alive) unlisteners.push(un);
      else un();
    });

    // M1-49：从树里拖到系统后，Rust 的 DoDragDrop 线程在松手时回执落地效果；
    // move 说明文件已被搬出项目 → afterDragOut 重扫树并摘掉失效的选中/展开项
    void onKernelEvent<DragOutResult>(RustEvents.dragOutDone, (e) => {
      if (!alive) return;
      finishDragOut();
      void useProjectStore.getState().afterDragOut(e.effect, e.paths);
    }).then((un) => {
      if (alive) unlisteners.push(un);
      else un();
    });

    // M1-49：从系统资源管理器剪走/粘走项目里的文件时（非本应用操作），
    // 目录监听与编译期静默都会漏掉刷新；切回窗口时补扫一次（800ms 内合并多次 focus）
    let lastFocusRefreshAt = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAt < 800) return;
      lastFocusRefreshAt = now;
      const st = useProjectStore.getState();
      if (st.root) void st.refresh(true);
    };
    window.addEventListener("focus", onFocus);
    unlisteners.push(() => window.removeEventListener("focus", onFocus));

    // 外部改动 → 自动重载已打开的文本标签（静默；脏缓冲不覆盖）
    const reloadTimers = new Map<string, number>();
    void onKernelEvent<FileChanged>(RustEvents.fileChanged, (e) => {
      if (!alive || typeof e?.path !== "string" || !e.path) return;
      const key = pathKey(e.path);
      const prev = reloadTimers.get(key);
      if (prev !== undefined) window.clearTimeout(prev);
      reloadTimers.set(
        key,
        window.setTimeout(() => {
          reloadTimers.delete(key);
          const st = useBuffersStore.getState();
          // Rust 事件路径写法可能与缓冲 path 不同（反斜杠 / verbatim 前缀），
          // 先按规范化路径找缓冲，再用它自己的 path 重载（revert 内部是精确匹配）。
          const buf = st.buffers.find((b) => shouldReloadOnExternalChange(b, e.path));
          if (buf) void st.reloadExternalFile(buf.path);
        }, FILE_RELOAD_DEBOUNCE_MS),
      );
    }).then((un) => {
      if (alive) unlisteners.push(un);
      else un();
    });

    return () => {
      alive = false;
      reloadTimers.forEach((t) => window.clearTimeout(t));
      reloadTimers.clear();
      unlisteners.forEach((u) => u());
    };
  }, []);
}
