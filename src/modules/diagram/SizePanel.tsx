// M2 · F4-1：节点尺寸数值面板（W / H + 单位 + 应用范围），挂在左侧栏「图元与属性」合并区。
//
// 与 F3-4「变换（数值）」分区并列但**语义不同**：那里写 rotate/scale/xshift/yshift，
// 这里写 text width / minimum height（节点文本框尺寸），绝不合成单一 scale=。
// 写回统一走 planSizePatches → mergeSourcePatches → commitDiagramPatches，
// 一次 dispatch = 一条 Ctrl+Z；只读 / 锁定 / 能力矩阵全部沿用既有判定。
import { useMemo, useState } from "react";
import { useDiagramStore } from "./store";
import { canEditDiagramSource } from "./editability.ts";
import {
  SIZE_LABELS,
  normalizeSizeValue,
  planSizePatches,
  sizeValueToPt,
  type SizeKey,
  type SizeValues,
} from "./sizeEdit.ts";
import {
  findStyleUsers,
  scanSharedStyles,
  sharedStyleHint,
  styleNamesForStatement,
} from "./sharedStyle.ts";
import { commitDiagramPatches } from "./diagramHistory.ts";
import { isManuallyLocked } from "./grouping.ts";
import "./diagram.css";

type Tone = "ok" | "warn";
type SizeUnit = "cm" | "pt";

function currentSize(entries: readonly { key: string; value: string | null }[], key: SizeKey): string | null {
  const hit = entries.find((e) => e.value !== null && e.key.trim().toLowerCase() === key);
  return hit?.value ?? null;
}

/** 输入「4」按当前单位补成 4cm / 4pt；已带单位则原样交给白名单校验。 */
function withUnit(text: string, unit: SizeUnit): string {
  const t = text.trim();
  return /[a-z]{2}$/i.test(t) ? t : `${t}${unit}`;
}

