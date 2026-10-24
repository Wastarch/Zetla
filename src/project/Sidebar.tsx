// M0-6 · 侧栏（VSCode 资源管理器风格，mockup UI.html .sidebar）
// M1-5a：改为「活动栏视图」容器 ——
//   explorer = 资源管理器标签 + 项目树；outline = 大纲面板独占；
//   modules = 模块坞独占（fill 模式，原先是资源管理器底部固定区）
import type { CSSProperties } from "react";
import { useAppStore } from "@/core/store";
import { ProjectTree } from "./ProjectTree";
import { ModuleDock } from "@/modules/ModuleDock";
import { OutlinePanel } from "@/outline/OutlinePanel";

export interface SidebarProps {
  /** 拖拽得到的宽度（M0-6 不持久化，M0-13 接配置） */
  style?: CSSProperties;
}

export function Sidebar({ style }: SidebarProps) {
  const view = useAppStore((s) => s.sidebarView);

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
      ) : (
        <div className="side-view">
          <div className="side-head">
            <div className="side-title">模块</div>
          </div>
          <ModuleDock fill />
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
