// 全局状态（zustand）—— 项目、编译、编辑器的共享状态
import { create } from "zustand";
import type { CompileResult, ProjectInfo, TexDistInfo } from "@/types";

export type CompileStatus = "idle" | "running" | "ok" | "error" | "cancelled";

/** 偏好设置页当前打开的页签（null = 关闭） */
export type SettingsPane = "general" | "build" | "editor" | "pdf" | "look" | "about";

/** 全局状态接口（M0-13：useWindowMemory 订阅布局字段需要类型） */
export interface AppState {
  // ── 布局 ──
  /** M0-13 前移：资源树可见性（视图菜单/快捷键切换） */
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  /** M0-13：侧栏宽度（170–560，拖拽写入，偏好设置持久化） */
  sidebarWidth: number;
  /** M0-13：编辑区/预览比例（0.2–0.75，拖拽写入，偏好设置持久化） */
  previewRatio: number;

  // ── 偏好设置（M0-14a）──
  /** 设置页状态：null 关闭；否则为打开时停留的页签 */
  settingsDialog: SettingsPane | null;
  openSettings: (pane?: SettingsPane) => void;
  closeSettings: () => void;

  // ── PDF 预览（M0-10）──
  previewVisible: boolean;
  togglePreview: () => void;
  /** 最近一次「成功」编译的 PDF 路径（失败时保留旧值，不清屏） */
  previewPdf: string | null;
  /** 成功编译计数：同路径重编译也能触发重新加载 */
  previewRev: number;
  /** 直接展示指定 PDF（项目树 / 文件菜单打开已有 PDF） */
  showPdf: (path: string) => void;

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

  // ── 编译日志（M0-9：原始输出；M0-12：错误/警告结构化页签） ──
  logVisible: boolean;
  toggleLog: () => void;
  /** 底部日志面板当前页签 */
  logTab: "errors" | "warnings" | "all";
  setLogTab: (t: "errors" | "warnings" | "all") => void;
  compileLog: string[];
  appendLog: (lines: string[]) => void;
  clearLog: () => void;

  // ── TeX 环境（M0-15a）──
  /** 最近一次发行版检测结果（null=尚未检测） */
  env: TexDistInfo | null;
  /** 环境引导面板开关 */
  envGuideOpen: boolean;
  /** dev-only：模拟「未检测到 TeX」（仅引导面板调试按钮使用，不落盘，重启重置） */
  envDebugMock: boolean;
  setEnv: (info: TexDistInfo | null) => void;
  setEnvGuideOpen: (open: boolean) => void;
  setEnvDebugMock: (on: boolean) => void;
}

/** 日志保留上限（防止长时间编译吃内存） */
const LOG_LIMIT = 800;

export const useAppStore = create<AppState>((set) => ({
  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  sidebarWidth: 258,
  previewRatio: 0.5,

  // ── 偏好设置（M0-14a）──
  settingsDialog: null,
  openSettings: (pane = "build") => set({ settingsDialog: pane }),
  closeSettings: () => set({ settingsDialog: null }),

  previewVisible: true,
  togglePreview: () => set((s) => ({ previewVisible: !s.previewVisible })),
  previewPdf: null,
  previewRev: 0,
  showPdf: (path) =>
    set((s) => ({
      previewPdf: path,
      previewRev: s.previewRev + 1,
      previewVisible: true,
    })),

  project: null,
  openProject: (p) =>
    set({
      project: p,
      lastResult: null,
      compileStatus: "idle",
      previewPdf: null,
      previewRev: 0,
    }),
  closeProject: () =>
    set({
      project: null,
      lastResult: null,
      compileStatus: "idle",
      compilePct: 0,
      previewPdf: null,
      previewRev: 0,
    }),

  compileStatus: "idle",
  compilePct: 0,
  compileCurrent: "",
  lastResult: null,
  setCompiling: (pct, current) =>
    set({ compileStatus: "running", compilePct: pct, compileCurrent: current }),
  setCompileDone: (r) =>
    set((s) => {
      // 只有成功且拿到产物才更新预览；失败保留上一次成功的 PDF
      const fresh = r.status === "ok" && !!r.pdfPath;
      return {
        compileStatus:
          r.status === "ok" ? "ok" : r.status === "cancelled" ? "cancelled" : "error",
        lastResult: r,
        compilePct: 100,
        compileCurrent: "",
        previewPdf: fresh ? r.pdfPath! : s.previewPdf,
        previewRev: fresh ? s.previewRev + 1 : s.previewRev,
      };
    }),
  resetCompile: () => set({ compileStatus: "idle", compilePct: 0, compileCurrent: "" }),

  logVisible: false,
  toggleLog: () => set((s) => ({ logVisible: !s.logVisible })),
  logTab: "errors",
  setLogTab: (t) => set({ logTab: t }),
  compileLog: [],
  appendLog: (lines) =>
    set((s) => {
      if (lines.length === 0) return s;
      const next = s.compileLog.concat(lines);
      return { compileLog: next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next };
    }),
  clearLog: () => set({ compileLog: [] }),

  // ── TeX 环境（M0-15a）──
  env: null,
  envGuideOpen: false,
  envDebugMock: false,
  setEnv: (info) => set({ env: info }),
  setEnvGuideOpen: (open) => set({ envGuideOpen: open }),
  setEnvDebugMock: (on) => set({ envDebugMock: on }),
}));
