// M0-6 · 侧栏（VSCode 资源管理器风格，mockup UI.html .sidebar）
// M1-5a：改为「活动栏视图」容器 —— explorer = 资源管理器 + 项目树；outline = 大纲面板。
// M1-12a：原「符号」「公式」两视图合并为「公式」单视图（MathView，输入/输出双区 +
// 快捷工具/公式模板/搭建 三页签；页签按 symbol/formula 模块启停生成）。
import { type CSSProperties } from "react";
import { useAppStore } from "@/core/store";
import { ProjectTree } from "./ProjectTree";
import { OutlinePanel } from "@/outline/OutlinePanel";
import { MathView } from "./MathView";

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
        <MathView />
      )}
    </aside>
  );
}

export default Sidebar;
