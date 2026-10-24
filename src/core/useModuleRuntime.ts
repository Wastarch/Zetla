// M1-1 · 模块接口层运行时装配（App 根部挂一次）
// 职责：登记内核能力 → 注册业务模块 → 设置页覆盖值同步进注册表 → 绑定总线钩子。
// 与 useCompileBridge 同模式：全应用只挂一次，卸载时解绑。
import { useEffect } from "react";
import { moduleRegistry, bindModuleBus, KERNEL_CAPABILITIES } from "./moduleRegistry";
import { useSettingsStore } from "./settings";
import { registerSymbolModule } from "@/modules/symbol/symbolModule";

export function useModuleRuntime(): void {
  useEffect(() => {
    // 内核能力登记（模块 requires 校验用；与 src/ 实际域一一对应）
    for (const cap of KERNEL_CAPABILITIES) moduleRegistry.registerCapability(cap);

    // M1-6 · 符号面板：唯一业务模块，DEV+release 均注册，默认启用（验证 registry 通路）。
    // M1-6b：M1-1 的「示例模块（开发自检）」已移除，设置页只保留真实模块。
    registerSymbolModule();

    // 设置页覆盖值 → 注册表：
    // - 配置未加载完成前传 null（各模块走 defaultEnabled）
    // - 之后任何设置变更（预览/保存/取消回滚）都会经此订阅落地，实现「即时启停」
    const apply = () => {
      const st = useSettingsStore.getState();
      moduleRegistry.setOverrides(st.loaded ? st.settings.modules : null);
    };
    apply();
    const unsubSettings = useSettingsStore.subscribe(apply);

    const unsubBus = bindModuleBus();
    return () => {
      unsubSettings();
      unsubBus();
    };
  }, []);
}
