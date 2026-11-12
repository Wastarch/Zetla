// M2·F2-2 / F2-3 / F2-4 / F3-3：画布左侧「属性」区 —— 选中图元 → 改颜色 / 线宽 / 箭头 / 线型 / 填充 → 写回源码。
// F2-3：能力矩阵判定为不可编辑的语句，显示具体锁定理由而不是属性下拉（防止绕过画布锁定）。
// F2-4：连续改同一个属性并入同一组 history，与画布拖拽共享同一个合并会话。
// F3-3：多选时属性只作用于主选中项（selectedId = selectedIds[0]）；图层面板的主动锁定
//        与 F2-3 能力锁定并列生效，避免用户绕过画布的「禁止拖拽」还能从属性面板改属性。
//
// 位置：绘图 Tab 画布左侧属性面板（2026-11-12 从侧栏分离，不污染全局侧栏）。
// 与 LayersPanel 共用**唯一一份**图元清单：本组件不再渲染语句选择列表，
// 只按 selectedId 编辑属性；选中来自画布点选或侧栏图层行。
// 数据流：DiagramCanvas 点选写 selectedId + 每次渲染写 renderMeta → 本组件按
// renderMeta.source === store.source 判定清单新鲜 → optionsEdit 生成单个最小 span 补丁
// → commitDiagramPatch() 经 sourceBridge dispatch 到 CM6（与键盘直编 / F2-1 拖拽共用撤销栈）。
// 源码栏未就绪时降级为 setSource(applyPatchToSource)，功能不丢但无撤销记录，会明确提示。
import { useEffect, useMemo, useState } from "react";
import { useDiagramStore } from "./store";
import { commitDiagramPatch } from "./diagramHistory";
import { isManuallyLocked } from "./grouping.ts";
import { canEditDiagramSource } from "./editability.ts";
import {
  PROPERTY_LABELS,
  PROPERTY_PRESETS,
  applyPatchToSource,
  planPropertyPatch,
  readProperty,
  statementEditability,
  statementLabel,
  type PropertyChoice,
  type PropertyKey,
} from "./optionsEdit.ts";

interface PropertyRowProps {
  label: string;
  value: string | null;
  presets: readonly PropertyChoice[];
  onCommit: (value: string | null) => void;
}

function PropertyRow({ label, value, presets, onCommit }: PropertyRowProps) {
  const isCustom = value !== null && !presets.some((p) => p.value === value);
  const [customMode, setCustomMode] = useState(isCustom);
  const [text, setText] = useState(value ?? "");

  // 外部写回成功后 value 变化，回到预设态 / 清掉上一次的自定义草稿
  useEffect(() => {
    setCustomMode(isCustom);
    setText(value ?? "");
  }, [value, isCustom]);

  const applyText = () => onCommit(text.trim() || null);

  return (
    <div className="dg-prop-row">
      <span className="dg-prop-label">{label}</span>
      <select
        className="dg-prop-select"
        value={customMode ? "__custom__" : (value ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onCommit(v === "" ? null : v);
        }}
      >
        {presets.map((p) => (
          <option key={p.value ?? "__default__"} value={p.value ?? ""}>
            {p.label}
          </option>
        ))}
        <option value="__custom__">自定义…</option>
      </select>
      {customMode && (
        <div className="dg-prop-custom">
          <input
            className="dg-side-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyText();
            }}
            placeholder="如 blue!40 / 1.2pt / dashed"
            spellCheck={false}
          />
          <button type="button" className="btn" onClick={applyText}>
            应用
          </button>
        </div>
      )}
      <span className="dg-prop-current">当前：{value ?? "默认"}</span>
    </div>
  );
}

interface Notice {
  tone: "ok" | "warn";
  text: string;
}

