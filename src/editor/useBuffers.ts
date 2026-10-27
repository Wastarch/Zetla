// M0-5 · 缓冲区管理（多文件标签页）—— 见 docs/开发计划.md M0-5
// 职责：打开/关闭/切换缓冲、脏状态、保存（写盘+回读校验）
// 说明：编辑器实例状态（撤销栈/光标/滚动）由 EditorWorkspace 的多实例方案（A）持有，
//       本 store 只存「文档数据」；M0-12 错误定位通过 openFiles + setActive 复用。
import { create } from "zustand";
import { confirm } from "@tauri-apps/plugin-dialog";
import { projectApi } from "@/ipc/invoke";
import { useSettingsStore } from "@/core/settings";
import { startCompile } from "@/compile/useCompile";
import type { FileDoc } from "@/types";

/** 正在写盘的缓冲路径（防止手动保存与自动保存并发互踩） */
const savingPaths = new Set<string>();

/**
 * 保存时自动编译：手动保存（Ctrl+S / 保存菜单 / 保存按钮，silent=false）成功后，
 * 若设置开启且保存的是 .tex 文件，防抖触发一次编译。连续保存（如「全部保存」）
 * 会合并为一次编译；自动保存（silent=true）不触发，避免频繁编译。
 */
let compileOnSaveTimer: number | undefined;
function scheduleCompileOnSave(): void {
  if (!useSettingsStore.getState().settings.build.compileOnSave) return;
  if (compileOnSaveTimer !== undefined) window.clearTimeout(compileOnSaveTimer);
  compileOnSaveTimer = window.setTimeout(() => {
    compileOnSaveTimer = undefined;
    void startCompile();
  }, 400);
}

/** 缓冲类型：`text`=普通文本文档（LaTeX 等，可编辑/可保存）；`image`/`pdf`=只读查看器，不持有文本 */
export type BufferKind = "text" | "image" | "pdf";

/** 一个打开的文档（标签页） */
export interface EditorBuffer {
  /** 绝对路径（唯一键） */
  path: string;
  /** 标签显示名（文件名） */
  name: string;
  /** 当前编辑内容（查看器缓冲恒为 ""） */
  content: string;
  /** 上次保存的内容（脏 = content !== savedContent；查看器缓冲恒为 ""） */
  savedContent: string;
  /** 打开/保存后回读的编码，"utf-8" | "gbk" | ...（查看器缓冲无意义，恒 "utf-8"） */
  encoding: string;
  /** 换行符（查看器缓冲恒 "lf"） */
  eol: "lf" | "crlf";
  /** 是否已挂载 CM 实例（首次激活后为 true，切走只隐藏不卸载） */
  mounted: boolean;
  /** 缓冲类型（决定渲染方式与是否可保存） */
  kind: BufferKind;
  /** M1-9：文件被外部修改、待用户决定是否重新加载 */
  externallyChanged?: boolean;
}

/** 轻量反馈（toast） */
export interface BuffersNotice {
  text: string;
  kind: "ok" | "err";
}

/** 光标位置（全局状态栏展示；由活动编辑器 onCursorChange 写入） */
export interface CursorPos {
  line: number;
  col: number;
}

function basename(p: string): string {
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] || p;
}

/** 图片扩展名（与 useProject.EXT_IMG 保持一致；本地副本避免循环依赖） */
const IMG_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "eps", "tif", "tiff", "avif",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 按扩展名判定缓冲类型：图片/PDF → 查看器；其余 → 文本 */
function bufferKind(p: string): BufferKind {
  const ext = extOf(p);
  if (ext === "pdf") return "pdf";
  if (IMG_EXT.has(ext)) return "image";
  return "text";
}

/** 缓冲区 store 状态（外部订阅/键计算用，如 useWindowMemory 的会话记忆） */
export interface BuffersState {
  buffers: EditorBuffer[];
  activePath: string | null;
  notice: BuffersNotice | null;
  /** 光标位置（活动编辑器；状态栏展示） */
  cursor: CursorPos;

