// M1-13 · 更新检测：拉取 latest.json + semver 比较
import { invoke } from "@tauri-apps/api/core";
import semver from "semver";
import { APP_VERSION } from "@/version";
import { ENDPOINTS } from "./endpoints";
import type { LatestInfo } from "./types";

/** latest.version 是否严格新于当前版本（手写不靠谱，用成熟库） */
export function isNewer(latest: string, current: string): boolean {
  try {
    return semver.gt(latest, current);
  } catch {
    return false;
  }
}

/** 是否强制更新：显式 mandatory 或当前版本低于 minVersion */
export function isMandatory(latest: LatestInfo): boolean {
  if (latest.mandatory) return true;
  if (latest.minVersion && semver.lt(APP_VERSION, latest.minVersion)) return true;
  return false;
}

/**
 * 经 Rust 侧（reqwest）依次尝试各端点拉取 latest.json —— 绕过 WebView 的 CORS 限制。
 * 全部失败（网络/404/JSON 非法）返回 null —— 调用方按「已是最新」静默处理。
 */
export async function fetchLatest(): Promise<LatestInfo | null> {
  try {
    const text = await invoke<string>("fetch_latest_json", { urls: ENDPOINTS });
    const data = JSON.parse(text) as LatestInfo;
    if (
      !data?.version ||
      !Array.isArray(data.installers) ||
      data.installers.length === 0
    ) {
      return null;
    }
    return data;
  } catch (e) {
    // DEV 下打印具体原因（如「所有更新源均不可用：…」），生产静默当已是最新
    if (import.meta.env.DEV) console.warn("[update] 拉取 latest.json 失败：", e);
    return null;
  }
}
