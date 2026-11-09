// M2·F3-4：对齐 / 分布 / 变换的**纯逻辑**（无 DOM / React，Node strip-types 可直接回归）。
//
// 三条硬约束（与 F3-3 一脉相承）：
//   ① 唯一真源：对齐 / 分布产出的是「每个元素各自的 world 位移」，再交给
//      grouping.planGroupMove 的 deltaFor 逐句柄调 applyEditIntent，最终仍是最小 span 补丁。
//      绝不生成第二套图元模型，也绝不整篇替换源码。
//   ② 包围盒 = 同一批**可写控制点**的 world 坐标范围（见 collectElementBoxes）。
//      它和写回用的句柄集合完全相同，因此「对齐算出来的 delta」不会与源码改写错位。
//      这不是视觉包围盒（圆的半径、线宽不计入），UI 里叫「锚点包围盒」。
//   ③ 旋转 / 缩放 / 位移写成 `rotate=` / `scale=` / `xshift=` / `yshift=` 选项，
//      复用 optionsEdit 的语句模型与插入 / 删除 / 替换三态，一次只改一个选项，
//      同类选项重复、源码过期、能力矩阵锁定、主动锁定 / 隐藏一律拒绝并给具体理由。
import type { PointLike, SourceSpanPatch } from "./dragEdit.ts";
import {
  isDraggableHandle,
  lockedHandleReason,
} from "./dragEdit.ts";
import {
  statementEditability,
  type TikzOptionEntry,
  type TikzStatement,
} from "./optionsEdit.ts";
import {
  mergeSourcePatches,
  isManuallyHidden,
  isManuallyLocked,
  type GroupMoveSkipped,
  type GroupingState,
} from "./grouping.ts";
import { resolveHandleLock, type CompatReport } from "./tikzEditor/compat.ts";
import type { TikzEditHandle } from "./tikzEditor/engine.ts";
import {
  boxCenter,
  boxFromPoints,
  makeWorldBox,
  planSnap,
  unionWorldBox,
  type GuideLine,
  type WorldBox,
} from "./guides.ts";

// ── 锚点包围盒 ───────────────────────────────────────────────────────────────

export interface ElementBox {
  id: string;
  box: WorldBox;
}

/**
 * 按语句 id 收集可写控制点的 world 坐标，得到「锚点包围盒」。
 * 判定口径与 grouping.planGroupMove 的 writable 完全一致：
 * 隐藏 / 主动锁定 / F2-3 能力矩阵锁定 / rewriteMode 不可写的句柄都不计入，
 * 因此后面写回时不会出现「按 A 点算、却改了 B 点」的语义错位。
 */
