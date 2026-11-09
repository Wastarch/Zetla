// M2·F3-4：侧栏「对齐 · 变换」面板。复用纯逻辑（transform.ts / guides.ts）+ 写回桥，
// 与画布拖拽 / 属性区共用同一条 CM6 history；绝不引入第二套图元模型。
//
// 口径：所有几何计算都基于「可写控制点的 world 包围盒」（collectElementBoxes），
// 与写回句柄同源，因此「对齐算出来的位移」不会和源码改写错位。旋转 / 缩放 / 位移
// 写成 rotate=/scale=/xshift=/yshift 选项（planTransformPatches），一次只改一个选项。
import { useState } from "react";
import { useDiagramStore } from "./store";
import { applyDeltaEdit, renderTikz } from "./tikzEditor/engine";
import { commitDiagramPatches } from "./diagramHistory";
import {
  collectElementBoxes,
  normalizeTransformValue,
  planAlignDeltas,
  planDistributeDeltas,
  planTransformPatches,
  ALIGN_LABELS,
  DISTRIBUTE_LABELS,
  TRANSFORM_LABELS,
  type AlignKind,
  type DistributeKind,
  type TransformKey,
} from "./transform";
import { boxHeight, boxWidth, formatCm, unionWorldBox, type WorldBox } from "./guides";

type Tone = "ok" | "warn" | "err";

const ALIGN_KINDS: AlignKind[] = ["left", "hcenter", "right", "top", "vcenter", "bottom"];
const DISTRIBUTE_KINDS: DistributeKind[] = ["horizontal", "vertical"];
const TRANSFORM_KEYS: TransformKey[] = ["rotate", "scale", "xshift", "yshift"];

/** 把选中集合的可写控制点 world 包围盒算出来；无选中 / 无写回权时返回 null。 */
async function selectionBoxes(source: string) {
  const r = await renderTikz(source);
  const store = useDiagramStore.getState();
  const ids =
    store.selectedIds.length > 0
      ? store.selectedIds
      : store.selectedId
        ? [store.selectedId]
        : [];
  if (ids.length === 0) return { r, ids, boxes: [], union: null as WorldBox | null };
  const { boxes } = collectElementBoxes({
    handles: r.handles,
    elementIds: ids,
    compat: r.compat,
    grouping: store.grouping,
  });
  return { r, ids, boxes, union: unionWorldBox(boxes.map((b) => b.box)) };
}

