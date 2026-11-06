// M0-6 · 侧栏（VSCode 资源管理器风格，mockup UI.html .sidebar）
// M1-5a：改为「活动栏视图」容器 —— explorer = 资源管理器 + 项目树；outline = 大纲面板。
// M1-12a：原「符号」「公式」两视图合并为「公式」单视图（MathView，输入/输出双区 +
// 快捷工具/公式模板 两页签；整体随「公式」模块启停）。
// M1-12b：MathView 整体懒加载——其内部含 katex（编写区可视化 + 输出区预览），
//          经此 lazy 使 katex 只在首开公式侧栏时进网络，explorer/outline 视图不受影响。
// M1-8：模块自带视图（LatexModule.view，如表格）走动态分支——侧栏不再为每个模块加硬编码，
//       模块停用/未注册时回退 explorer，避免留下指向空组件的死视图。
import { Suspense, lazy, useEffect, type CSSProperties, type ComponentType, type LazyExoticComponent } from "react";
import { BUILTIN_SIDEBAR_VIEWS, useAppStore } from "@/core/store";
import { useModuleViews } from "@/modules/useModuleList";
import type { LatexModule, ModuleViewDecl } from "@/types/module";
import { ProjectTree } from "./ProjectTree";
import { OutlinePanel } from "@/outline/OutlinePanel";
import ReferencePanel from "@/modules/reference/ReferencePanel";
import { SearchView } from "@/editor/SearchView";

const MathView = lazy(() => import("./MathView"));

export interface SidebarProps {
  /** 拖拽得到的宽度（M0-6 不持久化，M0-13 接配置） */
  style?: CSSProperties;
}

/** 模块视图宿主：标题栏 + 懒加载组件（模块自带视图的统一外壳） */
function ModuleViewHost({
  view: decl,
  component: Comp,
}: {
  view: ModuleViewDecl;
  component: LazyExoticComponent<ComponentType>;
}) {
  return (
    <div className="side-view">
      <div className="side-head">
        <div className="side-title">{decl.label}</div>
      </div>
      <Suspense fallback={<div className="side-loading">加载中…</div>}>
        <Comp />
      </Suspense>
    </div>
  );
}

export function Sidebar({ style }: SidebarProps) {
  const view = useAppStore((s) => s.sidebarView);
  const moduleViews = useModuleViews();
  const modEntry = moduleViews.find((mv) => mv.view.id === view) as
    | { module: LatexModule; view: ModuleViewDecl }
    | undefined;

  // 视图失效（提供该视图的模块被停用/卸载）→ 回退资源管理器
  const known = (BUILTIN_SIDEBAR_VIEWS as readonly string[]).includes(view) || !!modEntry;
  useEffect(() => {
    if (!known) useAppStore.getState().setSidebarView("explorer");
  }, [known]);

  return (
    <aside className="sidebar" style={style}>
      {view === "explorer" ? (
        <>
          <div className="side-head">
            <div className="side-title">资源管理器</div>
          </div>

          <ProjectTree />
        </>
      ) : view === "outline" ? (
        <div className="side-view">
          <OutlinePanel />
        </div>
      ) : view === "references" ? (
        <div className="side-view">
          <div className="side-head">
            <div className="side-title">引用</div>
          </div>
          <ReferencePanel />
        </div>
      ) : view === "search" ? (
        <SearchView />
      ) : view === "math" ? (
        <Suspense
          fallback={
            <div className="side-view">
              <div className="side-loading">加载中…</div>
            </div>
          }
        >
          <MathView />
        </Suspense>
      ) : modEntry?.module.component ? (
        <ModuleViewHost view={modEntry.view} component={modEntry.module.component} />
      ) : (
        <div className="side-empty">
          <div>该视图不可用（提供它的模块可能已停用）</div>
          <button
            type="button"
            className="btn"
            onClick={() => useAppStore.getState().openSettings("modules")}
          >
            去设置启用
          </button>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
