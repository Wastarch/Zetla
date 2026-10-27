// M0-6 · 项目域 store（zustand）—— 见 docs/开发计划.md M0-6
// 职责：打开/刷新项目、树展开与选中、右键菜单与新建/重命名/删除、资源管理器定位
// 反馈复用编辑域 toast（EditorWorkspace 渲染 useBuffersStore.notice）
import { create } from "zustand";
import { confirm, open as openFileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { configApi, projectApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
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

/** M1-15d：项目生命周期动作（自建确认/输入对话框；不用 prompt） */
export type ProjectAction =
  | { kind: "rename"; path: string; name: string }
  | { kind: "delete"; path: string; name: string };

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

/** 主文件同目录的编译产物（与 compile.rs 当前输出位置一致） */
export function expectedPdfPath(mainFile: string): string {
  const stem = base(mainFile).replace(/\.tex$/i, "");
  return joinPath(parentOf(mainFile), `${stem}.pdf`);
}

/** 在树中按路径查找文件（Windows 路径不区分大小写，用实际大小写返回） */
function findFileByPath(nodes: ProjectNode[], path: string): ProjectNode | null {
  const want = path.toLowerCase();
  for (const n of nodes) {
    if (n.type === "file" && n.path.toLowerCase() === want) return n;
    if (n.children) {
      const hit = findFileByPath(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
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
  /** R5：项目设置对话框（图片目录等） */
  projectSettingsOpen: boolean;
  /** M1-15a：启动恢复上次项目进行中（欢迎页据此延后显示，避免闪现） */
  restoring: boolean;
  /** M1-15b：项目切换器（Ctrl+R / 文件→切换项目） */
  switcherOpen: boolean;
  openSwitcher: () => void;
  closeSwitcher: () => void;

  /** M1-15d：项目生命周期（重命名/删除）确认对话框 */
  projectAction: ProjectAction | null;
  openProjectAction: (a: ProjectAction) => void;
  closeProjectAction: () => void;
  /** M1-15d：重命名项目目录（拒绝活动 root）；成功后同步注册表 */
  renameProject: (path: string, newName: string) => Promise<void>;
  /** M1-15d：删除项目目录（拒绝活动 root）；成功后同步注册表 */
  deleteProject: (path: string) => Promise<void>;
  /** M1-15d：导出项目为 zip（保存对话框 + 排除 aux） */
  exportProject: (path: string) => Promise<void>;

  openProjectDialog: () => Promise<void>;
  openProject: (root: string) => Promise<void>;
  /** M1-15a：关闭当前项目（关闭其下缓冲；脏文件取消则中止），回到欢迎页 */
  closeProject: () => Promise<void>;
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
  /** R5：打开/关闭项目设置对话框 */
  openProjectSettings: () => void;
  closeProjectSettings: () => void;
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
  projectSettingsOpen: false,
  restoring: false,
  switcherOpen: false,
  projectAction: null,

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
      // M0-12：切换项目时关掉上一个项目打开的文件（非强制：脏文件弹关闭确认，取消则该文件保留）
      const oldRoot = get().root;
      if (oldRoot && oldRoot !== root) {
        const toClose = useBuffersStore
          .getState()
          .buffers.filter(
            (b) =>
              b.path.startsWith(`${oldRoot}\\`) || b.path.startsWith(`${oldRoot}/`),
          )
          .map((b) => b.path);
        for (const p of toClose) {
          await useBuffersStore.getState().closeBuffer(p);
        }
      }
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
      // M0-10/M0-12：换项目后旧 PDF 与上次编译结果/状态都不再有效，一并清空
      useAppStore.setState({
        previewPdf: null,
        previewRev: 0,
        lastResult: null,
        compileStatus: "idle",
        compilePct: 0,
        compileCurrent: "",
      });
      useAppStore.getState().clearLog();
      // M0-10b：主文件同目录已有编译产物时直接加载，不必先编译（不强制展开预览栏）
      if (tree.mainFile) {
        const existing = findFileByPath(tree.nodes, expectedPdfPath(tree.mainFile));
        if (existing) {
          useAppStore.setState((s) => ({
            previewPdf: existing.path,
            previewRev: s.previewRev + 1,
          }));
        }
      }
      // M0-9a：监听项目目录（失败不阻断打开项目，手动「刷新」仍可用）
      void projectApi.watchProject(root).catch((e) => {
        console.warn("[watch_project]", e);
      });
      // M1-15a：写回最近项目注册表（upsert；失败不阻断打开，仅记录）
      void configApi
        .registerRecentProject(root)
        .then((list) => useSettingsStore.getState().setRecentProjects(list))
        .catch((e) => console.warn("[register_recent_project]", e));
    } catch (e) {
      notify(String(e), "err");
    }
  },

  closeProject: async () => {
    const root = get().root;
    if (!root) return;
    const isUnder = (p: string) =>
      p.startsWith(`${root}\\`) || p.startsWith(`${root}/`);
    // 关闭属于当前项目的缓冲（脏文件弹关闭确认；取消则该文件保留）
    const toClose = useBuffersStore
      .getState()
      .buffers.filter((b) => isUnder(b.path))
      .map((b) => b.path);
    for (const p of toClose) {
      await useBuffersStore.getState().closeBuffer(p);
    }
    // 仍有属于该项目的缓冲（用户取消了关闭确认）→ 中止关闭项目
    if (useBuffersStore.getState().buffers.some((b) => isUnder(b.path))) return;
    void projectApi.unwatchProject().catch((e) => {
      console.warn("[unwatch_project]", e);
    });
    set({
      root: null,
      tree: null,
      selected: null,
      openDirs: new Set<string>(),
      ctx: null,
      entryDialog: null,
      clip: null,
    });
    // 项目关闭后旧的 PDF / 编译结果 / 日志都不再有效
    useAppStore.setState({
      previewPdf: null,
      previewRev: 0,
      lastResult: null,
      compileStatus: "idle",
      compilePct: 0,
      compileCurrent: "",
    });
    useAppStore.getState().clearLog();
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
    // 一律进代码标签页：openFiles 内部按扩展名分流为文本 / 图片查看器 / PDF 查看器。
    // 右侧 PDF 预览仅由编译完成（compile_finished → showPdf）自动弹出，
    // 用户手动打开的文件（含 LaTeX 编译产物）不抢占右侧预览。
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

  openProjectSettings: () => set({ projectSettingsOpen: true }),
  closeProjectSettings: () => set({ projectSettingsOpen: false }),

  // M1-15b：项目切换器（命令面板式浮层；Ctrl+R / 文件→切换项目）
  openSwitcher: () => set({ switcherOpen: true, ctx: null }),
  closeSwitcher: () => set({ switcherOpen: false }),

  // ── M1-15d：项目生命周期（重命名 / 删除 / 导出） ──
  openProjectAction: (a) => set({ projectAction: a, ctx: null, switcherOpen: false }),
  closeProjectAction: () => set({ projectAction: null }),

  renameProject: async (path, newName) => {
    try {
      const list = await projectApi.renameProject(path, newName, get().root);
      useSettingsStore.getState().setRecentProjects(list);
      set({ projectAction: null });
      notify(`已重命名为 ${newName.trim()}`, "ok");
    } catch (e) {
      notify(String(e), "err");
    }
  },

  deleteProject: async (path) => {
    try {
      const list = await projectApi.deleteProject(path, get().root);
      useSettingsStore.getState().setRecentProjects(list);
      set({ projectAction: null });
      notify("已删除项目", "ok");
    } catch (e) {
      notify(String(e), "err");
    }
  },

  exportProject: async (path) => {
    try {
      // 默认导出到项目同级目录：<项目>.zip
      const basePath = path.replace(/[\\/]+$/, "");
      const dest = await saveDialog({
        defaultPath: `${basePath}.zip`,
        filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
      });
      if (typeof dest !== "string" || !dest) return; // 用户取消
      const n = await projectApi.exportProject(path, dest);
      notify(`已导出 ${n} 个文件到 ${dest}`, "ok");
    } catch (e) {
      notify(String(e), "err");
    }
  },
}));
