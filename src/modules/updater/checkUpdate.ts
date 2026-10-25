// M1-13 · 更新检测：拉取 latest.json + semver 比较
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
 * 依次尝试各端点拉取 latest.json；任一成功即返回。
 * 全部失败（网络/404/JSON 非法）返回 null —— 调用方按「已是最新」静默处理。
 */
export async function fetchLatest(): Promise<LatestInfo | null> {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = (await res.json()) as LatestInfo;
      if (
        !data?.version ||
        !Array.isArray(data.installers) ||
        data.installers.length === 0
      ) {
        continue;
      }
      return data;
    } catch {
      continue;
    }
  }
  return null;
}