export function collectElementBoxes(args: {
  handles: readonly TikzEditHandle[];
  elementIds: readonly string[];
  compat: CompatReport | null;
  grouping: GroupingState;
}): { boxes: ElementBox[]; skipped: GroupMoveSkipped[] } {
  const byId = new Map<string, PointLike[]>();
  for (const h of args.handles) {
    const id = h?.sourceRef?.sourceId;
    if (!id || !h.world || !Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
    if (!isDraggableHandle(h)) continue;
    const lock = resolveHandleLock(args.compat, h.id, true, lockedHandleReason(h));
    if (lock !== null) continue;
    const list = byId.get(id) ?? [];
    list.push({ x: h.world.x, y: h.world.y });
    byId.set(id, list);
  }
  const boxes: ElementBox[] = [];
  const skipped: GroupMoveSkipped[] = [];
  for (const id of new Set(args.elementIds)) {
    if (isManuallyHidden(args.grouping, id)) {
      skipped.push({ id, reason: "已隐藏，先在图层面板显示后再对齐 / 变换" });
      continue;
    }
    if (isManuallyLocked(args.grouping, id)) {
      skipped.push({ id, reason: "已主动锁定，先解锁后再对齐 / 变换" });
      continue;
    }
    const box = boxFromPoints(byId.get(id) ?? []);
    if (!box) {
      const reason = (args.compat?.lockReasons?.[id] as string | undefined) ?? null;
      skipped.push({ id, reason: reason ?? "没有可写控制点，无法参与对齐 / 变换" });
      continue;
    }
    boxes.push({ id, box });
  }
  return { boxes, skipped };
}

// ── 对齐 / 分布 ─────────────────────────────────────────────────────────────

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeKind = "horizontal" | "vertical";
export type AlignAnchor = "selection" | "first";

export const ALIGN_LABELS: Record<AlignKind, string> = {
  left: "左对齐",
  hcenter: "水平居中",
  right: "右对齐",
  top: "上对齐",
  vcenter: "垂直居中",
  bottom: "下对齐",
};

export const DISTRIBUTE_LABELS: Record<DistributeKind, string> = {
  horizontal: "水平等距分布",
  vertical: "垂直等距分布",
};

export interface DeltaPlan {
  status: "ok" | "empty" | "error";
  /** 每个元素各自的 world 位移；交给 planGroupMove 的 deltaFor */
  deltas: Record<string, PointLike>;
  /** 操作完成后应高亮显示的对齐参考线 */
  guides: GuideLine[];
  changedIds: string[];
  reason: string;
}

function emptyDeltaPlan(reason: string): DeltaPlan {
  return { status: "error", deltas: {}, guides: [], changedIds: [], reason };
}

/**
 * 对齐：默认以「选中集合的联合包围盒」为基准；anchor=first 时以主选中项为基准。
 * 每条语句的 delta 只作用在它自己的对应边 / 中心上，其余坐标由上游一并平移。
 */
export function planAlignDeltas(
  boxes: readonly ElementBox[],
  kind: AlignKind,
  anchor: AlignAnchor = "selection",
): DeltaPlan {
  if (boxes.length < 2) return emptyDeltaPlan("对齐至少需要选中 2 个图元。");
  const union = unionWorldBox(boxes.map((b) => b.box));
  if (!union) return emptyDeltaPlan("无法计算选中集合的包围盒。");
  const base = anchor === "first" ? boxes[0].box : union;
  const c = boxCenter(base);
  const axis: "x" | "y" = kind === "left" || kind === "hcenter" || kind === "right" ? "x" : "y";
  const target =
    kind === "left" ? base.minX
    : kind === "hcenter" ? c.x
    : kind === "right" ? base.maxX
    : kind === "top" ? base.maxY
    : kind === "vcenter" ? c.y
    : base.minY;
  const deltas: Record<string, PointLike> = {};
  const changedIds: string[] = [];
  for (const item of boxes) {
    const own = boxCenter(item.box);
    const from =
      kind === "left" ? item.box.minX
      : kind === "hcenter" ? own.x
      : kind === "right" ? item.box.maxX
      : kind === "top" ? item.box.maxY
      : kind === "vcenter" ? own.y
      : item.box.minY;
    const diff = target - from;
    if (!Number.isFinite(diff)) continue;
    deltas[item.id] = axis === "x" ? { x: diff, y: 0 } : { x: 0, y: diff };
    if (Math.abs(diff) > 1e-6) changedIds.push(item.id);
  }
  const guides: GuideLine[] = [{ axis, at: target, kind: "center" }];
  const any = changedIds.length > 0;
  return {
    status: any ? "ok" : "empty",
    deltas,
    guides: any ? guides : [],
    changedIds,
    reason: any ? "" : "已对齐，无需改动。",
  };
}

/** 分布：保持首尾不动，把中间元素的中心按等间距重排（按当前位置排序，不改变层序）。 */
export function planDistributeDeltas(
  boxes: readonly ElementBox[],
  kind: DistributeKind,
): DeltaPlan {
  if (boxes.length < 3) return emptyDeltaPlan("等距分布至少需要选中 3 个图元。");
  const axis = kind === "horizontal" ? "x" : "y";
  const sorted = [...boxes].sort(
    (a, b) => boxCenter(a.box)[axis] - boxCenter(b.box)[axis],
  );
  const first = boxCenter(sorted[0].box)[axis];
  const last = boxCenter(sorted[sorted.length - 1].box)[axis];
  const span = last - first;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-9) {
    return emptyDeltaPlan("首尾图元已重合，无法等距分布。");
  }
  const step = span / (sorted.length - 1);
  const deltas: Record<string, PointLike> = {};
  const changedIds: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];
    const from = boxCenter(item.box)[axis];
    const diff = first + i * step - from;
    if (!Number.isFinite(diff)) continue;
    deltas[item.id] = axis === "x" ? { x: diff, y: 0 } : { x: 0, y: diff };
    if (Math.abs(diff) > 1e-6) changedIds.push(item.id);
  }
  const any = changedIds.length > 0;
  return {
    status: any ? "ok" : "empty",
    deltas,
    guides: [],
    changedIds,
    reason: any ? "" : "已等距，无需改动。",
  };
}

