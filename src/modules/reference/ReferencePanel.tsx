// M1-14f · 引用管理面板（纯前端，零 Rust 改动）—— 见 docs/开发计划.md M1-14f
// 活动栏「引用」视图：校验汇总条 + 搜索 + 按 .bib 文件分组的条目列表 + 导入 .bib。
// M1-14g+：条目左键 → 浮窗预览（只读）；右键菜单 → 插入 \cite / 跳到条目 / 查看反向引用。
// 所有数据只读 useReferenceStore 缓存（entries/byKey/duplicateKeys/citations），不重解、不重读盘。
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useReferenceStore } from "./useReferenceStore";
import { useProjectStore, notify } from "@/project/useProject";
import { projectApi } from "@/ipc/invoke";
import { jumpToFile } from "@/editor/jump";
import { insertSnippet } from "@/core/moduleRegistry";
import { firstDuplicateEntry, type MissingCiteSummary } from "./lintLogic";
import { RefPreviewCard } from "./RefPreviewCard";
import type { BibEntry } from "./bibParser";

/** 浮窗尺寸估算（用于定位 clamp，实际宽高由 CSS 决定） */
const PREVIEW_W = 340;
const PREVIEW_H_EST = 300;

/** 以条目矩形为锚点计算浮窗位置：优先右侧，空间不足翻左侧，并 clamp 到视口内 */
function previewPos(rect: DOMRect): { left: number; top: number } {
  let left = rect.right + 8;
  if (left + PREVIEW_W > window.innerWidth - 8) left = rect.left - PREVIEW_W - 8;
  if (left < 8) left = 8;
  let top = rect.top;
  if (top + PREVIEW_H_EST > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - PREVIEW_H_EST - 8);
  }
  return { left, top };
}

export default function ReferencePanel() {
  const entries = useReferenceStore((s) => s.entries);
  const byKey = useReferenceStore((s) => s.byKey);
  const duplicateKeys = useReferenceStore((s) => s.duplicateKeys);
  const citesByKey = useReferenceStore((s) => s.citesByKey);
  const citations = useReferenceStore((s) => s.citations);

  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 右键菜单：命中的条目、屏幕坐标、以及「查看反向引用」用的浮窗锚点 */
  const [menu, setMenu] = useState<{
    entry: BibEntry;
    x: number;
    y: number;
    pos: { left: number; top: number };
  } | null>(null);
  /** 左键浮窗预览（info 预览 / refs 反向引用） */
  const [preview, setPreview] = useState<{
    entry: BibEntry;
    mode: "info" | "refs";
    left: number;
    top: number;
  } | null>(null);

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

  // 浮窗预览：点击浮窗/条目之外、Esc、滚动（浮窗内部滚动除外）关闭
  useEffect(() => {
    if (!preview) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest(".ref-preview") || t.closest(".ref-entry"))) return;
      setPreview(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    const onScroll = (ev: Event) => {
      const t = ev.target as HTMLElement | null;
      if (t && t.closest && t.closest(".ref-preview")) return;
      setPreview(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [preview]);

  /** 左键：打开/切换浮窗预览（再点同一条目收起） */
  const onRowClick = useCallback((e: BibEntry, ev: ReactMouseEvent<HTMLButtonElement>) => {
    const id = `${e.file}:${e.line}`;
    // 先同步取锚点坐标：setState updater 可能延迟执行，届时 ev.currentTarget 已为 null
    const pos = previewPos(ev.currentTarget.getBoundingClientRect());
    setPreview((prev) => {
      if (prev && `${prev.entry.file}:${prev.entry.line}` === id) {
        // 同一条目：info 再点收起；refs 则切回 info
        return prev.mode === "info" ? null : { ...prev, mode: "info" };
      }
      return { entry: e, mode: "info", ...pos };
    });
  }, []);

  /** 右键：菜单「在光标处插入 \\cite{key}」 */
  const onInsert = useCallback((key: string) => {
    if (!insertSnippet(`\\cite{${key}}`)) {
      notify("请先打开一个 .tex 编辑器并定位光标", "err");
    }
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
                    const refCount = (citesByKey.get(e.key) ?? []).length;
                    return (
                      <div className="ref-entry-wrap" key={`${e.file}:${e.line}`}>
                        <button
                          type="button"
                          className={dup ? "ref-entry ref-entry-dup" : "ref-entry"}
                          title={`${e.key} · @${e.type} · 点击预览；右键更多`}
                          onClick={(ev) => onRowClick(e, ev)}
                          onContextMenu={(ev) => {
                            ev.preventDefault();
                            setPreview(null);
                            setMenu({
                              entry: e,
                              x: ev.clientX,
                              y: ev.clientY,
                              pos: previewPos(ev.currentTarget.getBoundingClientRect()),
                            });
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
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {/* 右键菜单：在光标处插入 / 跳到条目 / 查看反向引用 */}
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
              onInsert(menu.entry.key);
              setMenu(null);
            }}
          >
            {`在光标处插入 \\cite{${menu.entry.key}}`}
          </button>
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
              setPreview({ entry: menu.entry, mode: "refs", ...menu.pos });
              setMenu(null);
            }}
          >
            查看反向引用
          </button>
        </div>
      )}

      {/* 左键浮窗：预览信息 / 反向引用 */}
      {preview && (
        <RefPreviewCard
          entry={preview.entry}
          refs={citesByKey.get(preview.entry.key) ?? []}
          mode={preview.mode}
          left={preview.left}
          top={preview.top}
          onMode={(m) => setPreview((p) => (p ? { ...p, mode: m } : p))}
          onClose={() => setPreview(null)}
          onJump={(file, line) => {
            jumpToFile(file, line);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}
