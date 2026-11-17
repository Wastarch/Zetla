// M2-5b · 快捷输入代码片段浮层（菜单「插入 → 插入代码片段…」唤起）
// 布局参考 docs/dev/UI/插入代码片段浮窗.html：双栏（左片段列表 + 右预览）、
// 分类 chips、代码高亮 + Tab Stops；配色全部走项目 token，明暗主题自适应。
// 插入直接走 expandSnippet（snippet() 模板引擎），不依赖 autocompletion 扩展——
// 解决原「菜单 → startCompletion」在非 latex 档位 / 空前缀时无反应的问题；
// 且天然支持 ${n:占位符} Tab 跳转与 $SELECTION 包裹选中文字。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAppStore } from "@/core/store";
import { getActiveView } from "@/editor/activeView";
import { allSnippets, expandSnippet } from "@/editor/snippetsSupport";
import { notify } from "@/project/useProject";
import type { SnippetDef } from "@/types/snippets";

/** 内置片段 id 前缀 sn-；用户自定义为 s-<时间戳>-<随机>（见 types/snippets.ts） */
const isCustomSnippet = (s: SnippetDef) => s.id.startsWith("s-") && !s.id.startsWith("sn-");

/** 代码高亮：命令 / 占位符 / $SELECTION / 括号分段（返回 React 节点，不用 innerHTML） */
function highlightBody(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\$SELECTION|\$\{?\d+(?::[^}$}]*)?\}?|\\[a-zA-Z]+|[{}\[\]])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const token = m[0];
    let cls = "snip-code-plain";
    if (token === "$SELECTION") cls = "snip-code-sel";
    else if (token.startsWith("$")) cls = "snip-code-num";
    else if (token.startsWith("\\")) cls = "snip-code-cmd";
    else cls = "snip-code-brace";
    out.push(
      <span className={cls} key={key++}>
        {token}
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/** 解析 Tab Stops：${n:标签} / $n / $SELECTION / ${0}（去重保序） */
function parseStops(code: string): { key: string; name: string; hint: string; cls: string }[] {
  const out: { key: string; name: string; hint: string; cls: string }[] = [];
  const seen = new Set<string>();
  const re = /\$\{?(\d+|SELECTION)(?::([^}$}]*))?\}?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const n = m[1];
    if (seen.has(n)) continue;
    seen.add(n);
    const label = m[2]?.trim();
    if (n === "0") {
      out.push({ key: "$0", name: label || "最终光标", hint: "插入后结束", cls: "end" });
    } else if (n === "SELECTION") {
      out.push({
        key: "$SELECTION",
        name: label || "选中的文字",
        hint: "包裹已选内容",
        cls: "sel",
      });
    } else {
      out.push({ key: `$${n}`, name: label || `停靠点 ${n}`, hint: "Tab 依次跳转", cls: "" });
    }
  }
  return out;
}

/** 展开示意：把占位符替换为标签文本、$SELECTION 标为「选中文字」，给用户直观预览 */
function previewText(code: string): string {
  return code
    .replace(/\$\{?SELECTION\}?/g, "选中文字")
    .replace(/\$\{(\d+):([^}$}]*)\}/g, "$2")
    .replace(/\$\{?(\d+)\}?/g, "")
    .replace(/^\s*\n/gm, "")
    .trim();
}