  /** 打开文件（去重；已存在则激活）；返回是否成功打开新文件 */
  openFiles: (paths: string[]) => Promise<void>;
  /** 激活指定缓冲 */
  setActive: (path: string) => void;
  /** 关闭缓冲；脏文件先经原生确认，取消返回 false */
  closeBuffer: (path: string, force?: boolean) => Promise<boolean>;
  /** 编辑器内容变更 */
  updateContent: (path: string, content: string) => void;
  /** 保存指定缓冲：write_file → 回读校验 → markSaved；silent 不弹「已保存」toast（自动保存用），失败仍弹 */
  saveBuffer: (path: string, options?: { silent?: boolean }) => Promise<boolean>;
  /** 保存全部脏缓冲（侧栏/菜单栏共用）；返回保存个数 */
  saveAllBuffers: () => Promise<number>;
  /** M0-14a · 自动保存全部脏缓冲（静默成功；失败汇总一条 toast），返回是否全部成功 */
  autosaveDirty: () => Promise<boolean>;
  /** 脏缓冲数量（退出确认等用） */
  dirtyCount: () => number;
  /** 首次激活后标记已挂载 */
  markMounted: (path: string) => void;
  clearNotice: () => void;
  /** 更新光标位置（状态栏行/列展示） */
  setCursor: (pos: CursorPos) => void;
  /** M1-9：标记/清除某缓冲的「外部已修改」状态 */
  setExternalChanged: (path: string, val: boolean) => void;
  /** M1-9：放弃缓冲、重新从盘读回（revert_file 回填并清脏）；返回是否成功 */
  revertBuffer: (path: string) => Promise<boolean>;
  /** M1-9：忽略外部改动提示（不再提示，直到下次外部改动） */
  dismissExternal: (path: string) => void;
  /** 诊断用：缓冲是否脏 */
  isDirty: (path: string) => boolean;
}

