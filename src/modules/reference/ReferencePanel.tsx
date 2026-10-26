// M1-14f · 引用管理面板（纯前端，零 Rust 改动）—— 见 docs/开发计划.md M1-14f
// 活动栏「引用」视图：校验汇总条 + 搜索 + 按 .bib 文件分组的条目列表 + 导入 .bib。
// M1-14g：条目左键插入 \cite、右键菜单（跳到条目 / 查看反向引用）。
// 所有数据只读 useReferenceStore 缓存（entries/byKey/duplicateKeys/citations），不重解、不重读盘。
import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useReferenceStore } from "./useReferenceStore";
import { useProjectStore, notify } from "@/project/useProject";
import { projectApi } from "@/ipc/invoke";
import { jumpToFile } from "@/editor/jump";
import { insertSnippet } from "@/core/moduleRegistry";
import { firstDuplicateEntry, type MissingCiteSummary } from "./lintLogic";
import type { BibEntry } from "./bibParser";

export default function ReferencePanel() {
  const entries = useReferenceStore((s) => s.entries);
  const byKey = useReferenceStore((s) => s.byKey);
  const duplicateKeys = useReferenceStore((s) => s.duplicateKeys);
  const citesByKey = useReferenceStore((s) => s.citesByKey);
  const citations = useReferenceStore((s) => s.citations);

  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 右键菜单：命中的 key 与屏幕坐标 */
  const [menu, setMenu] = useState<{ key: string; entry: BibEntry; x: number; y: number } | null>(
    null,
  );
  /** 展开反向引用列表的 key（null = 全收起） */
  const [revKey, setRevKey] = useState<string | null>(null);

  // 右键菜单：点击空白/滚动/Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  /** 左键：在活动编辑器光标处插入 \cite{key} */
  const onInsert = useCallback((key: string) => {
    if (!insertSnippet(`\\cite{${key}}`)) {
      notify("请先打开一个 .tex 编辑器并定位光标", "err");
    }
  }, []);

  /** 查看反向引用（展开/收起该条目下的引用列表） */
  const onShowRefs = useCallback((key: string) => {
    setRevKey((prev) => (prev === key ? null : key));
  }, []);

  // 重复 key 汇总（store 直接可得，无需读盘）
  const dupSummary = useMemo(() => {
    return {
      count: duplicateKeys.size,
      first: firstDuplicateEntry(entries, duplicateKeys),
    };
  }, [entries, duplicateKeys]);

  // 缺失引用汇总：直接从 store 的 citation 索引推导（不重读盘、不重扫）
  const missing = useMemo<MissingCiteSummary>(() => {
    const known = new Set(byKey.keys());
    let count = 0;
    let first: { file: string; line: number } | null = null;
    // 依文件+行号排序，保证「首个」稳定（citations 顺序取决于树遍历）
    const sorted = [...citations].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
    );
    for (const c of sorted) {
      if (known.has(c.key)) continue;
      count++;
      if (!first) first = { file: c.file, line: c.line };
    }
    return { count, first };
  }, [citations, byKey]);

  // 分组：按 .bib 文件
  const groups = useMemo(() => {
    const map = new Map<string, BibEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.file) ?? [];
      arr.push(e);
      map.set(e.file, arr);
    }
    return [...map.entries()];
  }, [entries]);

  // 搜索过滤（key / author / title）
  const query = q.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!query) return groups;
    return groups
      .map(([file, es]) => {
        const fes = es.filter(
          (e) =>
            e.key.toLowerCase().includes(query) ||
            (e.author ?? "").toLowerCase().includes(query) ||
            (e.title ?? "").toLowerCase().includes(query),
        );
        return [file, fes] as [string, BibEntry[]];
      })
      .filter(([, es]) => es.length > 0);
  }, [groups, query]);

  // 导入 .bib（仅文件导入：选本地 .bib → 拷进项目根）
  const onImport = useCallback(async () => {
    const r = useProjectStore.getState().root;
    if (!r) {
      notify("请先打开项目", "err");
      return;
    }
    try {
      const picked = await openFileDialog({
        multiple: false,
        filters: [{ name: "BibTeX", extensions: ["bib"] }],
      });
      if (typeof picked !== "string") return; // 取消
      const base = picked.split(/[\\/]/).pop() ?? "reference.bib";
      const sep = r.includes("\\") ? "\\" : "/";
      const target = r.endsWith(sep) ? r + base : r + sep + base;
      const t = useProjectStore.getState().tree;
      const exists = t?.nodes.some(
        (n) => n.type === "file" && n.path.toLowerCase() === target.toLowerCase(),
      );
      if (exists) {
        notify(`项目根已存在 ${base}，未覆盖`, "err");
        return;
      }
      await projectApi.copyEntry(picked, target);
      notify(`已导入 ${base}，请在 \\addbibresource 中引用`);
      void useReferenceStore.getState().reindex();
    } catch (e) {
      notify(`导入失败：${String(e)}`, "err");
    }
  }, []);

  const toggleGroup = (file: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const allClear = dupSummary.count === 0 && missing.count === 0;

  return (
    <div className="ref-panel">
      {/* 校验汇总条（M1-14e 缓过来的项目级聚合） */}
      <div className="ref-summary">
        {allClear ? (
          <div className="ref-ok">✓ 引用无误</div>
        ) : (
          <>
            <button
              type="button"
              className="ref-pill ref-pill-warn"
              disabled={dupSummary.count === 0}
              title="点击跳到首个重复 key"
              onClick={() =>
                dupSummary.first && jumpToFile(dupSummary.first.file, dupSummary.first.line)
              }
            >
              ⚠ 重复 key {dupSummary.count} 处
            </button>
            <button
              type="button"
              className="ref-pill ref-pill-err"
              disabled={missing.count === 0}
              title="点击跳到首个缺失引用"
              onClick={() =>
                missing.first && jumpToFile(missing.first.file, missing.first.line)
              }
            >
              ❌ 缺失引用 {missing.count} 处
            </button>
          </>
        )}
      </div>

      {/* 操作区：搜索 + 导入 */}
      <div className="ref-actions">
        <input
          className="ref-search"
          placeholder="搜索 key / 作者 / 标题"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="ref-import" onClick={() => void onImport()}>
          + 导入…
        </button>
      </div>

      {/* 分组列表 */}
      <div className="ref-list">
        {filteredGroups.length === 0 ? (
          <div className="ref-empty">
            {entries.length === 0 ? "项目中未发现 .bib 文献" : "无匹配条目"}
          </div>
        ) : (
          filteredGroups.map(([file, es]) => {
            const isCollapsed = collapsed.has(file);
            return (
              <div className="ref-group" key={file}>
                <button
                  type="button"
                  className="ref-group-head"
                  onClick={() => toggleGroup(file)}
                  title={file}
                >
                  <span className={isCollapsed ? "ref-caret" : "ref-caret open"}>▾</span>
                  <span className="ref-group-name">{file.split(/[\\/]/).pop()}</span>
                  <span className="ref-group-count">{es.length}</span>
                </button>
                {!isCollapsed &&
                  es.map((e) => {
                    const dup = duplicateKeys.has(e.key);
                    const refs = citesByKey.get(e.key) ?? [];
                    const refCount = refs.length;
                    const isRev = revKey === e.key;
                    return (
                      <div className="ref-entry-wrap" key={`${e.file}:${e.line}`}>
                        <button
                          type="button"
                          className={dup ? "ref-entry ref-entry-dup" : "ref-entry"}
                          title={`${e.key} · @${e.type} · 点击插入 \\cite{…}；右键更多`}
                          onClick={() => onInsert(e.key)}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            setMenu({ key: e.key, entry: e, x: ev.clientX, y: ev.clientY });
                          }}
                        >
                          {dup && (
                            <span className="ref-dup-dot" title="重复 key">
                              ●
                            </span>
                          )}
                          <span className="ref-key">{e.key}</span>
                          <span className="ref-meta">
                            {(e.author ?? "—") + (e.year ? ` (${e.year})` : "")}
                          </span>
                          {refCount > 0 && (
                            <span className="ref-cite-count" title={`被引用 ${refCount} 次`}>
                              {refCount}
                            </span>
                          )}
                          <span className="ref-type">@{e.type}</span>
                        </button>
                        {isRev && (
                          <div className="ref-rev">
                            {refCount === 0 ? (
                              <div className="ref-rev-empty">未被任何 .tex 引用</div>
                            ) : (
                              refs.map((r, i) => (
                                <button
                                  type="button"
                                  className="ref-rev-item"
                                  key={`${r.file}:${r.line}:${i}`}
                                  title={r.file}
                                  onClick={() => jumpToFile(r.file, r.line)}
                                >
                                  <span className="ref-rev-file">
                                    {r.file.split(/[\\/]/).pop()}
                                  </span>
                                  <span className="ref-rev-line">:{r.line}</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {/* 右键菜单：跳到条目 / 查看反向引用 */}
      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(ev) => ev.stopPropagation()}
        >
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              jumpToFile(menu.entry.file, menu.entry.line);
              setMenu(null);
            }}
          >
            跳到条目
          </button>
          <button
            type="button"
            className="ctx-item"
            onClick={() => {
              onShowRefs(menu.key);
              setMenu(null);
            }}
          >
            查看反向引用
          </button>
        </div>
      )}
    </div>
  );
}