/** 把 DeltaPlan 喂给 planGroupMove.deltaFor；没参与的元素位移为零。 */
export function deltaForFromPlan(plan: DeltaPlan): (id: string) => PointLike {
  return (id) => plan.deltas[id] ?? { x: 0, y: 0 };
}

/**
 * 拖拽吸附：候选包围盒 = 被选中集合的联合包围盒 + 当前指针位移，
 * 静止元素 = 未选中集合的包围盒。返回需要叠加到本次位移上的修正量与参考线。
 */
export function planDragSnap(args: {
  selectedBoxes: readonly ElementBox[];
  otherBoxes: readonly ElementBox[];
  delta: PointLike;
  threshold?: number;
  canvasCenter?: PointLike | null;
}) {
  const union = unionWorldBox(args.selectedBoxes.map((b) => b.box));
  if (!union || !Number.isFinite(args.delta.x) || !Number.isFinite(args.delta.y)) {
    return { delta: { x: 0, y: 0 }, guides: [] as GuideLine[] };
  }
  const moved = makeWorldBox(
    union.minX + args.delta.x,
    union.minY + args.delta.y,
    union.maxX + args.delta.x,
    union.maxY + args.delta.y,
  );
  if (!moved) return { delta: { x: 0, y: 0 }, guides: [] as GuideLine[] };
  return planSnap({
    moving: moved,
    others: args.otherBoxes.map((b) => b.box),
    threshold: args.threshold,
    canvasCenter: args.canvasCenter,
  });
}

// ── 变换选项补丁 ────────────────────────────────────────────────────────────

export const TRANSFORM_KEYS = ["rotate", "scale", "xshift", "yshift"] as const;
export type TransformKey = (typeof TRANSFORM_KEYS)[number];

export const TRANSFORM_LABELS: Record<TransformKey, string> = {
  rotate: "旋转角度",
  scale: "缩放比例",
  xshift: "水平位移",
  yshift: "垂直位移",
};

