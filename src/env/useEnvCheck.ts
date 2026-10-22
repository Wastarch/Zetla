// M0-15a · TeX 环境检测桥
// runEnvCheck：探测发行版并写全局 store（设置页内联显示也订阅它）
// checkEnvOnStartup：启动预检测 —— 未找到 TeX 时自动打开引导（每次启动一次，会话内关闭后不再自动弹）
// ensureEnv：编译前预检 —— 已知有 TeX 直接放行；检测命令失败不拦截（让编译命令报具体错）
// openEnvGuide：手动入口（帮助菜单 / 状态栏 chip）—— 每次重新检测并打开引导面板
// pickEngineDir：指定/接管已有安装（TeX Live 优先接管并写台账；其他发行版回退 engineBinDir）
import { open as pickDialog } from "@tauri-apps/plugin-dialog";
import { compileApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import type { TexDistInfo } from "@/types";

/**
 * 会话内「未检测到 TeX 自动弹引导」已处理标记（不持久化，重启重置）。
 * 启动自动打开 / 引导被关闭 / 打开安装向导都会置位；置位后编译时只 toast。
 */
let autoPromptSettled = false;

/** 引导被用户关闭或转入安装向导：本次会话不再自动打开 */
export function markEnvGuideDismissed(): void {
  autoPromptSettled = true;
}

/** dev-only 调试模拟：与 Rust `detect_tex_distribution` 未找到时的返回保持一致 */
const DEBUG_NO_TEX: TexDistInfo = {
  found: false,
  distribution: "None",
  version: null,
  engines: [],
  recommended: "xelatex",
  perl: { found: false, version: null, binDir: null, source: "none" },
};

/** 探测 TeX 发行版并写入全局 store；探测命令本身失败时返回 null（不误判为「未安装」） */
export async function runEnvCheck(): Promise<TexDistInfo | null> {
  // 引导面板调试按钮：dev 构建下模拟未检测，跳过 IPC；release 构建天然不生效
  if (import.meta.env.DEV && useAppStore.getState().envDebugMock) {
    useAppStore.getState().setEnv(DEBUG_NO_TEX);
    return DEBUG_NO_TEX;
  }
  try {
    const info = await compileApi.detectTexDistribution();
    useAppStore.getState().setEnv(info);
    return info;
  } catch (e) {
    console.warn("[env] 检测 TeX 发行版失败", e);
    return null;
  }
}

/**
 * 启动预检测：TeX 缺失时自动打开引导面板。
 * 每次启动最多一次；关闭后本次会话不再自动弹。
 */
export async function checkEnvOnStartup(): Promise<void> {
  const info = await runEnvCheck();
  if (info === null) return; // 检测失败不误判
  // TeX 可用 → 不打扰；TeX 缺失 → 提示一次
  if (info.found) return;
  if (autoPromptSettled) return;
  autoPromptSettled = true;
  useAppStore.getState().setEnvGuideOpen(true);
}

/** 编译前环境预检：true = 继续编译 */
export async function ensureEnv(): Promise<boolean> {
  // 已知可用直接放行（结果缓存在 store，避免每次编译都探测）
  if (useAppStore.getState().env?.found) return true;

  const info = await runEnvCheck();
  if (info === null) return true; // 检测失败不拦截
  if (info.found) return true;

  // 未检测到：本次会话尚未自动提示过则弹引导，否则只提示（不打扰）
  if (!useAppStore.getState().envGuideOpen) {
    if (!autoPromptSettled) {
      autoPromptSettled = true;
      useAppStore.getState().setEnvGuideOpen(true);
    } else {
      notify("未检测到 TeX 发行版，无法编译；可从「帮助 → TeX 环境检测」打开引导", "err");
    }
  }
  return false;
}

/** 手动入口（帮助菜单 / 状态栏 chip / 设置页）：重新检测并打开引导面板 */
export async function openEnvGuide(): Promise<void> {
  await runEnvCheck();
  useAppStore.getState().setEnvGuideOpen(true);
}

/**
 * 引导面板「指定/接管已有安装」：
 * 1. 优先按 TeX Live 根目录接管（校验引擎 + 写 config/台账/标记）；
 * 2. 非 TeX Live（如 MiKTeX）退回手动指定 engineBinDir，不写代装台账。
 */
export async function pickEngineDir(): Promise<void> {
  const picked = await pickDialog({
    multiple: false,
    directory: true,
    title: "选择 TeX Live 安装根目录（或 bin 目录）",
  });
  if (typeof picked !== "string") return;

  // TeX Live 根目录 / bin 目录：接管后 config.tex 会同时写入 installDir 与 engineBinDir
  try {
    const adopted = await compileApi.adoptTexInstall(picked);
    await useSettingsStore.getState().load();
    await runEnvCheck();
    const suffix = adopted.installDir ? ` · ${adopted.installDir}` : "";
    notify(`已接管 TeX Live（${adopted.version ?? "版本未知"}）${suffix}`, "ok");
    return;
  } catch (e) {
    // 不是 TeX Live 根目录：退回手动指定引擎目录
    console.warn("[env] 接管 TeX Live 失败，尝试手动指定引擎目录", e);
  }

  await useSettingsStore
    .getState()
    .persist({ tex: { distro: null, installDir: null, engineBinDir: picked } });
  const info = await runEnvCheck();
  if (info?.found) {
    notify(`已识别 ${info.distribution ?? "TeX"}（${info.version ?? "版本未知"}）`, "ok");
  } else {
    notify("该目录及其 bin 子目录下未找到可用引擎，请选择 xelatex.exe 所在目录或 TeX 安装根目录", "err");
  }
}
