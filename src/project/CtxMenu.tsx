// M0-6 · 树右键菜单（对齐 docs/UI/code.html .ctx/.mi/.msep）
// 文件：打开/重命名/复制/剪切/资源管理器/删除
// 目录：新建 .tex/新建文件夹/重命名/复制/剪切/粘贴/资源管理器/删除
// 空白：新建 .tex/新建文件夹/粘贴/刷新
// M1-40：多选感知——右键目标在选中集合内且为多选时，复制/剪切/删除/资源管理器
//        作用于整组（顶层去重），重命名/打开文件仅单选可用
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { base, useProjectStore } from "./useProject";
import { filterTopLevel } from "./treeDrop";

interface CtxItem {
  label: string;
  icon: string;
  /** 右侧快捷键提示（.mi .sc） */
  sc?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function CtxMenu() {
  const ctx = useProjectStore((s) => s.ctx);
  const closeCtx = useProjectStore((s) => s.closeCtx);
  const openEntryDialog = useProjectStore((s) => s.openEntryDialog);
  const removeEntries = useProjectStore((s) => s.removeEntries);
  const revealInExplorer = useProjectStore((s) => s.revealInExplorer);
  const refresh = useProjectStore((s) => s.refresh);
  const openFromTree = useProjectStore((s) => s.openFromTree);
  const copyPaths = useProjectStore((s) => s.copyPaths);
  const cutPaths = useProjectStore((s) => s.cutPaths);
  const pasteInto = useProjectStore((s) => s.pasteInto);
  const clip = useProjectStore((s) => s.clip);
  const osClip = useProjectStore((s) => s.osClip);
  const root = useProjectStore((s) => s.root);
  const sel = useProjectStore((s) => s.selected);

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

  const pasteItem = (dir: string): CtxItem => {
    // 应用内剪贴板为空、但系统剪贴板里有文件（资源管理器复制的）时，粘贴同样可用：
    // 文案点明是「复制/move 外部 N 项」，避免用户以为会粘贴树内复制过的东西
    const ext = !clip || clip.paths.length === 0 ? osClip : null;
    return {
      label: ext ? `粘贴（${ext.cut ? "移动" : "复制"}外部 ${ext.paths.length} 项）` : "粘贴",
      icon: "copy",
      sc: "Ctrl+V",
      disabled: ext ? false : !clip || clip.paths.length === 0,
      onClick: () => void pasteInto(dir),
    };
  };

  // M1-40：右键目标在选中集合内且为多选 → 操作对象是整组（顶层去重），否则就是目标本身
  const groupSel = ctx && ctx.path && sel.includes(ctx.path) && sel.length > 1;
  const targets = ctx && ctx.path && groupSel ? filterTopLevel(sel) : ctx?.path ? [ctx.path] : [];
  const n = targets.length;
  /** 在资源管理器中逐项定位（系统无「多选单窗口」接口可走，逐项 reveal） */
  const revealAll = () => targets.forEach((t) => void revealInExplorer(t));

  let items: CtxItem[] = [];

  if (ctx?.kind === "file" && ctx.path) {
    const p = ctx.path;
    if (n > 1) {
      items = [
        { label: `复制（${n} 项）`, icon: "copy", sc: "Ctrl+C", onClick: () => copyPaths(targets) },
        { label: `剪切（${n} 项）`, icon: "cut", sc: "Ctrl+X", onClick: () => cutPaths(targets) },
        { label: "", icon: "", onClick: () => {} },
        { label: `在资源管理器中打开（${n} 项）`, icon: "external", onClick: revealAll },
        { label: "", icon: "", onClick: () => {} },
        {
          label: `删除（${n} 项）`,
          icon: "trash",
          danger: true,
          onClick: () => void removeEntries(targets),
        },
      ];
    } else
      items = [
        { label: "打开文件", icon: "file", onClick: () => openFromTree(p) },
        {
          label: "重命名",
          icon: "edit",
          onClick: () => openEntryDialog({ mode: "rename", from: p, initial: base(p) }),
        },
        { label: "复制", icon: "copy", sc: "Ctrl+C", onClick: () => copyPaths([p]) },
        { label: "剪切", icon: "cut", sc: "Ctrl+X", onClick: () => cutPaths([p]) },
        { label: "", icon: "", onClick: () => {} },
        { label: "在资源管理器中打开", icon: "external", onClick: () => void revealInExplorer(p) },
        { label: "", icon: "", onClick: () => {} },
        { label: "删除", icon: "trash", danger: true, onClick: () => void removeEntries([p]) },
      ];
  } else if (ctx?.kind === "dir" && ctx.path) {
    const d = ctx.path;
    items = [
      {
        label: "新建文件",
        icon: "file-plus",
        onClick: () =>
          openEntryDialog({ mode: "create", kind: "file", dir: d, initial: "untitled", ext: ".tex" }),
      },
      {
        label: "新建文件夹",
        icon: "folder-plus",
        onClick: () => openEntryDialog({ mode: "create", kind: "dir", dir: d, initial: "新建文件夹" }),
      },
      {
        label: "从模板新建…",
        icon: "wand",
        onClick: () => useProjectStore.getState().openWizard(d),
      },
      { label: "", icon: "", onClick: () => {} },
      // 重命名仅单选可用（多选没有统一语义）
      ...(n > 1
        ? []
        : [
            {
              label: "重命名",
              icon: "edit",
              onClick: () => openEntryDialog({ mode: "rename", from: d, initial: base(d) }),
            },
          ]),
      {
        label: n > 1 ? `复制（${n} 项）` : "复制",
        icon: "copy",
        sc: "Ctrl+C",
        onClick: () => copyPaths(targets),
      },
      {
        label: n > 1 ? `剪切（${n} 项）` : "剪切",
        icon: "cut",
        sc: "Ctrl+X",
        onClick: () => cutPaths(targets),
      },
      pasteItem(d),
      { label: "", icon: "", onClick: () => {} },
      {
        label: n > 1 ? `在资源管理器中打开（${n} 项）` : "在资源管理器中打开",
        icon: "external",
        onClick: revealAll,
      },
      { label: "", icon: "", onClick: () => {} },
      {
        label: n > 1 ? `删除（${n} 项）` : "删除",
        icon: "trash",
        danger: true,
        onClick: () => void removeEntries(targets),
      },
    ];
  } else if (root) {
    items = [
      {
        label: "新建文件",
        icon: "file-plus",
        onClick: () =>
          openEntryDialog({
            mode: "create",
            kind: "file",
            dir: root,
            initial: "untitled",
            ext: ".tex",
          }),
      },
      {
        label: "新建文件夹",
        icon: "folder-plus",
        onClick: () =>
          openEntryDialog({ mode: "create", kind: "dir", dir: root, initial: "新建文件夹" }),
      },
      {
        label: "从模板新建…",
        icon: "wand",
        onClick: () => useProjectStore.getState().openWizard(root),
      },
      { label: "", icon: "", onClick: () => {} },
      pasteItem(root),
      { label: "", icon: "", onClick: () => {} },
      { label: "刷新", icon: "refresh", onClick: () => void refresh() },
      {
        label: "导出为 zip…",
        icon: "external",
        onClick: () => void useProjectStore.getState().exportProject(root),
      },
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
            disabled={it.disabled}
            onClick={() => {
              closeCtx();
              it.onClick();
            }}
          >
            <Icon name={it.icon} size={14} />
            <span className={it.danger ? "danger" : undefined}>{it.label}</span>
            {it.sc && <span className="sc">{it.sc}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export default CtxMenu;