export function isTransformKey(v: unknown): v is TransformKey {
  return typeof v === "string" && (TRANSFORM_KEYS as readonly string[]).includes(v);
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;
const LENGTH = /^-?\d+(?:\.\d+)?(?:pt|cm|mm|in|em|ex)$/;

/** 数值白名单：禁止任何可能写坏 TikZ 选项结构的字符（逗号 / 括号 / 反斜杠 / 百分号）。 */
export function normalizeTransformValue(
  key: TransformKey,
  text: string,
): { value: string } | { error: string } {
  const t = text.trim();
  if (!t) return { error: "请输入数值；留空无法应用，若要移除请用「移除」。" };
  if (t.length > 32) return { error: "数值过长（最多 32 字符）。" };
  if (key === "rotate" || key === "scale") {
    if (!NUMERIC.test(t)) return { error: "请填纯数字，如 30 / -15 / 1.2。" };
    const n = Number(t);
    if (!Number.isFinite(n)) return { error: "数值无效。" };
    if (key === "scale" && (n <= 0 || n > 20)) return { error: "缩放比例需在 (0, 20] 之间。" };
    if (key === "rotate" && Math.abs(n) > 3600) return { error: "旋转角度绝对值不能超过 3600。" };
    return { value: String(Math.round(n * 10000) / 10000) };
  }
  if (!LENGTH.test(t)) return { error: "位移需带单位，如 1cm / 12pt / -0.5cm。" };
  return { value: t };
}

function matchesOption(entry: TikzOptionEntry, key: TransformKey): boolean {
  return entry.value !== null && entry.key.trim().toLowerCase() === key;
}

function removalPatch(stmt: TikzStatement, hit: TikzOptionEntry, source: string): SourceSpanPatch {
  const idx = stmt.entries.indexOf(hit);
  // 方括号里只剩这一项时把整段 `[...]` 一起删掉，避免留下 `\draw[]`（F2-2 的
  // 属性移除保留方括号是历史行为，这里只管 F3-4 自己写的变换选项）。
  if (stmt.entries.length === 1 && stmt.optionsSpan) {
    const raw = source.slice(stmt.optionsSpan.from, stmt.optionsSpan.to);
    if (raw.startsWith("[") && raw.endsWith("]") && raw.slice(1, -1).trim() === hit.raw.trim()) {
      return { from: stmt.optionsSpan.from, to: stmt.optionsSpan.to, insert: "" };
    }
  }
  const isLast = idx === stmt.entries.length - 1;
  if (!isLast) {
    const next = stmt.entries[idx + 1];
    return { from: hit.span.from, to: next.span.from, insert: "" };
  }
  const prevTo = idx > 0
    ? stmt.entries[idx - 1].span.to
    : (stmt.optionsSpan?.from ?? hit.span.from) + 1;
  const between = source.slice(prevTo, hit.span.from);
  const comma = between.lastIndexOf(",");
  const from = comma >= 0 ? prevTo + comma : hit.span.from;
  return { from, to: hit.span.to, insert: "" };
}

function insertionPatch(source: string, stmt: TikzStatement, raw: string): SourceSpanPatch | null {
  if (!stmt.optionsSpan) {
    const at = stmt.insertOffset;
    return at >= 0 && at <= source.length ? { from: at, to: at, insert: `[${raw}]` } : null;
  }
  const bracket = stmt.optionsSpan;
  if (source[bracket.from] !== "[" || source[bracket.to - 1] !== "]") return null;
  const innerFrom = bracket.from + 1;
  const innerTo = bracket.to - 1;
  if (stmt.entries.length === 0) {
    let at = innerFrom;
    while (at < innerTo && /\s/.test(source[at])) at += 1;
    return { from: at, to: at, insert: raw };
  }
  const last = stmt.entries[stmt.entries.length - 1];
  const at = Math.min(Math.max(last.span.to, innerFrom), innerTo);
  return { from: at, to: at, insert: `, ${raw}` };
}

export type OptionPatchPlan =
  | { status: "ok"; patch: SourceSpanPatch; label: string }
  | { status: "noop" }
  | { status: "error"; reason: string };

/**
 * 单条语句、单个变换选项的最小补丁（replace / delete / insert 三态）。
 * 与 optionsEdit.planPropertyPatch 同构，但只认 kv 形式的 4 个变换选项，
 * 避免把 `rotate` 误判成颜色 flag，也不动其它任何选项 / 缩进 / 注释。
 */
export function planOptionPatch(
  source: string,
  stmt: TikzStatement,
  key: TransformKey,
  rawValue: string | null,
): OptionPatchPlan {
  const edit = statementEditability(stmt);
  if (!edit.editable) return { status: "error", reason: edit.reason };
  let value: string | null = null;
  if (rawValue !== null) {
    const normalized = normalizeTransformValue(key, rawValue);
    if ("error" in normalized) return { status: "error", reason: normalized.error };
    value = normalized.value;
  }
  const hits = stmt.entries.filter((e) => matchesOption(e, key));
  if (hits.length > 1) {
    return {
      status: "error",
      reason: `检测到 ${hits.length} 个 ${key}= 选项，请先在源码里整理，避免静默改语义。`,
    };
  }
  const hit = hits[0] ?? null;
  const raw = value === null ? null : `${key}=${value}`;
  if (!hit && value === null) return { status: "noop" };
  if (hit && value !== null && hit.raw.trim() === raw) return { status: "noop" };
  if (hit && source.slice(hit.span.from, hit.span.to) !== hit.raw) {
    return { status: "error", reason: "源码在选择期间已变化，请重新点击图元。" };
  }
  let patch: SourceSpanPatch | null;
  if (hit && value !== null) patch = { from: hit.span.from, to: hit.span.to, insert: raw! };
  else if (hit) patch = removalPatch(stmt, hit, source);
  else patch = insertionPatch(source, stmt, raw!);
  if (!patch || patch.from < 0 || patch.to < patch.from || patch.to > source.length) {
    return { status: "error", reason: "选项范围已失效，请重新点击图元。" };
  }
  return {
    status: "ok",
    patch,
    label: `${TRANSFORM_LABELS[key]}：${hit?.raw ?? "默认"} → ${raw ?? "默认"}`,
  };
}

export interface TransformPlan {
  status: "ok" | "empty" | "conflict" | "locked";
  patches: SourceSpanPatch[];
  nextSource: string;
  changedIds: string[];
  skipped: GroupMoveSkipped[];
  reason: string;
  label: string;
}

/**
 * 对整个选中集合应用一个变换选项。每条语句最多一个补丁，全部基于同一份基准源码，
 * 由 mergeSourcePatches 排序 / 重叠 / 越界校验后一次 dispatch（一条 Ctrl+Z 退整组）。
 * 任何一条语句补丁冲突 / 全部不可写时整次放弃，绝不部分提交。
 */
export function planTransformPatches(args: {
  source: string;
  statements: readonly TikzStatement[];
  elementIds: readonly string[];
  key: TransformKey;
  value: string | null;
  compat: CompatReport | null;
  grouping: GroupingState;
}): TransformPlan {
  const base: TransformPlan = {
    status: "locked",
    patches: [],
    nextSource: args.source,
    changedIds: [],
    skipped: [],
    reason: "",
    label: `${TRANSFORM_LABELS[args.key]}：无改动`,
  };
  if (!isTransformKey(args.key)) return { ...base, reason: "未知的变换类型。" };
  if (args.value !== null) {
    const normalized = normalizeTransformValue(args.key, args.value);
    if ("error" in normalized) return { ...base, reason: normalized.error };
  }
  const byId = new Map(args.statements.map((s) => [s.id, s]));
  const patches: SourceSpanPatch[] = [];
  const skipped: GroupMoveSkipped[] = [];
  const changedIds: string[] = [];
  let label = "";
  for (const id of new Set(args.elementIds)) {
    if (isManuallyHidden(args.grouping, id)) {
      skipped.push({ id, reason: "已隐藏，先在图层面板显示后再变换" });
      continue;
    }
    if (isManuallyLocked(args.grouping, id)) {
      skipped.push({ id, reason: "已主动锁定，先解锁后再变换" });
      continue;
    }
    const compatReason = args.compat?.lockReasons?.[id] as string | undefined;
    if (compatReason) {
      skipped.push({ id, reason: compatReason });
      continue;
    }
    const stmt = byId.get(id);
    if (!stmt) {
      skipped.push({ id, reason: "该图元没有可编辑的语句选项" });
      continue;
    }
    const plan = planOptionPatch(args.source, stmt, args.key, args.value);
    if (plan.status === "error") {
      skipped.push({ id, reason: plan.reason });
      continue;
    }
    if (plan.status === "noop") continue;
    patches.push(plan.patch);
    changedIds.push(id);
    if (!label) label = plan.label;
  }
  const merged = mergeSourcePatches(args.source, patches);
  if (!merged) {
    return {
      ...base,
      status: "conflict",
      skipped: [...skipped, { id: "*", reason: "补丁区间重叠或越界，已放弃整次写回" }],
      reason: "补丁区间重叠或越界",
    };
  }
  if (merged.nextSource === args.source) {
    return {
      ...base,
      status: "empty",
      nextSource: args.source,
      changedIds,
      skipped,
      reason: changedIds.length === 0 ? "选中的图元都不可变换或已是该值。" : "变换后源码未变化。",
      label,
    };
  }
  return {
    status: "ok",
    patches: merged.patches,
    nextSource: merged.nextSource,
    changedIds,
    skipped,
    reason: "",
    label: label || `${TRANSFORM_LABELS[args.key]} 已应用`,
  };
}
