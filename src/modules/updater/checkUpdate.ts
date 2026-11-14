// M1-13 · 更新检测：拉取 latest.json + semver 比较；U1 追加本机平台环境查询
import { invoke } from "@tauri-apps/api/core";
import semver from "semver";
import { APP_VERSION } from "@/version";
import { ENDPOINTS } from "./endpoints";
import type { LatestInfo, UpdateEnv } from "./types";

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
 *
 * U1：校验放宽为「有 version，且 installers 或 platforms 至少一项非空」——
 * v2 清单可能只为部分平台提供包，不再要求顶层 installers 必须有内容。
 */
export async function fetchLatest(): Promise<LatestInfo | null> {
  try {
    const text = await invoke<string>("fetch_latest_json", { urls: ENDPOINTS });
    const data = JSON.parse(text) as LatestInfo;
    if (!data?.version) return null;
    const hasInstallers =
      Array.isArray(data.installers) && data.installers.length > 0;
    const platforms = data.platforms;
    const hasPlatforms =
      !!platforms &&
      typeof platforms === "object" &&
      Object.keys(platforms).length > 0;
    if (!hasInstallers && !hasPlatforms) return null;
    return data;
  } catch (e) {
    // DEV 下打印具体原因（如「所有更新源均不可用：…」），生产静默当已是最新
    if (import.meta.env.DEV) console.warn("[update] 拉取 latest.json 失败：", e);
    return null;
  }
}

/**
 * U1：查询本机更新环境（平台键 / 期望包类型 / 能否自更新）。
 * 失败返回 null —— 调用方回退到旧逻辑（只看顶层 installers），不影响 Windows 现有链路。
 */
export async function fetchUpdateEnv(): Promise<UpdateEnv | null> {
  try {
    return await invoke<UpdateEnv>("update_env_info");
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[update] 读取平台环境失败：", e);
    return null;
  }
}
