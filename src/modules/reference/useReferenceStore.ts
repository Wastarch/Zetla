// M1-14a · 引用索引 store（纯前端）—— 见 docs/开发计划.md M1-14a
// 职责：收集项目内全部 .bib → 解析 → 构建 key 索引 + 重复 key 集合。
// 触发：项目树变化 / 已打开 .bib 缓冲区内容变化（防抖）；解析全缓存，热路径零重算。
import { create } from "zustand";
import { parseBib, findDuplicateKeys, type BibEntry } from "./bibParser";
import { useProjectStore, extOf } from "@/project/useProject";
import { useBuffersStore } from "@/editor/useBuffers";
import { projectApi } from "@/ipc/invoke";
import type { ProjectNode } from "@/types";

/** 递归收集项目树内所有 .bib 文件绝对路径 */
function collectBibFiles(nodes: ProjectNode[] | undefined, out: string[]): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type === "file" && extOf(node.name) === "bib") out.push(node.path);
    else if (node.type === "dir" && node.children) collectBibFiles(node.children, out);
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
  /** 重新扫描并重建索引 */
  reindex: () => Promise<void>;
}

export const useReferenceStore = create<ReferenceState>((set) => ({
  ready: false,
  entries: [],
  byKey: new Map(),
  duplicateKeys: new Set(),

  reindex: async () => {
    const { root, tree } = useProjectStore.getState();
    if (!root || !tree) {
      set({ ready: true, entries: [], byKey: new Map(), duplicateKeys: new Set() });
      return;
    }

    const bibPaths: string[] = [];
    collectBibFiles(tree.nodes, bibPaths);
    if (bibPaths.length === 0) {
      set({ ready: true, entries: [], byKey: new Map(), duplicateKeys: new Set() });
      return;
    }

    // 取内容：已打开缓冲优先（实时），否则读盘
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

    set({
      ready: true,
      entries,
      byKey,
      duplicateKeys: findDuplicateKeys(entries),
    });
  },
}));

let watcherStarted = false;

/**
 * 启动引用索引监听（模块级只启一次，在 App 根部调用）。
 * - 项目树/根变化 → 防抖重索引（覆盖新增/改名/删除 .bib）
 * - 已打开 .bib 缓冲内容变化 → 防抖重索引（编辑实时反映到补全/校验）
 * - 非 .bib 缓冲（如 .tex）变化不触发，避免无谓解析
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
    if (s.tree !== prev.tree || s.root !== prev.root) schedule();
  });

  useBuffersStore.subscribe((s, prev) => {
    if (s.buffers === prev.buffers) return;
    const changed = s.buffers.some((b, idx) => {
      const before = prev.buffers[idx];
      return extOf(b.name) === "bib" && (!before || before.content !== b.content);
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
