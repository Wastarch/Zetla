// M0-6 · 树右键菜单（对齐 docs/UI/code.html .ctx/.mi/.msep）
// 文件：打开/重命名/资源管理器/删除；目录：新建 .tex/新建文件夹/资源管理器；空白：新建/新建文件夹/刷新
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { base, useProjectStore } from "./useProject";

interface CtxItem {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
}

export function CtxMenu() {
  const ctx = useProjectStore((s) => s.ctx);
  const closeCtx = useProjectStore((s) => s.closeCtx);
  const openEntryDialog = useProjectStore((s) => s.openEntryDialog);
  const removeEntry = useProjectStore((s) => s.removeEntry);
  const revealInExplorer = useProjectStore((s) => s.revealInExplorer);
  const refresh = useProjectStore((s) => s.refresh);
  const openFromTree = useProjectStore((s) => s.openFromTree);
  const root = useProjectStore((s) => s.root);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // 关闭：点击菜单外 / Esc / 失焦
  useEffect(() => {
    if (!ctx) return;
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      closeCtx();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCtx();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", closeCtx);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", closeCtx);
    };
  }, [ctx, closeCtx]);

  // 渲染后测量并夹取到视口
  useLayoutEffect(() => {
    if (!ctx || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(ctx.x, window.innerWidth - r.width - 10)),
      y: Math.max(6, Math.min(ctx.y, window.innerHeight - r.height - 10)),
    });
  }, [ctx]);

  if (!ctx) return null;

  let items: CtxItem[] = [];

  if (ctx.kind === "file" && ctx.path) {
    const p = ctx.path;
    items = [
      { label: "打开文件", icon: "file", onClick: () => openFromTree(p) },
      {
        label: "重命名",
        icon: "edit",
        onClick: () =>
          openEntryDialog({ mode: "rename", from: p, initial: base(p) }),
      },
      { label: "在资源管理器中打开", icon: "external", onClick: () => void revealInExplorer(p) },
      { label: "", icon: "", onClick: () => {} },
      { label: "删除", icon: "trash", danger: true, onClick: () => void removeEntry(p) },
    ];
  } else if (ctx.kind === "dir" && ctx.path) {
    const d = ctx.path;
    items = [
      {
        label: "新建 .tex 文件",
        icon: "file-plus",
        onClick: () => openEntryDialog({ mode: "create", kind: "tex", dir: d, initial: "untitled" }),
      },
      {
        label: "新建文件夹",
        icon: "folder-plus",
        onClick: () => openEntryDialog({ mode: "create", kind: "dir", dir: d, initial: "新建文件夹" }),
      },
      { label: "", icon: "", onClick: () => {} },
      { label: "在资源管理器中打开", icon: "external", onClick: () => void revealInExplorer(d) },
    ];
  } else if (root) {
    items = [
      {
        label: "新建 .tex 文件",
        icon: "file-plus",
        onClick: () =>
          openEntryDialog({ mode: "create", kind: "tex", dir: root, initial: "untitled" }),
      },
      {
        label: "新建文件夹",
        icon: "folder-plus",
        onClick: () =>
          openEntryDialog({ mode: "create", kind: "dir", dir: root, initial: "新建文件夹" }),
      },
      { label: "", icon: "", onClick: () => {} },
      { label: "刷新", icon: "refresh", onClick: () => void refresh() },
    ];
  }

  return (
    <div
      ref={ref}
      className="ctx open"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {items.map((it, i) =>
        it.label === "" ? (
          <div key={`sep-${i}`} className="msep" />
        ) : (
          <button
            key={it.label}
            type="button"
            className="mi"
            role="menuitem"
            onClick={() => {
              closeCtx();
              it.onClick();
            }}
          >
            <Icon name={it.icon} size={14} />
            <span className={it.danger ? "danger" : undefined}>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

export default CtxMenu;
