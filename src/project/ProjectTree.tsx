// M0-6 · 项目树（对齐 docs/UI/UI.html renderTree）
// 目录展开/文件选中/主文件 badge/缓冲脏点/右键菜单入口
// 补充：Ctrl+C/X/V 复制剪切粘贴、剪切项置灰
// M0-13 前移：树首行改为「根目录行」（资源管理器头部的图标组移入该行，hover 才显）
import { useMemo, useRef, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { useBuffersStore } from "@/editor/useBuffers";
import type { ProjectNode } from "@/types";
import { EXT_IMG, base, extOf, findNode, notify, parentOf, useProjectStore } from "./useProject";

function iconFor(name: string): { icon: string; cls: string } {
  const ext = extOf(name);
  if (EXT_IMG.has(ext)) return { icon: "image", cls: "file-img" };
  if (ext === "pdf") return { icon: "pdf", cls: "file-pdf" };
  if (ext === "bib") return { icon: "bib", cls: "file-bib" };
  if (["tex", "cls", "sty", "ltx"].includes(ext)) return { icon: "tex", cls: "file-tex" };
  return { icon: "file", cls: "" };
}

export function ProjectTree() {
  const root = useProjectStore((s) => s.root);
  const nodes = useProjectStore((s) => s.tree?.nodes);
  const openDirs = useProjectStore((s) => s.openDirs);
  const selected = useProjectStore((s) => s.selected);
  const toggleDir = useProjectStore((s) => s.toggleDir);
  const collapseAll = useProjectStore((s) => s.collapseAll);
  const openCtx = useProjectStore((s) => s.openCtx);
  const refresh = useProjectStore((s) => s.refresh);
  const openFromTree = useProjectStore((s) => s.openFromTree);
  const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
  const copyPaths = useProjectStore((s) => s.copyPaths);
  const cutPaths = useProjectStore((s) => s.cutPaths);
  const pasteInto = useProjectStore((s) => s.pasteInto);
  const clip = useProjectStore((s) => s.clip);
  const buffers = useBuffersStore((s) => s.buffers);
  const treeRef = useRef<HTMLDivElement>(null);

  const dirtyPaths = useMemo(
    () => new Set(buffers.filter((b) => b.content !== b.savedContent).map((b) => b.path)),
    [buffers],
  );

  // Ctrl+C / Ctrl+X / Ctrl+V（树容器获得焦点时；粘贴目标=选中目录 / 选中文件的父目录 / 项目根）
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "c" && selected) {
      e.preventDefault();
      copyPaths([selected]);
    } else if (k === "x" && selected) {
      e.preventDefault();
      cutPaths([selected]);
    } else if (k === "v") {
      e.preventDefault();
      const st = useProjectStore.getState();
      if (!st.clip) {
        notify("剪贴板为空", "err");
        return;
      }
      let target: string | null = root ?? null;
      if (selected) {
        const node = findNode(nodes, selected);
        target = node?.type === "dir" ? selected : parentOf(selected) || root;
      }
      if (target) void pasteInto(target);
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
  }

  function renderNodes(list: ProjectNode[], depth: number): ReactNode {
    const pad = 8 + depth * 15;
    return list.map((n) => {
      if (n.type === "dir") {
        const open = openDirs.has(n.path);
        return (
          <div key={n.path}>
            <div
              className={open ? "tnode open-dir" : "tnode"}
              style={{ paddingLeft: pad, opacity: isCut(n.path) ? 0.55 : undefined }}
              title={n.path}
              onClick={() => toggleDir(n.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openCtx({ x: e.clientX, y: e.clientY, kind: "dir", path: n.path });
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
      const isSel = selected === n.path;
      return (
        <div
          key={n.path}
          className={isSel ? "tnode sel" : "tnode"}
          style={{ paddingLeft: pad, opacity: isCut(n.path) ? 0.55 : undefined }}
          title={n.path}
          onClick={() => openFromTree(n.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openCtx({ x: e.clientX, y: e.clientY, kind: "file", path: n.path });
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
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => treeRef.current?.focus()}
      onContextMenu={(e) => {
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
          {/* 根目录行：树的第一层（所有节点的父行），图标组 hover 才显 */}
          <div
            className={
              openDirs.has(root) ? "tnode tree-root open-dir" : "tnode tree-root"
            }
            style={{ paddingLeft: 8 }}
            title={root}
            onClick={() => toggleDir(root)}
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
                  createEntry("file", root);
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
                  createEntry("dir", root);
                }}
              >
                <Icon name="folder-plus" size={14} />
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
