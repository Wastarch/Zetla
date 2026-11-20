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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { insertSnippet } from "@/core/moduleRegistry";
import { useSettingsStore } from "@/core/settings";
import { getActiveView } from "@/editor/activeView";
import { zoteroApi } from "@/ipc/invoke";
import { notify } from "@/project/useProject";
import { ZOTERO_COMMANDS, type ZoteroCollection, type ZoteroCommand, type ZoteroItem } from "@/types/zotero";
import { useReferenceStore } from "@/modules/reference/useReferenceStore";
import {
  PICKER_COLUMN_DEFS,
  PICKER_DEBOUNCE_MS,
  PICKER_MIN_QUERY,
  PICKER_PAGE_SIZE,
  formatCitation,
  matchCollectionKey,
  mergeCandidates,
  nextPageStart,
  normalizeCommand,
  normalizePickerColumnWidths,
  normalizePickerColumns,
  parseSearchItems,
  parseSelectedCollection,
  pickerGridTemplate,
  PICKER_COL_WIDTH_MAX,
  PICKER_COL_WIDTH_MIN,
  rankCandidates,
  type BibLikeEntry,
} from "./zoteroPicker";
import { buildCollectionRows } from "./zoteroLibrary";
import { parseCollections, parseZoteroItems } from "./zoteroSync";
import { ensureBibEntries } from "./zoteroRuntime";
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
  // M1-34：列表显示列配置（持久化在 zotero.pickerColumns，title 恒显）
  const pickerColumnsCfg = useSettingsStore((s) => s.settings.zotero?.pickerColumns);
  // M1-35：列宽覆盖（持久化在 zotero.pickerColumnWidths）
  const pickerWidthsCfg = useSettingsStore((s) => s.settings.zotero?.pickerColumnWidths);

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
  // P5：分类下拉（"" = 全部文献）；默认定位到 Zotero 主窗口当前打开的分类
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [collectionKey, setCollectionKey] = useState("");
  const [collAuto, setCollAuto] = useState<string | null>(null);
  // M1-34：表头右键菜单开合与弹出坐标（M1-35 去掉按钮，只保留右键）
  const [colOpen, setColOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ x: 0, y: 0 });
  const colMenuRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef<{ id: string; startX: number; startW: number } | null>(null);
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
    setCollections([]);
    setCollectionKey("");
    setCollAuto(null);
    setColOpen(false);
    resizingRef.current = null;
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
  const inCollection = collectionKey !== "";

  // P5：打开时拉分类树 + 定位 Zotero 当前打开的分类（失败静默降级为「全部文献」）
  useEffect(() => {
    if (!open || !connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const port = zoteroSettings?.port || 23119;
        const [rawColls, rawSel] = await Promise.all([
          zoteroApi.fetchCollections(port),
          zoteroApi.selectedCollection(port).catch(() => ""),
        ]);
        if (cancelled) return;
        const colls = parseCollections(rawColls);
        setCollections(colls);
        const key = matchCollectionKey(rawSel ? parseSelectedCollection(rawSel) : null, colls);
        if (key) {
          setCollectionKey(key);
          setCollAuto(colls.find((c) => c.key === key)?.name ?? null);
        }
      } catch {
        /* 离线降级：保持「全部文献」 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, connected, zoteroSettings?.port]);

  // P5：切换分类时重置分页与已加载条目
  useEffect(() => {
    setPage(0);
    setRemoteItems([]);
    setTotal(null);
    setLastReceived(0);
    setHighlight(0);
  }, [collectionKey]);

  // 远端数据：分类选中 = 分类条目（空查询浏览 / 关键词分类内搜索）；
  // 全部文献 = 全库搜索。250ms 防抖 + 显式 limit/start；离线回落本地索引。
  useEffect(() => {
    if (!open || !connected) {
      setRemoteItems([]);
      setTotal(null);
      setLastReceived(0);
      setSearching(false);
      return;
    }
    const browse = inCollection && q.length < PICKER_MIN_QUERY;
    if (!inCollection && q.length < PICKER_MIN_QUERY) {
      setRemoteItems([]);
      setTotal(null);
      setLastReceived(0);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(
      async () => {
        try {
          const port = zoteroSettings?.port || 23119;
          if (inCollection) {
            // 分类端点支持 q 服务端过滤（实测 Total-Results 正常）；
            // 原始 JSON 不带总数头 → 用「本页不足一页即到底」翻页判定
            const raw = await zoteroApi.fetchItems(
              port,
              collectionKey,
              PICKER_PAGE_SIZE,
              page * PICKER_PAGE_SIZE,
              browse ? "" : q,
            );
            if (cancelled) return;
            const parsed = parseZoteroItems(raw);
            setRemoteItems((prev) => (page === 0 ? parsed : [...prev, ...parsed]));
            setLastReceived(parsed.length);
            setTotal(null);
            setNote("");
          } else {
            const r = await zoteroApi.search(
              port,
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
          }
        } catch {
          if (cancelled) return;
          setRemoteItems([]);
          setLastReceived(0);
          setNote(inCollection ? "Zotero 分类条目读取失败，已回落到项目 .bib 索引" : "Zotero 搜索不可用，已回落到项目 .bib 索引");
        } finally {
          if (!cancelled) setSearching(false);
        }
      },
      browse ? 0 : PICKER_DEBOUNCE_MS,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, connected, q, page, collectionKey, inCollection, zoteroSettings?.port]);

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
  // P5：分类树下拉行（复用 P3-5 拍平逻辑：DFS + 全角缩进）
  const collRows = useMemo(() => buildCollectionRows(collections), [collections]);
  const collectionName = useMemo(
    () => collections.find((c) => c.key === collectionKey)?.name ?? "",
    [collections, collectionKey],
  );
  const canLoadRemote = connected && (inCollection || q.length >= PICKER_MIN_QUERY);
  const hasMore =
    connected &&
    canLoadRemote &&
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

  // M1-34：显示列派生（归一化兜底旧配置/非法值）与勾选切换（旁路落盘）
  const colOn = useMemo(
    () => new Set(normalizePickerColumns(pickerColumnsCfg)),
    [pickerColumnsCfg],
  );
  const visibleDefs = useMemo(
    () => PICKER_COLUMN_DEFS.filter((d) => d.id !== "title" && colOn.has(d.id)),
    [colOn],
  );
  const gridTemplate = useMemo(
    () => pickerGridTemplate(pickerColumnsCfg ?? [], pickerWidthsCfg ?? {}),
    [pickerColumnsCfg, pickerWidthsCfg],
  );
  const toggleColumn = useCallback((id: string) => {
    const st = useSettingsStore.getState();
    const cur = st.settings.zotero;
    if (!cur) return;
    const base = normalizePickerColumns(cur.pickerColumns);
    const next = base.includes(id) ? base.filter((c) => c !== id) : [...base, id];
    if (next.length === 0) return; // 至少保留一列
    const nextZotero = { ...cur, pickerColumns: next };
    st.setSettings({ ...st.settings, zotero: nextZotero });
    void st.persist({ zotero: nextZotero });
  }, []);

  // M1-35：表头右键开关列菜单（坐标钳制避免溢出屏幕）
  const openColumnMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setColMenuPos({
      x: Math.min(e.clientX, window.innerWidth - 184),
      y: Math.min(e.clientY, window.innerHeight - 300),
    });
    setColOpen(true);
  }, []);
  // 点菜单外部关闭（浮层自身 mousedown 会 stopPropagation，故挂 window）
  useEffect(() => {
    if (!colOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!colMenuRef.current?.contains(e.target as Node)) setColOpen(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [colOpen]);

  // M1-35：拖拽表头列边界改列宽（指针事件，与 Tauri 原生拖放隔离）；
  // 拖动中只改内存 store 求即时反馈，松手才落盘。
  const onResizeStart = useCallback((e: ReactPointerEvent<HTMLSpanElement>, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cell = e.currentTarget.parentElement;
    const w = cell?.getBoundingClientRect().width ?? 120;
    resizingRef.current = { id, startX: e.clientX, startW: w };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onResizeMove = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    const r = resizingRef.current;
    if (!r) return;
    e.preventDefault();
    const w = Math.round(
      Math.min(PICKER_COL_WIDTH_MAX, Math.max(PICKER_COL_WIDTH_MIN, r.startW + e.clientX - r.startX)),
    );
    const st = useSettingsStore.getState();
    const cur = st.settings.zotero;
    if (!cur || cur.pickerColumnWidths?.[r.id] === w) return;
    const next = { ...cur, pickerColumnWidths: { ...cur.pickerColumnWidths, [r.id]: w } };
    st.setSettings({ ...st.settings, zotero: next }); // 拖动中不落盘
  }, []);
  const onResizeEnd = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    const r = resizingRef.current;
    if (!r) return;
    e.preventDefault();
    resizingRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const st = useSettingsStore.getState();
    const cur = st.settings.zotero;
    if (!cur) return;
    void st.persist({
      zotero: {
        ...cur,
        pickerColumnWidths: normalizePickerColumnWidths(cur.pickerColumnWidths),
      },
    });
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
    // 插入即写入：未进 .bib 的条目自动补写（无绑定时自动推断项目内主库）。
    // 写入成功不打扰用户；失败才用一条简短提示，且绝不阻断插入。
    const selected = shown.filter((c) => activeKeys.includes(c.citeKey));
    try {
      const r = await ensureBibEntries(
        selected.map((c) => ({ citeKey: c.citeKey, itemKey: c.itemKey })),
      );
      if (!r.ok && r.message) notify(r.message, "err");
    } catch {
      /* 写入失败不阻断插入 */
    }
    if (!insertSnippet(text)) {
      notify("没有活动编辑器，无法插入引用", "err");
      return;
    }
    rememberCommand(command);
    closeAndFocus();
  }, [activeKeys, preview, shown, command, rememberCommand, closeAndFocus]);

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
              ? inCollection
                ? ` · 分类「${collectionName}」${searching ? "读取中…" : ""}`
                : ` · Zotero 全库 ${searching ? "搜索中…" : total != null ? `命中 ${total}` : "已连接"}`
              : " · Zotero 离线（仅本地索引）"}
          </span>
        </div>

        {connected && (
          <div className="zotero-picker-coll">
            <label>
              分类
              <select
                value={collectionKey}
                onChange={(e) => {
                  setCollectionKey(e.target.value);
                  setCollAuto(null);
                  window.setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                <option value="">全部文献（全库搜索）</option>
                {collRows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {`${"\u3000".repeat(r.depth)}${r.name}`}
                  </option>
                ))}
              </select>
            </label>
            {collAuto && collectionKey && (
              <em title="每次打开都会重新定位 Zotero 当前分类">
                已定位 Zotero 当前分类
              </em>
            )}
          </div>
        )}

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
          <label>
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

        {/* M1-35：表头右键选择显示列 + 拖拽列边界改列宽 */}
        <div
          className="zotero-picker-cols"
          style={{ gridTemplateColumns: gridTemplate }}
          onContextMenu={openColumnMenu}
          title="右键选择显示列 · 拖拽列边界调整宽度"
        >
          <span className="zotero-picker-hcell" />
          <span className="zotero-picker-hcell">
            标题
            <span
              className="zotero-picker-col-resizer"
              onPointerDown={(e) => onResizeStart(e, "title")}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
            />
          </span>
          {visibleDefs.map((d) => (
            <span key={d.id} className="zotero-picker-hcell">
              {d.label}
              <span
                className="zotero-picker-col-resizer"
                onPointerDown={(e) => onResizeStart(e, d.id)}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeEnd}
                onPointerCancel={onResizeEnd}
              />
            </span>
          ))}
        </div>
        {colOpen && (
          <div
            ref={colMenuRef}
            className="zotero-picker-colmenu"
            style={{ left: colMenuPos.x, top: colMenuPos.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {PICKER_COLUMN_DEFS.filter((d) => d.id !== "title").map((d) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={colOn.has(d.id)}
                  onChange={() => toggleColumn(d.id)}
                />
                {d.label}
              </label>
            ))}
            <button
              type="button"
              className="zotero-picker-colreset"
              onClick={() => {
                const st = useSettingsStore.getState();
                const cur = st.settings.zotero;
                if (!cur) return;
                const next = { ...cur, pickerColumnWidths: {} };
                st.setSettings({ ...st.settings, zotero: next });
                void st.persist({ zotero: next });
                setColOpen(false);
              }}
            >
              重置列宽
            </button>
          </div>
        )}

        <div className="zotero-picker-list">
          {shown.length === 0 && (
            <p className="zotero-picker-empty">
              没有匹配条目
              {connected && q.length < PICKER_MIN_QUERY
                ? inCollection
                  ? `（已在分类内浏览；输入 2 个字以上可在分类内搜索）`
                  : "（输入 2 个字以上可搜 Zotero 全库）"
                : ""}
            </p>
          )}
          {shown.map((c, i) => (
            <div
              key={c.citeKey}
              className={`zotero-picker-row${i === highlight ? " on" : ""}${
                selected.includes(c.citeKey) ? " picked" : ""
              }`}
              style={{ gridTemplateColumns: gridTemplate }}
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
              <span className="zotero-picker-cell zc-title">
                {c.title || c.citeKey}
              </span>
              {colOn.has("authors") && (
                <span className="zotero-picker-cell">{c.authors || "—"}</span>
              )}
              {colOn.has("year") && (
                <span className="zotero-picker-cell zc-year">{c.year || "—"}</span>
              )}
              {colOn.has("publication") && (
                <span className="zotero-picker-cell">{c.publication || "—"}</span>
              )}
              {colOn.has("doi") && (
                <span className="zotero-picker-cell zc-mono">{c.doi || "—"}</span>
              )}
              {colOn.has("citeKey") && (
                <span className="zotero-picker-cell zc-mono">{c.citeKey}</span>
              )}
              {colOn.has("citedCount") && (
                <span className="zotero-picker-cell zc-num">
                  {c.citedCount > 0 ? String(c.citedCount) : "—"}
                </span>
              )}
              {colOn.has("status") && (
                <span
                  className={`zotero-picker-tag${c.inBib ? "" : " warn"}`}
                  title={c.inBib ? "该 key 已在项目 .bib 中" : "尚未同步到项目 .bib"}
                >
                  {c.inBib ? "已在 .bib" : "未同步"}
                  {c.citedCount > 0 ? ` · 被引 ${c.citedCount}` : ""}
                </span>
              )}
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
          {note && <p className="zotero-picker-note">{note}</p>}
        </div>

        <div className="zotero-picker-foot">
          <span>
            ↑↓ 选择 · Shift+Enter 多选 · Alt+←/→ 换命令 · Enter 插入 · Esc 取消
          </span>
          <div className="zotero-picker-ops">
            <button type="button" className="primary" onClick={doInsert}>
              插入
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
