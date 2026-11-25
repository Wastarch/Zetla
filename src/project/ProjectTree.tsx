// M0-6 · 项目树（对齐 docs/UI/UI.html renderTree）
// 目录展开/文件选中/主文件 badge/缓冲脏点/右键菜单入口
// 补充：Ctrl+C/X/V 复制剪切粘贴、剪切项置灰
// M0-13 前移：树首行改为「根目录行」（资源管理器头部的图标组移入该行，始终显示）
// M1-26：树内拖拽条目到目录（移动；Ctrl / macOS Option 拖拽复制），指针事件实现
// M1-38：根目录图标组加「显示隐藏文件」眼睛开关（点号项，.git/重型目录始终跳过）
// M1-40：多选（系统原生语义）——普通点击单选、Ctrl+点击加减选、Shift+点击范围选、
//        Ctrl+A 全选、Esc 清空、Delete 批量删除；右键/复制/剪切/删除/拖拽均作用于多选集合
// M1-48（外部文件互操作）：Ctrl+V 可粘贴**在系统里复制/剪切**的文件（Rust 读系统剪贴板 CF_HDROP），
//        系统文件可直接拖进树（Tauri 窗口级 drag-drop，落点由视口坐标命中树行）
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { Icon } from "@/ui/Icon";
import { useSettingsStore } from "@/core/settings";
import { useBuffersStore } from "@/editor/useBuffers";
import type { ProjectNode } from "@/types";
import { EXT_IMG, base, extOf, findNode, parentOf, useProjectStore } from "./useProject";
import {
  dropHoverProblem,
  filterTopLevel,
  rangeSelect,
  resolveDropDir,
  type TreeDropHit,
} from "./treeDrop";
import { createDragGhost, type DragGhost } from "@/ui/dragGhost";

/** 拖拽复制修饰键文案（macOS 用 Option，其余平台用 Ctrl） */
function macModifierLabel(): string {
  return typeof document !== "undefined" &&
    document.documentElement.dataset.platform === "darwin"
    ? "Option"
    : "Ctrl";
}

function iconFor(name: string): { icon: string; cls: string } {
  const ext = extOf(name);
  if (EXT_IMG.has(ext)) return { icon: "image", cls: "file-img" };
  if (ext === "pdf") return { icon: "pdf", cls: "file-pdf" };
  if (ext === "bib") return { icon: "bib", cls: "file-bib" };
  if (["tex", "cls", "sty", "ltx"].includes(ext)) return { icon: "tex", cls: "file-tex" };
  return { icon: "file", cls: "" };
}

/** Tauri 原生拖放负载（enter/over/drop 带 position；drop 带 paths；position 是物理像素） */
interface DragPayload {
  paths?: string[];
  position?: { x: number; y: number };
}

/** 系统拖入可能被 Tauri 与 HTML5 两条通道同时上报：短时间内只消费一次 */
let lastExternalDropAt = 0;
function claimExternalDrop(): boolean {
  const now = Date.now();
  if (now - lastExternalDropAt < 400) return false;
  lastExternalDropAt = now;
  return true;
}

/**
 * dragover 阶段 dataTransfer.files 恒为空，只能用 types 判断是否为文件拖入。
 * Chromium/WebView2 给 "Files"；WKWebView(macOS) 也可能给 "public.file-url" 等 UTI。
 */
function isFileDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types).some((t) => t === "Files" || /file|public\./i.test(t));
}

