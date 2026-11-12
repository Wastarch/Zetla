// M2 · 2026-11-12：左侧栏「图元与属性」合并面板。
//
// 原 F3-9 的「预览窗口右侧属性坞」已撤销：选中图元的属性 / 尺寸 / 对齐变换
// 与图层清单统一进左侧栏，画布 pane 恢复单孩子。用户反馈左右两侧各有一份
// 可点选的图元清单（右侧 path:0… 语句列表 / 左侧 node 3… 图层行）属重复，
// 现在**只保留 LayersPanel 一份清单**：`DiagramProperties` 不再列语句，
// 只按 selectedId 渲染选中项的属性编辑器。
//
// 边界不变：
//   · 本组件不渲染编辑器、不注册 sourceBridge、不碰 DiagramCodePane 与 CM6 容器；
//   · 写回仍走各面板既有的 commitDiagramPatch / commitDiagramPatches / applyDeltaEdit；
//   · 折叠由侧栏原生 <details> 承担，本组件不新增 state / localStorage 偏好。
import { useDiagramStore } from "./store";
import { LayersPanel } from "./LayersPanel";
import { DiagramProperties } from "./DiagramProperties";
import { SizePanel } from "./SizePanel";
import { TransformPanel } from "./TransformPanel";
import "./diagram.css";

export function DiagramInspector() {
  const selectedId = useDiagramStore((s) => s.selectedId);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const renderMeta = useDiagramStore((s) => s.renderMeta);
  const source = useDiagramStore((s) => s.source);

  // 与四个面板同口径：源码改了但本地渲染还在 debounce 中时不拿旧 statements。
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
    <div className="dg-inspector-merged">
      <div className="dg-merged-target" title={target}>
        <span className="dg-merged-target-label">当前选中</span>
        <span className="dg-merged-target-value">{target}</span>
      </div>
      {/* 唯一一份图元清单：选中 / 编组 / 显隐 / 锁定 / 层级都在这里 */}
      <LayersPanel />
      {/* 以下三块只作用于上面清单（或画布）选中的图元，不再重复列语句 */}
      <DiagramProperties />
      <SizePanel />
      <TransformPanel />
    </div>
  );
}

export default DiagramInspector;
