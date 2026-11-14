// U1 · 清单协议 v2：按本机平台挑选更新包条目
// 纯逻辑，不依赖 Tauri / DOM，可被 scripts/update-platform-entry.test.ts 直接跑。
// 查找顺序（见 docs/dev/自动更新-Linux-macOS设计.md §3.1）：
//   1. platforms[{os}-{arch}]
//   2. platforms[{os}-universal]（macOS universal 包同时服务 arm64 / x86_64）
//   3. 顶层 installers（仅 Windows；0.2.x 老清单只有这一项）
import type {
  InstallerSrc,
  LatestInfo,
  PlatformEntry,
  ResolvedEntry,
  UpdateEnv,
  UpdateKind,
} from "./types.ts";

/** 已知包类型白名单；未知值一律降级为 none */
const KNOWN_KINDS: UpdateKind[] = ["exe", "app-tar-gz", "appimage", "none"];

/** 归一化 kind：未知 / 缺省 → "none" */
export function normalizeKind(raw?: string | null): UpdateKind {
  const v = (raw ?? "").trim();
  return (KNOWN_KINDS as string[]).includes(v) ? (v as UpdateKind) : "none";
}

/** 过滤掉不完整的源（缺 url / sha256 的条目无法校验，直接丢弃） */
function cleanInstallers(list?: InstallerSrc[]): InstallerSrc[] {
  if (!Array.isArray(list)) return [];
  const out: InstallerSrc[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const url = typeof it.url === "string" ? it.url.trim() : "";
    const sha256 = typeof it.sha256 === "string" ? it.sha256.trim() : "";
    if (url && sha256) out.push({ url, sha256 });
  }
  return out;
}

/** 把清单里的原始条目归一化成内部结构；无可用源时返回 null */
function toEntry(raw: PlatformEntry | undefined): ResolvedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const installers = cleanInstallers(raw.installers);
  const packages = cleanInstallers(raw.packages);
  const kind = normalizeKind(raw.kind);
  if (kind !== "none" && installers.length > 0) {
    return { kind, installers, packages: packages.length ? packages : undefined };
  }
  // kind=none（deb/rpm）或该平台只有系统包：保留条目让 UI 能给出「请用包管理器更新」提示
  if (packages.length > 0) {
    return { kind: "none", installers: [], packages };
  }
  return null;
}

/**
 * 同平台的 universal 键：`darwin-aarch64` → `darwin-universal`。
 * 注意此处按 `env.key` 的前缀推导（清单用 `darwin`，不是展示用的 `macos`）。
 */
function universalKey(key: string): string {
  const i = key.lastIndexOf("-");
  return i > 0 ? `${key.slice(0, i)}-universal` : `${key}-universal`;
}

/**
 * 该条目是否只能「下载 + 交系统安装器」（deb/rpm，U4）。
 * 判定与 `toEntry` 保持一致：kind=none 且带 packages。
 */
export function needsManualInstall(entry: ResolvedEntry | null): boolean {
  return entry?.kind === "none" && (entry.packages?.length ?? 0) > 0;
}

/**
 * 取系统包源（deb/rpm）；没有则空数组 —— 调用方据此判断能否走下载引导。
 * 注意：**不按 kind 过滤**。同一次发布常常既有 AppImage 又有 deb/rpm
 * （`kind` 只能是其中一个），此时 deb 安装版的用户（`env.canSelfUpdate=false`）
 * 仍要能拿到 deb 源；是否走这条通道由调用方的 `canSelfUpdate` 决定。
 */
export function packageSources(entry: ResolvedEntry | null): InstallerSrc[] {
  return entry?.packages ?? [];
}

/**
 * 按本机环境挑选更新包条目。
 * - `env` 为 null（Rust 命令失败）时按旧逻辑使用顶层 `installers`，保持 0.2.x 行为不变；
 * - 非 Windows 平台不回退顶层 `installers`（那是 Windows 安装器，喂给别的平台必失败）；
 * - 该平台没有任何可用包时返回 null，由调用方提示「去发布页手动下载」。
 */
export function pickEntry(latest: LatestInfo, env: UpdateEnv | null): ResolvedEntry | null {
  const platforms = latest.platforms ?? {};

  if (env) {
    const direct = toEntry(platforms[env.key]);
    if (direct) return direct;

    if (env.os === "macos") {
      const universal = toEntry(platforms[universalKey(env.key)]);
      if (universal) return universal;
    }

    // 顶层 installers 只服务 Windows（老清单兼容）；其余平台宁可返回 null 也不装错包
    if (env.os !== "windows") return null;
  }

  const legacy = cleanInstallers(latest.installers);
  if (legacy.length === 0) return null;
  return { kind: "exe", installers: legacy };
}