export function ProjectTree() {
  const root = useProjectStore((s) => s.root);
  const nodes = useProjectStore((s) => s.tree?.nodes);
  const openDirs = useProjectStore((s) => s.openDirs);
  const selectedPaths = useProjectStore((s) => s.selected);
  const toggleDir = useProjectStore((s) => s.toggleDir);
  const collapseAll = useProjectStore((s) => s.collapseAll);
  const openCtx = useProjectStore((s) => s.openCtx);
  const refresh = useProjectStore((s) => s.refresh);
  const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
  const copyPaths = useProjectStore((s) => s.copyPaths);
  const cutPaths = useProjectStore((s) => s.cutPaths);
  const pasteInto = useProjectStore((s) => s.pasteInto);
  const removeEntries = useProjectStore((s) => s.removeEntries);
  const dropEntries = useProjectStore((s) => s.dropEntries);
  const setShowHiddenFiles = useProjectStore((s) => s.setShowHiddenFiles);
  const showHiddenFiles = useSettingsStore((s) => s.settings.layout.showHiddenFiles);
  const clip = useProjectStore((s) => s.clip);
  const buffers = useBuffersStore((s) => s.buffers);
  const treeRef = useRef<HTMLDivElement>(null);

  const dirtyPaths = useMemo(
    () => new Set(buffers.filter((b) => b.content !== b.savedContent).map((b) => b.path)),
    [buffers],
  );

  // ── M1-40 多选 ──
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  /** 树可见行的路径顺序（根行不参与选择；Shift 范围 / Ctrl+A 用） */
  const visiblePaths = useMemo(() => {
    const out: string[] = [];
    const walk = (list: ProjectNode[]) => {
      for (const n of list) {
        out.push(n.path);
        if (n.type === "dir" && openDirs.has(n.path) && n.children) walk(n.children);
      }
    };
    if (nodes) walk(nodes);
    return out;
  }, [nodes, openDirs]);

  /** 多选行点击（系统原生语义） */
  function handleRowClick(e: React.MouseEvent, path: string, kind: "file" | "dir") {
    if (suppressClick.current) return;
    const st = useProjectStore.getState();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+点击：加减选；不打开文件、不展开目录
      st.toggleSelect(path);
      return;
    }
    if (e.shiftKey) {
      // Shift+点击：从锚点（最后一次单选）到目标行的闭区间；锚点不动
      const anchor = st.anchor ?? path;
      st.setSelection(rangeSelect(visiblePaths, anchor, path) ?? [path], anchor);
      return;
    }
    // 普通点击：单选；文件打开到标签、目录展开/折叠
    if (kind === "file") {
      st.openFromTree(path); // 内部置单选
    } else {
      st.setSelection([path], path);
      st.toggleDir(path);
    }
  }

  // ── M1-26 拖拽：pointer 事件（Tauri Windows 的 HTML5 拖放会被原生文件拖入拦截） ──
  const [dragSrcs, setDragSrcs] = useState<string[]>([]);
  const [hover, setHover] = useState<{ targetDir: string; valid: boolean } | null>(null);
  const suppressClick = useRef(false);

  /** 当前指针下的树行（根节点/子行都带 data-tree-*；空白区返回 null → 项目根） */
  const hitAt = (x: number, y: number): TreeDropHit | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tree-path]");
    const path = el?.dataset.treePath;
    if (!path) return null;
    const kind = el?.dataset.treeKind;
    return {
      path,
      kind: kind === "dir" || kind === "file" ? kind : "blank",
    };
  };

  const startDrag = (e: ReactPointerEvent<HTMLElement>, srcs: string[]) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    // currentTarget 在 React 合成事件返回后会清空，同步保存供阈值触发时克隆
    const srcEl = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let copy = false;
    let active = false;
    let edgeY = 0;
    let raf = 0;
    let ghost: DragGhost | null = null;
    const rootDir = root ?? "";
    const mac = document.documentElement.dataset.platform === "darwin";

    const updateHover = (x: number, y: number) => {
      const hit = hitAt(x, y);
      const targetDir = resolveDropDir(hit, rootDir);
      // 多选：只有「目录拖进自身/子目录」非法；原地移动的项由 dropEntries 逐项跳过
      const valid = srcs.every((s) => {
        const isDir = findNode(nodes, s)?.type === "dir";
        return !dropHoverProblem(s, targetDir, isDir);
      });
      setHover({ targetDir, valid });
    };

    const autoScroll = () => {
      if (edgeY !== 0 && treeRef.current) {
        treeRef.current.scrollTop += edgeY * 10;
        updateHover(lastX, lastY);
      }
      if (active) raf = requestAnimationFrame(autoScroll);
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
        active = true;
        // 过了阈值才造影像：点击时不会出现一闪而过的幽灵；多项拖拽带计数徽标
        ghost = createDragGhost(srcEl, ev.clientX, ev.clientY, srcs.length);
        setDragSrcs(srcs);
        raf = requestAnimationFrame(autoScroll);
      }
      lastX = ev.clientX;
      lastY = ev.clientY;
      copy = mac ? ev.altKey : ev.ctrlKey;
      // 复制拖拽显示 ＋ 角标；影像跟随指针（源行仍半透明，落点仍由 hover 描边）
      ghost?.setCopy(copy);
      ghost?.move(ev.clientX, ev.clientY);
      ev.preventDefault();
      updateHover(lastX, lastY);
      const box = treeRef.current?.getBoundingClientRect();
      if (box) {
        edgeY = lastY < box.top + 24 ? -1 : lastY > box.bottom - 24 ? 1 : 0;
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      active = false;
      edgeY = 0;
      cancelAnimationFrame(raf);
      ghost?.hide();
      ghost = null;
      setDragSrcs([]);
      setHover(null);
    };
    const onUp = (ev: PointerEvent) => {
      if (active) {
        const hit = hitAt(ev.clientX, ev.clientY);
        const targetDir = resolveDropDir(hit, rootDir);
        void dropEntries(srcs, targetDir, copy ? "copy" : "move");
        // 拖拽尾随的 click 不应再触发打开/展开
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
      }
      cleanup();
    };
    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  /** M1-40：拖拽入口。按在未选中项上 → 只拖它；按在已选多项之一 → 拖整组（顶层去重）。
   *  注意：无修饰键按下未选中项才「立即改选」；带 Ctrl/Shift 时必须不动选择态，
   *  否则 pointerdown 先选中、click 再 toggle/范围会互相抵消（Ctrl 加选变成空选、
   *  Shift 范围锚点被改成目标自身）。 */
  const beginDrag = (e: ReactPointerEvent<HTMLElement>, path: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const st = useProjectStore.getState();
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !st.selected.includes(path)) {
      st.setSelection([path], path); // 原生语义：按下未选中项即改选
    }
    const srcs =
      st.selected.includes(path) && st.selected.length > 1
        ? filterTopLevel(st.selected)
        : [path];
    startDrag(e, srcs);
  };

  /** 拖拽时的行样式：被拖的源行（整组）半透明；目标目录行高亮（合法 accent / 非法 warn） */
  function dragClass(path: string): string {
    if (dragSrcs.includes(path)) return "is-dragging";
    if (!hover || hover.targetDir !== path) return "";
    return hover.valid ? "drop-ok" : "drop-bad";
  }

  // ── M1-48：系统文件拖入（资源管理器 / 桌面 → 项目树）──
  // Tauri 默认接管窗口级文件拖放（dragDropEnabled 未关闭），webview 内 HTML5 drop 通常收不到，
  // 主通道是 tauri://drag-enter|over|leave|drop；position 是**物理像素**，须 ÷ devicePixelRatio
  // 再比 DOM 坐标（与图拼贴 FigureDropZone 同口径，少数平台已给逻辑像素时用原值兜底）。
  useEffect(() => {
    const treeEl = treeRef.current;
    if (!treeEl) return;
    let disposed = false;
    let unlisten: UnlistenFn[] = [];

    /** 视口坐标命中树行；指针不在树上 → null（不抢别处的拖放） */
    const rowAt = (pos?: { x: number; y: number }): TreeDropHit | null => {
      if (!pos) return null;
      const at = (x: number, y: number): TreeDropHit | null => {
        const el = document.elementFromPoint(x, y);
        if (!el || !treeEl.contains(el)) return null;
        const row = el.closest<HTMLElement>("[data-tree-path]");
        const path = row?.dataset.treePath;
        if (!path) return { path: "", kind: "blank" }; // 树空白区 = 项目根
        const kind = row?.dataset.treeKind;
        return { path, kind: kind === "dir" || kind === "file" ? kind : "blank" };
      };
      const dpr = window.devicePixelRatio || 1;
      return at(pos.x / dpr, pos.y / dpr) ?? at(pos.x, pos.y);
    };

    /** 落点 → 目标目录（空白区=项目根；文件行=其父目录；目录行=自身） */
    const targetAt = (pos?: { x: number; y: number }): string | null => {
      const rootDir = useProjectStore.getState().root;
      if (!rootDir) return null;
      const hit = rowAt(pos);
      return hit ? resolveDropDir(hit, rootDir) : null;
    };

    // over 时缓存落点：少数平台/版本的 drop 事件可能缺 position，用它兜底
    let lastDir: string | null = null;
    const onOver = (e: { payload?: DragPayload }) => {
      const dir = targetAt(e.payload?.position);
      lastDir = dir;
      // over 事件高频触发：落点未变时返回同一 state 对象，React 直接跳过重渲染
      setHover((prev) => {
        if (!dir) return prev === null ? prev : null;
        if (prev && prev.targetDir === dir && prev.valid) return prev;
        return { targetDir: dir, valid: true };
      });
    };
    const onDrop = (e: { payload?: DragPayload }) => {
      const dir = targetAt(e.payload?.position) ?? lastDir;
      const paths = e.payload?.paths ?? [];
      lastDir = null;
      setHover(null);
      // 系统拖入恒为复制（剪切请在资源管理器里 Ctrl+X 后到树里粘贴）
      if (!dir || paths.length === 0 || !claimExternalDrop()) return;
      void useProjectStore.getState().importPaths(paths, dir, "copy");
    };

    void Promise.all([
      listen<DragPayload>(TauriEvent.DRAG_ENTER, onOver),
      listen<DragPayload>(TauriEvent.DRAG_OVER, onOver),
      listen(TauriEvent.DRAG_LEAVE, () => {
        lastDir = null;
        setHover(null);
      }),
      listen<DragPayload>(TauriEvent.DRAG_DROP, onDrop),
    ])
      .then((fns) => {
        if (disposed) fns.forEach((u) => void u());
        else unlisten = fns;
      })
      .catch((e) => console.warn("[tree] 拖放监听注册失败", e));

    return () => {
      disposed = true;
      unlisten.forEach((u) => void u());
    };
  }, []);

  // 窗口重新获得焦点时刷新系统剪贴板探测：用户常在资源管理器里复制后才切回本应用，
  // 右键菜单的「粘贴」可用态要随之变化
  useEffect(() => {
    const onFocus = () => void useProjectStore.getState().probeOsClipboard();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // 键盘操作（树容器获得焦点时）：
  // Ctrl+A 全选可见行 / Ctrl+C 复制 / Ctrl+X 剪切 / Ctrl+V 粘贴 /
  // Delete（macOS 为 Backspace）删除选中 / Esc 清空选择
  function handleKeyDown(e: React.KeyboardEvent) {
    const st = useProjectStore.getState();
    const sel = st.selected;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "a") {
        e.preventDefault();
        st.setSelection([...visiblePaths]);
        return;
      }
      if (k === "c" && sel.length > 0) {
        e.preventDefault();
        copyPaths(sel);
      } else if (k === "x" && sel.length > 0) {
        e.preventDefault();
        cutPaths(sel);
      } else if (k === "v") {
        e.preventDefault();
        // 粘贴目标跟随焦点项（锚点）：目录=自身，文件=父目录，无选中=项目根
        const focus = st.anchor ?? sel[sel.length - 1] ?? null;
        let target: string | null = root ?? null;
        if (focus) {
          const node = findNode(nodes, focus);
          target = node?.type === "dir" ? focus : parentOf(focus) || root;
        }
        // 来源由 pasteInto 判定：系统剪贴板里若有文件（资源管理器复制/剪切）优先，
        // 否则回落到应用内剪贴板；两者都空时才提示
        if (target) void pasteInto(target);
      }
      return;
    }
    // Windows/Linux 用 Delete；macOS 主键盘删除键发 Backspace（Finder 语义），同样触发批量删除
    const mac = document.documentElement.dataset.platform === "darwin";
    if ((e.key === "Delete" || (mac && e.key === "Backspace")) && sel.length > 0) {
      e.preventDefault();
      void removeEntries(sel);
    } else if (e.key === "Escape") {
      st.setSelection([]);
    }
  }

  function isCut(path: string): boolean {
    return clip?.mode === "cut" && clip.paths.includes(path);
  }

  /** 新建条目（VSCode 语义：空文档 / 空目录，模板向导仍走菜单与右键） */
  function createEntry(kind: "file" | "dir", dir: string) {
    useProjectStore
      .getState()
      .openEntryDialog({ mode: "create", kind, dir, initial: "", ext: kind === "file" ? ".tex" : undefined });
    // 目标目录折叠时先展开，否则建完看不见
    if (dir !== root && !openDirs.has(dir)) toggleDir(dir);
  }

  /** M1-47：头部图标新建的目标目录——选中目录=该目录；选中文件=其父目录；无选中/根外=项目根。
   *  多选取 anchor（最后一次普通点击项）。 */
  function newEntryDir(): string {
    const st = useProjectStore.getState();
    const r = st.root;
    if (!r) return ""; // 仅在未打开项目时可空，此时头部按钮不渲染
    const sel = st.anchor ?? st.selected[0];
    if (!sel) return r;
    if (findNode(st.tree?.nodes, sel)?.type === "dir") return sel;
    const parent = parentOf(sel);
    // 须是 root 自身或 root 的直接子路径（防前缀同形目录如 proj2 误判）
    const under =
      !!parent &&
      (parent === r || parent.startsWith(r + "/") || parent.startsWith(r + "\\"));
    return under && parent ? parent : r;
  }

  /** 右键行：若目标不在当前选中集合内 → 改选为它；在集合内（含多选）→ 保持集合 */
  function ctxSelect(kind: "file" | "dir", path: string, x: number, y: number) {
    const st = useProjectStore.getState();
    if (!st.selected.includes(path)) st.setSelection([path], path);
    openCtx({ x, y, kind, path });
  }

  function renderNodes(list: ProjectNode[], depth: number): ReactNode {
    const pad = 8 + depth * 15;
    return list.map((n) => {
      if (n.type === "dir") {
        const open = openDirs.has(n.path);
        const cls = [
          selectedSet.has(n.path) ? "sel" : "",
          open ? "open-dir" : "",
          dragClass(n.path),
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={n.path}>
            <div
              className={cls ? `tnode ${cls}` : "tnode"}
              style={{ paddingLeft: pad, opacity: isCut(n.path) ? 0.55 : undefined }}
              title={`${n.path} · 拖动可移动，按住 ${macModifierLabel()} 拖动可复制`}
              data-tree-path={n.path}
              data-tree-kind="dir"
              onPointerDown={(e) => beginDrag(e, n.path)}
              onClick={(e) => handleRowClick(e, n.path, "dir")}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                ctxSelect("dir", n.path, e.clientX, e.clientY);
              }}
            >
              <Icon name="chev" className="chev" size={12} />
              <Icon name="folder" size={15} />
              <span className="nm">{n.name}</span>
            </div>
            {open && n.children && renderNodes(n.children, depth + 1)}
          </div>
        );
      }
      const { icon, cls } = iconFor(n.name);
      const isSel = selectedSet.has(n.path);
      const rowCls = [isSel ? "sel" : "", "file", dragClass(n.path)]
        .filter(Boolean)
        .join(" ");
      return (
        <div
          key={n.path}
          className={`tnode ${rowCls}`}
          style={{ paddingLeft: pad, opacity: isCut(n.path) ? 0.55 : undefined }}
          title={`${n.path} · 拖动可移动，按住 ${macModifierLabel()} 拖动可复制`}
          data-tree-path={n.path}
          data-tree-kind="file"
          onPointerDown={(e) => beginDrag(e, n.path)}
          onClick={(e) => handleRowClick(e, n.path, "file")}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            ctxSelect("file", n.path, e.clientX, e.clientY);
          }}
        >
          <Icon name={icon} size={15} className={cls} />
          <span className="nm">{n.name}</span>
          {n.isMain ? (
            <span className="badge">主文件</span>
          ) : dirtyPaths.has(n.path) ? (
            <span className="dirt" title="未保存" />
          ) : null}
        </div>
      );
    });
  }

  return (
    <div
      ref={treeRef}
      className="tree"
      data-project-tree="1"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      // HTML5 兜底通道：Tauri 关闭窗口级拖放、或平台仍派发 webview drop 时由此生效
      // （与 Tauri 通道经 claimExternalDrop 去重，路径来自 File.path）
      onDragOver={(e) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault(); // 不 preventDefault 就不会派发 drop
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null);
      }}
      onDrop={(e) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        setHover(null);
        const paths = Array.from(files)
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => typeof p === "string" && p.length > 0);
        if (paths.length === 0) return;
        const rootDir = useProjectStore.getState().root;
        if (!rootDir || !claimExternalDrop()) return;
        const row = (e.target as HTMLElement).closest<HTMLElement>("[data-tree-path]");
        const kind = row?.dataset.treeKind;
        const hit: TreeDropHit | null = row?.dataset.treePath
          ? {
              path: row.dataset.treePath,
              kind: kind === "dir" || kind === "file" ? kind : "blank",
            }
          : null;
        void useProjectStore.getState().importPaths(paths, resolveDropDir(hit, rootDir), "copy");
      }}
      onClick={(e) => {
        treeRef.current?.focus();
        // M1-47：点空白区（非树行）取消选中；拖拽尾随的 click 不清空
        if (!(e.target as HTMLElement).closest(".tnode") && !suppressClick.current) {
          useProjectStore.getState().setSelection([]);
        }
      }}      onContextMenu={(e) => {
        // 空白区右键（节点已 stopPropagation）
        e.preventDefault();
        if (!root) return;
        openCtx({ x: e.clientX, y: e.clientY, kind: "blank", path: root });
      }}
    >
      {!root ? (
        <div className="tree-empty">
          未打开项目
          <br />
          选择一个文件夹作为项目根
          <br />
          <button className="btn" onClick={() => void openProjectDialog()}>
            打开项目文件夹…
          </button>
        </div>
      ) : (
        <>
          {/* 根目录行：树的第一层（所有节点的父行），图标组始终显示 */}
          <div
            className={[
              "tnode",
              "tree-root",
              openDirs.has(root) ? "open-dir" : "",
              dragClass(root),
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ paddingLeft: 8 }}
            title={`${root} · 可把条目拖到这里（项目根）`}
            data-tree-path={root}
            data-tree-kind="dir"
            onClick={() => {
              if (suppressClick.current) return;
              toggleDir(root);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 根行用「空白」菜单：新建/模板/粘贴/刷新，不含重命名/删除/剪切
              openCtx({ x: e.clientX, y: e.clientY, kind: "blank", path: root });
            }}
          >
            <Icon name="chev" className="chev" size={12} />
            <Icon name="folder" size={15} />
            <span className="nm">{base(root)}</span>
            <span className="tree-root-acts">
              <button
                type="button"
                className="ibtn"
                title="新建文件"
                onClick={(e) => {
                  e.stopPropagation();
                  createEntry("file", newEntryDir());
                }}
              >
                <Icon name="file-plus" size={14} />
              </button>
              <button
                type="button"
                className="ibtn"
                title="新建文件夹"
                onClick={(e) => {
                  e.stopPropagation();
                  createEntry("dir", newEntryDir());
                }}
              >
                <Icon name="folder-plus" size={14} />
              </button>
              <button
                type="button"
                className={`ibtn${showHiddenFiles ? " on" : ""}`}
                title={showHiddenFiles ? "隐藏文件（点击关闭）" : "显示隐藏文件"}
                aria-label={showHiddenFiles ? "隐藏文件" : "显示隐藏文件"}
                aria-pressed={showHiddenFiles}
                onClick={(e) => {
                  e.stopPropagation();
                  void setShowHiddenFiles(!showHiddenFiles);
                }}
              >
                <Icon name={showHiddenFiles ? "eye-off" : "eye"} size={14} />
              </button>
              <button
                type="button"
                className="ibtn"
                title="刷新"
                onClick={(e) => {
                  e.stopPropagation();
                  void refresh();
                }}
              >
                <Icon name="refresh" size={14} />
              </button>
              <button
                type="button"
                className="ibtn"
                title="全部折叠"
                // 唯一置灰条件：根行展开且没有其他目录可折叠
                disabled={openDirs.has(root) && openDirs.size === 1}
                onClick={(e) => {
                  e.stopPropagation();
                  collapseAll();
                }}
              >
                <Icon name="collapse-all" size={14} />
              </button>
            </span>
          </div>

          {openDirs.has(root) &&
            (!nodes || nodes.length === 0 ? (
              <div className="tree-empty">
                项目为空
                <br />
                右键空白处可新建文档
                <br />
                <button className="btn" onClick={() => void refresh()}>
                  刷新
                </button>
              </div>
            ) : (
              renderNodes(nodes, 1)
            ))}
        </>
      )}
    </div>
  );
}

export default ProjectTree;
