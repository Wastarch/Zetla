// M1-13 · 更新状态机（zustand）
// status: idle → checking → (uptodate | update → downloading → downloaded | error)
// 红点：hasUpdate = update | downloading | downloaded
// U1：先取本机 env（Rust update_env_info），再按平台从 v2 清单挑条目（pickEntry）
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetchLatest, fetchUpdateEnv, isMandatory, isNewer } from "./checkUpdate";
import { pickEntry } from "./platformEntry";
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
  loadEnv: () => Promise<UpdateEnv | null>;
  check: () => Promise<void>;
  download: () => Promise<void>;
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
    set({ status: "checking", error: null });
    // 先拿平台环境：失败也继续（pickEntry 会退回顶层 installers，Windows 行为不变）
    const env = await get().loadEnv();
    const latest = await fetchLatest();
    if (!latest) {
      // 拉不到：静默视为已是最新，不弹错误（避免网络抖动骚扰）
      set({ status: "uptodate", entry: null });
      return;
    }
    if (isNewer(latest.version, APP_VERSION)) {
      set({
        status: "update",
        latest,
        entry: pickEntry(latest, env),
        mandatory: isMandatory(latest),
      });
    } else {
      set({ status: "uptodate", latest, entry: null, mandatory: false });
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
    if (get().status === "update") await get().download();
  },
}));

/** 能否在应用内完成换包（env 未知时按旧逻辑乐观处理，仅 Windows 会走到这里） */
export const selectCanApply = (s: UpdateState): boolean =>
  s.env ? s.env.canSelfUpdate : true;

/** 选择器：是否应显示红点 */
export const selectHasUpdate = (s: UpdateState): boolean =>
  s.status === "update" || s.status === "downloading" || s.status === "downloaded";
