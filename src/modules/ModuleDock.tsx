// M1-1 · 模块面板停靠区（侧栏底部，仅渲染已启用且声明 slot="sidebar" 的模块）
// 懒加载组件统一走 React.Suspense；无启用模块时整体不占位。
import { Suspense } from "react";
import { useSlotModules } from "./useModuleList";

export function ModuleDock() {
  const mods = useSlotModules("sidebar");
  if (mods.length === 0) return null;
  return (
    <div className="mod-dock">
      {mods.map((m) => {
        const Comp = m.component!;
        return (
          <div className="mod-dock-item" key={m.id}>
            <div className="mod-dock-head">
              <span className="mod-dock-name">{m.name}</span>
              <span className="mod-dock-ver">v{m.version}</span>
            </div>
            <Suspense fallback={<div className="mod-dock-loading">加载中…</div>}>
              <Comp />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}

export default ModuleDock;
