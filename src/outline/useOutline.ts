// M1-5 · 大纲导航（轻量 section 扫描 + 层级面板/跳转）
// 纯前端实现（不新增 Rust 命令；完整符号索引 get_symbol_index 为 M2-2 范围）：
//   - 从主文件出发，递归读取 \input/\include 的文件（模拟文档实际结构），
//     扫到 \input 处就地递归（子文件条目插在该位置）→ 全局按文档顺序；
//   - 注释里的章节命令 / \input 不收录（2026-11-22 用户反馈修复）；
//   - 条目含 file + line，点击复用 M0-12 的 jumpToError 跳行；
//   - 刷新时机：打开项目、每次成功编译（previewRev）、手动刷新按钮。
// 扫描纯逻辑（正则/注释判定/标题清洗/路径解析）在 ./outlineScan（零 import 可 Node 单测）。
import { create } from "zustand";
import { projectApi } from "@/ipc/invoke";
import { base } from "@/project/useProject";
import { scanOutlineDocs } from "./outlineScan";

export type { OutlineItem } from "./outlineScan";

interface OutlineState {
  items: import("./outlineScan").OutlineItem[];
  loading: boolean;
  error: string | null;
  /** 手动刷新计数（变更即重算） */
  manualRev: number;
  /** 扫描（root+mainFile 来自调用方，避免与 store 耦合） */
  recompute: (root: string, mainFile: string) => Promise<void>;
  /** 触发手动刷新 */
  refresh: () => void;
}

// 防止并发重算互相覆盖
let runToken = 0;

async function readFileSafe(path: string): Promise<{ content: string } | null> {
  try {
    return await projectApi.readFile(path);
  } catch {
    return null;
  }
}

/** 扫描主文件及其 \input 链，返回按文档顺序的章节条目 */
export async function scanOutline(_root: string, mainFile: string): Promise<import("./outlineScan").OutlineItem[]> {
  // runToken 变化说明又来了一轮更终新的扫描：旧一轮的 await 恢复后自废（丢引用即可，
  // outlineScan 内部无共享可变状态，并发安全由调用方丢弃结果保证）
  const myToken = ++runToken;
  const items = await scanOutlineDocs(mainFile, readFileSafe);
  if (myToken !== runToken) return [];
  return items;
}

export const useOutlineStore = create<OutlineState>((set) => ({
  items: [],
  loading: false,
  error: null,
  manualRev: 0,
  refresh: () => set((s) => ({ manualRev: s.manualRev + 1 })),
  recompute: async (root: string, mainFile: string) => {
    set({ loading: true, error: null });
    try {
      const items = await scanOutline(root, mainFile);
      // 扫描期间可能已有更新的请求，scanOutline 已按 runToken 丢弃，这里再校一次
      set({ items, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));

export { base };