export const useBuffersStore = create<BuffersState>((set, get) => ({
  buffers: [],
  activePath: null,
  notice: null,
  cursor: { line: 1, col: 1 },

  openFiles: async (paths) => {
    const unique = [...new Set(paths.filter((p) => p && p.trim() !== ""))];
    if (unique.length === 0) return;

    const fresh: EditorBuffer[] = [];
    for (const p of unique) {
      if (get().buffers.some((b) => b.path === p)) continue;
      if (fresh.some((b) => b.path === p)) continue;
      try {
        const kind = bufferKind(p);
        if (kind === "text") {
          const d: FileDoc = await projectApi.readFile(p);
          fresh.push({
            path: p,
            name: basename(p),
            content: d.content,
            savedContent: d.content,
            encoding: d.encoding,
            eol: d.eol,
            mounted: false,
            kind,
          });
        } else {
          // 图片 / PDF：仅建查看器缓冲，不读取二进制文本（避免误当文本回读/污染脏状态）
          fresh.push({
            path: p,
            name: basename(p),
            content: "",
            savedContent: "",
            encoding: "utf-8",
            eol: "lf",
            mounted: false,
            kind,
          });
        }
      } catch (e) {
        set({ notice: { text: `打开失败 ${basename(p)}：${String(e)}`, kind: "err" } });
      }
    }

    // 激活目标：优先用户点选的第一个（新打开或已打开），否则第一个新文件
    const opened = new Set([...get().buffers.map((b) => b.path), ...fresh.map((b) => b.path)]);
    const active =
      (unique[0] && opened.has(unique[0]) ? unique[0] : undefined) ??
      fresh[0]?.path ??
      get().activePath;

    set((s) => ({
      buffers: [...s.buffers, ...fresh],
      activePath: active,
      notice: fresh[0]
        ? {
            text:
              fresh[0].kind === "text"
                ? `已打开 ${fresh[0].name} · encoding=${fresh[0].encoding} · eol=${fresh[0].eol}`
                : `已打开 ${fresh[0].name}（预览）`,
            kind: "ok",
          }
        : s.notice,
    }));
  },

  setActive: (path) => {
    if (get().buffers.some((b) => b.path === path)) set({ activePath: path });
  },

  closeBuffer: async (path, force) => {
    const buf = get().buffers.find((b) => b.path === path);
    if (!buf) return false;
    if (!force && buf.content !== buf.savedContent) {
      const ok = await confirm(
        `「${buf.name}」有未保存的修改，确定关闭？\n关闭后这些修改将丢失。`,
        { title: "关闭未保存文件", kind: "warning", okLabel: "关闭", cancelLabel: "取消" },
      );
      if (!ok) return false;
    }
    set((s) => {
      const idx = s.buffers.findIndex((b) => b.path === path);
      const buffers = s.buffers.filter((b) => b.path !== path);
      let activePath = s.activePath;
      if (s.activePath === path) {
        activePath = buffers.length
          ? buffers[Math.min(idx, buffers.length - 1)]!.path
          : null;
      }
      return { buffers, activePath };
    });
    return true;
  },

  updateContent: (path, content) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.path === path ? { ...b, content } : b)),
    }));
  },

  saveBuffer: async (path, options) => {
    const silent = !!options?.silent;
    const buf = get().buffers.find((b) => b.path === path);
    if (!buf) return false;
    // 查看器缓冲（图片/PDF）不可保存：避免把二进制当文本写盘、避免 Ctrl+S 副作用
    if (buf.kind !== "text") return false;
    // 自动保存与手动保存并发时直接跳过（写的是同一快照，残余脏状态由两者之一收尾）
    if (savingPaths.has(path)) return false;
    savingPaths.add(path);
    const written = buf.content;
    try {
      await projectApi.writeFile(path, written);
      const d = await projectApi.readFile(path); // 回读校验往返
      const intact = d.content === written || d.content === written.replace(/\n/g, "\r\n");
      set((s) => ({
        buffers: s.buffers.map((b) =>
          b.path === path
            ? { ...b, savedContent: written, encoding: d.encoding, eol: d.eol }
            : b,
        ),
        // 静默模式（自动保存）成功不弹 toast；往返有差异仅在手动保存时提示
        notice: silent
          ? s.notice
          : {
              text: `已保存 ${buf.name} · encoding=${d.encoding} · eol=${d.eol} · 往返${
                intact ? "无损" : "内容有差异"
              }`,
              kind: intact ? "ok" : "err",
            },
      }));
      // 手动保存 .tex 成功后，按设置触发自动编译（自动保存 silent=true 不触发）
      if (!silent && path.toLowerCase().endsWith(".tex")) {
        scheduleCompileOnSave();
      }
      return true;
    } catch (e) {
      set({ notice: { text: `保存失败 ${buf.name}：${String(e)}`, kind: "err" } });
      return false;
    } finally {
      savingPaths.delete(path);
    }
  },

  saveAllBuffers: async () => {
    const dirty = get().buffers.filter((b) => b.kind === "text" && b.content !== b.savedContent);
    for (const b of dirty) {
      await get().saveBuffer(b.path);
    }
    if (dirty.length > 0) {
      set({ notice: { text: `已保存全部 ${dirty.length} 个文件`, kind: "ok" } });
    }
    return dirty.length;
  },

  // M0-14a · 自动保存：静默写全部脏缓冲；「保存未成功且仍脏且无其他保存接手」才算失败，汇总一条 toast
  autosaveDirty: async () => {
    const dirty = get().buffers.filter((b) => b.kind === "text" && b.content !== b.savedContent);
    const failed: string[] = [];
    for (const b of dirty) {
      const ok = await get().saveBuffer(b.path, { silent: true });
      const buf = get().buffers.find((x) => x.path === b.path);
      if (!ok && buf && buf.content !== buf.savedContent && !savingPaths.has(b.path)) {
        failed.push(buf.name);
      }
    }
    if (dirty.length > 0 && failed.length > 0) {
      set({ notice: { text: `自动保存失败：${failed.join("、")}`, kind: "err" } });
    }
    return failed.length === 0;
  },

  markMounted: (path) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.path === path ? { ...b, mounted: true } : b)),
    }));
  },

  clearNotice: () => set({ notice: null }),

  setCursor: (pos) => set({ cursor: pos }),

  setExternalChanged: (path, val) => {
    set((s) => ({
      buffers: s.buffers.map((b) =>
        b.path === path && !!b.externallyChanged !== val
          ? { ...b, externallyChanged: val }
          : b,
      ),
    }));
  },

  revertBuffer: async (path) => {
    const buf = get().buffers.find((b) => b.path === path);
    if (!buf || buf.kind !== "text") return false;
    try {
      const d = await projectApi.revertFile(path);
      set((s) => ({
        buffers: s.buffers.map((b) =>
          b.path === path
            ? {
                ...b,
                content: d.content,
                savedContent: d.content,
                encoding: d.encoding,
                eol: d.eol,
                externallyChanged: false,
              }
            : b,
        ),
      }));
      return true;
    } catch (e) {
      set({ notice: { text: `重新加载失败 ${buf.name}：${String(e)}`, kind: "err" } });
      return false;
    }
  },

  dismissExternal: (path) => {
    set((s) => ({
      buffers: s.buffers.map((b) =>
        b.path === path && b.externallyChanged ? { ...b, externallyChanged: false } : b,
      ),
    }));
  },

  isDirty: (path) => {
    const b = get().buffers.find((x) => x.path === path);
    return !!b && b.content !== b.savedContent;
  },

  dirtyCount: () => get().buffers.filter((b) => b.content !== b.savedContent).length,
}));

/** 便捷选择器（组件内用） */
export const selectActive = (s: BuffersState): EditorBuffer | null =>
  s.buffers.find((b) => b.path === s.activePath) ?? null;
