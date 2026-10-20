// 全局状态（zustand）—— 项目、编译、编辑器的共享状态
import { create } from "zustand";
import type { CompileResult, ProjectInfo } from "@/types";

export type CompileStatus = "idle" | "running" | "ok" | "error" | "cancelled";

interface AppState {
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
}

export const useAppStore = create<AppState>((set) => ({
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
}));
