// M1-10 · 公式模块（验证「注册 → 设置页启停 → 懒加载面板挂载 → 向编辑器插入代码」通路）
// 镜像 symbol 模块：默认启用；侧栏**第四视图**（活动栏 formula 图标 / Ctrl+B 4）是其专用入口，
// 不再经模块坞列表渲染。插入时按设置（编号/行内）智能包裹（见 FormulaPanel）。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerFormulaModule(): void {
  if (moduleRegistry.get("formula")) return;
  moduleRegistry.register({
    id: "formula",
    name: "公式",
    version: "1.0.0",
    description: "公式库浏览 + 搜索 + 一键插入（M1-10）",
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
