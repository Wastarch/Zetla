// M0-15a · TeX 环境检测桥
// runEnvCheck：探测发行版并写全局 store（设置页内联显示也订阅它）
// ensureEnv：编译前预检 —— 已知有 TeX 直接放行；检测命令失败不拦截（让编译命令报具体错）
// openEnvGuide：手动入口（帮助菜单 / 状态栏 chip）—— 每次重新检测并打开引导面板
// pickEngineDir：手动指定引擎目录（写 config.tex.engineBinDir 后重新检测验证）
import { open as pickDialog } from "@tauri-apps/plugin-dialog";
import { compileApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import type { TexDistInfo } from "@/types";

/** 会话内「未检测到 TeX 自动弹引导」只弹一次的标记（不持久化，重启重置） */
let autoGuideShown = false;

/** dev-only 调试模拟：与 Rust `detect_tex_distribution` 未找到时的返回保持一致 */
const DEBUG_NO_TEX: TexDistInfo = {
  found: false,
  distribution: "None",
  version: null,
  engines: [],
  recommended: "xelatex",
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

/** 编译前环境预检：true = 继续编译 */
export async function ensureEnv(): Promise<boolean> {
  // 已知可用直接放行（结果缓存在 store，避免每次编译都探测）
  if (useAppStore.getState().env?.found) return true;

  const info = await runEnvCheck();
  if (info === null) return true; // 检测失败不拦截
  if (info.found) return true;

  // 未检测到：首次自动弹引导，之后只提示（不打扰）
  if (!useAppStore.getState().envGuideOpen) {
    if (!autoGuideShown) {
      autoGuideShown = true;
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

/** 引导面板「手动指定引擎目录」：写 config.tex.engineBinDir（旁路落盘）后重新检测验证 */
export async function pickEngineDir(): Promise<void> {
  const picked = await pickDialog({
    multiple: false,
    directory: true,
    title: "选择引擎目录（xelatex.exe 所在目录）",
  });
  if (typeof picked !== "string") return;
  // distro 保持 null：目录是手动指定的，不算 Zetla 代装记录
  await useSettingsStore
    .getState()
    .persist({ tex: { distro: null, installDir: null, engineBinDir: picked } });
  const info = await runEnvCheck();
  if (info?.found) {
    notify(`已识别 ${info.distribution ?? "TeX"}（${info.version ?? "版本未知"}）`, "ok");
  } else {
    notify("该目录下未找到可用引擎，请确认选择了 xelatex.exe 所在目录", "err");
  }
}
