// M0-9 · 编译桥接 —— 前端唯一订阅内核编译事件的地方
// 职责：listen compile_progress / compile_finished → 写全局 store；
//      暴露 startCompile() / cancelCompile() 给按钮、菜单、快捷键共用。
import { useEffect } from "react";
import { RustEvents, onKernelEvent } from "@/ipc/events";
import { compileApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, notify, useProjectStore } from "@/project/useProject";
import { ensureEnv } from "@/env/useEnvCheck";
import { stepsLabel } from "@/types";
import type { CompileEngine } from "@/types";
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

/**
 * M1-3：生效编译引擎。设置页显式指定（xelatex/pdflatex/lualatex）时全局覆盖
 * 项目 `.ltex/config.json`；"auto"（默认）跟随项目配置（缺省 xelatex）。
 */
export function effectiveEngine(
  setting: CompileEngine,
  projectEngine?: string | null,
): string {
  return setting === "auto" ? projectEngine || "xelatex" : setting;
}

/**
 * 开始编译（项目 + 主文件来自 useProjectStore；引擎 = 设置页显式值 ?? 项目 config；
 * 流程步骤来自设置页，空=自动 —— M1-3）
 */
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

  // M0-15a：编译前 TeX 环境预检（未检测到 → 弹引导并拦截；检测失败不拦截）
  if (!(await ensureEnv())) return;

  // M0-9b：编译前先把脏缓冲落盘，避免编译磁盘上的旧内容
  // M0-14a：受偏好设置「编译前自动保存」控制；关闭时仍可编译，但提示使用的是磁盘旧内容
  const buffers = useBuffersStore.getState();
  const dirtyBefore = buffers.dirtyCount();
  if (dirtyBefore > 0 && useSettingsStore.getState().settings.build.saveBeforeCompile) {
    await buffers.saveAllBuffers();
    // saveBuffer 内部吞异常只弹 toast，用「保存后是否仍脏」判定失败
    if (useBuffersStore.getState().dirtyCount() > 0) {
      notify("有文件保存失败，已中止编译", "err");
      return;
    }
  } else if (dirtyBefore > 0) {
    notify("编译前自动保存已关闭，本次编译使用磁盘上的内容", "err");
  }

  st.clearLog();
  // 用户指令 2026-10-24：开始编译即展开面板并切「全部」页看实时输出；
  // 失败时 compile_finished 桥接切「错误」页，成功/取消不动作、留在「全部」
  useAppStore.setState({ logVisible: true, logTab: "all" });
  // M1-3：生效引擎 = 设置页显式值 ?? 项目 config（缺省 xelatex）；
  // steps 空=自动（latexmk），非空=按序直跑的固定流程（如 LaTeX → BibTeX → LaTeX → LaTeX）
  const { build } = useSettingsStore.getState().settings;
  const engine = effectiveEngine(build.engine, tree.engine);
  const steps = build.steps;
  st.appendLog([
    `$ ${engineLabel(engine)} · ${base(tree.mainFile)}${steps.length > 0 ? ` · ${stepsLabel(steps)}` : ""}`,
  ]);
  st.setCompiling(0, "准备编译…");

  try {
    await compileApi.compileProject(root, tree.mainFile, engine, steps);
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
      // M0-12：编译失败自动展开面板并切到「错误」页（开始编译时已切「全部」；
      // 成功/取消留在「全部」不动作——用户指令 2026-10-24；用户手动收起后下次失败仍会展开）
      if (r.status === "error") useAppStore.setState({ logVisible: true, logTab: "errors" });
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
        // M0-12 之前：至少把失败这件事说清楚
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
