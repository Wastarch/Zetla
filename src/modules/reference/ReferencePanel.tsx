// M1-14f · 引用管理面板（纯前端，零 Rust 改动）—— 见 docs/开发计划.md M1-14f
// 活动栏「引用」视图：校验汇总条 + 搜索 + 按 .bib 文件分组的条目列表 + 导入 .bib。
// 所有数据只读 useReferenceStore 缓存（entries/byKey/duplicateKeys），不重解；
// 缺失引用汇总按需扫描项目内 .tex 文件（复用 M1-14e 的 collectMissingCiteDiags）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text } from "@codemirror/state";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useReferenceStore } from "./useReferenceStore";
import { useProjectStore, notify } from "@/project/useProject";
import { useBuffersStore } from "@/editor/useBuffers";
import { projectApi } from "@/ipc/invoke";
import { jumpToFile } from "@/editor/jump";
import {
  firstDuplicateEntry,
  summarizeMissingCites,
  type MissingCiteSummary,
} from "./lintLogic";
import type { BibEntry } from "./bibParser";
import type { ProjectNode } from "@/types";

/** 递归收集项目树内所有 .tex / .ltx 文件绝对路径 */
function collectTexFiles(nodes: ProjectNode[] | undefined, out: string[]): void {
  if (!nodes) return;
  for (const n of nodes) {
    if (
      n.type === "file" &&
      (n.name.toLowerCase().endsWith(".tex") || n.name.toLowerCase().endsWith(".ltx"))
    ) {
      out.push(n.path);
    } else if (n.type === "dir" && n.children) {
      collectTexFiles(n.children, out);
    }
  }
}

const EMPTY_MISSING: MissingCiteSummary = { count: 0, first: null };

export default function ReferencePanel() {
  const entries = useReferenceStore((s) => s.entries);
  const byKey = useReferenceStore((s) => s.byKey);
  const duplicateKeys = useReferenceStore((s) => s.duplicateKeys);
  const ready = useReferenceStore((s) => s.ready);

  const root = useProjectStore((s) => s.root);
  const tree = useProjectStore((s) => s.tree);

  const [q, setQ] = useState("");
  const [missing, setMissing] = useState<MissingCiteSummary>(EMPTY_MISSING);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 重复 key 汇总（store 直接可得，无需读盘）
  const dupSummary = useMemo(() => {
    return {
      count: duplicateKeys.size,
      first: firstDuplicateEntry(entries, duplicateKeys),
    };
  }, [entries, duplicateKeys]);

  // 缺失引用汇总：扫描项目 .tex 文件（复用 M1-14e 逻辑，只读缓存不重解）
  const computeMissing = useCallback(async () => {
    const r = useProjectStore.getState().root;
    const t = useProjectStore.getState().tree;
    if (!r || !t) {
      setMissing(EMPTY_MISSING);
      return;
    }
    const texPaths: string[] = [];
    collectTexFiles(t.nodes, texPaths);
    texPaths.sort(); // 确定性顺序，保证「首个」稳定
    const known = new Set(useReferenceStore.getState().byKey.keys());
    const files: { path: string; doc: Text }[] = [];
    for (const p of texPaths) {
      try {
        const d = await projectApi.readFile(p);
        files.push({ path: p, doc: Text.of(d.content.split(/\r?\n/)) });
      } catch {
        // 读不到则跳过该文件
      }
    }
    setMissing(summarizeMissingCites(files, known));
  }, []);

  // bib 重索引 / 项目切换 → 重算缺失汇总
  useEffect(() => {
    void computeMissing();
  }, [ready, byKey, root, tree, computeMissing]);

  // .tex 编辑实时反映到缺失汇总（与引用 watcher 同思路，debounce 300ms）
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useBuffersStore.subscribe((s, prev) => {
      if (s.buffers === prev.buffers) return;
      const changedTex = s.buffers.some((b, idx) => {
        const before = prev.buffers[idx];
        return (
          b.path.toLowerCase().endsWith(".tex") &&
          (!before || before.content !== b.content)
        );
      });
      if (!changedTex) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void computeMissing(), 300);
    });
    return () => {
      if (timer != null) window.clearTimeout(timer);
      unsub();
    };
  }, [computeMissing]);

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
      void computeMissing();
    } catch (e) {
      notify(`导入失败：${String(e)}`, "err");
    }
  }, [computeMissing]);

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
                    return (
                      <button
                        type="button"
                        key={`${e.file}:${e.line}`}
                        className={dup ? "ref-entry ref-entry-dup" : "ref-entry"}
                        title={`${e.key} · @${e.type} · 点击跳到条目`}
                        onClick={() => jumpToFile(e.file, e.line)}
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
                        <span className="ref-type">@{e.type}</span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
