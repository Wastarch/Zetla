#!/usr/bin/env node
/**
 * Zetla · 更新清单生成（U6）
 *
 * 一次发版把三平台产物写进仓库根 latest.json：
 *
 *   # 1) 把三台 CI 的 artifact 解压到 build/artifacts/（Windows 包放 build/installer/）
 *   # 2) 生成清单（幂等，可重复跑）
 *   node scripts/update-manifest.mjs --notes-text "新增 xxx" --dry-run
 *   node scripts/update-manifest.mjs --notes-text "新增 xxx"
 *
 * 产物识别只依赖「文件名后缀 + 文件名里是否含本次版本号」，与 CI 的目录布局解耦：
 * 从 Linux / macOS runner 下载的 artifact 解压到同一目录即可。
 *
 * 默认扫描目录（给了 --assets 就只扫给定目录）：
 *   build/installer                                        Windows（Inno 输出）
 *   build/artifacts                                        CI artifact 解包处
 *   src-tauri/target/release/bundle                        Linux（deb / appimage / rpm）
 *   src-tauri/target/universal-apple-darwin/release/bundle macOS（.app.tar.gz）
 *
 * 设计依据：docs/dev/自动更新-Linux-macOS设计.md §3.1（清单协议 v2）、§7（U6）。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 版本号唯一源：package.json */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 下载源基址，数组顺序 = 客户端回退顺序（与 src/modules/updater/endpoints.ts 一致：
 * Gitee 优先，GitHub 兜底）。`--base` 可整体覆盖。
 */
export const DEFAULT_BASES = [
  "https://gitee.com/Wastarch/Zetla/releases/download",
  "https://github.com/Wastarch/Zetla/releases/download",
];

export const DEFAULT_DIRS = [
  "build/installer",
  "build/artifacts",
  "src-tauri/target/release/bundle",
  "src-tauri/target/universal-apple-darwin/release/bundle",
];

const DEFAULT_RELEASE_URL = (version) =>
  `https://github.com/Wastarch/Zetla/releases/tag/v${version}`;

/**
 * 产物规则：`slot=installer` 进 platforms[key].installers（应用内换包用），
 * `slot=package` 进 packages（deb/rpm，只能下载后交系统安装器，见 U4）。
 * 注意 `.app.tar.gz` 必须排在 `.gz` 类规则之前（本项目没有单 .gz 规则，仅为稳妥）。
 */
const RULES = [
  { id: "darwin-app", os: "darwin", kind: "app-tar-gz", slot: "installer", test: (n) => /\.app\.tar\.gz$/i.test(n) },
  { id: "linux-appimage", os: "linux", kind: "appimage", slot: "installer", test: (n) => /\.appimage$/i.test(n) },
  { id: "linux-deb", os: "linux", kind: "none", slot: "package", test: (n) => /\.deb$/i.test(n) },
  { id: "linux-rpm", os: "linux", kind: "none", slot: "package", test: (n) => /\.rpm$/i.test(n) },
  { id: "windows-exe", os: "windows", kind: "exe", slot: "installer", test: (n) => /-setup\.exe$/i.test(n) },
];

/** 平台键里的架构位：macOS 优先识别 universal（一个包同时服务 arm64 / x86_64） */
export function archFor(fileName, os) {
  const n = fileName.toLowerCase();
  if (os === "darwin") {
    if (n.includes("universal")) return "universal";
    if (/aarch64|arm64/.test(n)) return "aarch64";
    if (/x86_64|x64|amd64|intel/.test(n)) return "x86_64";
    // 拿不准时按 universal —— macOS 侧 pickEntry 对 darwin-* 都会回退到 universal 键
    return "universal";
  }
  if (/aarch64|arm64/.test(n)) return "aarch64";
  return "x86_64";
}

/**
 * 识别单个文件名。
 * @returns {{kind:"artifact", file:string, os:string, packKind:string, slot:string, ruleId:string, key:string}
 *          | {kind:"version-mismatch", file:string}
 *          | null}
 */
export function classifyArtifact(fileName, version) {
  const rule = RULES.find((r) => r.test(fileName));
  if (!rule) return null;
  if (version && !fileName.includes(version)) return { kind: "version-mismatch", file: fileName };
  return {
    kind: "artifact",
    file: fileName,
    os: rule.os,
    packKind: rule.kind,
    slot: rule.slot,
    ruleId: rule.id,
    key: `${rule.os}-${archFor(fileName, rule.os)}`,
  };
}

