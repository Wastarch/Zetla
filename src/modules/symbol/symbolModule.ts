// M1-6 · 符号面板模块（开发文档 §3.4 / R7）：经 ModuleRegistry 注册，验证「注册 → 设置页启停
// → 钩子派发 → 懒加载面板挂载 → 向编辑器插入代码」全通路。
// 这是当前唯一的业务模块（M1-1 的 demo 自检模块已于 M1-6b 移除），默认启用；
// 侧栏**第三视图**（活动栏 wand 图标 / Ctrl+B 3）是它的专用入口，不再经模块坞列表渲染。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerSymbolModule(): void {
  if (moduleRegistry.get("symbol")) return;
  moduleRegistry.register({
    id: "symbol",
    name: "符号面板",
    version: "1.0.0",
    description: "符号库浏览 + 搜索 + 一键插入（M1-6；R7）",
    requires: ["editor"],
    defaultEnabled: true,
    hooks: {
      onModuleEnabled: () => console.info("[symbol] 符号面板已启用"),
      onModuleDisabled: () => console.info("[symbol] 符号面板已停用"),
    },
    component: lazy(() => import("./SymbolPanel")),
    slot: "sidebar",
  });
}
