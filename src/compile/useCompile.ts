// M0-9 · 编译桥接 —— 前端唯一订阅内核编译事件的地方
// 职责：listen compile_progress / compile_finished → 写全局 store；
//      暴露 startCompile() / cancelCompile() 给按钮、菜单、快捷键共用。
import { useEffect } from "react";
import { RustEvents, onKernelEvent } from "@/ipc/events";
import { compileApi, projectApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore } from "@/editor/useBuffers";
import { getActiveView } from "@/editor/activeView";
import { anchorPdfToSource } from "@/preview/syncTex";
import { base, notify, useProjectStore } from "@/project/useProject";
import { ensureEnv } from "@/env/useEnvCheck";
import { DEFAULT_AUX_EXTENSIONS, liveSafeAuxExtensions, stepsLabel } from "@/types";
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
 * M1-18c：本次（最近一次）编译是否由实时预览触发。
 * 后端在 compile_finished 里不带这个标记（它只是执行者），而前端每次 startCompile
 * 都会覆盖它，且 latest-wins 下只有「最新任务」会 emit finished——因此这个模块级标记
 * 与即将到达的 finished 事件天然一一对应，不需要改 Rust 协议。
 */
let liveCompile = false;
/** 实时预览触发时记录的光标位置（编译成功后用它做 PDF 滚动锚定） */
let liveAnchorAt: { file: string; line: number; col: number } | null = null;

/** 当前活动编辑器的光标（1 基行号 / 1 基列号）；无活动编辑器时返回 null */
function currentCursor(): { file: string; line: number; col: number } | null {
  const file = useBuffersStore.getState().activePath;
  const view = getActiveView();
  if (!file || !view) return null;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return { file, line: line.number, col: pos - line.from + 1 };
}

/**
 * 开始编译（项目 + 主文件来自 useProjectStore；引擎 = 设置页显式值 ?? 项目 config；
 * 流程步骤来自设置页，空=自动 —— M1-3）
 *
 * M1-18b：不再用「已在编译中就直接返回」的哨兵。后端已改为 latest-wins——
 * 新请求会顶掉旧任务并杀掉其子进程，所以重叠触发（实时预览的常态）总是落到最新内容，
 * 也不会再出现「已有编译任务在进行中」的误报。
 *
 * M1-18c：`opts.live` 标记「实时预览触发的编译」——不展开/不清空日志面板、失败不弹窗，
 * 成功后按光标行做 PDF 静默锚定（见 `anchorPdfToSource`）。
 */
