// M1-1 · 模块接口层运行时装配（App 根部挂一次）
// 职责：登记内核能力 → 注册 DEV 演示模块 → 设置页覆盖值同步进注册表 → 绑定总线钩子。
// 与 useCompileBridge 同模式：全应用只挂一次，卸载时解绑。
import { useEffect } from "react";
import { moduleRegistry, bindModuleBus, KERNEL_CAPABILITIES } from "./moduleRegistry";
import { useSettingsStore } from "./settings";
import { registerDemoModule } from "@/modules/demo/demoModule";

export function useModuleRuntime(): void {
  useEffect(() => {
    // 内核能力登记（模块 requires 校验用；与 src/ 实际域一一对应）
    for (const cap of KERNEL_CAPABILITIES) moduleRegistry.registerCapability(cap);

    // DEV 演示模块：M1-1 验收「注册一个空模块能被启停」的自检载体；
    // release 构建不注册，正式用户设置页只看到真实业务模块（M1-2 起）。
    if (import.meta.env.DEV) registerDemoModule();

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
