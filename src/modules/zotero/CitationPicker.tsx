// Zotero 联动 · P2 沉浸式引用插入浮层
//
// 双数据源：项目 .bib 索引为主源（离线可用、插入即存在），Zotero 全库搜索为增强。
// 用户决策：全库命中但不在项目 .bib 的条目「允许插入、只做警告」。
// 全程键盘：Ctrl+Alt+K 唤起 → ↑↓ 选择 → Shift+Enter 多选 → Alt+←/→ 换命令 → Enter 插入 → Esc 关闭。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { insertSnippet } from "@/core/moduleRegistry";
import { useSettingsStore } from "@/core/settings";
import { getActiveView } from "@/editor/activeView";
import { zoteroApi } from "@/ipc/invoke";
import { notify } from "@/project/useProject";
import { ZOTERO_COMMANDS, type ZoteroCommand, type ZoteroItem } from "@/types/zotero";
import { useReferenceStore } from "@/modules/reference/useReferenceStore";
import {
  PICKER_DEBOUNCE_MS,
  PICKER_MIN_QUERY,
  PICKER_PAGE_SIZE,
  formatCitation,
  mergeCandidates,
  nextPageStart,
  normalizeCommand,
  parseSearchItems,
  pickerWarning,
  rankCandidates,
  type BibLikeEntry,
} from "./zoteroPicker";
import { ensureBibEntries, syncAllZoteroBindings } from "./zoteroRuntime";
import { useZoteroPicker } from "./useZoteroPicker";
import { useZoteroStore } from "./useZoteroStore";