export async function startCompile(opts?: { live?: boolean }): Promise<void> {
  const live = !!opts?.live;
  const st = useAppStore.getState();

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
    // live 触发走静默保存：不弹「已保存」toast、不触发「保存即编译」（避免每次防抖双重编译）
    await buffers.saveAllBuffers(live ? { silent: true } : undefined);
    // saveBuffer 内部吞异常只弹 toast，用「保存后是否仍脏」判定失败
    if (useBuffersStore.getState().dirtyCount() > 0) {
      // live 触发不弹窗（否则每次防抖都会弹），仅静默中止
      if (!live) notify("有文件保存失败，已中止编译", "err");
      return;
    }
  } else if (dirtyBefore > 0) {
    if (!live) notify("编译前自动保存已关闭，本次编译使用磁盘上的内容", "err");
  }

  // M1-18c：实时预览触发的编译**不抢界面**——不清日志、不展开面板，只写日志备查
  if (!live) {
    st.clearLog();
    // 用户指令 2026-10-24：开始编译即展开面板并切「全部」页看实时输出；
    // 失败时 compile_finished 桥接切「错误」页，成功/取消不动作、留在「全部」
    useAppStore.setState({ logVisible: true, logTab: "all" });
    // 手动编译不参与锚定；清掉上一轮 live 的锚点，避免 PDF 重载时被旧锚点拽走
    useAppStore.setState({ pdfAnchor: null });
  }
  // M1-3：生效引擎 = 设置页显式值 ?? 项目 config（缺省 xelatex）；
  // steps 空=自动（latexmk），非空=按序直跑的固定流程（如 LaTeX → BibTeX → LaTeX → LaTeX）
  const { build } = useSettingsStore.getState().settings;
  const engine = effectiveEngine(build.engine, tree.engine);
  const steps = build.steps;
  st.appendLog([
    `$ ${engineLabel(engine)} · ${base(tree.mainFile)}${steps.length > 0 ? ` · ${stepsLabel(steps)}` : ""}`,
  ]);
  st.setCompiling(0, "准备编译…");

  // M1-18c：标记本次是否由实时预览触发，并记录光标（成功后据此做 PDF 锚定）
  liveCompile = live;
  liveAnchorAt = live ? currentCursor() : null;

  try {
    await compileApi.compileProject(root, tree.mainFile, engine, steps);
  } catch (e) {
    // 命令本身失败（主文件不存在 / 引擎缺失 / 环境异常）；
    // M1-18b 起「已有任务在跑」不再是错误（后端 latest-wins 顶替旧任务）
    const s = useAppStore.getState();
    s.setCompileDone({ status: "error", errors: [], passes: 0, durationMs: 0 });
    s.appendLog([String(e)]);
    if (!live) notify(String(e), "err");
    liveCompile = false;
    liveAnchorAt = null;
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
      // M1-18c：本次结果是否来自实时预览触发（标记在 startCompile 里写入）
      const isLive = liveCompile;
      const anchor = liveAnchorAt;
      liveCompile = false;
      liveAnchorAt = null;

      st.setCompileDone(r);
      // M0-12：编译失败自动展开面板并切到「错误」页（开始编译时已切「全部」；
      // 成功/取消留在「全部」不动作——用户指令 2026-10-24；用户手动收起后下次失败仍会展开）
      // M1-18c：**实时预览触发的失败不弹面板**——打字途中必然频繁半成品报错，
      // 每次弹日志会灾难；改由预览右上角「未更新」灰标提示（PdfPreview 的 stale）
      if (r.status === "error" && !isLive) {
        useAppStore.setState({ logVisible: true, logTab: "errors" });
      }
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
        // M0-12 之前：至少把失败这件事说清楚（live 时静默，见上）
        if (!isLive) notify("编译失败，详情见下方日志", "err");
      } else if (r.status === "ok") {
        // M1-18c：实时预览成功 → 按编译前记录的光标行做 PDF 静默锚定
        // （重排后 scrollTop 像素值会错位，用 SyncTeX 的逻辑位置才准；不复用 pdfSync 的闪现高亮）
        if (isLive && anchor && r.pdfPath) {
          void anchorPdfToSource(anchor.file, anchor.line, anchor.col, r.pdfPath);
        }
        // M1-9b：编译成功且开启「编译完成后清理辅助文件」→ 自动 clean_aux；
        // 清理绕过 store（参考 MenuBar 菜单项），故清理后再刷一次资源树
        const build = useSettingsStore.getState().settings.build;
        if (build.cleanAuxAfterCompile) {
          const root = useProjectStore.getState().root;
          // M1-18c：实时预览开启时保留 latexmk 缓存（.fdb_latexmk/.fls）与 .synctex.gz，
          // 否则每次清理都会把增量缓存删掉 → 二次编译退化全量，且锚定/双向跳转失效
          const exts = build.livePreview
            ? liveSafeAuxExtensions(
                build.cleanAuxExtensions.length > 0
                  ? build.cleanAuxExtensions
                  : DEFAULT_AUX_EXTENSIONS,
              )
            : build.cleanAuxExtensions;
          if (root && exts.length > 0) {
            projectApi
              .cleanAux(root, exts)
              .then((res) => {
                if (res.removed > 0) {
                  useAppStore.getState().appendLog([`— 已清理 ${res.removed} 个辅助文件 —`]);
                  if (!isLive) notify(`已清理 ${res.removed} 个辅助文件`, "ok");
                  void useProjectStore.getState().refresh(true);
                }
              })
              .catch((e) => notify(`清理辅助文件失败：${e}`, "err"));
          }
        }
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
