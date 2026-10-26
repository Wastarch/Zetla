// M1-14a · 引用索引 store（纯前端）—— 见 docs/开发计划.md M1-14a
// 职责：收集项目内全部 .bib → 解析 → 构建 key 索引 + 重复 key 集合；
//       并收集全部 .tex → 构建反向引用索引（key → 引用位置，M1-14g）。
// 触发：项目树变化 / 已打开 .bib 或 .tex 缓冲区内容变化（防抖）；解析全缓存，热路径零重算。
import { create } from "zustand";
import { parseBib, findDuplicateKeys, type BibEntry } from "./bibParser";
import { useProjectStore, extOf } from "@/project/useProject";
import { useBuffersStore } from "@/editor/useBuffers";
import { projectApi } from "@/ipc/invoke";
import { scanCitesForIndex } from "./lintLogic";
import type { ProjectNode } from "@/types";

/** 单个 \cite 引用位置（反向引用索引用） */
export interface CiteRef {
  file: string;
  line: number;
}

/** 递归收集项目树内所有 .bib 文件绝对路径 */
function collectBibFiles(nodes: ProjectNode[] | undefined, out: string[]): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type === "file" && extOf(node.name) === "bib") out.push(node.path);
    else if (node.type === "dir" && node.children) collectBibFiles(node.children, out);
  }
}

/** 递归收集项目树内所有 .tex / .ltx 文件绝对路径 */
function collectTexFiles(nodes: ProjectNode[] | undefined, out: string[]): void {
  if (!nodes) return;
  for (const node of nodes) {
    const e = extOf(node.name);
    if (node.type === "file" && (e === "tex" || e === "ltx")) out.push(node.path);
    else if (node.type === "dir" && node.children) collectTexFiles(node.children, out);
  }
}

interface ReferenceState {
  /** 索引是否已就绪（至少跑过一次，含「无项目/无 bib」的空结果） */
  ready: boolean;
  /** 全部条目（跨项目内所有 .bib） */
  entries: BibEntry[];
  /** key → 条目（支持重复 key 多值） */
  byKey: Map<string, BibEntry[]>;
  /** 重复 key 集合 */
  duplicateKeys: Set<string>;
  /** 全部引用位置（扁平，按文件遍历顺序；供汇总/校验直接推导） */
  citations: { key: string; file: string; line: number }[];
  /** 反向引用索引：key → 引用位置（来自项目内所有 .tex / .ltx） */
  citesByKey: Map<string, CiteRef[]>;
  /** 失效反向引用缓存（项目树变化时调用，强制重读所有 .tex） */
  invalidateCitations: () => void;
  /** 重新扫描并重建索引 */
  reindex: () => Promise<void>;
}

/** 反向引用增量缓存：path → 内容 + 已解析引用（已打开走 buffer，关闭文件缓存复用） */
let citeCache = new Map<string, { content: string; citations: { key: string; line: number }[] }>();

