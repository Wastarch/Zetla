// M0-6 · 项目域 store（zustand）—— 见 docs/开发计划.md M0-6
// 职责：打开/刷新项目、树展开与选中、右键菜单与新建/重命名/删除、资源管理器定位
// 反馈复用编辑域 toast（EditorWorkspace 渲染 useBuffersStore.notice）
import { create } from "zustand";
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { projectApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import type { EntryKind, ProjectNode, ProjectTree } from "@/types";

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

/** 树剪贴板（会话级内存，不进系统剪贴板、不持久化） */
export interface Clip {
  mode: "copy" | "cut";
  paths: string[];
}

/** 在树节点中递归查找（键盘粘贴需要判断选中是文件还是目录） */
export function findNode(
  nodes: ProjectNode[] | undefined,
  path: string,
): ProjectNode | null {
  if (!nodes) return null;
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.type === "dir" && n.children) {
      const hit = findNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

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
  /** 树剪贴板（复制/剪切，会话级） */
  clip: Clip | null;
  /** M0-7：从模板新建向导 */
  wizardOpen: boolean;
  /** 向导目标目录默认值（右键目录进入时指定） */
  wizardDir: string | null;

  openProjectDialog: () => Promise<void>;
  openProject: (root: string) => Promise<void>;
  /** silent=true 时失败不弹 toast（M0-9a 监听触发的刷新用） */
  refresh: (silent?: boolean) => Promise<void>;
  toggleDir: (path: string) => void;
  /** 全部折叠（资源管理器头部「全部折叠」按钮） */
  collapseAll: () => void;
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

  /** 复制到剪贴板（粘贴时用 copy_entry 实际复制） */
  copyPaths: (paths: string[]) => void;
  /** 剪切到剪贴板（粘贴时用 rename_entry 移动） */
  cutPaths: (paths: string[]) => void;
  /** 粘贴到目标目录（冲突报错中止；剪切成功后清空剪贴板） */
  pasteInto: (targetDir: string) => Promise<void>;

  /** 打开/关闭「从模板新建」向导（dir 缺省用项目根） */
  openWizard: (dir?: string) => void;
  closeWizard: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  root: null,
  tree: null,
  selected: null,
  openDirs: new Set<string>(),
  ctx: null,
  entryDialog: null,
  clip: null,
  wizardOpen: false,
  wizardDir: null,

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
        // 根行作为树的第一层节点，默认展开
        openDirs: new Set<string>([root]),
        ctx: null,
      });
      notify(
        `已打开项目 · ${tree.nodes.length} 个条目${
          tree.mainFile ? ` · 主文件 ${base(tree.mainFile)}` : " · 未识别主文件"
        }`,
        "ok",
      );
      // M0-10：换项目后旧 PDF 不再有效，清空预览
      useAppStore.setState({ previewPdf: null, previewRev: 0, lastResult: null });
      // M0-9a：监听项目目录（失败不阻断打开项目，手动「刷新」仍可用）
      void projectApi.watchProject(root).catch((e) => {
        console.warn("[watch_project]", e);
      });
    } catch (e) {
      notify(String(e), "err");
    }
  },

  refresh: async (silent = false) => {
    const root = get().root;
    if (!root) return;
    try {
      const tree = await projectApi.scanProject(root);
      set({ tree }); // 保留 selected / openDirs
    } catch (e) {
      if (silent) console.warn("[refresh]", e);
      else notify(String(e), "err");
    }
  },

  toggleDir: (path) =>
    set((s) => {
      const next = new Set(s.openDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { openDirs: next };
    }),

  // 全部折叠：只折叠根以下目录，根行保持展开；根行被收起时点它会先展开根行
  collapseAll: () => set((s) => ({ openDirs: s.root ? new Set<string>([s.root]) : new Set<string>() })),

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

  copyPaths: (paths) => {
    if (paths.length === 0) return;
    set({ clip: { mode: "copy", paths }, ctx: null });
    notify(`已复制 ${paths.length} 项 · 右键目标处粘贴`, "ok");
  },

  cutPaths: (paths) => {
    if (paths.length === 0) return;
    set({ clip: { mode: "cut", paths }, ctx: null });
    notify(`已剪切 ${paths.length} 项 · 右键目标处粘贴`, "ok");
  },

  pasteInto: async (targetDir) => {
    const clip = get().clip;
    if (!clip || clip.paths.length === 0) {
      notify("剪贴板为空", "err");
      return;
    }
    // 防呆：目录不能粘贴到自身或其子目录
    for (const src of clip.paths) {
      if (
        targetDir === src ||
        targetDir.startsWith(src + "/") ||
        targetDir.startsWith(src + "\\")
      ) {
        notify(`不能粘贴到「${base(src)}」自身或其子目录`, "err");
        return;
      }
    }
    const created: string[] = [];
    for (const src of clip.paths) {
      const dst = joinPath(targetDir, base(src));
      try {
        if (clip.mode === "copy") await projectApi.copyEntry(src, dst);
        else await projectApi.renameEntry(src, dst);
        created.push(dst);
      } catch (e) {
        // 冲突/失败：中止后续（已完成的保留）
        notify(`粘贴失败 ${base(src)}：${String(e)}`, "err");
        break;
      }
    }
    set((s) => ({
      ctx: null,
      clip: clip.mode === "cut" ? null : s.clip,
      selected: created[created.length - 1] ?? s.selected,
    }));
    await get().refresh();
    if (created.length > 0) {
      notify(
        clip.mode === "copy"
          ? `已复制 ${created.length} 项到 ${base(targetDir)}`
          : `已移动 ${created.length} 项到 ${base(targetDir)}`,
        "ok",
      );
    }
  },

  openWizard: (dir) => set({ wizardOpen: true, wizardDir: dir ?? get().root ?? null }),
  closeWizard: () => set({ wizardOpen: false, wizardDir: null }),
}));
