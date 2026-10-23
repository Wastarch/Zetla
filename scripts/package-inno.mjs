#!/usr/bin/env node
/**
 * Zetla · Inno Setup 打包脚本（M0-15d）
 *
 * 前置：npm run tauri build -- --no-bundle
 * 用法：npm run package:inno
 *
 * 版本号统一从 src-tauri/tauri.conf.json 读取，避免 .iss 与配置漂移。
 * ISCC 查找顺序：INNO_SETUP_ISCC 环境变量 → 注册表 InstallLocation →
 *                常见安装目录 → PATH。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const issPath = path.join(root, "src-tauri", "windows", "inno", "zetla.iss");
const exePath = path.join(root, "src-tauri", "target", "release", "zetla.exe");
const templatesDir = path.join(root, "src-tauri", "templates");

function fail(message) {
  console.error(`\n[package:inno] ${message}\n`);
  process.exit(1);
}

function readConfig() {
  if (!existsSync(tauriConfPath)) {
    fail(`找不到 ${tauriConfPath}`);
  }
  try {
    return JSON.parse(readFileSync(tauriConfPath, "utf8"));
  } catch (error) {
    fail(`读取 tauri.conf.json 失败：${error.message}`);
  }
}

function queryRegistryInstallLocation(key) {
  try {
    const output = execFileSync("reg", ["query", key, "/v", "InstallLocation"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = output.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function findInnoCompiler() {
  const envPath = process.env.INNO_SETUP_ISCC;
  if (envPath && existsSync(envPath)) return envPath;

  const registryKeys = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
  ];
  for (const key of registryKeys) {
    const location = queryRegistryInstallLocation(key);
    if (!location) continue;
    const candidate = path.join(location, "ISCC.exe");
    if (existsSync(candidate)) return candidate;
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
    path.join(localAppData, "Programs", "Inno Setup 6", "ISCC.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  try {
    const output = execFileSync("where", ["iscc"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first && existsSync(first)) return first;
  } catch {
    // 未安装或不在 PATH。
  }

  return "";
}

const config = readConfig();
const version = config.version;
if (!version) {
  fail("tauri.conf.json 缺少 version 字段");
}

if (!existsSync(exePath)) {
  fail(`找不到 ${exePath}\n请先运行：npm run tauri build -- --no-bundle`);
}
if (!existsSync(templatesDir)) {
  fail(`找不到 ${templatesDir}\n请先运行：npm run tauri build -- --no-bundle`);
}
if (!existsSync(issPath)) {
  fail(`找不到安装脚本 ${issPath}`);
}

const iscc = findInnoCompiler();
if (!iscc) {
  fail(
    "找不到 Inno Setup 编译器 ISCC.exe。\n" +
      "请安装 Inno Setup 6（https://jrsoftware.org/isdl.php），或设置环境变量 INNO_SETUP_ISCC 指向 ISCC.exe。",
  );
}

const outputDir = path.join(root, "build", "installer");
const installerPath = path.join(outputDir, `Zetla_${version}_x64-setup.exe`);

console.log(`[package:inno] Zetla ${version}`);
console.log(`[package:inno] ISCC: ${iscc}`);
console.log(`[package:inno] 输出: ${installerPath}`);

execFileSync(iscc, [`/DMyAppVersion=${version}`, issPath], {
  cwd: root,
  stdio: "inherit",
});

if (!existsSync(installerPath)) {
  fail(`编译命令已结束，但未找到产物：${installerPath}`);
}

console.log(`\n[package:inno] 完成：${installerPath}`);
