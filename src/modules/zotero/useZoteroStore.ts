// Zotero 联动 · P0 运行时状态：连接自检 / 状态灯 / 轮询 / 离线降级
//
// 关键约束：
// - 自检**不参与编译链路**，任何失败都收敛成一个 offline/unavailable 结果，绝不抛出阻断；
// - 关闭联动时不自动发请求（设置页「一键自检」仍可手动触发）；
// - React StrictMode 会让组件首次挂载假卸载一次，故运行时做成**模块级单例**，
//   只用 import.meta.hot.dispose 清理，不跟随组件 useEffect cleanup；
// - Rust 的 zotero_health 会同时 emit `zotero:status`，这里订阅它作为第二条更新通道，
//   与命令返回值幂等（同一份 ZoteroHealth）。
import { create } from "zustand";
import { zoteroApi } from "@/ipc/invoke";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import { useSettingsStore } from "@/core/settings";
import {
  DEFAULT_ZOTERO_SETTINGS,
  type ZoteroBinding,
  type ZoteroConsistency,
  type ZoteroHealth,
  type ZoteroKeyMap,
  type ZoteroSettings,
  type ZoteroSyncRecord,
} from "@/types/zotero";
import {
  nextPollDelayMs,
  normalizePort,
  shouldPoll,
  type ZoteroPollSettings,
} from "./zoteroDiagnostics";
import type { ConcreteBibFormat, EffectiveFormat } from "./zoteroFormat";

/** P11：新建 .bib 后「补引用环境」提示的触发参数（详情由弹窗挂载后自行读盘计算） */
export interface BibSetupPrompt {
  /** 新建 .bib 的项目内相对路径（用于写 \bibliography 的命令名） */
  bibPath: string;
  /** 引用所在主 .tex 绝对路径 */
  texPath: string;
  /** 当前生效的参考文献引擎 */
  format: ConcreteBibFormat;
}

export interface ZoteroStoreState {
  /** 最近一次自检结果（关闭联动时也可能保留历史值） */
  health: ZoteroHealth | null;
  checking: boolean;
  /** 最近一次 connected 的时刻，用于「离线（缓存于 xx:xx:xx）」 */
  lastGoodAt: string | null;
  error: string | null;
  /** 手动/自动自检；永不抛异常，失败返回降级后的 health */
  check: (port?: number) => Promise<ZoteroHealth | null>;
  /** 由 Rust 事件或命令结果写入（幂等） */
  applyHealth: (h: ZoteroHealth) => void;

  // ── P1 · 自动化同步状态 ──────────────────────────────────
  /** 当前项目的 collection → .bib 绑定 */
  bindings: ZoteroBinding[];
  /** citekey ↔ itemKey 映射（.ltex/zotero/map.json 的内存镜像） */
  keyMap: ZoteroKeyMap | null;
  /** 最近一次主动同步结果 */
  lastSync: ZoteroSyncRecord | null;
  syncBusy: boolean;
  syncError: string | null;
  /** 编译前一致性诊断（只读，不阻断编译） */
  consistency: ZoteroConsistency | null;
  /** 最近一次受管 .bib 变更事件 */
  bibChange: { path: string; hash: string; reason: string; at: string } | null;
  /** P9：项目参考文献格式（配置 + 主 .tex 检测 + 生效值），换项目时由 runtime 重算 */
  bibFormat: EffectiveFormat;
  setBibFormat: (f: EffectiveFormat) => void;
  /** P11：新建 .bib 后待确认的「补引用环境」提示（全局弹窗消费；取消/完成后置 null） */
  bibSetupPrompt: BibSetupPrompt | null;
  setBibSetupPrompt: (p: BibSetupPrompt | null) => void;
  setBindings: (b: ZoteroBinding[]) => void;
  setKeyMap: (m: ZoteroKeyMap | null) => void;
  setLastSync: (r: ZoteroSyncRecord | null) => void;
  setSyncBusy: (v: boolean) => void;
  setSyncError: (v: string | null) => void;
  setConsistency: (c: ZoteroConsistency | null) => void;
  noteBibChange: (e: { path: string; hash: string; reason: string }) => void;
}

/** IPC 本身失败（非 Tauri 预览环境 / 命令未注册）时的本地兜底结果 */
function fallbackHealth(port: number, message: string): ZoteroHealth {
  return {
    state: "offline",
    httpStatus: null,
    apiVersion: null,
    schemaVersion: null,
    serverId: null,
    zoteroVersion: null,
    canWrite: false,
    bbtAvailable: false,
    port,
    checkedAt: new Date().toISOString(),
    message,
  };
}