export function CitationPicker() {
  const open = useZoteroPicker((s) => s.open);
  const close = useZoteroPicker((s) => s.closePicker);

  const entries = useReferenceStore((s) => s.entries);
  const citesByKey = useReferenceStore((s) => s.citesByKey);
  const keyMap = useZoteroStore((s) => s.keyMap);
  const health = useZoteroStore((s) => s.health);
  const zoteroSettings = useSettingsStore((s) => s.settings.zotero);

  const [query, setQuery] = useState("");
  const [command, setCommand] = useState<ZoteroCommand>("cite");
  const [starred, setStarred] = useState(false);
  const [prenote, setPrenote] = useState("");
  const [postnote, setPostnote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [remoteItems, setRemoteItems] = useState<ZoteroItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [lastReceived, setLastReceived] = useState(0);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeAndFocus = useCallback(() => {
    close();
    // 插入通道本身会 view.focus()，Esc / 点遮罩时这里补一次，保证焦点回到编辑器
    getActiveView()?.focus();
  }, [close]);

  // 每次打开都重置临时态，并把默认命令接到设置项（上次使用后已记忆）
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected([]);
    setHighlight(0);
    setRemoteItems([]);
    setPage(0);
    setTotal(null);
    setLastReceived(0);
    setStarred(false);
    setPrenote("");
    setPostnote("");
    setNote("");
    setCommand(
      normalizeCommand(useSettingsStore.getState().settings.zotero?.defaultCommand ?? "cite"),
    );
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const bibEntries = useMemo<BibLikeEntry[]>(
    () =>
      entries.map((e) => ({
        key: e.key,
        author: e.author,
        title: e.title,
        year: e.year,
        publication:
          e.fields.journal ?? e.fields.booktitle ?? e.fields.publisher ?? "",
        doi: e.fields.doi ?? "",
      })),
    [entries],
  );

  const citedCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, v] of citesByKey) out[k] = v.length;
    return out;
  }, [citesByKey]);

  const candidates = useMemo(
    () => mergeCandidates(bibEntries, remoteItems, keyMap, citedCounts),
    [bibEntries, remoteItems, keyMap, citedCounts],
  );
  const shown = useMemo(
    () => rankCandidates(candidates, query),
    [candidates, query],
  );

  const connected = health?.state === "connected" && !!zoteroSettings?.enabled;
  const q = query.trim();

  // 远端搜索：250ms 防抖 + 显式 limit/start；离线 / 403 / 短词一律回落本地索引
  useEffect(() => {
    if (!open || !connected || q.length < PICKER_MIN_QUERY) {
      setRemoteItems([]);
      setTotal(null);
      setLastReceived(0);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const r = await zoteroApi.search(
          zoteroSettings?.port || 23119,
          q,
          PICKER_PAGE_SIZE,
          page * PICKER_PAGE_SIZE,
        );
        if (cancelled) return;
        const parsed = parseSearchItems(r.items);
        setRemoteItems((prev) => (page === 0 ? parsed : [...prev, ...parsed]));
        setLastReceived(parsed.length);
        setTotal(r.total);
        setNote("");
      } catch {
        if (cancelled) return;
        setRemoteItems([]);
        setLastReceived(0);
        setNote("Zotero 搜索不可用，已回落到项目 .bib 索引");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, PICKER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, connected, q, page, zoteroSettings?.port]);

  const activeKeys = useMemo(
    () =>
      selected.length > 0
        ? selected
        : shown[highlight]
          ? [shown[highlight].citeKey]
          : [],
    [selected, shown, highlight],
  );
  const preview = useMemo(
    () =>
      formatCitation({
        command,
        keys: activeKeys,
        starred,
        prenote,
        postnote,
      }),
    [command, activeKeys, starred, prenote, postnote],
  );
  const warning = useMemo(
    () => pickerWarning(shown.filter((c) => activeKeys.includes(c.citeKey))),
    [shown, activeKeys],
  );
  const hasMore =
    connected &&
    q.length >= PICKER_MIN_QUERY &&
    nextPageStart(page * PICKER_PAGE_SIZE, lastReceived, total) !== null;

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const rememberCommand = useCallback((cmd: ZoteroCommand) => {
    const st = useSettingsStore.getState();
    const cur = st.settings.zotero;
    if (!cur || cur.defaultCommand === cmd) return;
    const next = { ...cur, defaultCommand: cmd };
    // 运行时立即生效 + 旁路落盘（失败不打扰用户，见 settings.persist）
    st.setSettings({ ...st.settings, zotero: next });
    void st.persist({ zotero: next });
  }, []);

  const doInsert = useCallback(async () => {
    if (activeKeys.length === 0) {
      setNote("请至少选择一条文献");
      return;
    }
    const text = preview;
    if (!text) {
      setNote("引用命令为空，无法插入");
      return;
    }
    // P4：按需绑定先补缺失条目（插一篇写一篇）；失败不阻断插入，由警告兜底
    const selected = shown.filter((c) => activeKeys.includes(c.citeKey));
    let missingNote: string | null = warning;
    try {
      const r = await ensureBibEntries(
        selected.map((c) => ({ citeKey: c.citeKey, itemKey: c.itemKey })),
      );
      if (r.written > 0) notify(r.message, "ok");
      if (r.unknown.length === 0) missingNote = null;
    } catch {
      /* 保持原警告提示 */
    }
    if (!insertSnippet(text)) {
      notify("没有活动编辑器，无法插入引用", "err");
      return;
    }
    rememberCommand(command);
    // 用户决策：仍未写入的条目允许插入，但必须给出明确警告
    if (missingNote) notify(missingNote, "err");
    closeAndFocus();
  }, [activeKeys, preview, shown, command, warning, rememberCommand, closeAndFocus]);

  const cycleCommand = useCallback((delta: number) => {
    setCommand((cur) => {
      const i = ZOTERO_COMMANDS.indexOf(cur);
      const n = (i + delta + ZOTERO_COMMANDS.length) % ZOTERO_COMMANDS.length;
      return ZOTERO_COMMANDS[n];
    });
  }, []);

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
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        const c = shown[highlight];
        if (c) toggleSelect(c.citeKey);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void doInsert();
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        cycleCommand(e.key === "ArrowRight" ? 1 : -1);
      }
    },
    [shown, highlight, doInsert, toggleSelect, cycleCommand, closeAndFocus],
  );

  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      const recs = await syncAllZoteroBindings();
      const ok = recs.filter((r) => r.ok).length;
      setNote(
        recs.length === 0
          ? "当前项目没有启用中的 Zotero 绑定"
          : `已同步 ${ok}/${recs.length} 条绑定，索引已刷新`,
      );
    } catch {
      setNote("同步失败，请检查 Zotero 连接");
    } finally {
      setSyncing(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="zotero-picker-mask" onMouseDown={closeAndFocus}>
      <div
        className="zotero-picker"
        role="dialog"
        aria-modal="true"
        aria-label="插入 Zotero 引用"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="zotero-picker-head">
          <b>插入引用</b>
          <span>
            项目 .bib {bibEntries.length} 条
            {connected
              ? ` · Zotero ${searching ? "搜索中…" : total != null ? `命中 ${total}` : "已连接"}`
              : " · Zotero 离线（仅本地索引）"}
          </span>
        </div>

        <input
          ref={inputRef}
          className="zotero-picker-search"
          placeholder="搜索作者 / 年份 / 标题 / DOI / citekey…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            setPage(0);
          }}
          onKeyDown={onKeyDown}
        />

        <div className="zotero-picker-tools">
          <label>
            命令
            <select
              value={command}
              onChange={(e) => setCommand(normalizeCommand(e.target.value))}
            >
              {ZOTERO_COMMANDS.map((c) => (
                <option key={c} value={c}>
                  \{c}
                </option>
              ))}
            </select>
          </label>
          <label className="zotero-picker-inline">
            <input
              type="checkbox"
              checked={starred}
              onChange={(e) => setStarred(e.target.checked)}
            />
            星号
          </label>
          <label>
            前缀
            <input
              className="zotero-picker-arg"
              placeholder="see / cf."
              value={prenote}
              onChange={(e) => setPrenote(e.target.value)}
            />
          </label>
          <label>
            页码
            <input
              className="zotero-picker-arg"
              placeholder="p.~10"
              value={postnote}
              onChange={(e) => setPostnote(e.target.value)}
            />
          </label>
        </div>

        <div className="zotero-picker-list">
          {shown.length === 0 && (
            <p className="zotero-picker-empty">
              没有匹配条目{connected && q.length < PICKER_MIN_QUERY ? "（输入 2 个字以上可搜 Zotero 全库）" : ""}
            </p>
          )}
          {shown.map((c, i) => (
            <div
              key={c.citeKey}
              className={`zotero-picker-row${i === highlight ? " on" : ""}${
                selected.includes(c.citeKey) ? " picked" : ""
              }`}
              onClick={() => {
                setHighlight(i);
                toggleSelect(c.citeKey);
              }}
              onDoubleClick={doInsert}
              title={c.citeKey}
            >
              <span className="zotero-picker-check">
                {selected.includes(c.citeKey) ? "✓" : ""}
              </span>
              <div className="zotero-picker-meta">
                <b>{c.title || c.citeKey}</b>
                <span>
                  {[c.authors, c.year, c.publication].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>
              <span className="zotero-picker-code">{c.citeKey}</span>
              <span
                className={`zotero-picker-tag${c.inBib ? "" : " warn"}`}
                title={c.inBib ? "该 key 已在项目 .bib 中" : "尚未同步到项目 .bib"}
              >
                {c.inBib ? "已在 .bib" : "未同步"}
                {c.citedCount > 0 ? ` · 被引 ${c.citedCount}` : ""}
              </span>
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              className="zotero-picker-more"
              onClick={() => setPage((p) => p + 1)}
            >
              加载更多 Zotero 结果
            </button>
          )}
        </div>

        <div className="zotero-picker-preview">
          <code>{preview || "（未选择条目）"}</code>
          {warning && <p className="zotero-picker-warn">{warning}</p>}
          {note && <p className="zotero-picker-note">{note}</p>}
        </div>

        <div className="zotero-picker-foot">
          <span>
            ↑↓ 选择 · Shift+Enter 多选 · Alt+←/→ 换命令 · Enter 插入 · Esc 取消
          </span>
          <div className="zotero-picker-ops">
            <button type="button" onClick={() => void doSync()} disabled={syncing}>
              {syncing ? "同步中…" : "立即同步"}
            </button>
            <button type="button" className="primary" onClick={doInsert}>
              插入
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