export function SizePanel() {
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const renderMeta = useDiagramStore((s) => s.renderMeta);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const grouping = useDiagramStore((s) => s.grouping);
  const permission = canEditDiagramSource({ previewMode });
  const readonly = !permission.ok;

  const [draft, setDraft] = useState<{ w: string; h: string; unit: SizeUnit }>({
    w: "", h: "", unit: "cm",
  });
  const [applyToAll, setApplyToAll] = useState(false);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);

  const fresh = renderMeta?.source === source;
  const statements = fresh ? (renderMeta?.statements ?? []) : [];
  const compat = fresh ? (renderMeta?.compat ?? null) : null;
  const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
  const selected = statements.find((s) => s.id === selectedId) ?? null;

  const defs = useMemo(() => scanSharedStyles(source), [source]);
  const names = useMemo(
    () => (selected ? styleNamesForStatement(selected, defs) : []),
    [selected, defs],
  );
  const hint = sharedStyleHint(defs, names);
  const styleUsers = useMemo(
    () => (names.length > 0 ? findStyleUsers(defs, statements, names) : []),
    [names, defs, statements],
  );
  // 无共享样式时「同类」退化为所有 \node（同 command），保证批量能力不依赖 .style。
  const allNodeIds = useMemo(
    () => statements.filter((s) => s.command === "node").map((s) => s.id),
    [statements],
  );
  const groupIds = styleUsers.length > 0 ? styleUsers : allNodeIds;
  const targetIds = applyToAll ? groupIds : ids;

  const manualLock = selected && isManuallyLocked(grouping, selected.id)
    ? "该图元已在图层面板主动锁定，先解锁后再改尺寸。"
    : null;
  const compatLock = selected ? (compat?.lockReasons[selected.id] ?? null) : null;
  const blocked = readonly || !!manualLock || !!compatLock || ids.length === 0;
  const blockReason = readonly
    ? permission.reason
    : (manualLock ?? compatLock ?? "未选中图元 · 在画布点选节点后可用");

  const curW = selected ? currentSize(selected.entries, "text width") : null;
  const curH = selected ? currentSize(selected.entries, "minimum height") : null;
  const curWPt = sizeValueToPt(curW);
  const curHPt = sizeValueToPt(curH);

  const validate = (): { values: SizeValues } | { error: string } => {
    const values: SizeValues = {};
    if (draft.w.trim()) {
      const n = normalizeSizeValue("text width", withUnit(draft.w, draft.unit));
      if ("error" in n) return { error: n.error };
      values["text width"] = n.value;
    }
    if (draft.h.trim()) {
      const n = normalizeSizeValue("minimum height", withUnit(draft.h, draft.unit));
      if ("error" in n) return { error: n.error };
      values["minimum height"] = n.value;
    }
    if (Object.keys(values).length === 0) return { error: "请输入 W 或 H 后再应用。" };
    return { values };
  };

  function commit(values: SizeValues, label: string): void {
    if (blocked) {
      setMsg({ tone: "warn", text: blockReason });
      return;
    }
    const plan = planSizePatches({
      source, statements, elementIds: targetIds, values, compat,
      grouping: useDiagramStore.getState().grouping,
    });
    if (plan.status === "empty") {
      setMsg({ tone: "warn", text: plan.reason || "所选节点都已是该尺寸。" });
      return;
    }
    if (plan.status !== "ok") {
      setMsg({ tone: "warn", text: plan.reason || "无法应用尺寸，已放弃整次写回。" });
      return;
    }
    const write = commitDiagramPatches({
      patches: plan.patches, source, nextSource: plan.nextSource, fallback: setSource,
    });
    const sk = plan.skipped.length
      ? ` · ${plan.skipped.length} 个跳过（${plan.skipped[0].reason}）`
      : "";
    setMsg({
      tone: write.written ? "ok" : "warn",
      text: `${label}：${plan.changedIds.length} 个节点${sk}${write.written ? " · Ctrl+Z 一次退回" : " · 无撤销记录"}`,
    });
    setDraft((d) => ({ ...d, w: "", h: "" }));
  }

  function apply(): void {
    const v = validate();
    if ("error" in v) { setMsg({ tone: "warn", text: v.error }); return; }
    commit(v.values, "已应用尺寸");
  }

  function remove(key: SizeKey): void {
    commit({ [key]: null }, `已移除${SIZE_LABELS[key]}`);
  }

  return (
    <section className="dg-side-card dg-size-card">
      <h3 className="dg-side-card-title">尺寸 · 节点文本框</h3>
      {readonly && <div className="dg-panel-readonly">{permission.reason}</div>}
      {hint && <div className="dg-size-hint">{hint}</div>}
      {ids.length === 0 ? (
        <div className="dg-panel-hint">未选中图元 · 在画布点选节点后可用</div>
      ) : (
        <>
          <div className="dg-size-row">
            <label title="text width">W</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder={curW ?? "默认"}
              value={draft.w}
              disabled={blocked}
              onChange={(e) => setDraft((d) => ({ ...d, w: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            />
            <span className="dg-size-unit">{draft.unit}</span>
            <button type="button" title="移除宽度选项" disabled={blocked} onClick={() => remove("text width")}>✕</button>
          </div>
          <div className="dg-size-row">
            <label title="minimum height">H</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder={curH ?? "默认"}
              value={draft.h}
              disabled={blocked}
              onChange={(e) => setDraft((d) => ({ ...d, h: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            />
            <span className="dg-size-unit">{draft.unit}</span>
            <button type="button" title="移除高度选项" disabled={blocked} onClick={() => remove("minimum height")}>✕</button>
          </div>
          <div className="dg-size-actions">
            <select
              className="dg-side-input"
              aria-label="尺寸单位"
              value={draft.unit}
              disabled={blocked}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value as SizeUnit }))}
            >
              <option value="cm">cm</option>
              <option value="pt">pt</option>
            </select>
            <button type="button" className="dg-mini-btn" disabled={blocked} onClick={apply}>
              应用尺寸
            </button>
          </div>
          <label className="dg-size-check" title="批量写每个节点的局部选项，绝不修改 .style 定义">
            <input
              type="checkbox"
              checked={applyToAll}
              disabled={blocked || groupIds.length === 0}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            应用到同类所有节点（{groupIds.length} 个）
          </label>
          <div className="dg-size-readout">
            当前：W {curW ?? "默认"}{curWPt !== null ? `（${curWPt.toFixed(1)}pt）` : ""}
            {" · "}H {curH ?? "默认"}{curHPt !== null ? `（${curHPt.toFixed(1)}pt）` : ""}
          </div>
          {!readonly && (manualLock || compatLock) && (
            <div className="dg-panel-readonly">{manualLock ?? compatLock}</div>
          )}
        </>
      )}
      {msg && <div className={`dg-panel-msg dg-msg-${msg.tone}`}>{msg.text}</div>}
    </section>
  );
}

export default SizePanel;
