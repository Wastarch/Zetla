// U6 · 更新清单生成单测（Node 直接跑）：
//   node --experimental-strip-types scripts/update-manifest.test.ts
// 覆盖：产物识别 / 平台键 / 双源 URL / 混合 Linux 条目 / 老客户端兜底 / 幂等与参数解析。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BASES,
  archFor,
  buildManifest,
  buildPlatforms,
  classifyArtifact,
  collectArtifacts,
  formatIsoLocal,
  parseArgs,
  resolveNotes,
  sha256Of,
  urlFor,
  withSha,
} from "./update-manifest.mjs";

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

const V = "0.3.0";
const B = DEFAULT_BASES; // [gitee, github]

// ---------- 产物识别 ----------

const exe = classifyArtifact(`Zetla_${V}_x64-setup.exe`, V);
check(!!exe && "key" in exe && exe.key === "windows-x86_64", "Windows 安装包 → windows-x86_64");
check(!!exe && "packKind" in exe && exe.packKind === "exe", "Windows 安装包 kind=exe");
check(!!exe && "slot" in exe && exe.slot === "installer", "Windows 安装包进 installers");

const uni = classifyArtifact(`Zetla_${V}_universal.app.tar.gz`, V);
check(!!uni && "key" in uni && uni.key === "darwin-universal", "universal .app.tar.gz → darwin-universal");
check(!!uni && "packKind" in uni && uni.packKind === "app-tar-gz", "macOS 包 kind=app-tar-gz");

const armApp = classifyArtifact(`Zetla_${V}_aarch64.app.tar.gz`, V);
check(!!armApp && "key" in armApp && armApp.key === "darwin-aarch64", "aarch64 .app.tar.gz → darwin-aarch64");
// 没有架构标记时按 universal（pickEntry 对 darwin-* 都会回退 universal 键）
check(archFor("Zetla_0.3.0.app.tar.gz", "darwin") === "universal", "无架构标记的 mac 包按 universal");

const appimg = classifyArtifact(`Zetla_${V}_amd64.AppImage`, V);
check(!!appimg && "key" in appimg && appimg.key === "linux-x86_64", "AppImage → linux-x86_64");
check(!!appimg && "packKind" in appimg && appimg.packKind === "appimage", "AppImage kind=appimage");

const deb = classifyArtifact(`zetla_${V}_amd64.deb`, V);
check(!!deb && "slot" in deb && deb.slot === "package", "deb 进 packages（不是 installers）");
check(!!deb && "packKind" in deb && deb.packKind === "none", "deb 的 kind 记为 none");

const rpm = classifyArtifact(`zetla-${V}-1.x86_64.rpm`, V);
check(!!rpm && "slot" in rpm && rpm.slot === "package", "rpm 进 packages");
check(
  !!rpm && "key" in rpm && rpm.key === "linux-x86_64",
  "rpm 名里的 x86_64 能被识别（不走默认分支也正确）",
);

const oldPkg = classifyArtifact("Zetla_0.2.8_x64-setup.exe", V);
check(!!oldPkg && oldPkg.kind === "version-mismatch", "版本不符的产物被标记出来（不静默混入）");
check(classifyArtifact("README.md", V) === null, "无关文件直接忽略");
check(classifyArtifact(`Zetla_${V}_x64_en-US.msi`, V) === null, "未支持的格式（.msi）忽略");

// ---------- URL / 时间 ----------

check(
  urlFor("https://gitee.com/x/y/releases/download/", V, "Zetla_0.3.0_amd64.AppImage") ===
    "https://gitee.com/x/y/releases/download/v0.3.0/Zetla_0.3.0_amd64.AppImage",
  "urlFor 去掉 base 末尾斜杠并拼 v<ver>/<文件名>",
);
check(
  urlFor("https://a.b/c", V, "Zetla 0.3.0 版.AppImage").includes("Zetla%200.3.0%20"),
  "文件名做 URL 编码（空格/中文不拼坏）",
);
const iso = formatIsoLocal(new Date(2026, 10, 14, 9, 5, 3));
check(iso.startsWith("2026-11-14T09:05:03"), "formatIsoLocal 保留本地时间且两位补零");
check(/[+-]\d{2}:\d{2}$/.test(iso), "formatIsoLocal 带时区偏移");

