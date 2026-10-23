// M1-1 · DEV 演示模块（注册表自检载体，release 不注册）
// 用途：验证「注册 → 设置页启停 → 钩子派发 → 懒加载面板挂载 → 向编辑器插入代码」全通路。
// M1-2 起的真实业务模块（symbol/table/image）按同模式声明。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerDemoModule(): void {
  if (moduleRegistry.get("demo")) return;
  moduleRegistry.register({
    id: "demo",
    name: "示例模块（开发自检）",
    version: "0.1.0",
    description: "M1-1 注册表演示：启用后在侧栏底部显示面板，可经钩子向编辑器插入代码",
    requires: ["editor"],
    defaultEnabled: false,
    hooks: {
      onModuleEnabled: () => console.info("[demo] 模块已启用"),
      onModuleDisabled: () => console.info("[demo] 模块已停用"),
      onCompileDone: (r) => console.info("[demo] 编译完成：", r.status),
    },
    component: lazy(() => import("./DemoPanel")),
    slot: "sidebar",
  });
}
