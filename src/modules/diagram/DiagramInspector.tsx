// M2 · 2026-11-12：绘图页面画布左侧的「单个图元属性」面板。
//
// 用户口径：全局侧栏只放工具箱 / 组件库 / 图层清单 / 导出插入，属性编辑不污染侧栏；
// 属性 / 尺寸 / 对齐变换三块常驻在 diagram://editor Tab 的画布左侧，可折叠让出画布宽度。
//
// 清单去重：点选与编组仍只由侧栏 LayersPanel 承担；本组件不再渲染任何图元清单，
// 只按 selectedId / selectedIds 渲染选中态与属性编辑器。
//
// 边界不变：
//   · 本组件不渲染编辑器、不注册 sourceBridge、不碰 DiagramCodePane 与 CM6 容器；
//   · 写回仍走各面板既有的 commitDiagramPatch / commitDiagramPatches / applyDeltaEdit；
//   · 折叠只切 CSS class，不卸载面板，Draft / 提示消息不丢。
import { useState } from "react";
import { useDiagramStore } from "./store";
import { DiagramProperties } from "./DiagramProperties";
import { SizePanel } from "./SizePanel";
import { TransformPanel } from "./TransformPanel";
import "./diagram.css";

export function DiagramInspector() {
  const [collapsed, setCollapsed] = useState(false);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const renderMeta = useDiagramStore((s) => s.renderMeta);
  const source = useDiagramStore((s) => s.source);

  // 与三个面板同口径：源码改了但本地渲染还在 debounce 中时不拿旧 statements。
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
    // 复用 F3-8 的 .dg-side 控件规格作用域（只是 UI token 容器，不代表应用侧栏）；
    // 布局由 .dg-canvas-inspector 覆盖，避免复制一整套卡片 / 控件样式。
    <aside
      className={`dg-side dg-canvas-inspector${collapsed ? " is-collapsed" : ""}`}
      aria-label="图元属性"
    >
      <div className="dg-canvas-inspector-head">
        <span className="dg-canvas-inspector-title">图元属性</span>
        <span className="dg-canvas-inspector-target" title={target}>
          {target}
        </span>
        <button
          type="button"
          className="dg-canvas-inspector-toggle"
          aria-label={collapsed ? "展开属性面板" : "折叠属性面板"}
          title={collapsed ? "展开属性面板" : "折叠属性面板"}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <div className="dg-canvas-inspector-body">
        <DiagramProperties />
        <SizePanel />
        <TransformPanel />
      </div>
    </aside>
  );
}

export default DiagramInspector;