// ---------- 平台条目组装 ----------

type Entry = { file: string; key: string; packKind: string; slot: string; sha256: string };
const mk = (file: string, key: string, packKind: string, slot: string): Entry => ({
  file,
  key,
  packKind,
  slot,
  sha256: "A".repeat(64),
});

const full = buildPlatforms(
  [
    mk(`Zetla_${V}_x64-setup.exe`, "windows-x86_64", "exe", "installer"),
    mk(`Zetla_${V}_universal.app.tar.gz`, "darwin-universal", "app-tar-gz", "installer"),
    mk(`Zetla_${V}_amd64.AppImage`, "linux-x86_64", "appimage", "installer"),
    mk(`zetla_${V}_amd64.deb`, "linux-x86_64", "none", "package"),
  ],
  { version: V, bases: B },
);

check(Object.keys(full).join(",") === "darwin-universal,linux-x86_64,windows-x86_64", "平台键按字典序输出（diff 稳定）");
check(full["windows-x86_64"].kind === "exe", "windows 条目 kind=exe");
check(full["windows-x86_64"].installers.length === 2, "每个平台生成 2 个下载源（gitee + github）");
check(
  full["windows-x86_64"].installers[0].url.startsWith("https://gitee.com/"),
  "下载源顺序 = bases 顺序（Gitee 优先，与 endpoints.ts 一致）",
);
check(full["darwin-universal"].kind === "app-tar-gz", "darwin-universal kind=app-tar-gz");
check(full["linux-x86_64"].kind === "appimage", "Linux 有 AppImage 时 kind=appimage（deb 只作补充）");
check(full["linux-x86_64"].packages?.length === 2, "Linux 同时给出 deb 源（两个镜像）");
check(
  full["linux-x86_64"].installers.length === 2 && full["linux-x86_64"].packages!.length === 2,
  "installers 与 packages 分开装，互不污染",
);
check(!("packages" in full["windows-x86_64"]), "无 packages 的平台不写空字段");

const debOnly = buildPlatforms([mk(`zetla_${V}_amd64.deb`, "linux-x86_64", "none", "package")], {
  version: V,
  bases: B,
});
check(debOnly["linux-x86_64"].kind === "none", "只有 deb 时 kind=none（U4 引导通道）");
check(!("installers" in debOnly["linux-x86_64"]), "只有 deb 时不写空 installers");
check(debOnly["linux-x86_64"].packages?.length === 2, "只有 deb 时 packages 仍是双源");

check(Object.keys(buildPlatforms([], { version: V, bases: B })).length === 0, "空产物 → 空 platforms");

// ---------- 完整清单 ----------

const platforms = buildPlatforms(
  [
    mk(`Zetla_${V}_x64-setup.exe`, "windows-x86_64", "exe", "installer"),
    mk(`Zetla_${V}_universal.app.tar.gz`, "darwin-universal", "app-tar-gz", "installer"),
  ],
  { version: V, bases: B },
);

const manifest = buildManifest({
  version: V,
  notes: "新增 xxx",
  pubDate: "2026-11-14T20:00:00+08:00",
  platforms,
  prev: { version: "0.2.8", installers: [], minVersion: "0.1.0", mandatory: false },
});

