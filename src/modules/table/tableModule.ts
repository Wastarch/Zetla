// M1-8 · 表格模块（R6）：侧栏「表格」视图的模块声明。
// 形态：自带侧栏视图的模块（LatexModule.view）——活动栏图标、视图菜单项、
// Ctrl+B 5 均由内核按下述声明自动接入，无需在 ActivityBar/Sidebar/MenuBar 硬编码。
// 组件 TablePanel 懒加载：网格 UI 与代码生成器体积不进首屏。
// M1-19/M1-20：模块启停联动注册/注销「表格」环境编辑器（环境开头常驻 ✎ 标记 → 反向编辑）。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";
import { registerEnvEditor, unregisterEnvEditor, type EnvEditor } from "@/editor/envEdit";
import { scanTables } from "./tableParse";
import { loadTableRange } from "./tableEdit";

/** 表格环境编辑器：全文扫描命中 tabular/tabularx/tabular* → 打开表格面板反向编辑 */
const tableEnvEditor: EnvEditor = {
  id: "table",
  viewId: "table",
  scan: (doc) =>
    scanTables(doc).map((e) => ({
      id: "table",
      from: e.from,
      to: e.to,
      markAt: e.markAt,
      label: `表格（${e.name}）`,
    })),
  load: (hit) => {
    loadTableRange(hit.from, hit.to);
  },
};

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerTableModule(): void {
  if (moduleRegistry.get("table")) return;
  moduleRegistry.register({
    id: "table",
    name: "表格",
    version: "0.1.0",
    description: "网格编辑 → booktabs 三线表；CSV/TSV 导入、Excel 粘贴、光标处表格回填",
    requires: ["editor"],
    defaultEnabled: true,
    // 注意：不声明 slot —— 本模块的 UI 由自带视图（view）承载，
    // 若同时声明 slot 会被通用坞（ModuleDock）重复挂载。
    view: { id: "table", icon: "table", label: "表格", hint: "Ctrl+B 5", order: 5 },
    hooks: {
      onModuleEnabled: () => registerEnvEditor(tableEnvEditor),
      onModuleDisabled: () => unregisterEnvEditor("table"),
    },
    component: lazy(() => import("./TablePanel")),
  });
}
