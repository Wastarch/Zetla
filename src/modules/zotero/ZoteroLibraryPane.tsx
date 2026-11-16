// P3-5 · 「Zotero 文献库」页签（只读浏览：分类 / 标签 / 搜索 / 分页）
//
// 数据全部来自 Rust 的只读命令（fetchCollections / fetchItems 带 start）；
// 前端不做任何写请求，也不在本地重建 Zotero 的层级逻辑——分类树由纯逻辑拍平。
// 条目操作只有两个：插入 \cite（需 citekey）与在 Zotero 中定位（本地协议）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { zoteroApi } from "@/ipc/invoke";
import { useSettingsStore } from "@/core/settings";
import { useZoteroStore } from "@/modules/zotero/useZoteroStore";
import { parseCollections } from "@/modules/zotero/zoteroSync";
import { citationKeyFor } from "@/modules/zotero/zoteroPicker";
import { zoteroSelectUrl } from "@/modules/zotero/zoteroReverse";
import {
  buildCollectionRows,
  collectLibraryTags,
  collectionLabel,
  filterLibraryItems,
  libraryItemMeta,
  mergeLibraryItems,
  parseLibraryItems,
  type LibraryItem,
} from "@/modules/zotero/zoteroLibrary";

/** 每页条数：本地 API 无总数，靠「加载更多」逐页取 */
const PAGE_SIZE = 100;

export interface ZoteroLibraryPaneProps {
  /**
   * 插入引用（父组件负责 insertSnippet 与无编辑器提示）。
   * P4：item 让父组件在按需绑定下先补写缺失条目（插一篇写一篇）。
   */
  onInsert: (key: string, item?: LibraryItem) => void;
  /** 轻提示（无 citekey 等） */
  onNotice: (msg: string, kind?: "ok" | "err") => void;
}