export const useReferenceStore = create<ReferenceState>((set) => ({
  ready: false,
  entries: [],
  byKey: new Map(),
  duplicateKeys: new Set(),
  citations: [],
  citesByKey: new Map(),

  invalidateCitations: () => {
    citeCache.clear();
  },

  reindex: async () => {
    const { root, tree } = useProjectStore.getState();
    if (!root || !tree) {
      set({
        ready: true,
        entries: [],
        byKey: new Map(),
        duplicateKeys: new Set(),
        citations: [],
        citesByKey: new Map(),
      });
      return;
    }

    // 1) .bib → 条目（已打开缓冲优先，否则读盘）
    const bibPaths: string[] = [];
    collectBibFiles(tree.nodes, bibPaths);
    const open = useBuffersStore.getState().buffers;
    const textByPath = new Map<string, string>();
    for (const p of bibPaths) {
      const buf = open.find((b) => b.path.toLowerCase() === p.toLowerCase());
      if (buf) {
        textByPath.set(p, buf.content);
        continue;
      }
      try {
        const d = await projectApi.readFile(p);
        textByPath.set(p, d.content);
      } catch {
        // 读不到则跳过该文件
      }
    }

    const entries: BibEntry[] = [];
    for (const [p, text] of textByPath) {
      try {
        for (const e of parseBib(text, p)) entries.push(e);
      } catch {
        // 单文件解析异常不影响整体
      }
    }

    const byKey = new Map<string, BibEntry[]>();
    for (const e of entries) {
      const arr = byKey.get(e.key) ?? [];
      arr.push(e);
      byKey.set(e.key, arr);
    }
    const duplicateKeys = findDuplicateKeys(entries);

    // 2) .tex / .ltx → 反向引用索引（增量：已打开走 buffer，关闭文件缓存复用；内容未变跳过重扫）
    const texPaths: string[] = [];
    collectTexFiles(tree.nodes, texPaths);
    const allCites: { key: string; file: string; line: number }[] = [];
    for (const p of texPaths) {
      const buf = open.find((b) => b.path.toLowerCase() === p.toLowerCase());
      let content: string | null = null;
      if (buf) {
        content = buf.content; // 实时：内存优先，零磁盘 IO
      } else {
        const cached = citeCache.get(p);
        if (cached) {
          allCites.push(...cached.citations.map((c) => ({ ...c, file: p })));
          continue; // 关闭文件且已缓存 → 复用，不读盘不重扫
        }
        try {
          const d = await projectApi.readFile(p);
          content = d.content;
        } catch {
          continue; // 读不到则跳过
        }
      }
      if (content != null) {
        const cached = citeCache.get(p);
        if (cached && cached.content === content) {
          allCites.push(...cached.citations.map((c) => ({ ...c, file: p })));
          continue; // 内容未变 → 复用
        }
        const cites = scanCitesForIndex(content);
        citeCache.set(p, { content, citations: cites });
        allCites.push(...cites.map((c) => ({ ...c, file: p })));
      }
    }
    const citesByKey = new Map<string, CiteRef[]>();
    for (const c of allCites) {
      const arr = citesByKey.get(c.key) ?? [];
      arr.push({ file: c.file, line: c.line });
      citesByKey.set(c.key, arr);
    }

    set({
      ready: true,
      entries,
      byKey,
      duplicateKeys,
      citations: allCites,
      citesByKey,
    });
  },
}));

let watcherStarted = false;

/**
 * 启动引用索引监听（模块级只启一次，在 App 根部调用）。
 * - 项目树/根变化 → 清反向引用缓存 + 防抖重索引（覆盖新增/改名/删除 .bib/.tex）
 * - 已打开 .bib/.tex/.ltx 缓冲内容变化 → 防抖重索引（增量：仅重扫变更文件）
 */
export function startReferenceWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;

  let timer: number | null = null;
  const schedule = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void useReferenceStore.getState().reindex();
    }, 300);
  };

  useProjectStore.subscribe((s, prev) => {
    if (s.tree !== prev.tree || s.root !== prev.root) {
      // 树变化（新增/删除/改名/切换项目）→ 清反向引用缓存，强制重读
      useReferenceStore.getState().invalidateCitations();
      schedule();
    }
  });

  useBuffersStore.subscribe((s, prev) => {
    if (s.buffers === prev.buffers) return;
    const changed = s.buffers.some((b, idx) => {
      const before = prev.buffers[idx];
      const e = extOf(b.name);
      const tracked = e === "bib" || e === "tex" || e === "ltx";
      return tracked && (!before || before.content !== b.content);
    });
    if (changed) schedule();
  });

  // 初次索引
  void useReferenceStore.getState().reindex();
}

// 开发期调试：暴露到全局，便于在浏览器控制台验证引用索引（仅 DEV，生产构建不携带）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__refStore = useReferenceStore;
}
