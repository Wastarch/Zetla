// Zotero 联动 · P3-4 样式切换落地（编辑器侧，含 store / CM6 依赖）
//
// 目标：把 planStyleSwitch 算出的**最小 span 补丁**写进主文档，且尽量保留撤销栈。
//   1) 目标文件已挂载编辑器（即使是隐藏标签）→ 直接 view.dispatch，Ctrl+Z 可撤销；
//   2) 只在缓冲里（未挂载）→ 改缓冲内容，标脏，交给自动保存；
//   3) 完全没打开 → 先 openFiles 再等视图注册，超时才退到 (2)。
// 绝不静默失败：每种落点都在返回值里说明，由调用方 toast。

import { getEditorView } from "@/editor/activeView";
import { useBuffersStore } from "@/editor/useBuffers";
import { projectApi } from "@/ipc/invoke";
import {
  applyStyleEdit,
  planStyleSwitch,
  type StyleEdit,
} from "./zoteroStyleMap";
import {
  applyEngineSwitch,
  planEngineSwitch,
  type ConcreteBibFormat,
} from "./zoteroFormat";
import { detectPreambleStyle } from "./zoteroStyleMap";

export interface TexSource {
  tex: string;
  /** 数据来源：编辑器文档 / 脏缓冲 / 磁盘 */
  source: "editor" | "buffer" | "disk";
}

/** 读目标 .tex 的当前内容：编辑器 > 缓冲 > 磁盘（顺序保证偏移与真实文档一致） */
export async function readTexForEdit(path: string): Promise<TexSource> {
  const view = getEditorView(path);
  if (view) return { tex: view.state.doc.toString(), source: "editor" };
  const buf = useBuffersStore.getState().buffers.find((b) => b.path === path);
  if (buf) return { tex: buf.content, source: "buffer" };
  const doc = await projectApi.readFile(path);
  return { tex: doc.content, source: "disk" };
}

/** 等编辑器挂载：openFiles 之后视图注册要跨几帧 */
function waitForView(path: string, tries = 60): Promise<ReturnType<typeof getEditorView>> {
  return new Promise((resolve) => {
    let left = tries;
    const tick = () => {
      const v = getEditorView(path);
      if (v || left <= 0) {
        resolve(v ?? null);
        return;
      }
      left -= 1;
      window.setTimeout(tick, 16);
    };
    tick();
  });
}

export interface StyleApplyResult {
  ok: boolean;
  /** 是否真的改了文件（noop / 失败时为 false） */
  changed: boolean;
  /** 改动是否进入 CM6 撤销栈 */
  undoable: boolean;
  message: string;
}

/**
 * 应用一次样式切换。
 * 会在写入前**重新读取并重新规划**：弹窗预览到用户点确认之间用户可能改了导言区，
 * 旧偏移在新文本上可能错位，重算一次比相信旧偏移安全。
 */
export async function applyStyleSwitch(
  path: string,
  cslId: string,
): Promise<StyleApplyResult> {
  const { tex, source } = await readTexForEdit(path);
  const plan = planStyleSwitch(tex, cslId);
  if (!plan.ok) {
    return { ok: false, changed: false, undoable: false, message: plan.message };
  }
  if (plan.noop || !plan.edit) {
    return { ok: true, changed: false, undoable: false, message: plan.message };
  }

  let view = getEditorView(path);
  if (!view && source === "disk") {
    await useBuffersStore.getState().openFiles([path]);
    view = await waitForView(path);
  }
  if (view) {
    view.dispatch({
      changes: { from: plan.edit.from, to: plan.edit.to, insert: plan.edit.insert },
      scrollIntoView: true,
    });
    return {
      ok: true,
      changed: true,
      undoable: true,
      message: `${plan.message}（Ctrl+Z 可撤销，未自动重新编译）`,
    };
  }

  const buf = useBuffersStore.getState().buffers.find((b) => b.path === path);
  if (!buf) {
    return {
      ok: false,
      changed: false,
      undoable: false,
      message: "未找到目标文件缓冲，未做修改",
    };
  }
  useBuffersStore.getState().updateContent(path, applyStyleEdit(buf.content, plan.edit));
  return {
    ok: true,
    changed: true,
    undoable: false,
    message: `${plan.message}（已写入缓冲，未自动重新编译）`,
  };
}

/** 仅供单测/预览：把补丁套在给定文本上（不碰任何文件） */
export function previewStyleEdit(tex: string, edit: StyleEdit): string {
  return applyStyleEdit(tex, edit);
}

/**
 * P9：把导言区引擎切到目标格式（bibtex ↔ biblatex）。
 * 写入前重新读取并重新规划（预览到确认之间用户可能改了导言区）；
 * 有多个 span 补丁时一次性 view.dispatch（保撤销栈），无视图时退到缓冲。
 */
export async function applyEngineSwitchToTex(
  path: string,
  target: ConcreteBibFormat,
): Promise<StyleApplyResult> {
  const { tex, source } = await readTexForEdit(path);
  const from = detectPreambleStyle(tex).engine;
  const plan = planEngineSwitch(tex, from, target);
  if (!plan.ok) return { ok: false, changed: false, undoable: false, message: plan.message };
  if (plan.noop || plan.edits.length === 0) {
    return { ok: true, changed: false, undoable: false, message: plan.message };
  }

  let view = getEditorView(path);
  if (!view && source === "disk") {
    await useBuffersStore.getState().openFiles([path]);
    view = await waitForView(path);
  }
  if (view) {
    view.dispatch({
      changes: plan.edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })),
      scrollIntoView: true,
    });
    return {
      ok: true, changed: true, undoable: true,
      message: `${plan.message}（Ctrl+Z 可撤销，未自动重新编译）`,
    };
  }

  const buf = useBuffersStore.getState().buffers.find((b) => b.path === path);
  if (!buf) {
    return { ok: false, changed: false, undoable: false, message: "未找到目标文件缓冲，导言区未修改" };
  }
  useBuffersStore.getState().updateContent(path, applyEngineSwitch(buf.content, plan));
  return {
    ok: true, changed: true, undoable: false,
    message: `${plan.message}（已写入缓冲，未自动重新编译）`,
  };
}
