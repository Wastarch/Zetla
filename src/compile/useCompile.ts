// M0-9 · 编译桥接 —— 前端唯一订阅内核编译事件的地方
// 职责：listen compile_progress / compile_finished → 写全局 store；
//      暴露 startCompile() / cancelCompile() 给按钮、菜单、快捷键共用。
import { useEffect } from "react";
import { RustEvents, onKernelEvent } from "@/ipc/events";
import { compileApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, notify, useProjectStore } from "@/project/useProject";
import type { CompileProgress, CompileResult } from "@/types";

/** 引擎显示名（状态栏 chip 用真实引擎） */
const ENGINE_LABELS: Record<string, string> = {
  xelatex: "XeLaTeX",
  pdflatex: "pdfLaTeX",
  lualatex: "LuaLaTeX",
  latexmk: "latexmk",
};

export function engineLabel(engine?: string | null): string {
  if (!engine) return "XeLaTeX";
  return ENGINE_LABELS[engine.toLowerCase()] ?? engine;
}

/** 开始编译（项目 + 主文件 + 引擎都来自 .ltex/config.json 的权威结果） */
export async function startCompile(): Promise<void> {
  const st = useAppStore.getState();
  if (st.compileStatus === "running") return;

  const { root, tree } = useProjectStore.getState();
  if (!root || !tree) {
    notify("请先打开项目", "err");
    return;
  }
  if (!tree.mainFile) {
    notify("未识别主文件，请在 .ltex/config.json 指定 mainFile", "err");
    return;
  }

  // M0-9b：编译前先把脏缓冲落盘，避免编译磁盘上的旧内容
  const buffers = useBuffersStore.getState();
  if (buffers.dirtyCount() > 0) {
    await buffers.saveAllBuffers();
    // saveBuffer 内部吞异常只弹 toast，用「保存后是否仍脏」判定失败
    if (useBuffersStore.getState().dirtyCount() > 0) {
      notify("有文件保存失败，已中止编译", "err");
      return;
    }
  }

  st.clearLog();
  useAppStore.setState({ logVisible: true });
  st.appendLog([`$ ${engineLabel(tree.engine)} · ${base(tree.mainFile)}`]);
  st.setCompiling(0, "准备编译…");

  try {
    await compileApi.compileProject(root, tree.mainFile, tree.engine);
  } catch (e) {
    // 命令本身失败（已有任务在跑 / 主文件不存在 / 引擎缺失）
    const s = useAppStore.getState();
    s.setCompileDone({ status: "error", errors: [], passes: 0, durationMs: 0 });
    s.appendLog([String(e)]);
    notify(String(e), "err");
  }
}

/** 取消编译（后台真的杀掉子进程） */
export async function cancelCompile(): Promise<void> {
  try {
    await compileApi.cancelCompile();
  } catch (e) {
    notify(String(e), "err");
  }
}

/** 事件桥：在 App 根部挂一次即可 */
export function useCompileBridge(): void {
  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];

    // 事件可能在 listen 注册完成前到达（用户开面板即刻编译），alive 防止卸载后写入
    void onKernelEvent<CompileProgress>(RustEvents.compileProgress, (p) => {
      if (!alive) return;
      const st = useAppStore.getState();
      st.setCompiling(p.pct, p.current);
      if (p.current.trim()) st.appendLog([p.current]);
    }).then((un) => {
      if (alive) unlisteners.push(un);
      else un();
    });

    void onKernelEvent<CompileResult>(RustEvents.compileFinished, (r) => {
      if (!alive) return;
      const st = useAppStore.getState();
      st.setCompileDone(r);
      const secs = (r.durationMs / 1000).toFixed(1);
      const summary =
        r.status === "ok"
          ? `— 编译通过 · ${r.passes} 遍 · ${secs}s —`
          : r.status === "cancelled"
            ? "— 已取消 —"
            : `— 编译失败 · ${secs}s —`;
      st.appendLog([summary]);
      // M0-9a：编译产物入树（编译期间监听事件被攒下，这里统一刷一次；
      // 同时兜住目录监听不可用时的情况）
      void useProjectStore.getState().refresh(true);
      if (r.status === "error") {
        // M0-11 之前：至少把失败这件事说清楚
        notify("编译失败，详情见下方日志", "err");
      }
    }).then((un) => {
      if (alive) unlisteners.push(un);
      else un();
    });

    return () => {
      alive = false;
      for (const un of unlisteners) un();
    };
  }, []);
}