export function ZoteroLibraryPane({ onInsert, onNotice }: ZoteroLibraryPaneProps) {
  const health = useZoteroStore((s) => s.health);
  const keyMap = useZoteroStore((s) => s.keyMap);
  const settings = useSettingsStore((s) => s.settings.zotero);
  const enabled = !!settings?.enabled;
  const connected = health?.state === "connected";
  const port = health?.port ?? settings?.port ?? 23119;

  const [collections, setCollections] = useState<ReturnType<typeof parseCollections>>([]);
  const [active, setActive] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  /** 请求序号：切分类/翻页时旧响应直接丢弃，避免串库 */
  const seq = useRef(0);

  const rows = useMemo(() => buildCollectionRows(collections), [collections]);
  const tags = useMemo(() => collectLibraryTags(items), [items]);
  const filtered = useMemo(() => filterLibraryItems(items, { query: q, tag }), [items, q, tag]);

  // 分类列表：连接可用时加载一次（失败只提示，不影响项目文献页签）
  useEffect(() => {
    if (!enabled || !connected) return;
    let alive = true;
    zoteroApi
      .fetchCollections(port)
      .then((raw) => {
        if (alive) setCollections(parseCollections(raw));
      })
      .catch((e) => {
        if (alive) setError(`读取 Zotero 分类失败：${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [enabled, connected, port]);

  const loadPage = useCallback(
    async (start: number, replace: boolean) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const raw = await zoteroApi.fetchItems(port, active, PAGE_SIZE, start);
        if (my !== seq.current) return;
        const page = parseLibraryItems(raw);
        setItems((prev) => (replace ? page : mergeLibraryItems(prev, page)));
        setHasMore(page.length >= PAGE_SIZE);
        setError(null);
      } catch (e) {
        if (my === seq.current) setError(`读取 Zotero 文献失败：${String(e)}`);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [port, active],
  );

  // 切分类 / 连接恢复：重置列表并取首页
  useEffect(() => {
    if (!enabled || !connected) return;
    setItems([]);
    setTag(null);
    setError(null);
    setHasMore(false);
    void loadPage(0, true);
  }, [enabled, connected, loadPage]);

  const onOpenInZotero = useCallback(
    async (item: LibraryItem) => {
      const url = zoteroSelectUrl(item.itemKey);
      if (!url) {
        onNotice("该条目 itemKey 非法，无法定位", "err");
        return;
      }
      try {
        await openUrl(url);
      } catch (e) {
        onNotice(`打开 Zotero 失败：${String(e)}`, "err");
      }
    },
    [onNotice],
  );

  const onInsertItem = useCallback(
    (item: LibraryItem) => {
      const key = citationKeyFor(item, keyMap);
      if (!key) {
        onNotice("该条目还没有 citekey：请先把所在分类同步到项目 .bib", "err");
        return;
      }
      // P4：带上完整题录，按需绑定可在插入前补写缺失条目（插一篇写一篇）
      onInsert(key, item);
    },
    [keyMap, onInsert, onNotice],
  );

  if (!enabled) {
    return <div className="zo-lib-empty">Zotero 联动已关闭，可在设置里开启后浏览文献库。</div>;
  }
  if (!connected) {
    return (
      <div className="zo-lib-empty">
        Zotero 未连接（{health?.message || "本地 API 不可用"}）。
        <div className="zo-lib-hint">启动 Zotero 并开启「允许其他应用程序通信」后重试。</div>
      </div>
    );
  }

  return (
    <div className="zo-lib">
      <div className="zo-lib-toolbar">
        <select
          className="zo-lib-collection"
          value={active ?? ""}
          title={collectionLabel(rows, active)}
          onChange={(e) => setActive(e.target.value || null)}
        >
          <option value="">全部文献</option>
          {rows.map((r) => (
            <option key={r.key} value={r.key}>
              {`${"\u3000".repeat(r.depth)}${r.name}`}
            </option>
          ))}
        </select>
        <input
          className="zo-lib-search"
          placeholder="筛选已加载条目"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          title="只在已加载的条目里筛选；全库搜索请用 Ctrl+Alt+K"
        />
      </div>

      {tags.length > 0 && (
        <div className="zo-lib-tags">
          {tag && (
            <button type="button" className="zo-lib-tag zo-lib-tag-on" onClick={() => setTag(null)}>
              {tag} ×
            </button>
          )}
          {tags
            .filter((t) => t.name !== tag)
            .slice(0, 12)
            .map((t) => (
              <button
                key={t.name}
                type="button"
                className="zo-lib-tag"
                title={`按标签 ${t.name} 过滤（${t.count} 条）`}
                onClick={() => setTag(t.name)}
              >
                {t.name}
                <span className="zo-lib-tag-count">{t.count}</span>
              </button>
            ))}
        </div>
      )}

      {error && <div className="zo-lib-error">{error}</div>}

      <div className="zo-lib-list">
        {filtered.length === 0 ? (
          <div className="zo-lib-empty">
            {loading ? "正在读取 Zotero 文献…" : items.length === 0 ? "该分类下没有条目" : "无匹配条目"}
          </div>
        ) : (
          filtered.map((it) => (
            <div className="zo-lib-item" key={it.itemKey} title={it.title || it.itemKey}>
              <div className="zo-lib-item-head">
                <span className="zo-lib-item-title">{it.title || "（无标题）"}</span>
                <span className="zo-lib-item-type">@{it.itemType}</span>
              </div>
              <div className="zo-lib-item-meta">{libraryItemMeta(it)}</div>
              <div className="zo-lib-item-ops">
                <button
                  type="button"
                  className="zo-lib-op"
                  title="在光标处插入 \\cite{citekey}"
                  onClick={() => onInsertItem(it)}
                >
                  插入引用
                </button>
                <button
                  type="button"
                  className="zo-lib-op"
                  title="在 Zotero 中定位该条目（本地协议，离线可用）"
                  onClick={() => void onOpenInZotero(it)}
                >
                  在 Zotero 打开
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="zo-lib-foot">
        <span>
          已加载 {items.length} 条{items.length > 0 && ` · 显示 ${filtered.length} 条`}
        </span>
        {hasMore && (
          <button
            type="button"
            className="zo-lib-more"
            disabled={loading}
            onClick={() => void loadPage(items.length, false)}
          >
            {loading ? "加载中…" : "加载更多"}
          </button>
        )}
      </div>
    </div>
  );
}
