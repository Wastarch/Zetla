// M0-6 · 侧栏（VSCode 资源管理器风格，mockup UI.html .sidebar）
// M1-5a：改为「活动栏视图」容器 —— explorer = 资源管理器 + 项目树；outline = 大纲面板。
// M1-6b：第三个视图由「模块坞」改为**符号面板专用入口**（活动栏第三图标直达，
//        不再经模块坞列表渲染）；模块停用时显示空态 + 去设置启用入口。
import { Suspense, useEffect, useState, type CSSProperties } from "react";
import { useAppStore } from "@/core/store";
import { moduleRegistry } from "@/core/moduleRegistry";
import { useModuleList } from "@/modules/useModuleList";
import { ProjectTree } from "./ProjectTree";
import { OutlinePanel } from "@/outline/OutlinePanel";

export interface SidebarProps {
  /** 拖拽得到的宽度（M0-6 不持久化，M0-13 接配置） */
  style?: CSSProperties;
}

/** 符号面板视图：直接挂载 symbol 模块的懒加载组件（仍受设置页启停控制） */
function SymbolView() {
  const mods = useModuleList();
  // 模块在 App 根 effect 注册（父级 effect 晚于子组件挂载）→ 挂载后补一拍重读注册表，
  // 否则首帧 get("symbol") 为 null 会误显示「已停用」。
  const [, setRev] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setRev((r) => r + 1), 0);
    return () => window.clearTimeout(t);
  }, []);

  const mod = moduleRegistry.get("symbol");
  const enabled = mods.find((m) => m.id === "symbol")?.enabled ?? false;
  const Comp = mod?.component;

  return (
    <div className="side-view">
      <div className="side-head">
        <div className="side-title">符号面板</div>
        {mod && <span className="side-ver">v{mod.version}</span>}
      </div>

      {enabled && Comp ? (
        <Suspense fallback={<div className="side-loading">加载中…</div>}>
          <Comp />
        </Suspense>
      ) : (
        <div className="side-empty">
          <div>符号面板已停用</div>
          <button
            type="button"
            className="btn"
            onClick={() => useAppStore.getState().openSettings("modules")}
          >
            去设置启用
          </button>
        </div>
      )}
    </div>
  );
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
        <SymbolView />
      )}
    </aside>
  );
}

export default Sidebar;
