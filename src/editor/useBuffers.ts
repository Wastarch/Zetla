// M0-5 · 缓冲区管理（多文件标签页）—— 见 docs/开发计划.md M0-5
// 职责：打开/关闭/切换缓冲、脏状态、保存（写盘+回读校验）
// 说明：编辑器实例状态（撤销栈/光标/滚动）由 EditorWorkspace 的多实例方案（A）持有，
//       本 store 只存「文档数据」；M0-11 错误定位通过 openFiles + setActive 复用。
import { create } from "zustand";
import { confirm } from "@tauri-apps/plugin-dialog";
import { projectApi } from "@/ipc/invoke";
import type { FileDoc } from "@/types";

/** 一个打开的文档（标签页） */
export interface EditorBuffer {
  /** 绝对路径（唯一键） */
  path: string;
  /** 标签显示名（文件名） */
  name: string;
  /** 当前编辑内容 */
  content: string;
  /** 上次保存的内容（脏 = content !== savedContent） */
  savedContent: string;
  /** 打开/保存后回读的编码，"utf-8" | "gbk" | ... */
  encoding: string;
  /** 换行符 */
  eol: "lf" | "crlf";
  /** 是否已挂载 CM 实例（首次激活后为 true，切走只隐藏不卸载） */
  mounted: boolean;
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

interface BuffersState {
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
  /** 保存指定缓冲：write_file → 回读校验 → markSaved */
  saveBuffer: (path: string) => Promise<void>;
  /** 保存全部脏缓冲（侧栏/菜单栏共用）；返回保存个数 */
  saveAllBuffers: () => Promise<number>;
  /** 脏缓冲数量（退出确认等用） */
  dirtyCount: () => number;
  /** 首次激活后标记已挂载 */
  markMounted: (path: string) => void;
  clearNotice: () => void;
  /** 更新光标位置（状态栏行/列展示） */
  setCursor: (pos: CursorPos) => void;
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
        const d: FileDoc = await projectApi.readFile(p);
        fresh.push({
          path: p,
          name: basename(p),
          content: d.content,
          savedContent: d.content,
          encoding: d.encoding,
          eol: d.eol,
          mounted: false,
        });
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
            text: `已打开 ${fresh[0].name} · encoding=${fresh[0].encoding} · eol=${fresh[0].eol}`,
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

  saveBuffer: async (path) => {
    const buf = get().buffers.find((b) => b.path === path);
    if (!buf) return;
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
        notice: {
          text: `已保存 ${buf.name} · encoding=${d.encoding} · eol=${d.eol} · 往返${
            intact ? "无损" : "内容有差异"
          }`,
          kind: intact ? "ok" : "err",
        },
      }));
    } catch (e) {
      set({ notice: { text: `保存失败 ${buf.name}：${String(e)}`, kind: "err" } });
    }
  },

  saveAllBuffers: async () => {
    const dirty = get().buffers.filter((b) => b.content !== b.savedContent);
    for (const b of dirty) {
      await get().saveBuffer(b.path);
    }
    if (dirty.length > 0) {
      set({ notice: { text: `已保存全部 ${dirty.length} 个文件`, kind: "ok" } });
    }
    return dirty.length;
  },

  markMounted: (path) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.path === path ? { ...b, mounted: true } : b)),
    }));
  },

  clearNotice: () => set({ notice: null }),

  setCursor: (pos) => set({ cursor: pos }),

  isDirty: (path) => {
    const b = get().buffers.find((x) => x.path === path);
    return !!b && b.content !== b.savedContent;
  },

  dirtyCount: () => get().buffers.filter((b) => b.content !== b.savedContent).length,
}));

/** 便捷选择器（组件内用） */
export const selectActive = (s: BuffersState): EditorBuffer | null =>
  s.buffers.find((b) => b.path === s.activePath) ?? null;
