// M1-13 · 更新状态机（zustand）
// status: idle → checking → (uptodate | update → downloading → downloaded | error)
// 红点：hasUpdate = update | downloading | downloaded
// U1：先取本机 env（Rust update_env_info），再按平台从 v2 清单挑条目（pickEntry）
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetchLatest, fetchUpdateEnv, isMandatory, isNewer } from "./checkUpdate";
import { pickEntry, needsManualInstall, packageSources } from "./platformEntry";
import { APP_VERSION } from "@/version";
import type {
  LatestInfo,
  ResolvedEntry,
  UpdateEnv,
  UpdateProgress,
} from "./types";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "uptodate"
  | "update"
  | "downloading"
  | "downloaded"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  latest: LatestInfo | null;
  /** 本机更新环境（取不到为 null，回退旧逻辑） */
  env: UpdateEnv | null;
  /** 本次可用的更新包条目（按平台挑选；无可用包为 null） */
  entry: ResolvedEntry | null;
  mandatory: boolean;
  error: string | null;
  progress: UpdateProgress | null;
  downloadedPath: string | null;
  /** U4：本次更新只能「下载 + 交系统安装器」（deb/rpm），应用不会替换自身 */
  manualInstall: boolean;
  /** U4：打开安装包失败的原因（无图形界面 / 无关联安装器）；有值时界面提示手动安装 */
  openError: string | null;
  loadEnv: () => Promise<UpdateEnv | null>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  /** U4：deb/rpm 引导 —— 下载系统安装包并交给系统安装器 */
  downloadPackage: () => Promise<void>;
  /** U4：重新用系统安装器打开已下载的包（无 GUI 场景下由用户手动安装） */
  openPackage: () => Promise<void>;
  confirmInstall: () => Promise<void>;
  openRelease: () => void;
  retry: () => Promise<void>;
  setProgress: (p: UpdateProgress) => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  latest: null,
  env: null,
  entry: null,
  mandatory: false,
  error: null,
  progress: null,
  downloadedPath: null,
  manualInstall: false,
  openError: null,

  setProgress: (p) => set({ progress: p }),

  /** 取一次并缓存；失败不重试（下次 check 会再试） */
  loadEnv: async () => {
    const cached = get().env;
    if (cached) return cached;
    const env = await fetchUpdateEnv();
    if (env) set({ env });
    return env;
  },

  check: async () => {
    set({ status: "checking", error: null, openError: null });
    // 先拿平台环境：失败也继续（pickEntry 会退回顶层 installers，Windows 行为不变）
    const env = await get().loadEnv();
    const latest = await fetchLatest();
    if (!latest) {
      // 拉不到：静默视为已是最新，不弹错误（避免网络抖动骚扰）
      set({ status: "uptodate", entry: null });
      return;
    }
    if (isNewer(latest.version, APP_VERSION)) {
      const entry = pickEntry(latest, env);
      set({
        status: "update",
        latest,
        entry,
        // U4：deb/rpm 只能下载后交系统安装器，界面据此换按钮组
        manualInstall: needsManualInstall(entry),
        mandatory: isMandatory(latest),
      });
    } else {
      set({
        status: "uptodate",
        latest,
        entry: null,
        manualInstall: false,
        mandatory: false,
      });
    }
  },

  download: async () => {
    const { latest, entry } = get();
    if (!latest) return;
    if (!entry || entry.kind === "none" || entry.installers.length === 0) {
      // 没有可用的自更新包：如实报错，引导用户走发布页
      set({
        status: "error",
        error: get().env?.reason ?? "当前平台暂无可用的更新包，请前往发布页手动下载。",
        progress: null,
      });
      return;
    }
    set({
      status: "downloading",
      error: null,
      manualInstall: false,
      openError: null,
      progress: { downloaded: 0, total: 0, source: "" },
    });
    try {
      const path = await invoke<string>("download_app_update", {
        installers: entry.installers,
      });
      set({ status: "downloaded", downloadedPath: path, progress: null });
    } catch (e) {
      set({ status: "error", error: String(e), progress: null });
    }
  },

  /**
   * U4 · deb/rpm 引导：下载系统安装包后交给系统安装器（xdg-open → GNOME Software /
   * Discover / GDebi，自带提权）。应用不替换自身、不退出。
   * 打不开时（无 GUI / 无关联安装器）保持「已下载」状态并记下 openError，
   * 由界面降级为「安装包已下载到 …」+「复制路径」。
   */
  downloadPackage: async () => {
    const { latest, entry } = get();
    if (!latest) return;
    const sources = packageSources(entry);
    if (sources.length === 0) {
      set({
        status: "error",
        error: "本次更新未提供当前平台的系统安装包，请前往发布页手动下载。",
        progress: null,
      });
      return;
    }
    set({
      status: "downloading",
      error: null,
      manualInstall: true,
      openError: null,
      progress: { downloaded: 0, total: 0, source: "" },
    });
    try {
      const path = await invoke<string>("download_app_update", { installers: sources });
      set({ status: "downloaded", downloadedPath: path, progress: null });
      // 下载完直接拉起系统安装器；失败只影响提示，不改状态
      await get().openPackage();
    } catch (e) {
      set({ status: "error", error: String(e), progress: null });
    }
  },

  openPackage: async () => {
    const { downloadedPath } = get();
    if (!downloadedPath) return;
    try {
      await invoke("open_downloaded_package", { path: downloadedPath });
      set({ openError: null });
    } catch (e) {
      set({ openError: String(e) });
    }
  },

  confirmInstall: async () => {
    const { downloadedPath } = get();
    if (!downloadedPath) return;
    try {
      // U3：统一入口，Rust 内按平台分派（Windows 拉起安装向导 / Linux 原地替换 AppImage）
      await invoke("apply_update_and_exit", { path: downloadedPath });
      // 成功时进程已被 Rust 退出，走不到这里
    } catch (e) {
      // 预检或换包失败时进程还活着，把原因显示出来（绝不静默失败）
      set({
        status: "error",
        error: String(e),
        // 落盘文件可能已被替换/清理，重试需要重新下载
        progress: null,
      });
    }
  },

  openRelease: () => {
    const { latest } = get();
    if (latest?.releaseUrl) void openUrl(latest.releaseUrl);
  },

  retry: async () => {
    set({ error: null });
    await get().check();
    if (get().status !== "update") return;
    // 重试也要按通道分流：deb/rpm 重新下载系统包，其余走自更新下载
    if (needsManualInstall(get().entry)) await get().downloadPackage();
    else await get().download();
  },
}));

/** 能否在应用内完成换包（env 未知时按旧逻辑乐观处理，仅 Windows 会走到这里） */
export const selectCanApply = (s: UpdateState): boolean =>
  s.env ? s.env.canSelfUpdate : true;

/** 选择器：是否应显示红点 */
export const selectHasUpdate = (s: UpdateState): boolean =>
  s.status === "update" || s.status === "downloading" || s.status === "downloaded";