/** 下载 URL：`<base>/v<version>/<文件名>`（文件名做 URL 编码，空格/中文不再拼坏） */
export function urlFor(base, version, fileName) {
  return `${String(base).replace(/\/+$/, "")}/v${version}/${encodeURIComponent(fileName)}`;
}

/** 本地时区 ISO 串（沿用 latest.json 现有风格 `2026-11-09T00:00:00+08:00`） */
export function formatIsoLocal(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 大写 SHA-256（与现有 latest.json 一致；Rust 侧 eq_ignore_ascii_case 比较） */
export function sha256Of(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}

function walk(dir, depth, out) {
  let items;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (depth <= 1) continue;
      if (item.name === "node_modules" || item.name === "git") continue;
      walk(full, depth - 1, out);
    } else if (item.isFile()) {
      out.push(full);
    }
  }
}

/**
 * 扫描目录取产物。同一平台同一扩展名的包在多个目录出现时只取第一个
 * （目录顺序即优先级：先 CI 解包目录、后本地 target）。
 * @returns {{entries: object[], mismatched: string[], duplicates: string[]}}
 */
export function collectArtifacts(dirs, version, depth = 4) {
  const entries = [];
  const mismatched = [];
  const duplicates = [];
  const seen = new Set();

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = [];
    walk(dir, depth, files);
    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const found = classifyArtifact(fileName, version);
      if (!found) continue;
      if (found.kind === "version-mismatch") {
        mismatched.push(filePath);
        continue;
      }
      const id = `${found.key}|${found.ruleId}`;
      if (seen.has(id)) {
        duplicates.push(filePath);
        continue;
      }
      seen.add(id);
      entries.push({ ...found, filePath });
    }
  }

  return { entries, mismatched, duplicates };
}

/** 给条目补 sha256（先算赢家，重复文件不白读） */
export function withSha(entries) {
  return entries.map((e) => ({ ...e, sha256: sha256Of(e.filePath) }));
}

/**
 * 组装 platforms 映射。每个平台的 installers 顺序 = bases 顺序（客户端按此回退）。
 * kind 取 installers 的类型；只有 deb/rpm 的平台 kind 记 "none"（U4 引导通道）。
 */
export function buildPlatforms(entries, { version, bases }) {
  const acc = {};
  for (const e of entries) {
    const entry = (acc[e.key] ??= { kind: "none", installers: [], packages: [] });
    const sources = bases.map((base) => ({ url: urlFor(base, version, e.file), sha256: e.sha256 }));
    if (e.slot === "installer") {
      entry.kind = e.packKind;
      entry.installers.push(...sources);
    } else {
      entry.packages.push(...sources);
    }
  }

  const out = {};
  for (const key of Object.keys(acc).sort()) {
    const { kind, installers, packages } = acc[key];
    const clean = { kind: installers.length > 0 ? kind : "none" };
    if (installers.length > 0) clean.installers = installers;
    if (packages.length > 0) clean.packages = packages;
    out[key] = clean;
  }
  return out;
}

/**
 * 组装完整清单。
 * - 顶层 `installers` 必须继续指向 Windows 包：0.2.x / 0.3.0 老客户端只读它；
 *   本次没打到 Windows 包时沿用上一版，避免老客户端误判「已是最新」。
 * - `minVersion` / `mandatory` 显式传参优先，否则沿用上一版。
 */
export function buildManifest({ version, notes, pubDate, releaseUrl, platforms, minVersion, mandatory, prev }) {
  const win = platforms["windows-x86_64"];
  const installers = win?.installers?.length ? win.installers : (prev?.installers ?? []);

  const out = { version, notes };
  if (pubDate) out.pubDate = pubDate;
  // releaseUrl 只在「同版本重跑」时沿用上一版 —— 换版本一定指向新的 tag
  const sameVersion = prev?.version === version;
  out.releaseUrl = releaseUrl ?? (sameVersion ? prev?.releaseUrl : undefined) ?? DEFAULT_RELEASE_URL(version);
  out.installers = installers;
  out.platforms = platforms;

  const min = minVersion ?? prev?.minVersion;
  if (min) out.minVersion = min;
  const forced = mandatory ?? prev?.mandatory;
  if (forced !== undefined) out.mandatory = !!forced;
  return out;
}

