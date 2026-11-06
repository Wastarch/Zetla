// M2·绘图模块（F1-1）：模块声明与注册。
// 形态：主区面板（ModuleViewDecl.tabMode = true）—— 点击活动栏「绘图」图标在主编辑区打开
// 绘图工作台（左源码 + 右画布 + 竖工具栏 + 右坞检查器），关闭后恢复编辑器 + PDF 预览。
// 画布渲染与拖拽由 tikz-editor 引擎承担（F1-3 / F2），导出走 Rust tikz_export（F1-4）。
// 引擎 vendoring 与 tikz-editor 集成细节见 docs/dev/绘图模块开发计划.md。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerDiagramModule(): void {
  if (moduleRegistry.get("diagram")) return;
  moduleRegistry.register({
    id: "diagram",
    name: "绘图",
    version: "0.1.0",
    description: "TikZ 可视化编辑器：源码与画布双向同步、拖拽、组件库、PDF/PNG/SVG 导出",
    requires: ["editor"],
    defaultEnabled: true,
    // 主区面板形态：活动栏入口 + 主编辑区工作台（与侧栏视图 figure/table 互斥）
    view: {
      id: "diagram",
      icon: "wand",
      label: "绘图",
      order: 7,
      tabMode: true,
    },
    // 懒加载工作台（经 App 的 ModulePanelHost 挂载）
    component: lazy(() => import("./DiagramTab")),
  });
}