export const useZoteroStore = create<ZoteroStoreState>((set, get) => ({
  health: null,
  checking: false,
  lastGoodAt: null,
  error: null,

  // P1 状态初值（纯内存，换项目时由 zoteroRuntime 重新载入）
  bindings: [],
  keyMap: null,
  lastSync: null,
  syncBusy: false,
  syncError: null,
  consistency: null,
  bibChange: null,
  bibFormat: { configured: "auto", detected: "none", effective: null, needsChoice: false },
  setBibFormat: (bibFormat) => set({ bibFormat }),
  bibSetupPrompt: null,
  setBibSetupPrompt: (bibSetupPrompt) => set({ bibSetupPrompt }),
  setBindings: (bindings) => set({ bindings }),
  setKeyMap: (keyMap) => set({ keyMap }),
  setLastSync: (lastSync) => set({ lastSync }),
  setSyncBusy: (syncBusy) => set({ syncBusy }),
  setSyncError: (syncError) => set({ syncError }),
  setConsistency: (consistency) => set({ consistency }),
  noteBibChange: (e) =>
    set({ bibChange: { ...e, at: new Date().toISOString() } }),

  check: async (port) => {
    const cfg = currentSettings();
    const p = normalizePort(port ?? cfg.port);
    if (get().checking) return get().health; // 合并并发自检，避免轮询与窗口获焦撞车
    set({ checking: true, error: null });
    try {
      const h = await zoteroApi.health(p);
      get().applyHealth(h);
      return h;
    } catch (e) {
      const h = fallbackHealth(p, `自检请求失败：${String(e)}`);
      get().applyHealth(h);
      return h;
    } finally {
      set({ checking: false });
    }
  },
  applyHealth: (h) =>
    set((s) => ({
      health: h,
      lastGoodAt: h.state === "connected" ? h.checkedAt : s.lastGoodAt,
      error: h.state === "connected" ? null : h.message,
    })),
}));

function currentSettings(): ZoteroSettings {
  return useSettingsStore.getState().settings.zotero ?? DEFAULT_ZOTERO_SETTINGS;
}

// ── 模块级单例运行时 ──────────────────────────────────────────
let installed = false;
let unlistenEvent: (() => void) | null = null;
let unsubscribeSettings: (() => void) | null = null;
let pollTimer: number | undefined;
let settingsDebounce: number | undefined;
let lastFocusCheck = 0;

function clearPoll() {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function schedulePoll() {
  clearPoll();
  const cfg: ZoteroPollSettings = currentSettings();
  if (!shouldPoll(cfg)) return;
  pollTimer = window.setInterval(() => {
    const s = currentSettings();
    if (!shouldPoll(s)) return;
    if (!useZoteroStore.getState().checking) {
      void useZoteroStore.getState().check(s.port);
    }
  }, nextPollDelayMs(cfg));
}

function onFocus() {
  const cfg = currentSettings();
  if (!shouldPoll(cfg)) return;
  const now = Date.now();
  if (now - lastFocusCheck < 3000) return; // 获焦与轮询可能撞在一起，节流
  lastFocusCheck = now;
  if (!useZoteroStore.getState().checking) {
    void useZoteroStore.getState().check(cfg.port);
  }
}

/** App 常驻组件挂载时调用（重复调用无副作用） */
export function startZoteroRuntime(): void {
  if (installed) return;
  installed = true;

  void onKernelEvent<ZoteroHealth>(RustEvents.zoteroStatus, (h) => {
    if (h && typeof h.state === "string") useZoteroStore.getState().applyHealth(h);
  })
    .then((fn) => {
      unlistenEvent = fn;
    })
    .catch(() => {});

  // 设置页即时预览会连续改端口；300ms 防抖后再重启轮询并自检，避免边打字边打 Zotero
  unsubscribeSettings = useSettingsStore.subscribe((s, prev) => {
    const a = s.settings.zotero;
    const b = prev.settings.zotero;
    if (!a || !b) return;
    if (
      a.enabled === b.enabled &&
      a.port === b.port &&
      a.autoSync === b.autoSync &&
      a.pollIntervalSeconds === b.pollIntervalSeconds
    ) {
      return;
    }
    if (settingsDebounce !== undefined) window.clearTimeout(settingsDebounce);
    settingsDebounce = window.setTimeout(() => {
      settingsDebounce = undefined;
      schedulePoll();
      const cfg = currentSettings();
      if (cfg.enabled && !useZoteroStore.getState().checking) {
        void useZoteroStore.getState().check(cfg.port);
      }
    }, 300);
  });

  window.addEventListener("focus", onFocus);
  schedulePoll();
  const cfg = currentSettings();
  if (cfg.enabled) void useZoteroStore.getState().check(cfg.port);
}

/** 仅 HMR / 测试用：完整清理，避免重复注册 */
export function stopZoteroRuntime(): void {
  clearPoll();
  if (settingsDebounce !== undefined) {
    window.clearTimeout(settingsDebounce);
    settingsDebounce = undefined;
  }
  unlistenEvent?.();
  unlistenEvent = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  window.removeEventListener("focus", onFocus);
  installed = false;
}

if (import.meta.hot) {
  import.meta.hot.dispose(stopZoteroRuntime);
}
