// M2-5b · 快捷输入代码片段浮层（菜单「插入 → 插入代码片段…」唤起）
// 与 CitationPicker 同为 store 驱动的居中浮层：搜索 + ↑↓ 选择 + Enter 展开 + Esc/遮罩关闭回焦。
// 关键：插入直接走 expandSnippet（snippet() 模板引擎），不依赖 autocompletion 扩展——
// 解决了原「菜单 → startCompletion」在非 latex 档位 / 空前缀时无反应的问题；
// 且天然支持 ${n:占位符} Tab 跳转与 $SELECTION 包裹选中文字。
// 样式复用 CitationPicker 的 .zotero-picker-*（字段语义相近，避免重复 CSS）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAppStore } from "@/core/store";
import { getActiveView } from "@/editor/activeView";
import { allSnippets, expandSnippet } from "@/editor/snippetsSupport";
import { notify } from "@/project/useProject";
import type { SnippetDef } from "@/types/snippets";

export function SnippetPicker() {
  const open = useAppStore((s) => s.snippetPickerOpen);
  const setOpen = useAppStore((s) => s.setSnippetPickerOpen);

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const closeAndFocus = useCallback(() => {
    setOpen(false);
    // 展开/关闭都把焦点交回编辑器（与 CitationPicker 一致）
    getActiveView()?.focus();
  }, [setOpen]);

  // 每次打开重置临时态并聚焦搜索框
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // 打开时重新取片段表（用户自定义片段可能在设置页更新过）
  const snippets = useMemo(() => allSnippets(), [open]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) =>
        s.trigger.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.desc ?? "").toLowerCase().includes(q),
    );
  }, [snippets, query]);

  // 键盘导航时保持高亮行可见
  useEffect(() => {
    listRef.current
      ?.querySelector(".zotero-picker-row.on")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, shown.length]);

  const doInsert = useCallback(
    (snip: SnippetDef | undefined) => {
      if (!snip) return;
      const view = getActiveView();
      if (!view) {
        notify("没有活动编辑器，无法插入代码片段", "err");
        closeAndFocus();
        return;
      }
      const pos = view.state.selection.main.head;
      // 有选区且模板含 $SELECTION → expandSnippet 内部按选区包裹；否则在光标处展开
      expandSnippet(view, snip, pos, pos);
      closeAndFocus();
    },
    [closeAndFocus],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAndFocus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(shown.length - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        doInsert(shown[highlight]);
      }
    },
    [shown, highlight, doInsert, closeAndFocus],
  );

  if (!open) return null;

  const active = shown[highlight];

  return (
    <div className="zotero-picker-mask" onMouseDown={closeAndFocus}>
      <div
        className="zotero-picker"
        role="dialog"
        aria-modal="true"
        aria-label="插入代码片段"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="zotero-picker-head">
          <b>插入代码片段</b>
          <span>
            共 {snippets.length} 条（内置 + 自定义）· 选中文字后选含 $SELECTION 的片段可包裹
          </span>
        </div>

        <input
          ref={inputRef}
          className="zotero-picker-search"
          placeholder="搜索触发词 / 分类 / 说明…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />

        <div className="zotero-picker-list" ref={listRef}>
          {shown.length === 0 && (
            <p className="zotero-picker-empty">没有匹配的代码片段</p>
          )}
          {shown.map((s, i) => (
            <div
              key={s.id}
              className={`zotero-picker-row${i === highlight ? " on" : ""}`}
              onClick={() => {
                setHighlight(i);
                doInsert(s);
              }}
              onMouseEnter={() => setHighlight(i)}
              title={s.desc ?? s.category}
            >
              <span className="zotero-picker-code">{s.trigger}</span>
              <div className="zotero-picker-meta">
                <b>{s.desc ?? s.trigger}</b>
                <span>{s.category}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="zotero-picker-preview">
          <code>{active ? active.body.slice(0, 400) : "（未选择片段）"}</code>
        </div>

        <div className="zotero-picker-foot">
          <span>↑↓ 选择 · Enter 插入 · Esc 取消</span>
        </div>
      </div>
    </div>
  );
}

export default SnippetPicker;
