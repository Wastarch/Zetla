// M2 · F3-9：预览窗口右侧的「属性设置」坞（参考 docs/dev/UI/tikz编辑器.html）。
//
// 定位：只承载**选中元素**的属性编辑（F2-2 选项面板 + F3-4 对齐 / 分布 / 变换）。
// 左侧栏保留基础元素 / 组件库 / 图层 / 插入选项，最右侧代码区保持纯净：
//   · 本组件不渲染任何编辑器、不注册 sourceBridge、不碰 DiagramCodePane 与 CM6 容器；
//   · 写回仍走两个面板既有的 commitDiagramPatch / applyDeltaEdit，唯一真源口径不变；
//   · 折叠只是组件内的展示 state，不写 store / localStorage（与 viewport 同口径）。
import { useState } from "react";
import { useDiagramStore } from "./store";
import { DiagramProperties } from "./DiagramProperties";
import { SizePanel } from "./SizePanel";
import { TransformPanel } from "./TransformPanel";
import "./diagram.css";

export function DiagramInspector() {
  const selectedId = useDiagramStore((s) => s.selectedId);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const renderMeta = useDiagramStore((s) => s.renderMeta);
  const source = useDiagramStore((s) => s.source);
  const [collapsed, setCollapsed] = useState(false);

  // 与两个面板同口径：源码改了但本地渲染还在 debounce 中时不拿旧 statements。
  const fresh = renderMeta?.source === source;
  const statement = fresh
    ? (renderMeta?.statements ?? []).find((s) => s.id === selectedId) ?? null
    : null;
  const target =
    selectedIds.length > 1
      ? `已选 ${selectedIds.length} 个图元`
      : statement
        ? `${statement.command || statement.kind} · ${statement.id}`
        : (selectedId ?? "未选中图元");

  return (
    <aside
      className={`dg-side dg-inspector${collapsed ? " is-collapsed" : ""}`}
      aria-label="选中元素属性"
    >
      <div className="dg-inspector-head">
        <span className="dg-inspector-title">属性设置</span>
        {!collapsed && (
          <span className="dg-inspector-target" title={target}>
            {target}
          </span>
        )}
        <button
          type="button"
          className="dg-inspector-toggle"
          title={collapsed ? "展开属性面板" : "收起属性面板"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "‹" : "›"}
        </button>
      </div>
      {!collapsed && (
        <div className="dg-inspector-body">
          <p className="dg-inspector-hint">
            选中画布图元后在此改线条 / 填充 / 对齐与变换；改动只写 TikZ 源码，与右侧代码区共用一条撤销栈。
          </p>
          <DiagramProperties />
          {/* F4-1：节点尺寸与 F3-4 几何变换分区并列，写不同的选项键 */}
          <SizePanel />
          <TransformPanel />
        </div>
      )}
    </aside>
  );
}

export default DiagramInspector;
