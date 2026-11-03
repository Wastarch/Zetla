// F2 · 拼图功能模块声明（侧栏视图形态，与表格模块同构）。
// 形态：自带侧栏视图（LatexModule.view）——活动栏图标、视图菜单项由内核按下述声明自动接入，
// 无需在 ActivityBar/Sidebar/MenuBar 硬编码。组件 FigureCanvas 懒加载（不进首屏）。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerFigureModule(): void {
  if (moduleRegistry.get("figure")) return;
  moduleRegistry.register({
    id: "figure",
    name: "拼图",
    version: "0.1.0",
    description: "多图拼成论文插图：网格布局 → 生成 subfigure 代码（F2 起）",
    requires: ["editor"],
    defaultEnabled: true,
    // 不声明 slot：UI 由自带视图（view）承载，避免被 ModuleDock 重复挂载
    view: { id: "figure", icon: "image", label: "拼图", order: 6 },
    component: lazy(() => import("./FigureCanvas")),
  });
}
