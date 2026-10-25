// M1-12a · 公式模块（合并原 M1-6 符号面板 + M1-10 公式库）：侧栏「公式」单视图的统一入口。
// 经 ModuleRegistry 注册，设置页一个开关控制整块「公式」视图（输入/输出双区 +
// 快捷工具 / 公式模板 两页签，见 src/project/MathView.tsx）。默认启用。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerMathModule(): void {
  if (moduleRegistry.get("formula")) return;
  moduleRegistry.register({
    id: "formula",
    name: "公式",
    version: "1.0.0",
    description: "符号库与公式库浏览 + 搜索 + 一键插入（快捷工具 / 公式模板）",
    requires: ["editor"],
    defaultEnabled: true,
    hooks: {
      onModuleEnabled: () => console.info("[formula] 公式模块已启用"),
      onModuleDisabled: () => console.info("[formula] 公式模块已停用"),
    },
    component: lazy(() => import("./FormulaPanel")),
    slot: "sidebar",
  });
}
