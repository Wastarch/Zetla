// M2·F2-2 / F2-3：侧栏「属性」区 —— 选中图元 → 改颜色 / 线宽 / 箭头 / 线型 / 填充 → 写回源码。
// F2-3：能力矩阵判定为不可编辑的语句，显示具体锁定理由而不是属性下拉（防止绕过画布锁定）。
//
// 位置按计划放在**侧栏选项区**（不另设右坞）；画布与源码仍是主编辑区的独立 Tab。
// 数据流：DiagramCanvas 点选写 selectedId + 每次渲染写 renderMeta → 本组件按
// renderMeta.source === store.source 判定清单新鲜 → optionsEdit 生成单个最小 span 补丁
// → sourceBridge.patch() dispatch 到 CM6（与键盘直编 / F2-1 拖拽共用撤销栈）。
// 源码栏未就绪时降级为 setSource(applyPatchToSource)，功能不丢但无撤销记录，会明确提示。
import { useEffect, useMemo, useState } from "react";
import { useDiagramStore } from "./store";
import { getDiagramSourceBridge } from "./sourceBridge";
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
  const setSource = useDiagramStore((s) => s.setSource);
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
  const compatLock = selected ? (compat?.lockReasons[selected.id] ?? null) : null;
  const editable =
    compatLock && baseEdit ? { ...baseEdit, editable: false, reason: compatLock } : baseEdit;

  function commit(key: PropertyKey, value: string | null): void {
    if (!selected) return;
    const plan = planPropertyPatch(source, selected, key, value);
    if (plan.status === "error") {
      setNotice({ tone: "warn", text: plan.reason });
      return;
    }
    if (plan.status === "noop") {
      setNotice({ tone: "warn", text: "当前已是该值，无需修改。" });
      return;
    }
    const bridge = getDiagramSourceBridge();
    const written = !!bridge && bridge.patch(plan.patch, source);
    if (!written) setSource(applyPatchToSource(source, plan.patch));
    setNotice({
      tone: "ok",
      text: `${plan.label}${written ? " · Ctrl+Z 可撤销" : " · 源码栏未就绪，无撤销记录"}`,
    });
  }

  return (
    <section className="dg-side-card dg-prop-card">
      <h3 className="dg-side-card-title">属性 · 选中图元</h3>
      {statements.length === 0 ? (
        <p className="dg-side-card-sub">
          {source.trim()
            ? "正在解析图元…（切到「本地即时」预览后即可点选）"
            : "源码为空。打开绘图 Tab 编写 TikZ 后，这里会列出可选图元。"}
        </p>
      ) : (
        <>
          <p className="dg-side-card-sub">
            在画布上点击图元，或从下面列表选一条语句；改动会以最小补丁写回源码并即时重绘。
          </p>
          <div className="dg-prop-list">
            {statements.slice(0, 40).map((stmt) => {
              const state = statementEditability(stmt);
              const lock = compat?.lockReasons[stmt.id] ?? null;
              const off = !state.editable || !!lock;
              return (
                <button
                  key={stmt.id}
                  type="button"
                  className={`dg-prop-item${selectedId === stmt.id ? " is-on" : ""}${off ? " is-off" : ""}${lock ? " is-compat-locked" : ""}`}
                  title={lock ?? (off ? state.reason : statementLabel(stmt, source))}
                  onClick={() => setSelectedId(stmt.id)}
                >
                  <span className="dg-prop-item-id">{stmt.id}</span>
                  {lock && <span className="dg-prop-lock">已锁定</span>}
                  <span className="dg-prop-item-code">{statementLabel(stmt, source)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {selectedId && !selected && (
        <p className="dg-side-warn">选中的图元已不在当前源码里，请重新选择。</p>
      )}

      {selected && (
        <div className="dg-prop-detail">
          <p className="dg-prop-snippet">{statementLabel(selected, source)}</p>
          {editable && !editable.editable ? (
            <p className="dg-side-warn">{editable.reason} 请在「仅源码」布局里直接编辑。</p>
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
