// M2·F3-3：图层面板（侧栏视图，不设右坞）。
//
// 只呈现 / 操作**编辑器侧元数据**：虚拟分组、可见性、主动锁定、命名、折叠、嵌套。
// 全部经 store.setGrouping 落到 localStorage，TikZ 源码一个字都不改 —— 绝不产生
// `\begin{scope}`，也不会因为「编组」在源码里插入任何东西。
// 与 F2-3 的能力矩阵锁定区分：这里的是用户主动「不想误改」，画布拖拽与属性区都会尊重。
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useDiagramStore } from "./store";
import {
  buildLayerRows,
  createGroup,
  deleteGroup,
  expandGroupElements,
  patchGroup,
  toggleId,
  toggleSelection,
  type LayerRow,
} from "./grouping.ts";
import { planZOrderEdit, type ZOrderOp } from "./zOrder.ts";
import { commitDiagramPatches } from "./diagramHistory";
import { canEditDiagramSource } from "./editability.ts";

interface Notice {
  tone: "ok" | "warn";
  text: string;
}

export function LayersPanel() {
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const renderMeta = useDiagramStore((s) => s.renderMeta);
  const grouping = useDiagramStore((s) => s.grouping);
  const setGrouping = useDiagramStore((s) => s.setGrouping);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const setSelectedIds = useDiagramStore((s) => s.setSelectedIds);
  const layersVisible = useDiagramStore((s) => s.layersVisible);
  const setLayersVisible = useDiagramStore((s) => s.setLayersVisible);
  const previewMode = useDiagramStore((s) => s.previewMode);
  // F3-6：z-order 会重排源码语句，精确通道只读必须禁；分组 / 隐藏 / 主动锁定是
  // 编辑器侧元数据（不写 TikZ），按唯一真源口径仍然可用。
  const permission = canEditDiagramSource({ previewMode });
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  // 与属性区同口径：源码改了但还在 160ms debounce 时，宁可显示「解析中」也不列旧 id。
  const fresh = renderMeta?.source === source;
  const statements = fresh ? (renderMeta?.statements ?? []) : [];
  const rows = useMemo(() => buildLayerRows(statements, grouping), [statements, grouping]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const canGroup = selectedIds.length >= 2;
  // z-order 只对顶层语句生效；需要一份新鲜的渲染结果才能拿到语句 span；精确通道只读禁用。
  const canZ = fresh && selectedIds.length > 0 && permission.ok;
  const activeGroup = grouping.groups.find((g) => g.id === activeGroupId) ?? null;

  function flash(text: string, tone: Notice["tone"] = "ok"): void {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 3500);
  }

  function doGroup(): void {
    if (!canGroup) return;
    const out = createGroup(grouping, selectedIds);
    if (!out.groupId) return;
    setGrouping(out.state);
    setActiveGroupId(out.groupId);
    flash(`已编组 ${selectedIds.length} 个图元（源码零改动，可一次撤销整组位移）`);
  }

  function doUngroup(): void {
    if (!activeGroupId) return;
    setGrouping(deleteGroup(grouping, activeGroupId));
    flash("已解组：只删除编辑器侧分组元数据，源码不变");
    setActiveGroupId(null);
  }

  function toggleHidden(row: LayerRow): void {
    if (row.kind === "group") {
      setGrouping(patchGroup(grouping, row.id, { hidden: !row.hidden }));
    } else {
      setGrouping({ ...grouping, hiddenIds: toggleId(grouping.hiddenIds, row.id) });
    }
  }

  function toggleLocked(row: LayerRow): void {
    if (row.kind === "group") {
      setGrouping(patchGroup(grouping, row.id, { locked: !row.locked }));
    } else {
      setGrouping({ ...grouping, lockedIds: toggleId(grouping.lockedIds, row.id) });
    }
  }

  function selectRow(row: LayerRow, e: ReactMouseEvent): void {
    if (row.kind === "group") {
      setActiveGroupId(row.id);
      const members = expandGroupElements(grouping.groups, row.id);
      // 组行点击 = 选中整组（Shift 时对整组做加选 / 减选），不是只选第一个
      if (e.shiftKey) {
        const next = new Set(selectedIds);
        for (const id of members) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        setSelectedIds(Array.from(next));
      } else {
        setSelectedIds(members);
      }
      return;
    }
    setActiveGroupId(null);
    setSelectedIds(toggleSelection(selectedIds, row.id, e.shiftKey));
  }

  function commitRename(): void {
    if (!renaming) return;
    setGrouping(patchGroup(grouping, renaming, { name: draft.trim() }));
    setRenaming(null);
  }

  /** F3-5：整段重排顶层语句（front/back/forward/backward），最小 span 补丁一次撤销。 */
  function doZOrder(op: ZOrderOp): void {
    if (!permission.ok) {
      flash(permission.reason, "warn");
      return;
    }
    if (!fresh || !renderMeta) return;
    const edit = planZOrderEdit(source, renderMeta.statements, selectedIds, op);
    if (!edit) {
      flash("已在顶 / 底，或选中项里没有可重排的顶层图元", "warn");
      return;
    }
    const write = commitDiagramPatches({
      patches: edit.patches,
      source,
      nextSource: edit.nextSource,
      fallback: setSource,
    });
    flash(
      write.written ? "已调整层级顺序 · Ctrl+Z 一次撤销" : "已调整层级（源码栏未就绪，无撤销记录）",
      write.written ? "ok" : "warn",
    );
  }

  return (
    <section className="dg-side-card dg-layer-card">
      <div className="dg-layer-head">
        <h3 className="dg-side-card-title">图层 · 分组</h3>
        <button
          type="button"
          className="dg-layer-toggle"
          aria-expanded={layersVisible}
          onClick={() => setLayersVisible(!layersVisible)}
        >
          {layersVisible ? "收起" : "展开"}
        </button>
      </div>
      {!layersVisible ? (
        <p className="dg-side-card-sub">图层面板已收起；分组 / 隐藏 / 锁定设置仍保留。</p>
      ) : (
        <>
          <p className="dg-side-card-sub">
            框选或 Shift 加选多个图元后点「编组」；分组只存编辑器侧，源码不出现 scope。
            眼睛 = 画布可见性（源码仍在），锁 = 主动锁定（禁止拖拽 / 改属性）。
          </p>
          <div className="dg-layer-actions">
            <button type="button" className="btn" disabled={!canGroup} onClick={doGroup}>
              编组{canGroup ? `（${selectedIds.length}）` : ""}
            </button>
            <button type="button" className="btn" disabled={!activeGroup} onClick={doUngroup}>
              解组
            </button>
            <button
              type="button"
              className="btn"
              disabled={selectedIds.length === 0}
              onClick={() => setSelectedIds([])}
            >
              清空选择
            </button>
          </div>

          {/* F3-5：层级 z-order —— 重排源码语句顺序（整段移动，注释 / 缩进零改动） */}
          <div className="dg-layer-actions dg-zorder-actions">
            <span className="dg-zorder-label">层级</span>
            {!permission.ok && (
              <span className="dg-zorder-readonly" title={permission.reason}>
                只读
              </span>
            )}
            <button
              type="button"
              className="dg-mini-btn"
              disabled={!canZ}
              onClick={() => doZOrder("front")}
              title="移到最上层（源码最后绘制）"
            >
              置顶
            </button>
            <button
              type="button"
              className="dg-mini-btn"
              disabled={!canZ}
              onClick={() => doZOrder("forward")}
              title="上移一层（与上一层交换顺序）"
            >
              上移
            </button>
            <button
              type="button"
              className="dg-mini-btn"
              disabled={!canZ}
              onClick={() => doZOrder("backward")}
              title="下移一层（与下一层交换顺序）"
            >
              下移
            </button>
            <button
              type="button"
              className="dg-mini-btn"
              disabled={!canZ}
              onClick={() => doZOrder("back")}
              title="移到最下层（源码最先绘制）"
            >
              置底
            </button>
          </div>

          {!fresh ? (
            <p className="dg-side-card-sub">正在解析图元…</p>
          ) : rows.length === 0 ? (
            <p className="dg-side-card-sub">当前源码没有可列出的图元。</p>
          ) : (
            <ul className="dg-layer-list">
              {rows.map((row) => {
                const isGroup = row.kind === "group";
                const isOn = isGroup
                  ? row.id === activeGroupId
                  : selected.has(row.id);
                return (
                  <li
                    key={`${row.kind}:${row.id}:${row.depth}`}
                    className={`dg-layer-row is-${row.kind}${isOn ? " is-on" : ""}${row.hidden ? " is-hidden" : ""}${row.locked ? " is-locked" : ""}`}
                    style={{ paddingLeft: `${6 + row.depth * 12}px` }}
                  >
                    {isGroup && (
                      <button
                        type="button"
                        className="dg-layer-icon"
                        title={row.collapsed ? "展开分组" : "折叠分组"}
                        onClick={() =>
                          setGrouping(patchGroup(grouping, row.id, { collapsed: !row.collapsed }))
                        }
                      >
                        {row.collapsed ? "▸" : "▾"}
                      </button>
                    )}
                    {isGroup && renaming === row.id ? (
                      <input
                        className="dg-side-input dg-layer-rename"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        aria-label="分组名称"
                      />
                    ) : (
                      <button
                        type="button"
                        className="dg-layer-name"
                        title={isGroup ? "点击选中整组（Shift 并入当前选择）" : "点击定位选中（Shift 加选 / 减选）"}
                        onClick={(e) => selectRow(row, e)}
                      >
                        {row.label}
                      </button>
                    )}
                    {isGroup && <span className="dg-layer-count">{row.count}</span>}
                    <span className="dg-layer-ops">
                      <button
                        type="button"
                        className={`dg-layer-icon${row.hidden ? " is-active" : ""}`}
                        title={row.hidden ? "显示（源码始终保留）" : "隐藏（源码始终保留）"}
                        onClick={() => toggleHidden(row)}
                      >
                        {row.hidden ? "隐" : "显"}
                      </button>
                      <button
                        type="button"
                        className={`dg-layer-icon${row.locked ? " is-active" : ""}`}
                        title={row.locked ? "解锁" : "主动锁定（禁止拖拽 / 改属性）"}
                        onClick={() => toggleLocked(row)}
                      >
                        {row.locked ? "锁" : "开"}
                      </button>
                      {isGroup && (
                        <>
                          <button
                            type="button"
                            className="dg-layer-icon"
                            title="重命名分组"
                            onClick={() => {
                              setRenaming(row.id);
                              setDraft(row.label);
                              setActiveGroupId(row.id);
                            }}
                          >
                            名
                          </button>
                          <button
                            type="button"
                            className="dg-layer-icon"
                            title="解散分组（源码不变）"
                            onClick={() => {
                              setGrouping(deleteGroup(grouping, row.id));
                              if (activeGroupId === row.id) setActiveGroupId(null);
                            }}
                          >
                            ×
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {notice && (
            <p className={`dg-prop-notice is-${notice.tone}`} role="status">
              {notice.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default LayersPanel;