check(manifest.version === V, "清单 version 取自 package.json");
check(manifest.notes === "新增 xxx", "清单 notes 透传");
check(manifest.pubDate === "2026-11-14T20:00:00+08:00", "清单 pubDate 透传");
check(
  manifest.installers.length === 2 &&
    manifest.installers[0].url.endsWith(`Zetla_${V}_x64-setup.exe`),
  "顶层 installers 指向 Windows 包（0.2.x / 0.3.0 老客户端只读它）",
);
check(manifest.installers[0].url.startsWith("https://gitee.com/"), "顶层 installers 同样是 Gitee 优先");
check(manifest.platforms === platforms, "platforms 原样写入");
check(manifest.minVersion === "0.1.0", "minVersion 沿用上一版");
check(manifest.mandatory === false, "mandatory 沿用上一版");
check(manifest.releaseUrl === `https://github.com/Wastarch/Zetla/releases/tag/v${V}`, "releaseUrl 默认指向 GitHub Release");

// 没打到 Windows 包 → 沿用上一版 installers，避免老客户端误判「已是最新」
const keepOld = buildManifest({
  version: V,
  notes: "x",
  platforms: buildPlatforms([mk(`Zetla_${V}_universal.app.tar.gz`, "darwin-universal", "app-tar-gz", "installer")], {
    version: V,
    bases: B,
  }),
  prev: {
    version: "0.2.8",
    installers: [{ url: "https://gitee.com/old.exe", sha256: "B".repeat(64) }],
    releaseUrl: "https://github.com/Wastarch/Zetla/releases/tag/v0.2.8",
  },
});
check(keepOld.installers[0].url === "https://gitee.com/old.exe", "缺 Windows 包 → 顶层 installers 沿用上一版");
check(
  keepOld.releaseUrl === `https://github.com/Wastarch/Zetla/releases/tag/v${V}`,
  "换版本时 releaseUrl 指向新 tag（不会沿用旧版链接）",
);
check(
  buildManifest({
    version: V,
    notes: "x",
    platforms: {},
    prev: { version: V, installers: [], releaseUrl: "https://example.com/tag" },
  }).releaseUrl === "https://example.com/tag",
  "同版本重跑时沿用上一版 releaseUrl",
);

const noPrev = buildManifest({ version: V, notes: "x", platforms: {} });
check(Array.isArray(noPrev.installers) && noPrev.installers.length === 0, "既无产物也无上一版 → installers 为空数组");
check(noPrev.pubDate === undefined, "未指定发布时间时不写 pubDate（由调用方决定）");
check(noPrev.mandatory === undefined, "没有强制标记时不写 mandatory");
check(buildManifest({ version: V, notes: "x", platforms: {}, mandatory: true }).mandatory === true, "显式 mandatory 生效");

// 幂等：同输入两次序列化必须逐字节一致
const a = JSON.stringify(manifest, null, 4);
const b = JSON.stringify(
  buildManifest({
    version: V,
    notes: "新增 xxx",
    pubDate: "2026-11-14T20:00:00+08:00",
    platforms,
    prev: { version: "0.2.8", installers: [], minVersion: "0.1.0", mandatory: false },
  }),
  null,
  4,
);
check(a === b, "同输入两次生成完全一致（幂等，不污染 git diff）");

// ---------- 更新说明 ----------

check(resolveNotes({ notesText: "  一句话  ", version: V }) === "一句话", "--notes-text 去首尾空白");
check(
  resolveNotes({ notesText: "", prev: { version: V, notes: "旧说明" }, version: V }) === "旧说明",
  "空 --notes-text 视为未提供，同版本重跑沿用旧说明",
);
let notesErr = "";
try {
  resolveNotes({ prev: { version: "0.2.8", notes: "旧说明" }, version: V });
} catch (error) {
  notesErr = String(error);
}
check(notesErr.includes("必须提供更新说明"), "换版本却没给说明 → 直接报错（不写错版文案）");

// ---------- 参数解析 ----------

