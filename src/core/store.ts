// 全局状态（zustand）—— 项目、编译、编辑器的共享状态
import { create } from "zustand";
import type { CompileResult, ProjectInfo } from "@/types";

export type CompileStatus = "idle" | "running" | "ok" | "error" | "cancelled";

interface AppState {
  // ── 布局 ──
  /** M0-13 前移：资源树可见性（视图菜单/快捷键切换） */
  sidebarVisible: boolean;
  toggleSidebar: () => void;

  // ── 项目 ──
  project: ProjectInfo | null;
  openProject: (p: ProjectInfo) => void;
  closeProject: () => void;

  // ── 编译 ──
  compileStatus: CompileStatus;
  compilePct: number;
  compileCurrent: string;
  lastResult: CompileResult | null;
  setCompiling: (pct: number, current: string) => void;
  setCompileDone: (r: CompileResult) => void;
  resetCompile: () => void;

  // ── 编译日志（M0-9：原始输出；M0-11 再加结构化解析） ──
  logVisible: boolean;
  toggleLog: () => void;
  compileLog: string[];
  appendLog: (lines: string[]) => void;
  clearLog: () => void;
}

/** 日志保留上限（防止长时间编译吃内存） */
const LOG_LIMIT = 800;

export const useAppStore = create<AppState>((set) => ({
  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  project: null,
  openProject: (p) => set({ project: p, lastResult: null, compileStatus: "idle" }),
  closeProject: () =>
    set({ project: null, lastResult: null, compileStatus: "idle", compilePct: 0 }),

  compileStatus: "idle",
  compilePct: 0,
  compileCurrent: "",
  lastResult: null,
  setCompiling: (pct, current) =>
    set({ compileStatus: "running", compilePct: pct, compileCurrent: current }),
  setCompileDone: (r) =>
    set({
      compileStatus: r.status === "ok" ? "ok" : r.status === "cancelled" ? "cancelled" : "error",
      lastResult: r,
      compilePct: 100,
      compileCurrent: "",
    }),
  resetCompile: () => set({ compileStatus: "idle", compilePct: 0, compileCurrent: "" }),

  logVisible: false,
  toggleLog: () => set((s) => ({ logVisible: !s.logVisible })),
  compileLog: [],
  appendLog: (lines) =>
    set((s) => {
      if (lines.length === 0) return s;
      const next = s.compileLog.concat(lines);
      return { compileLog: next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next };
    }),
  clearLog: () => set({ compileLog: [] }),
}));