export function DiagramProperties() {
  const source = useDiagramStore((s) => s.source);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const setSelectedId = useDiagramStore((s) => s.setSelectedId);
  const renderMeta = useDiagramStore((s) => s.renderMeta);
  const previewMode = useDiagramStore((s) => s.previewMode);
  // F3-6：精确通道只读 —— 属性写回是写源码，统一走全模块判定。
  const permission = canEditDiagramSource({ previewMode });
  const readonly = !permission.ok;
  const setSource = useDiagramStore((s) => s.setSource);
  const grouping = useDiagramStore((s) => s.grouping);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // 源码改了但本地渲染还在 160ms debounce 中时，旧 statements 的 span 已失效：
  // 直接按 source 相等判定，宁可短暂显示「等待渲染」也不打过期补丁。
  const fresh = renderMeta?.source === source;
  const statements = fresh ? (renderMeta?.statements ?? []) : [];
  const compat = fresh ? (renderMeta?.compat ?? null) : null;
  const selected = useMemo(
    () => statements.find((s) => s.id === selectedId) ?? null,
    [statements, selectedId],
  );
  const baseEdit = selected ? statementEditability(selected) : null;
  // F2-3：capabilityMatrix 归因的锁定优先于 F2-2 的语句类型判定，理由更具体
  // （例如 \draw … let \p1 在 F2-2 里被当成普通可编辑 Path）。
  // F6-补强：fit 只锁坐标写回，颜色 / 线宽 / 箭头等属性与变换选项同样安全，
  // 与画布 / planTransformPatches 共用 coordinateOnlyLockIds 放行表。
  const compatLock = selected && !compat?.coordinateOnlyLockIds[selected.id]
    ? (compat?.lockReasons[selected.id] ?? null)
    : null;
  // F3-3：图层面板的主动锁定与 F2-3 能力锁定并列，理由要区分开。
  const manualLock = selected && isManuallyLocked(grouping, selected.id)
    ? "该图元已在图层面板主动锁定，先解锁后再编辑。"
    : null;
  const lockedEdit =
    (compatLock || manualLock) && baseEdit
      ? { ...baseEdit, editable: false, reason: compatLock ?? manualLock ?? "" }
      : baseEdit;
  // 精确通道优先：把属性区整体收敛成只读理由条，不渲染任何可写下拉 / 输入框。
  const editable =
    readonly && lockedEdit
      ? { ...lockedEdit, editable: false, reason: permission.reason }
      : lockedEdit;

  function commit(key: PropertyKey, value: string | null): void {
    if (!selected || !permission.ok) {
      setNotice({ tone: "warn", text: permission.reason });
      return;
    }
    if (manualLock) {
      setNotice({ tone: "warn", text: manualLock });
      return;
    }
    const plan = planPropertyPatch(source, selected, key, value);
    if (plan.status === "error") {
      setNotice({ tone: "warn", text: plan.reason });
      return;
    }
    if (plan.status === "noop") {
      setNotice({ tone: "warn", text: "当前已是该值，无需修改。" });
      return;
    }
    const nextSource = applyPatchToSource(source, plan.patch);
    const write = commitDiagramPatch({
      key: `prop:${selected.id}:${key}`,
      source,
      nextSource,
      fallback: setSource,
    });
    const suffix = write.written
      ? write.merged
        ? " · 连续微调已并组，Ctrl+Z 撤回整组"
        : " · Ctrl+Z 可撤销"
      : " · 源码栏未就绪，无撤销记录";
    setNotice({ tone: write.written ? "ok" : "warn", text: `${plan.label}${suffix}` });
  }

  return (
    <section className="dg-side-card dg-prop-card">
      <h3 className="dg-side-card-title">属性 · 选中图元</h3>
      {readonly && <div className="dg-panel-readonly">{permission.reason}</div>}
      {statements.length === 0 ? (
        <p className="dg-side-card-sub">
          {source.trim() ? "解析中…" : "源码为空"}
        </p>
      ) : (
        <>
          <p className="dg-side-card-sub">在画布或图层清单点选图元</p>
          {selectedIds.length > 1 && (
            <p
              className="dg-side-card-sub"
              title="整体移动请在画布拖任一选中图元，或在上方清单编组"
            >
              已多选 {selectedIds.length} 项，属性作用于 <code>{selectedId}</code>
            </p>
          )}
        </>
      )}

      {selectedId && !selected && (
        <p className="dg-side-warn">该图元已不在源码中</p>
      )}

      {selected && (
        <div className="dg-prop-detail">
          <p className="dg-prop-snippet">{statementLabel(selected, source)}</p>
          {editable && !editable.editable ? (
            <p className="dg-side-warn">
              {editable.reason}（用「仅源码」布局编辑）
            </p>
          ) : (
            <>
              {editable?.keys.map((key) => (
                <PropertyRow
                  key={key}
                  label={PROPERTY_LABELS[key]}
                  value={readProperty(selected, key)}
                  presets={PROPERTY_PRESETS[key]}
                  onCommit={(v) => commit(key, v)}
                />
              ))}
              <button type="button" className="btn dg-prop-clear" onClick={() => setSelectedId(null)}>
                取消选中
              </button>
            </>
          )}
        </div>
      )}

      {notice && (
        <p className={`dg-prop-notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}

export default DiagramProperties;
