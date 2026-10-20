// M0-6 · 侧栏（VSCode 资源管理器风格，mockup UI.html .sidebar）
// 顶部只保留「资源管理器」标签；根目录行与图标组由 ProjectTree 渲染（树的第一层）
import type { CSSProperties } from "react";
import { ProjectTree } from "./ProjectTree";

export interface SidebarProps {
  /** 拖拽得到的宽度（M0-6 不持久化，M0-12 接配置） */
  style?: CSSProperties;
}

export function Sidebar({ style }: SidebarProps) {
  return (
    <aside className="sidebar" style={style}>
      <div className="side-head">
        <div className="side-title">资源管理器</div>
      </div>

      <ProjectTree />
    </aside>
  );
}

export default Sidebar;