const args = parseArgs([
  "--assets",
  "build/artifacts, build/installer",
  "-a",
  "ci/linux",
  "--base",
  "https://example.com/dl",
  "--notes-text",
  "修了几个 bug",
  "--no-mandatory",
  "--dry-run",
]);
check(args.assets.length === 3, "--assets 支持逗号分隔与重复累加");
check(args.assets[1] === "build/installer", "--assets 逗号分隔项去空白");
check(args.bases.length === 1 && args.bases[0] === "https://example.com/dl", "--base 覆盖默认源");
check(args.notesText === "修了几个 bug", "--notes-text 取值");
check(args.mandatory === false, "--no-mandatory 显式关掉");
check(args.dryRun === true, "--dry-run 生效");
check(parseArgs([]).dryRun === false && parseArgs([]).assets.length === 0, "默认不 dry-run、不指定目录");
check(
  parseArgs(["--notes-text", "- 修复 A"]).notesText === "- 修复 A",
  "以 - 开头的说明不会被当成缺值（说明常用「- 条目」写法）",
);

let argErr = "";
try {
  parseArgs(["--unknown"]);
} catch (error) {
  argErr = String(error);
}
check(argErr.includes("未知参数"), "未知参数报错（打错选项不会被静默忽略）");

let missingErr = "";
try {
  parseArgs(["--assets"]);
} catch (error) {
  missingErr = String(error);
}
check(missingErr.includes("缺少参数值"), "选项缺值报错");

// ---------- 目录扫描（真实临时目录） ----------

const tmp = mkdtempSync(path.join(os.tmpdir(), "zetla-manifest-"));
try {
  const artifacts = path.join(tmp, "artifacts");
  const installer = path.join(tmp, "installer");
  const later = path.join(tmp, "later");
  for (const dir of [artifacts, installer, later]) mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(artifacts, `Zetla_${V}_amd64.AppImage`), "appimage");
  writeFileSync(path.join(artifacts, `zetla_${V}_amd64.deb`), "deb");
  writeFileSync(path.join(artifacts, `Zetla_0.2.9_amd64.AppImage`), "old");
  writeFileSync(path.join(installer, `Zetla_${V}_x64-setup.exe`), "exe");
  // 后扫描目录里的同名产物应被判为重复（先扫描者胜出）
  writeFileSync(path.join(later, `Zetla_${V}_amd64.AppImage`), "dup");

  const { entries, mismatched, duplicates } = collectArtifacts([artifacts, installer, later], V);
  check(entries.length === 3, "扫描到 3 个本版本产物（AppImage / deb / exe）");
  check(mismatched.length === 1, "0.2.9 的旧包被单独列出");
  check(duplicates.length === 1, "跨目录重复产物被去重（1 个重复）");
  check(
    entries.find((e) => e.file.endsWith(".AppImage"))?.filePath.startsWith(artifacts),
    "去重保留先扫描目录里的那份",
  );

  const hashed = withSha(entries);
  check(hashed.every((e) => /^[0-9A-F]{64}$/.test(e.sha256)), "sha256 为大写 64 位十六进制");
  check(
    sha256Of(path.join(artifacts, `zetla_${V}_amd64.deb`)) ===
      "9CFA1468C93FC18652E34A000F0C6614B0FA18F6F4887477AD9B0D36CA6A7EAA",
    "sha256 与已知向量一致（内容 \"deb\"）",
  );

  const built = buildPlatforms(hashed, { version: V, bases: B });
  check(built["linux-x86_64"].kind === "appimage" && built["linux-x86_64"].packages?.length === 2, "扫描结果能直接组装出混合 Linux 条目");
  check(built["windows-x86_64"].kind === "exe", "扫描结果能组装出 Windows 条目");

  const notesFile = path.join(tmp, "notes.md");
  writeFileSync(notesFile, "\n  - 修复 A\n- 新增 B\n");
  check(resolveNotes({ notesFile, version: V }).startsWith("- 修复 A"), "--notes 读文件并去首尾空白");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? "全部通过" : "存在失败"}：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
