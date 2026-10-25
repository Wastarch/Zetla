// 全局状态（zustand）—— 项目、编译、编辑器的共享状态
import { create } from "zustand";
import type { CompileResult, ProjectInfo, TexDistInfo } from "@/types";

export type CompileStatus = "idle" | "running" | "ok" | "error" | "cancelled";

/** 侧栏视图（M1-5a · 活动栏切换）：资源管理器 / 大纲 / 公式。
 *  M1-12a：原「符号 / 公式」两视图合并为「公式」单视图（内部含 快捷工具/公式模板/搭建 三页签，
 *  输入/输出双区结构，见 src/project/MathView.tsx） */
export type SidebarView = "explorer" | "outline" | "math";

/** 偏好设置页当前打开的页签（null = 关闭） */
export type SettingsPane =
  | "general"
  | "build"
  | "editor"
  | "pdf"
  | "look"
  | "about"
  | "modules";

/** 全局状态接口（M0-13：useWindowMemory 订阅布局字段需要类型） */
export interface AppState {
  // ── 布局 ──
  /** M0-13 前移：资源树可见性（视图菜单/快捷键切换） */
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  /** M1-5a：侧栏当前视图（活动栏竖排图标切换；仅会话内记忆，不落盘） */
  sidebarView: SidebarView;
  /** M1-5a：活动栏点击 —— 同视图再点=折叠，异视图=切换并展开 */
  selectSidebarView: (v: SidebarView) => void;
  /** M1-5a：菜单/快捷键直接指定视图（总是展开，不折叠） */
  setSidebarView: (v: SidebarView) => void;
  /** M0-13：侧栏宽度（170–560，拖拽写入，偏好设置持久化） */
  sidebarWidth: number;
  /** M0-13：编辑区/预览比例（0.2–0.75，拖拽写入，偏好设置持久化） */
  previewRatio: number;
  /** PDF 预览内「缩略图/目录」侧栏宽度（110–380，拖拽写入，偏好设置持久化） */
  pvSideWidth: number;

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

  // ── SyncTeX 正向跳转目标（M1-4）──
  /** 源码 Ctrl+点击 → PDF 高亮 + 滚动定位；seq 保证重复跳同一位置仍触发。
   *  x/y/w/h 为 pt（scale=1 基准，y 自页顶向下） */
  pdfSync: { page: number; x: number; y: number; w: number; h: number; seq: number } | null;
  setPdfSync: (t: { page: number; x: number; y: number; w: number; h: number }) => void;

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
  /** 自动安装向导开关（M0-15b/c） */
  envSetupOpen: boolean;
  /** dev-only：模拟「未检测到 TeX」（仅引导面板调试按钮使用，不落盘，重启重置） */
  envDebugMock: boolean;
  setEnv: (info: TexDistInfo | null) => void;
  setEnvGuideOpen: (open: boolean) => void;
  setEnvSetupOpen: (open: boolean) => void;
  setEnvDebugMock: (on: boolean) => void;
}

/** 日志保留上限（防止长时间编译吃内存） */
const LOG_LIMIT = 800;

export const useAppStore = create<AppState>((set) => ({
  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  sidebarView: "explorer",
  selectSidebarView: (v) =>
    set((s) =>
      s.sidebarView === v
        ? { sidebarVisible: !s.sidebarVisible }
        : { sidebarView: v, sidebarVisible: true },
    ),
  setSidebarView: (v) => set({ sidebarView: v, sidebarVisible: true }),
  sidebarWidth: 258,
  previewRatio: 0.5,
  pvSideWidth: 132,

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

  pdfSync: null,
  setPdfSync: (t) =>
    set((s) => ({
      pdfSync: { ...t, seq: (s.pdfSync?.seq ?? 0) + 1 },
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
  envSetupOpen: false,
  envDebugMock: false,
  setEnv: (info) => set({ env: info }),
  setEnvGuideOpen: (open) => set({ envGuideOpen: open }),
  setEnvSetupOpen: (open) => set({ envSetupOpen: open }),
  setEnvDebugMock: (on) => set({ envDebugMock: on }),
}));
