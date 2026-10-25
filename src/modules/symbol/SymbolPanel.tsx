// M1-12b · 符号面板（公式侧栏「快捷工具」页签；M1-6 面板重写）
// 结构：搜索框 + 10 分类大钮（▾ 内嵌展开/收起，对齐 Formula.html 快捷工具）+ 符号/模板混合网格。
// 交互定稿（用户 2026-10-25）：
//   单击 → 写入侧栏编写区光标处（composeStore.insert + 记最近 + 回显）
//   右键 → InsertCtxMenu：直接插入到编辑器（= M1-6 旧单击行为，主项）/ 插入到编写区 / 复制 LaTeX
//   搜索框回车 → 写入首项（键盘路径）
// 模板含 \Box 槽位：直插编辑器时自动选中首槽、Tab 跳下一槽（mathSlots 协议）。
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippetWithSlots } from "@/editor/mathSlots";
import { notify } from "@/project/useProject";
import { useComposeStore } from "@/modules/formula/composeStore";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { CATEGORIES, CAT_ICONS, itemsByCat, searchItems, type InsertItem } from "./symbolItems";

/** 回显时长（ms） */
const FLASH_MS = 1200;

export default function SymbolPanel() {
  const [q, setQ] = useState("");
  // 默认展开第一类（常用符号）；点已展开类 = 收起（显示提示行）
  const [openCat, setOpenCat] = useState<string>(CATEGORIES[0]);
  const [flash, setFlash] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: InsertItem } | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const searching = q.trim() !== "";
  const items = useMemo(
    () => (searching ? searchItems(q) : openCat ? itemsByCat(openCat) : []),
    [searching, q, openCat],
  );

  const say = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  /** 单击：写入侧栏编写区光标处 + 记最近使用 */
  const writeToCompose = (item: InsertItem) => {
    const st = useComposeStore.getState();
    st.insert(item.latex);
    st.pushRecent({ key: item.key, label: item.name, latex: item.latex });
    say(`已写入编写区 ${item.latex}`);
  };

  /** 右键主项：直接插入主编辑器（无 \Box 时等价普通插入；有则选中首槽 + Tab 导航） */
  const directInsert = (item: InsertItem) => {
    if (insertSnippetWithSlots(item.latex)) say(`已插入 ${item.latex}`);
  };

  const copyLatex = async (item: InsertItem) => {
    try {
      await navigator.clipboard.writeText(item.latex);
      notify(`已复制 ${item.latex}`);
    } catch (e) {
      notify(`复制失败：${String(e)}`, "err");
    }
  };

  const menuFor = (item: InsertItem): CtxAction[] => [
    { label: "直接插入到编辑器", primary: true, onClick: () => directInsert(item) },
    { label: "插入到编写区", onClick: () => writeToCompose(item) },
    { label: "复制 LaTeX", onClick: () => void copyLatex(item) },
  ];

  return (
    <div className="symbol-panel">
      <input
        className="symbol-search"
        placeholder="搜索符号 / 公式 / 模板"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items.length > 0) {
            e.preventDefault();
            writeToCompose(items[0]);
          }
        }}
      />

      {/* 10 分类大钮（▾ 内嵌展开；搜索态隐藏——结果已跨分类） */}
      {!searching && (
        <nav className="sym-cats" aria-label="符号分类">
          {CATEGORIES.map((c) => {
            const open = openCat === c;
            return (
              <button
                key={c}
                type="button"
                className={open ? "sym-cat is-open" : "sym-cat"}
                title={`${c}（${itemsByCat(c).length} 项）${open ? " · 点击收起" : ""}`}
                onClick={() => setOpenCat(open ? "" : c)}
              >
                <span className="sym-cat-icon">{CAT_ICONS[c]}</span>
                <span className="sym-cat-name">{c}</span>
                <span className={open ? "sym-cat-arrow up" : "sym-cat-arrow"}>▾</span>
              </button>
            );
          })}
        </nav>
      )}

      {flash && <div className="symbol-flash">{flash}</div>}

      {!searching && !openCat ? (
        <div className="sym-cats-hint">点击上方分类，展开该类符号 / 模板</div>
      ) : (
        <div className="symbol-grid">
          {items.map((it) => {
            // 符号有真字形 → 大图；无字形符号（glyph=cmd）与模板 → 等宽小字
            const big = it.kind === "symbol" ? it.glyph !== it.latex : it.glyph.length <= 2;
            return (
              <button
                key={it.key}
                type="button"
                className={it.kind === "template" ? "symbol-btn is-tpl" : "symbol-btn"}
                title={`${it.name}（${it.latex}）${it.slots ? ` · ${it.slots} 个空槽` : ""} · 单击写入编写区，右键直插编辑器`}
                onClick={() => writeToCompose(it)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtx({ x: e.clientX, y: e.clientY, item: it });
                }}
              >
                <span className={big ? "symbol-glyph" : "symbol-glyph is-cmd"}>{it.glyph}</span>
                <span className="symbol-name">
                  {it.kind === "template" ? it.name : `\\${it.name}`}
                </span>
              </button>
            );
          })}
          {items.length === 0 && <div className="symbol-empty">未找到匹配项</div>}
        </div>
      )}

      {ctx && (
        <InsertCtxMenu x={ctx.x} y={ctx.y} actions={menuFor(ctx.item)} onClose={() => setCtx(null)} />
      )}
    </div>
  );
}
