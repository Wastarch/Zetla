// M1-45 · 标签页右键菜单（对齐 VS Code，按用户指令只保留 9 项）：
//   关闭 / 关闭其他 / 关闭右侧标签页 / 关闭已保存 / 全部关闭
//   复制路径 / 复制相对路径
//   在文件资源管理器中显示（系统）/ 在资源管理器视图中显示（侧栏树定位）
// 样式复用树右键菜单的 .ctx/.mi/.msep（zetla.css 全局类）；伪 buffer
// （拼图/绘图/偏好设置）路径族动作禁用。关闭族批量动作对脏文件一次确认
// （列出文件名），避免逐个弹原生框。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Icon } from "@/ui/Icon";
import { notify, useProjectStore } from "@/project/useProject";
import { isRealFileTab, relativePathOf, tabCloseSets } from "./tabCtx";
import { useBuffersStore } from "./useBuffers";

export interface TabCtxState {
  x: number;
  y: number;
  path: string;
}

interface MenuItem {
  label: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}

export function TabCtxMenu({ ctx, onClose }: { ctx: TabCtxState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: ctx.x, y: ctx.y });

  const buffers = useBuffersStore((s) => s.buffers);
  const root = useProjectStore((s) => s.root);
  const revealInExplorer = useProjectStore((s) => s.revealInExplorer);
  const revealInTree = useProjectStore((s) => s.revealInTree);

  const kind = buffers.find((b) => b.path === ctx.path)?.kind ?? "text";
  const real = isRealFileTab(kind);
  const sets = tabCloseSets(
    buffers.map((b) => ({ path: b.path, dirty: b.content !== b.savedContent })),
    ctx.path,
  );

  // 关闭：点击菜单外 / Esc / 失焦（与树右键菜单同口径）
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // 渲染后测量并夹取到视口
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(ctx.x, window.innerWidth - r.width - 10)),
      y: Math.max(6, Math.min(ctx.y, window.innerHeight - r.height - 10)),
    });
  }, [ctx.x, ctx.y]);

  /** 批量关闭：脏文件一次确认（列出名字），确认后逐个 force 关闭（不再逐个弹） */
  const closeMany = async (paths: string[]) => {
    const st = useBuffersStore.getState();
    const dirty = paths.filter((p) => st.isDirty(p));
    if (dirty.length > 0) {
      const names = dirty
        .map((p) => st.buffers.find((b) => b.path === p)?.name ?? p)
        .join("、");
      const ok = await confirm(
        `以下 ${dirty.length} 个文件有未保存的修改：\n${names}\n\n关闭后这些修改将丢失。`,
        { title: "关闭未保存文件", kind: "warning", okLabel: "关闭", cancelLabel: "取消" },
      );
      if (!ok) return;
    }
    for (const p of paths) await useBuffersStore.getState().closeBuffer(p, true);
  };

  const copyText = (text: string, msg: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => notify(msg, "ok"))
      .catch((e) => notify(String(e), "err"));
  };

  const items: MenuItem[] = [
    {
      label: "关闭",
      icon: "x",
      onClick: () => void useBuffersStore.getState().closeBuffer(ctx.path),
    },
    {
      label: "关闭其他",
      icon: "x",
      disabled: sets.others.length === 0,
      onClick: () => {
        void closeMany(sets.others).then(() => {
          if (useBuffersStore.getState().buffers.some((b) => b.path === ctx.path)) {
            useBuffersStore.getState().setActive(ctx.path);
          }
        });
      },
    },
    {
      label: "关闭右侧标签页",
      icon: "x",
      disabled: sets.right.length === 0,
      onClick: () => void closeMany(sets.right),
    },
    {
      label: "关闭已保存",
      icon: "x",
      disabled: sets.saved.length === 0,
      onClick: () => void closeMany(sets.saved),
    },
    {
      label: "全部关闭",
      icon: "x",
      disabled: sets.all.length === 0,
      onClick: () => void closeMany(sets.all),
    },
    { label: "", icon: "", onClick: () => {} },
    {
      label: "复制路径",
      icon: "copy",
      disabled: !real,
      onClick: () => copyText(ctx.path, "已复制路径"),
    },
    {
      label: "复制相对路径",
      icon: "copy",
      disabled: !real || !root,
      onClick: () => copyText(relativePathOf(ctx.path, root), "已复制相对路径"),
    },
    { label: "", icon: "", onClick: () => {} },
    {
      label: "在文件资源管理器中显示",
      icon: "external",
      disabled: !real,
      onClick: () => void revealInExplorer(ctx.path),
    },
    {
      label: "在资源管理器视图中显示",
      icon: "folder",
      disabled: !real || !root,
      onClick: () => revealInTree(ctx.path),
    },
  ];

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
              onClose();
              it.onClick();
            }}
          >
            <Icon name={it.icon} size={14} />
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

export default TabCtxMenu;