export function SnippetPicker() {
  const open = useAppStore((s) => s.snippetPickerOpen);
  const setOpen = useAppStore((s) => s.setSnippetPickerOpen);

  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("全部");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const closeAndFocus = useCallback(() => {
    setOpen(false);
    getActiveView()?.focus();
  }, [setOpen]);

  // 每次打开重置临时态并聚焦搜索框
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCat("全部");
    setHighlight(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // 打开时重新取片段表（用户自定义片段可能在设置页更新过）
  const snippets = useMemo(() => allSnippets(), [open]);
  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(snippets.map((s) => s.category)))],
    [snippets],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return snippets.filter(
      (s) =>
        (cat === "全部" || s.category === cat) &&
        (!q ||
          `${s.trigger} ${s.desc ?? ""} ${s.category}`.toLowerCase().includes(q)),
    );
  }, [snippets, cat, query]);

  // 过滤后高亮越界时收敛到最后一项
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  // 键盘导航时保持高亮行可见
  useEffect(() => {
    listRef.current
      ?.querySelector(".snip-row.sel")
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

  const copyCode = useCallback((snip: SnippetDef) => {
    // ${n:标签} → $n（复制出干净的 snippet 语法）
    const text = snip.body.replace(/\$\{(\d+):[^}]*\}/g, "$$$1");
    void navigator.clipboard
      ?.writeText(text)
      .then(() => notify("片段代码已复制到剪贴板", "ok"))
      .catch(() => notify("复制失败，请手动选择代码", "err"));
  }, []);

  if (!open) return null;

  const active = shown[highlight];
  const activeCustom = active ? isCustomSnippet(active) : false;
  const activeStops = active ? parseStops(active.body) : [];

  return (
    <div className="snip-mask" onMouseDown={closeAndFocus}>
      <div
        className="snip-modal"
        role="dialog"
        aria-modal="true"
        aria-label="插入代码片段"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="snip-head">
          <div className="snip-head-main">
            <h1>
              插入<em>代码片段</em>
            </h1>
            <div className="snip-sub">
              <span className="snip-pill">
                <i />
                共 {snippets.length} 条 · 内置 + 自定义
              </span>
              <span>
                选中文字后，含 <code>$SELECTION</code> 的片段可自动包装
              </span>
            </div>
          </div>
          <button
            type="button"
            className="snip-close"
            title="关闭 (Esc)"
            aria-label="关闭"
            onClick={closeAndFocus}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        {/* search */}
        <div className="snip-search-wrap">
          <label className="snip-search">
            <svg
              width="17"
              height="17"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <circle cx="8" cy="8" r="5.4" />
              <path d="M12.2 12.2L16 16" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索触发词 / 分类 / 说明…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        {/* 分类 chips */}
        <nav className="snip-chips">
          {categories.map((c) => {
            const n = c === "全部" ? snippets.length : snippets.filter((s) => s.category === c).length;
            return (
              <button
                type="button"
                key={c}
                className={`snip-chip${c === cat ? " on" : ""}`}
                onClick={() => {
                  setCat(c);
                  setHighlight(0);
                  inputRef.current?.focus();
                }}
              >
                {c}
                <span>{n}</span>
              </button>
            );
          })}
        </nav>

        {/* 双栏 */}
        <div className="snip-panes">
          <div className="snip-list" ref={listRef}>
            {shown.length === 0 && (
              <div className="snip-empty">没有匹配的片段，换个关键词试试？</div>
            )}
            {shown.map((s, i) => (
              <div
                key={s.id}
                className={`snip-row${i === highlight ? " sel" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => doInsert(s)}
                title={s.desc ?? s.trigger}
              >
                <span className="snip-trig">{s.trigger}</span>
                <div className="snip-main">
                  <div className="snip-title">{s.desc ?? s.trigger}</div>
                  <div className="snip-row-code">
                    {highlightBody(s.body.split("\n")[0])}
                  </div>
                </div>
                <div className="snip-side">
                  {s.body.includes("$SELECTION") && (
                    <span className="snip-wrap-badge">
                      <i />
                      包装
                    </span>
                  )}
                  <span className={`snip-tag${isCustomSnippet(s) ? " custom" : ""}`}>
                    {isCustomSnippet(s) ? "自定义" : s.category}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <aside className="snip-preview">
            {!active ? (
              <div className="snip-pv-empty">选择一个片段查看预览</div>
            ) : (
              <>
                <div className="snip-pv-top">
                  <span className="snip-pv-trig">{active.trigger}</span>
                  <span className={`snip-tag${activeCustom ? " custom" : ""}`}>
                    {activeCustom ? "自定义" : "内置"} · {active.category}
                  </span>
                  {active.body.includes("$SELECTION") && (
                    <span className="snip-wrap-badge">
                      <i />
                      支持包装
                    </span>
                  )}
                </div>

                <div>
                  <div className="snip-pv-title">{active.desc ?? active.trigger}</div>
                  <div className="snip-pv-desc">
                    输入触发词 <code>{active.trigger}</code> 后按 Tab 可直接展开
                  </div>
                </div>

                <div>
                  <div className="snip-sect">
                    <span className="snip-lbl">Snippet</span>
                    <span className="snip-rule" />
                  </div>
                  <div className="snip-code-card">
                    <button
                      type="button"
                      className="snip-copy"
                      title="复制片段代码"
                      onClick={() => copyCode(active)}
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      >
                        <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
                        <path d="M8.5 1.5H2.2A1.2 1.2 0 001 2.7v6.3" />
                      </svg>
                      复制
                    </button>
                    <pre>{highlightBody(active.body)}</pre>
                  </div>
                </div>

                {activeStops.length > 0 && (
                  <div>
                    <div className="snip-sect">
                      <span className="snip-lbl">Tab Stops</span>
                      <span className="snip-rule" />
                    </div>
                    <div className="snip-stops">
                      {activeStops.map((st) => (
                        <div className="snip-stop" key={st.key}>
                          <span className={`snip-stop-k ${st.cls}`}>{st.key}</span>
                          <span className="snip-stop-n">{st.name}</span>
                          <span className="snip-stop-hint">{st.hint}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="snip-sect">
                    <span className="snip-lbl">展开示意</span>
                    <span className="snip-rule" />
                  </div>
                  <div className="snip-sample">{previewText(active.body) || "（纯文本片段）"}</div>
                </div>

                <div className="snip-note">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <circle cx="7" cy="7" r="5.6" />
                    <path d="M7 4.2v.1M7 6.4v3.4" />
                  </svg>
                  <span>
                    {active.body.includes("$SELECTION")
                      ? "编辑器中有选中文字时，插入会自动将其包裹在片段内部"
                      : `在编辑器中输入 ${active.trigger} 后按 Tab 也可快速插入`}
                  </span>
                </div>
              </>
            )}
          </aside>
        </div>

        {/* footer */}
        <div className="snip-foot">
          <div className="snip-keys">
            <span className="snip-key">
              <kbd>↑</kbd>
              <kbd>↓</kbd> 选择
            </span>
            <span className="snip-key">
              <kbd>Enter</kbd> 插入
            </span>
            <span className="snip-key">
              <kbd>Tab</kbd> 跳转停靠点
            </span>
            <span className="snip-key">
              <kbd>Esc</kbd> 取消
            </span>
          </div>
          <div className="snip-foot-note">当前 {shown.length} 条片段</div>
        </div>
      </div>
    </div>
  );
}

export default SnippetPicker;
