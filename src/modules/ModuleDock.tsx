// M1-1 · 模块面板停靠区（仅渲染已启用且声明 slot="sidebar" 的模块）
// M1-5a：支持 fill 模式 —— 作为侧栏「模块」视图独占整栏（原先是资源管理器底部固定区）
// 懒加载组件统一走 React.Suspense；无启用模块时：fill 显示空态，否则整体不占位。
import { Suspense } from "react";
import { useAppStore } from "@/core/store";
import { useSlotModules } from "./useModuleList";

export interface ModuleDockProps {
  /** 独占侧栏视图：撑满高度、去顶边框、空态带「去设置启用」入口 */
  fill?: boolean;
}

export function ModuleDock({ fill = false }: ModuleDockProps) {
  const mods = useSlotModules("sidebar");

  if (mods.length === 0) {
    if (!fill) return null;
    return (
      <div className="mod-dock-empty">
        <div>暂无已启用模块</div>
        <button
          type="button"
          className="btn"
          onClick={() => useAppStore.getState().openSettings("modules")}
        >
          去设置启用
        </button>
      </div>
    );
  }

  return (
    <div className={fill ? "mod-dock fill" : "mod-dock"}>
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
