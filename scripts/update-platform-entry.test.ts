// U1 · 清单协议 v2 平台条目选择单测（Node 直接跑）：
//   node --experimental-strip-types scripts/update-platform-entry.test.ts
import { normalizeKind, pickEntry } from "../src/modules/updater/platformEntry.ts";
import type {
  InstallerSrc,
  LatestInfo,
  UpdateEnv,
} from "../src/modules/updater/types.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

const src = (name: string): InstallerSrc => ({
  url: `https://example.com/f/${name}`,
  sha256: "A".repeat(64),
});

function env(os: string, arch: string, key = `${os}-${arch}`): UpdateEnv {
  return { os, arch, key, kind: "exe", canSelfUpdate: os === "windows" };
}

const WIN = env("windows", "x86_64");
const MAC_ARM = env("macos", "aarch64", "darwin-aarch64");
const MAC_X64 = env("macos", "x86_64", "darwin-x86_64");
const LINUX = env("linux", "x86_64");

// ── 1) 老清单（只有顶层 installers）─────────────────────────────
console.log("\n== 1) 老清单向后兼容 ==");
const legacy: LatestInfo = {
  version: "0.3.1",
  installers: [src("Zetla_0.3.1_x64-setup.exe"), src("Zetla_0.3.1_x64-setup.exe")],
};
const legacyWin = pickEntry(legacy, WIN);
check(!!legacyWin, "Windows + 老清单 → 取到条目");
check(legacyWin?.kind === "exe", "老清单条目 kind 归一化为 exe");
check(legacyWin?.installers.length === 2, "老清单两个源都保留");

const legacyNoEnv = pickEntry(legacy, null);
check(legacyNoEnv?.kind === "exe", "env 为 null（Rust 命令失败）→ 回退顶层 installers");
check(
  pickEntry(legacy, LINUX) === null,
  "Linux + 老清单（只有 Windows exe）→ null，不装错包",
);

// ── 2) v2 清单精确命中 ─────────────────────────────────────────
console.log("\n== 2) platforms 精确命中 ==");
const v2: LatestInfo = {
  version: "0.4.0",
  installers: [src("Zetla_0.4.0_x64-setup.exe")],
  platforms: {
    "windows-x86_64": { kind: "exe", installers: [src("Zetla_0.4.0_x64-setup.exe")] },
    "darwin-aarch64": { kind: "app-tar-gz", installers: [src("Zetla_0.4.0_aarch64.app.tar.gz")] },
    "darwin-universal": { kind: "app-tar-gz", installers: [src("Zetla_0.4.0_universal.app.tar.gz")] },
    "linux-x86_64": { kind: "appimage", installers: [src("Zetla_0.4.0_amd64.AppImage")] },
  },
};
check(pickEntry(v2, WIN)?.kind === "exe", "Windows 命中 windows-x86_64（exe）");
check(
  pickEntry(v2, MAC_ARM)?.installers[0]?.url.includes("aarch64"),
  "macOS arm64 优先精确命中 darwin-aarch64",
);
check(
  pickEntry(v2, MAC_X64)?.installers[0]?.url.includes("universal"),
  "macOS x64 无精确条目 → 回退 darwin-universal",
);
check(pickEntry(v2, LINUX)?.kind === "appimage", "Linux 命中 appimage 条目");

// ── 3) 平台缺条目 / 只有系统包 ─────────────────────────────────
console.log("\n== 3) 缺条目与 deb/rpm ==");
const winOnly: LatestInfo = {
  version: "0.4.0",
  installers: [src("Zetla_0.4.0_x64-setup.exe")],
  platforms: { "windows-x86_64": { kind: "exe", installers: [src("a.exe")] } },
};
check(pickEntry(winOnly, LINUX) === null, "v2 清单无 linux 条目 → null（不回退 exe）");
check(pickEntry(winOnly, MAC_ARM) === null, "v2 清单无 darwin 条目 → null");

const debOnly: LatestInfo = {
  version: "0.4.0",
  installers: [],
  platforms: {
    "linux-x86_64": { kind: "none", packages: [src("Zetla_0.4.0_amd64.deb")] },
  },
};
const deb = pickEntry(debOnly, LINUX);
check(deb?.kind === "none", "只有 deb 包 → kind=none（UI 提示用包管理器更新）");
check(deb?.packages?.length === 1, "deb 包保留在 packages 里");
check(deb?.installers.length === 0, "kind=none 条目不带 installers");

// ── 4) 脏数据与白名单 ─────────────────────────────────────────
console.log("\n== 4) 脏数据与 kind 白名单 ==");
const dirty: LatestInfo = {
  version: "0.4.0",
  installers: [],
  platforms: {
    "windows-x86_64": {
      kind: "exe",
      installers: [
        { url: "https://example.com/a.exe", sha256: "" },
        { url: "", sha256: "B".repeat(64) },
        src("ok.exe"),
      ],
    },
    "linux-x86_64": { kind: "appimage", installers: [{ url: "x", sha256: "" }] },
  },
};
const dirtyWin = pickEntry(dirty, WIN);
check(dirtyWin?.installers.length === 1, "缺 url/sha256 的源被过滤，只留 1 个");
check(dirtyWin?.installers[0]?.url.endsWith("ok.exe"), "留下的是完整那一条");
check(pickEntry(dirty, LINUX) === null, "条目全被过滤 → null");

const weird: LatestInfo = {
  version: "0.4.0",
  installers: [src("Zetla_0.4.0_x64-setup.exe")],
  platforms: { "windows-x86_64": { kind: "msi", installers: [src("a.msi")] } },
};
check(
  pickEntry(weird, WIN)?.kind === "exe",
  "未知 kind（msi）不当作可安装包 → Windows 退回顶层 installers（exe）",
);
check(
  pickEntry(weird, LINUX) === null,
  "未知 kind + 非 Windows → null（宁可去发布页也不装错包）",
);

check(normalizeKind("exe") === "exe", "normalizeKind: exe");
check(normalizeKind("appimage") === "appimage", "normalizeKind: appimage");
check(normalizeKind("APPIMAGE") === "none", "normalizeKind: 大小写不匹配 → none");
check(normalizeKind("") === "none", "normalizeKind: 空串 → none");
check(normalizeKind(undefined) === "none", "normalizeKind: undefined → none");

// ── 5) 极端输入 ───────────────────────────────────────────────
console.log("\n== 5) 极端输入 ==");
check(
  pickEntry({ version: "1.0.0", installers: [] }, WIN) === null,
  "既无 platforms 也无 installers → null",
);
check(
  pickEntry({ version: "1.0.0", installers: [] as InstallerSrc[], platforms: {} }, WIN) === null,
  "platforms 为 {} → null",
);

console.log(`\n${failed === 0 ? "全部通过" : "存在失败"}：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