export function TransformPanel() {
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const setGuides = useDiagramStore((s) => s.setGuides);
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<TransformKey, string>>({
    rotate: "",
    scale: "",
    xshift: "",
    yshift: "",
  });
  const [readout, setReadout] = useState<{ x: string; y: string; w: string; h: string } | null>(
    null,
  );

  const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [];
  const count = ids.length;

  function flashGuides(g: { axis: "x" | "y"; at: number; kind: string }[]): void {
    setGuides(g as never);
    window.setTimeout(() => setGuides([]), 1200);
  }

  async function runAlign(kind: AlignKind): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { r, boxes } = await selectionBoxes(source);
      if (boxes.length < 2) {
        setMsg({ tone: "warn", text: "对齐至少需要选中 2 个图元。" });
        return;
      }
      const plan = planAlignDeltas(boxes, kind);
      if (plan.status !== "ok") {
        setMsg({ tone: "warn", text: plan.reason });
        return;
      }
      const move = await applyDeltaEdit({
        source,
        handles: r.handles,
        deltas: plan.deltas,
        compat: r.compat,
        grouping: useDiagramStore.getState().grouping,
      });
      if (move.status !== "ok") {
        setMsg({ tone: "warn", text: move.status === "conflict" ? "补丁冲突，已放弃。" : "无法对齐。" });
        return;
      }
      const write = commitDiagramPatches({
        patches: move.patches,
        source,
        nextSource: move.nextSource,
        fallback: setSource,
      });
      flashGuides(plan.guides);
      setMsg({
        tone: write.written ? "ok" : "warn",
        text: `已${ALIGN_LABELS[kind]} ${move.movedElements.length} 个图元${
          write.written ? " · Ctrl+Z 一次退回" : " · 无撤销记录"
        }`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function runDistribute(kind: DistributeKind): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { r, boxes } = await selectionBoxes(source);
      if (boxes.length < 3) {
        setMsg({ tone: "warn", text: "等距分布至少需要选中 3 个图元。" });
        return;
      }
      const plan = planDistributeDeltas(boxes, kind);
      if (plan.status !== "ok") {
        setMsg({ tone: "warn", text: plan.reason });
        return;
      }
      const move = await applyDeltaEdit({
        source,
        handles: r.handles,
        deltas: plan.deltas,
        compat: r.compat,
        grouping: useDiagramStore.getState().grouping,
      });
      if (move.status !== "ok") {
        setMsg({ tone: "warn", text: move.status === "conflict" ? "补丁冲突，已放弃。" : "无法分布。" });
        return;
      }
      const write = commitDiagramPatches({
        patches: move.patches,
        source,
        nextSource: move.nextSource,
        fallback: setSource,
      });
      setMsg({
        tone: write.written ? "ok" : "warn",
        text: `已${DISTRIBUTE_LABELS[kind]} ${move.movedElements.length} 个图元${
          write.written ? " · Ctrl+Z 一次退回" : " · 无撤销记录"
        }`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function applyTransform(key: TransformKey, raw: string | null): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { r, ids: sel } = await selectionBoxes(source);
      if (sel.length === 0) {
        setMsg({ tone: "warn", text: "未选中任何图元。" });
        return;
      }
      const plan = planTransformPatches({
        source,
        statements: r.statements,
        elementIds: sel,
        key,
        value: raw,
        compat: r.compat,
        grouping: useDiagramStore.getState().grouping,
      });
      if (plan.status === "empty") {
        setMsg(null);
        if (raw !== null) setDraft((d) => ({ ...d, [key]: "" }));
        return;
      }
      if (plan.status !== "ok") {
        setMsg({ tone: "warn", text: plan.reason || "无法应用变换" });
        return;
      }
      const write = commitDiagramPatches({
        patches: plan.patches,
        source,
        nextSource: plan.nextSource,
        fallback: setSource,
      });
      const sk = plan.skipped.length
        ? ` · ${plan.skipped.length} 个跳过（${plan.skipped[0].id}：${plan.skipped[0].reason}）`
        : "";
      if (raw !== null) setDraft((d) => ({ ...d, [key]: "" }));
      setMsg({
        tone: write.written ? "ok" : "warn",
        text: `已应用${TRANSFORM_LABELS[key]} ${plan.changedIds.length} 个图元${sk}${
          write.written ? " · Ctrl+Z 一次退回" : " · 无撤销记录"
        }`,
      });
    } finally {
      setBusy(false);
    }
  }

  function refreshReadout(): void {
    void (async () => {
      const { boxes } = await selectionBoxes(source);
      const u = unionWorldBox(boxes.map((b) => b.box));
      setReadout(
        u
          ? {
              x: formatCm(u.minX),
              y: formatCm(u.maxY),
              w: formatCm(boxWidth(u)),
              h: formatCm(boxHeight(u)),
            }
          : null,
      );
    })();
  }

  const alignDisabled = count < 2 || busy;
  const distDisabled = count < 3 || busy;
  const transformDisabled = count < 1 || busy;

  return (
    <div className="dg-transform-panel">
      <div className="dg-panel-title">对齐 · 变换</div>

      {count === 0 ? (
        <div className="dg-panel-hint">未选中图元 · 在画布点选 / 框选后可用</div>
      ) : (
        <>
          <div className="dg-panel-sub">
            已选 {count} 项
            <button type="button" className="dg-mini-btn" onClick={refreshReadout}>
              测包围盒
            </button>
          </div>
          {readout && (
            <div className="dg-bbox-readout">
              <span>X {readout.x}</span>
              <span>Y {readout.y}</span>
              <span>W {readout.w}</span>
              <span>H {readout.h}</span>
            </div>
          )}

          <div className="dg-panel-sub">对齐</div>
          <div className="dg-align-grid">
            {ALIGN_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={alignDisabled}
                title={ALIGN_LABELS[k]}
                onClick={() => void runAlign(k)}
              >
                {ALIGN_LABELS[k]}
              </button>
            ))}
          </div>

          <div className="dg-panel-sub">分布</div>
          <div className="dg-dist-grid">
            {DISTRIBUTE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={distDisabled}
                title={DISTRIBUTE_LABELS[k]}
                onClick={() => void runDistribute(k)}
              >
                {DISTRIBUTE_LABELS[k]}
              </button>
            ))}
          </div>

          <div className="dg-panel-sub">变换（数值）</div>
          {TRANSFORM_KEYS.map((k) => {
            const trimmed = draft[k].trim();
            const norm = trimmed === "" ? null : normalizeTransformValue(k, draft[k]);
            const err = norm && "error" in norm ? norm.error : null;
            return (
              <div key={k} className="dg-transform-row">
                <label title={TRANSFORM_LABELS[k]}>{TRANSFORM_LABELS[k]}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={k === "xshift" || k === "yshift" ? "1cm" : "30"}
                  value={draft[k]}
                  disabled={transformDisabled}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && norm && !("error" in norm)) {
                      void applyTransform(k, norm.value);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={transformDisabled || !norm || "error" in norm}
                  title="应用"
                  onClick={() => norm && !("error" in norm) && void applyTransform(k, norm.value)}
                >
                  ✓
                </button>
                <button
                  type="button"
                  disabled={transformDisabled}
                  title="移除该选项"
                  onClick={() => void applyTransform(k, null)}
                >
                  ✕
                </button>
                {err && <div className="dg-field-err">{err}</div>}
              </div>
            );
          })}

          {msg && <div className={`dg-panel-msg dg-msg-${msg.tone}`}>{msg.text}</div>}
        </>
      )}
    </div>
  );
}
