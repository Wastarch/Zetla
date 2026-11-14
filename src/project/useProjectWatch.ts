// M0-9a · 资源树自动刷新 —— 全局只挂一次
// Rust 端已按 500ms 防抖推 project_changed（只含文件增减）；
// 这里再做一层合并：刷新在飞时只记一次 pending，避免连续事件堆积全树扫描。
// 编译进行中不刷新（latexmk 会连续产出 .aux/.log/.pdf），改由 compile_finished 统一刷一次。
// 2026-11-14（用户指令）：移除「文件已在编辑器外部被修改，是否重新加载？」提示条，
// 因此这里的 file_changed 订阅一并撤掉 —— 外部改动不再提示、也不自动重载缓冲
// （需要手工从盘重读时仍可用 useBuffers.revertBuffer）。Rust 侧事件保留，零改动。
import { useEffect } from "react";
import { RustEvents, onKernelEvent } from "@/ipc/events";
import { useAppStore } from "@/core/store";
import { useProjectStore } from "./useProject";
import type { ProjectChanged } from "@/types";

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

    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, []);
}
