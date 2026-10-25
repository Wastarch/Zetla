// M1-13 · 更新状态机（zustand）
// status: idle → checking → (uptodate | update → downloading → downloaded | error)
// 红点：hasUpdate = update | downloading | downloaded
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetchLatest, isMandatory, isNewer } from "./checkUpdate";
import { APP_VERSION } from "@/version";
import type { LatestInfo, UpdateProgress } from "./types";

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
  mandatory: boolean;
  error: string | null;
  progress: UpdateProgress | null;
  downloadedPath: string | null;
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
  mandatory: false,
  error: null,
  progress: null,
  downloadedPath: null,

  setProgress: (p) => set({ progress: p }),

  check: async () => {
    set({ status: "checking", error: null });
    const latest = await fetchLatest();
    if (!latest) {
      // 拉不到：静默视为已是最新，不弹错误（避免网络抖动骚扰）
      set({ status: "uptodate" });
      return;
    }
    if (isNewer(latest.version, APP_VERSION)) {
      set({ status: "update", latest, mandatory: isMandatory(latest) });
    } else {
      set({ status: "uptodate", latest, mandatory: false });
    }
  },

  download: async () => {
    const { latest } = get();
    if (!latest) return;
    set({
      status: "downloading",
      error: null,
      progress: { downloaded: 0, total: 0, source: "" },
    });
    try {
      const path = await invoke<string>("download_app_update", {
        installers: latest.installers,
      });
      set({ status: "downloaded", downloadedPath: path, progress: null });
    } catch (e) {
      set({ status: "error", error: String(e), progress: null });
    }
  },

  confirmInstall: async () => {
    const { downloadedPath } = get();
    if (!downloadedPath) return;
    // 触发后进程会退出；前端无需处理返回值（invoke 可能因进程退出被拒，忽略即可）
    await invoke("launch_installer_and_exit", { path: downloadedPath }).catch(() => {});
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

/** 选择器：是否应显示红点 */
export const selectHasUpdate = (s: UpdateState): boolean =>
  s.status === "update" || s.status === "downloading" || s.status === "downloaded";
