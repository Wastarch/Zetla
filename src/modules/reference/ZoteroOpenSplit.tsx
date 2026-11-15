// P3-1b · 引用条目「打开目标」分体按钮（编译按钮 ▶ | ▾ 同款）
// 左半 = 默认动作「打开全文」，右半 = ▾ 下拉三选一。
// 下拉由父组件统一渲染 InsertCtxMenu：点 ▾ 时右键菜单会卸载，
// 若把菜单放在本组件内部会一起消失（TabBar.tsx 也是把 RecipeMenu 放在外层）。
import { Icon } from "@/ui/Icon";
import type { ZoteroOpenTarget } from "@/modules/zotero/zoteroOpenTargets";

export interface ZoteroOpenSplitProps {
  /** menu = 右键菜单里的一行；card = 预览卡片底部的小按钮 */
  variant: "menu" | "card";
  busy: boolean;
  /** 主按钮：默认 pdf；下拉项由父组件回调同一个入口 */
  onRun: (target: ZoteroOpenTarget) => void;
  /** 点 ▾：把锚点交给父组件（父组件同时关闭右键菜单） */
  onOpenMenu: (pos: { x: number; y: number }) => void;
  menuOpen?: boolean;
}

export function ZoteroOpenSplit({
  variant,
  busy,
  onRun,
  onOpenMenu,
  menuOpen = false,
}: ZoteroOpenSplitProps) {
  return (
    <div className={`zo-split zo-split-${variant}`}>
      <button
        type="button"
        className="zo-main"
        disabled={busy}
        title="打开 PDF 全文（默认）；找不到附件或 Zotero 离线时自动回退到在 Zotero 中定位条目"
        onClick={(e) => {
          e.stopPropagation();
          onRun("pdf");
        }}
      >
        {busy ? "打开中…" : "打开全文"}
      </button>
      <button
        type="button"
        className={menuOpen ? "zo-more on" : "zo-more"}
        disabled={busy}
        title="选择打开方式：PDF 全文 / Zotero 条目 / 论文网页"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // 与 TabBar.tsx:134 同款：菜单已开时再点 ▾ 要能收起，
        // 否则 InsertCtxMenu 的窗口 mousedown 监听会先把它关掉
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          onOpenMenu({ x: Math.max(6, r.right - 210), y: r.bottom + 4 });
        }}
      >
        <Icon name="chev" size={11} />
      </button>
    </div>
  );
}
