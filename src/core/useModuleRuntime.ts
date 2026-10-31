// M1-1 · 模块接口层运行时装配（App 根部挂一次）
// 职责：登记内核能力 → 注册业务模块 → 设置页覆盖值同步进注册表 → 绑定总线钩子。
// 与 useCompileBridge 同模式：全应用只挂一次，卸载时解绑。
import { useEffect } from "react";
import { moduleRegistry, bindModuleBus, KERNEL_CAPABILITIES } from "./moduleRegistry";
import { useSettingsStore } from "./settings";
import { registerMathModule } from "@/modules/formula/mathModule";
import { registerTableModule } from "@/modules/table/tableModule";
import { registerSnippetsModule } from "@/modules/snippets/snippetsModule";

export function useModuleRuntime(): void {
  useEffect(() => {
    // 内核能力登记（模块 requires 校验用；与 src/ 实际域一一对应）
    for (const cap of KERNEL_CAPABILITIES) moduleRegistry.registerCapability(cap);

    // M1-12a · 公式模块（合并原符号面板 + 公式库）：侧栏「公式」单视图的统一开关。
    // DEV+release 均注册，默认启用；设置页覆盖值经 setOverrides 落地实现「即时启停」。
    registerMathModule();

    // M1-8 · 表格模块（R6）：自带侧栏视图（LatexModule.view），活动栏/视图菜单/
    // Ctrl+B 5 由模块协议自动接入，停用即从界面消失。
    registerTableModule();

    // M2-5c · 代码片段模块（纯钩子）：设置页开关控制补全源与 Tab 直展是否生效
    registerSnippetsModule();

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
