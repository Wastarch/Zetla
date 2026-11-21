// M2 · 绘图功能模块声明（侧栏视图形态，与拼图模块同构）。
// 形态：左侧侧栏承载组件库 / 布局选项 / 导出方式；画布与源码在主编辑区的
// diagram://editor 伪 buffer Tab 中呈现（仅画布 / 仅源码 / 左右分屏三布局），
// 两者并存、互不遮挡。编辑完成后由侧栏选择导出方式，再插入主 .tex 文档。
// 引擎 vendoring 与切片安排见 docs/dev/绘图模块开发计划.md。
// M2 · 源码反向编辑：注册 tikzpicture 环境编辑器（主 .tex 里 \begin{tikzpicture} 旁的 ✎ →
// 载入该环境到绘图源码栏并锁定 targetTex），与公式/表格模块同用 envEdit 注册表。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";
import {
  registerEnvEditor,
  unregisterEnvEditor,
  type EnvEditor,
  type EnvHit,
} from "@/editor/envEdit";
import { useBuffersStore } from "@/editor/useBuffers";
import { useDiagramStore } from "./store";
import { findTikzEnvs } from "./tikzLocate";

/** tikzpicture 环境编辑器：全文扫描每个完整环境 → ✎ 标记 → 载入绘图源码栏 */
const diagramEnvEditor: EnvEditor = {
  id: "diagram",
  viewId: "diagram",
  scan: (doc) =>
    findTikzEnvs(doc).map((env) => {
      const hit: EnvHit = {
        id: "diagram",
        from: env.from,
        to: env.to,
        markAt: env.markAt,
        label: "TikZ 图",
        data: env,
      };
      return hit;
    }),
  load: (hit) => {
    // openEnvEditor 先 load 后 setSidebarView：此刻活动 Tab 仍是用户点击的那份 .tex，
    // 取它锁定 targetTex；之后 Tab 挂载触发的自动导入也因该候选来自 targetTex 而被跳过。
    const active = useBuffersStore.getState().activePath;
    const texPath = active && /\.tex$/i.test(active) ? active : null;
    const env = hit.data as ReturnType<typeof findTikzEnvs>[number];
    useDiagramStore.getState().loadFromEditorEnv(env.envText, texPath);
  },
};

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerDiagramModule(): void {
  if (moduleRegistry.get("diagram")) return;
  moduleRegistry.register({
    id: "diagram",
    name: "绘图",
    version: "0.1.0",
    description: "TikZ 可视化编辑器：源码与画布双向同步、组件库、导出插入主文档",
    requires: ["editor"],
    defaultEnabled: true,
    hooks: {
      onModuleEnabled: () => registerEnvEditor(diagramEnvEditor),
      onModuleDisabled: () => unregisterEnvEditor("diagram"),
    },
    // 不声明 slot：UI 由自带视图（view）承载，避免被 ModuleDock 重复挂载
    view: { id: "diagram", icon: "draw", label: "绘图", order: 7 },
    component: lazy(() => import("./DiagramSidebar")),
  });
}
