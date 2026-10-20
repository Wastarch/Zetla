// M0-6 · 项目域 store（zustand）—— 见 docs/开发计划.md M0-6
// 职责：打开/刷新项目、树展开与选中、右键菜单与新建/重命名/删除、资源管理器定位
// 反馈复用编辑域 toast（EditorWorkspace 渲染 useBuffersStore.notice）
import { create } from "zustand";
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { projectApi } from "@/ipc/invoke";
import { useBuffersStore } from "@/editor/useBuffers";
import type { EntryKind, ProjectTree } from "@/types";

/** 统一 toast 反馈（写入编辑域 notice） */
export function notify(text: string, kind: "ok" | "err" = "ok"): void {
  useBuffersStore.setState({ notice: { text, kind } });
}

export interface CtxState {
  x: number;
  y: number;
  kind: "file" | "dir" | "blank";
  /** 文件/目录绝对路径；blank 时为项目根 */
  path: string | null;
}

export type EntryDialog =
  | { mode: "create"; kind: "tex" | "dir"; dir: string; initial: string }
  | { mode: "rename"; from: string; initial: string };

export function base(p: string): string {
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] || p;
}

/** 图片扩展名（PDF/图片 → 查看器，MVP 未实现，仅提示） */
export const EXT_IMG = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "eps", "tif", "tiff", "avif",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function parentOf(p: string): string {
  return p.replace(/[\\/][^\\/]+$/, "");
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) || dir.endsWith("/") ? dir + name : dir + sep + name;
}

/** Windows 文件名合法性（名称级校验，路径级由 Rust 兜底） */
function validateName(name: string): string | null {
  if (name === "") return "名称不能为空";
  if (name === "." || name === "..") return "名称不合法";
  if (/[\\/:*?"<>|]/.test(name)) return '名称不能包含 \\ / : * ? " < > |';
  if (/[. ]$/.test(name)) return "名称不能以空格或点结尾";
  return null;
}

interface ProjectState {
  root: string | null;
  tree: ProjectTree | null;
  selected: string | null;
  /** 展开的目录（Set） */
  openDirs: Set<string>;
  ctx: CtxState | null;
  entryDialog: EntryDialog | null;

  openProjectDialog: () => Promise<void>;
  openProject: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  toggleDir: (path: string) => void;
  select: (path: string) => void;

  openCtx: (ctx: CtxState) => void;
  closeCtx: () => void;
  openEntryDialog: (d: EntryDialog) => void;
  closeEntryDialog: () => void;

  /** 树/右键点击文件：tex 系打开到标签，PDF/图片给出查看器提示 */
  openFromTree: (path: string) => void;
  createEntry: (dir: string, kind: EntryKind, name: string) => Promise<void>;
  renameEntry: (from: string, name: string) => Promise<void>;
  removeEntry: (path: string) => Promise<void>;
  revealInExplorer: (path: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  root: null,
  tree: null,
  selected: null,
  openDirs: new Set<string>(),
  ctx: null,
  entryDialog: null,

  openProjectDialog: async () => {
    try {
      const picked = await openFileDialog({
        directory: true,
        multiple: false,
        title: "打开项目文件夹",
      });
      if (typeof picked !== "string") return; // 取消
      await get().openProject(picked);
    } catch (e) {
      notify(String(e), "err");
    }
  },

  openProject: async (root) => {
    try {
      const tree = await projectApi.scanProject(root);
      set({
        root,
        tree,
        selected: tree.mainFile || null,
        openDirs: new Set<string>(),
        ctx: null,
      });
      notify(
        `已打开项目 · ${tree.nodes.length} 个条目${
          tree.mainFile ? ` · 主文件 ${base(tree.mainFile)}` : " · 未识别主文件"
        }`,
        "ok",
      );
    } catch (e) {
      notify(String(e), "err");
    }
  },

  refresh: async () => {
    const root = get().root;
    if (!root) return;
    try {
      const tree = await projectApi.scanProject(root);
      set({ tree }); // 保留 selected / openDirs
    } catch (e) {
      notify(String(e), "err");
    }
  },

  toggleDir: (path) =>
    set((s) => {
      const next = new Set(s.openDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { openDirs: next };
    }),

  select: (path) => set({ selected: path }),

  openCtx: (ctx) => set({ ctx, selected: ctx.path ?? get().selected }),
  closeCtx: () => set({ ctx: null }),
  openEntryDialog: (d) => set({ entryDialog: d, ctx: null }),
  closeEntryDialog: () => set({ entryDialog: null }),

  openFromTree: (path) => {
    set({ selected: path, ctx: null });
    const ext = extOf(path);
    if (ext === "pdf" || EXT_IMG.has(ext)) {
      notify(`${base(path)} 将由 PDF/图片查看器打开（MVP 未实现）`, "err");
      return;
    }
    void useBuffersStore.getState().openFiles([path]);
  },

  createEntry: async (dir, kind, name) => {
    const clean = name.trim();
    const bad = validateName(clean);
    if (bad) {
      notify(bad, "err");
      return;
    }
    try {
      const created = await projectApi.createEntry(joinPath(dir, clean), kind);
      set({ entryDialog: null });
      await get().refresh();
      if (kind === "tex") {
        // 新建文档直接打开到标签
        await useBuffersStore.getState().openFiles([created]);
      }
      set({ selected: created });
      notify(`已新建 ${base(created)}`, "ok");
    } catch (e) {
      notify(String(e), "err");
    }
  },

  renameEntry: async (from, name) => {
    const clean = name.trim();
    const bad = validateName(clean);
    if (bad) {
      notify(bad, "err");
      return;
    }
    try {
      const to = joinPath(parentOf(from), clean);
      const newPath = await projectApi.renameEntry(from, to);
      set({ entryDialog: null, selected: newPath });
      // 同步已打开缓冲的 path/name（撤销栈与内容保持不变）
      const buf = useBuffersStore.getState().buffers.find((b) => b.path === from);
      if (buf) {
        useBuffersStore.setState((s) => ({
          buffers: s.buffers.map((b) =>
            b.path === from ? { ...b, path: newPath, name: base(newPath) } : b,
          ),
          activePath: s.activePath === from ? newPath : s.activePath,
        }));
      }
      await get().refresh();
      notify(`已重命名为 ${base(newPath)}`, "ok");
    } catch (e) {
      notify(String(e), "err");
    }
  },

  removeEntry: async (path) => {
    const name = base(path);
    try {
      const ok = await confirm(
        `确定删除「${name}」？\n此操作不可撤销（不进回收站）。`,
        { title: "删除", kind: "warning", okLabel: "删除", cancelLabel: "取消" },
      );
      if (!ok) {
        set({ ctx: null });
        return;
      }
      await projectApi.removeEntry(path);
      set((s) => ({
        ctx: null,
        selected: s.selected === path ? null : s.selected,
      }));
      // 关闭受影响缓冲（被删文件本身及其子路径）
      const bs = useBuffersStore.getState();
      const affected = bs.buffers
        .filter((b) => b.path === path || b.path.startsWith(path + "/") || b.path.startsWith(path + "\\"))
        .map((b) => b.path);
      for (const p of affected) {
        await useBuffersStore.getState().closeBuffer(p, true);
      }
      await get().refresh();
      notify(`已删除 ${name}`, "ok");
    } catch (e) {
      notify(String(e), "err");
    }
  },

  revealInExplorer: async (path) => {
    try {
      await revealItemInDir(path);
      set({ ctx: null });
    } catch (e) {
      notify(String(e), "err");
    }
  },
}));