/** 更新说明：--notes-text > --notes 文件 > 上一版（仅同版本重跑时）> 报错 */
export function resolveNotes({ notesText, notesFile, prev, version }) {
  if (typeof notesText === "string" && notesText.trim()) return notesText.trim();
  if (notesFile) {
    if (!existsSync(notesFile)) throw new Error(`找不到更新说明文件：${notesFile}`);
    const text = readFileSync(notesFile, "utf8").trim();
    if (!text) throw new Error(`更新说明文件是空的：${notesFile}`);
    return text;
  }
  if (prev && prev.version === version && prev.notes) return prev.notes;
  throw new Error(
    "新版本必须提供更新说明：--notes-text \"一句话\" 或 --notes docs/版本说明.md（同版本重跑才会沿用旧说明）",
  );
}

/** 参数解析（纯函数，便于单测）。出错直接 throw，由 main 统一提示。 */
export function parseArgs(argv) {
  const opts = { assets: [], bases: [], dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = () => {
      const value = argv[++i];
      // 只看长选项前缀：更新说明常以 "- 修复…" 开头，不能当缺值处理
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} 缺少参数值`);
      return value;
    };
    switch (arg) {
      case "--assets":
      case "-a":
        opts.assets.push(
          ...takeValue()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case "--base":
        opts.bases.push(...takeValue().split(",").map((s) => s.trim()).filter(Boolean));
        break;
      case "--notes":
        opts.notesFile = takeValue();
        break;
      case "--notes-text":
        opts.notesText = takeValue();
        break;
      case "--pub-date":
        opts.pubDate = takeValue();
        break;
      case "--out":
        opts.out = takeValue();
        break;
      case "--version":
        opts.version = takeValue();
        break;
      case "--min-version":
        opts.minVersion = takeValue();
        break;
      case "--mandatory":
        opts.mandatory = true;
        break;
      case "--no-mandatory":
        opts.mandatory = false;
        break;
      case "--dry-run":
      case "-n":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}（--help 看用法）`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Zetla 更新清单生成（U6）

用法：
  node scripts/update-manifest.mjs [选项]

选项：
  -a, --assets <目录[,目录]>   扫描目录（可重复）；默认 ${DEFAULT_DIRS.join("、")}
      --base <URL[,URL]>       下载源基址（可重复，顺序即回退顺序）
                               默认 ${DEFAULT_BASES.join("、")}
      --notes-text <文本>      更新说明（一句话；支持 ## / - / 1. 等轻量标记）
      --notes <文件>           从文件读更新说明（与 --notes-text 二选一）
      --pub-date <ISO>         发布时间，默认当前时间（带本地时区偏移）
      --min-version <版本>     低于此版本视为必须更新
      --mandatory              标记为强制更新（--no-mandatory 取消）
      --out <文件>             输出路径，默认仓库根 latest.json
      --version <版本>         仅校验：必须与 package.json 一致
  -n, --dry-run                只打印，不写文件
  -h, --help                   显示本帮助

产物命名要求（版本号必须出现在文件名里）：
  Windows  Zetla_<ver>_x64-setup.exe
  macOS    Zetla_<ver>_universal.app.tar.gz
  Linux    Zetla_<ver>_amd64.AppImage / .deb / .rpm
`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function detectEol(text) {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`\n[update-manifest] ${error.message}\n`);
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    return;
  }

  const pkgPath = path.join(root, "package.json");
  const pkg = readJson(pkgPath);
  const version = pkg.version;
  if (!version || !VERSION_RE.test(version)) {
    console.error(`\n[update-manifest] package.json 的 version 不合法：${version}\n`);
    process.exit(1);
  }
  if (opts.version && opts.version !== version) {
    console.error(
      `\n[update-manifest] --version ${opts.version} 与 package.json 的 ${version} 不一致` +
        "（版本号唯一源是 package.json，先 node scripts/sync-version.mjs <ver>）\n",
    );
    process.exit(1);
  }

  const outPath = path.resolve(root, opts.out ?? "latest.json");
  const prev = existsSync(outPath) ? readJson(outPath) : null;

  let notes;
  try {
    notes = resolveNotes({
      notesText: opts.notesText,
      notesFile: opts.notesFile ? path.resolve(root, opts.notesFile) : undefined,
      prev,
      version,
    });
  } catch (error) {
    console.error(`\n[update-manifest] ${error.message}\n`);
    process.exit(1);
  }

  const dirs = (opts.assets.length > 0 ? opts.assets : DEFAULT_DIRS).map((d) => path.resolve(root, d));
  const { entries, mismatched, duplicates } = collectArtifacts(dirs, version);

  console.log(`\n[update-manifest] Zetla ${version} → ${path.relative(root, outPath) || outPath}`);
  for (const file of mismatched) {
    console.log(`  ! 跳过版本不符的产物：${path.relative(root, file)}`);
  }
  for (const file of duplicates) {
    console.log(`  ! 重复产物（已保留先扫描到的那个）：${path.relative(root, file)}`);
  }

  if (entries.length === 0) {
    console.error(
      `\n[update-manifest] 没找到任何 ${version} 的更新产物。\n` +
        `  扫描目录：\n${dirs.map((d) => `    - ${path.relative(root, d) || "."}`).join("\n")}\n` +
        "  请先构建（Windows: npm run package:win；Linux/macOS: CI 的 Build Linux / Build macOS），\n" +
        "  或把 CI artifact 解压到 build/artifacts 后用 --assets 指定。\n",
    );
    process.exit(1);
  }

  const bases = opts.bases.length > 0 ? opts.bases : DEFAULT_BASES;
  const hashed = withSha(entries);
  const platforms = buildPlatforms(hashed, { version, bases });
  // 同版本重跑沿用上一版发布时间 —— 不然每次跑都换 pubDate，幂等失效
  const sameVersion = prev?.version === version;
  const pubDate = opts.pubDate ?? (sameVersion ? prev?.pubDate : undefined) ?? formatIsoLocal();
  const manifest = buildManifest({
    version,
    notes,
    pubDate,
    platforms,
    minVersion: opts.minVersion,
    mandatory: opts.mandatory,
    prev,
  });

  const rows = [...hashed]
    .sort((a, b) =>
      a.key !== b.key
        ? a.key.localeCompare(b.key)
        : a.slot !== b.slot
          ? a.slot === "installer"
            ? -1
            : 1
          : a.file.localeCompare(b.file),
    )
    .map((e) => [e.key, e.slot === "installer" ? e.packKind : "package", `${e.file} (${mb(sizeOf(e.filePath))})`]);
  const width = Math.max(...rows.map(([key]) => key.length));
  for (const [key, kind, file] of rows) {
    console.log(`  ${key.padEnd(width)}  ${kind.padEnd(12)}${file}`);
  }
  if (bases.length > 1) console.log(`  下载源：${bases.length} 个（顺序即回退顺序）`);

  for (const [key, label] of [
    ["windows-x86_64", "Windows"],
    ["darwin-universal", "macOS"],
  ]) {
    if (!platforms[key]) console.warn(`  ! 缺少 ${label} 条目（${key}）：该平台用户收不到本次更新`);
  }
  if (!platforms["windows-x86_64"]) {
    console.warn("  ! 顶层 installers 沿用上一版（老客户端仍可更新到旧版本，注意别错版发布）");
  }
  if (platforms["linux-x86_64"] && platforms["linux-x86_64"].kind === "none") {
    console.log("  · Linux 只有 deb/rpm：AppImage 用户收不到自更新，只能走系统装包");
  }

  const eol = detectEolOf(outPath);
  const json = JSON.stringify(manifest, null, 4).replace(/\r?\n/g, eol) + eol;

  if (opts.dryRun) {
    console.log("\n--- dry-run：以下内容未写入 ---\n");
    console.log(json);
    return;
  }

  const before = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
  if (before === json) {
    console.log("\n[update-manifest] 内容无变化，未写入（幂等）\n");
    return;
  }
  writeFileSync(outPath, json);
  console.log(`\n[update-manifest] 已写入 ${path.relative(root, outPath) || outPath}\n`);
}

/** 沿用目标文件原有换行符（本仓库工作区为 CRLF），新建文件用 LF */
function detectEolOf(file) {
  if (!existsSync(file)) return "\n";
  return detectEol(readFileSync(file, "utf8"));
}

/** 文件字节数（打印用；读不到就当 0，不影响清单） */
function sizeOf(filePath) {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

// 仅直接执行时跑主流程（被单测 import 时保持纯模块）
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2));
}
