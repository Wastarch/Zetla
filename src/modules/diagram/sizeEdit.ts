// M2 · F4-1：节点尺寸编辑的纯逻辑层（Node 可回归，无 DOM / React / vendor 运行时依赖）。
//
// 与 F3-4 的 `scale=` 严格划界：
//   · F3-4 是「几何整体缩放」（连文字等比放大），写单一 scale=；
//   · F4-1 是「改节点文本框尺寸」，按轴分别写 text width / minimum height / inner sep，
//     **绝不把 sx/sy 合并成 sqrt(sx*sy)**，同一手势不混写两类选项。
// 写回仍只产 TikZ 源码最小 span 补丁，经 mergeSourcePatches 合并后一次 dispatch。
// 相对 import 一律带 .ts：scripts/diagram-render.test.ts 用 node --experimental-strip-types 直跑。
import type { SourceSpanPatch } from "./dragEdit.ts";
import { statementEditability, type TikzOptionEntry, type TikzStatement } from "./optionsEdit.ts";
import {
  isManuallyHidden,
  isManuallyLocked,
  mergeSourcePatches,
  type GroupingState,
  type GroupMoveSkipped,
} from "./grouping.ts";
import type { CompatReport } from "./tikzEditor/compat.ts";
import { CM_TO_PT } from "./canvasSize.ts";

/** 尺寸选项白名单（含空格键，必须整串精确匹配，不做分词）。 */
export const SIZE_KEYS = ["text width", "minimum height", "inner sep"] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

export const SIZE_LABELS: Record<SizeKey, string> = {
  "text width": "宽度 W",
  "minimum height": "高度 H",
  "inner sep": "内边距",
};

export function isSizeKey(v: unknown): v is SizeKey {
  return typeof v === "string" && (SIZE_KEYS as readonly string[]).includes(v);
}

/** 正向白名单：只允许「带单位的长度」或纯数字（纯数字按 pt 处理并补上 pt）。 */
const LENGTH = /^-?\d+(?:\.\d+)?(?:pt|cm|mm|in|em|ex)?$/;

/**
 * 尺寸值校验。刻意不用 optionsEdit 的 DANGEROUS 黑名单：这里是正向白名单，
 * 天然拒绝 `,` `{}` `\` `%` 引号与换行，同时**放行含空格的 key 与 `text width=3cm` 这类值**。
 */
export function normalizeSizeValue(
  key: SizeKey,
  text: string,
): { value: string } | { error: string } {
  const t = text.trim();
  if (!t) return { error: "请输入长度；留空无法应用，若要移除请用「移除」。" };
  if (t.length > 32) return { error: "数值过长（最多 32 字符）。" };
  if (!LENGTH.test(t)) {
    return { error: `${SIZE_LABELS[key]}请填带单位长度，如 3cm / 40pt / 0.5em。` };
  }
  const m = /^(-?\d+(?:\.\d+)?)([a-z]*)$/.exec(t);
  if (!m) return { error: "数值无效。" };
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return { error: "尺寸需为正数。" };
  const unit = m[2] || "pt";
  return { value: `${String(Math.round(n * 10000) / 10000)}${unit}` };
}

export type SizeValues = Partial<Record<SizeKey, string | null>>;

export interface SizePatchPlan {
  status: "ok" | "noop" | "error";
  /** 单条语句内可能有多个不重叠的最小补丁（分别写 W / H） */
  patches: SourceSpanPatch[];
  label: string;
  reason: string;
}

function matchesSizeOption(entry: TikzOptionEntry, key: SizeKey): boolean {
  return entry.value !== null && entry.key.trim().toLowerCase() === key;
}

/** 与 transform.ts 的 removalPatch 同构：删条目 + 后随逗号（末项则吞掉前一个逗号）。 */
function removalPatch(stmt: TikzStatement, hit: TikzOptionEntry, source: string): SourceSpanPatch {
  const idx = stmt.entries.indexOf(hit);
  const isLast = idx === stmt.entries.length - 1;
  if (!isLast) {
    const next = stmt.entries[idx + 1];
    return { from: hit.span.from, to: next.span.from, insert: "" };
  }
  const prevTo = idx > 0 ? stmt.entries[idx - 1].span.to : (stmt.optionsSpan?.from ?? hit.span.from) + 1;
  const between = source.slice(prevTo, hit.span.from);
  const comma = between.lastIndexOf(",");
  const from = comma >= 0 ? prevTo + comma : hit.span.from;
  return { from, to: hit.span.to, insert: "" };
}

/** 无选项 / 空选项 / 追加到末项之后，三态插入（与 transform.ts 同构）。 */
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

/**
 * 单条 \node 语句的尺寸补丁。所有目标 key 基于**同一份基准 source**，
 * 新增键合并进「最后一个命中条目的替换内容」或一次 insertionPatch，
 * 保证同一语句内多个补丁互不重叠（绝不删掉再插到同一处造成半写）。
 */
export function planSizePatch(
  source: string,
  stmt: TikzStatement,
  values: SizeValues,
): SizePatchPlan {
  const empty: SizePatchPlan = { status: "noop", patches: [], label: "", reason: "" };
  const edit = statementEditability(stmt);
  if (!edit.editable) return { ...empty, status: "error", reason: edit.reason };
  // 尺寸键只对节点有意义；给 \draw 写 text width 虽不报错但不会产生可见效果。
  if (stmt.command !== "node") {
    return { ...empty, status: "error", reason: "尺寸选项只适用于 \\node 节点，请在源码栏修改。" };
  }
  const desired = new Map<SizeKey, string | null>();
  for (const key of SIZE_KEYS) {
    if (!(key in values)) continue;
    const raw = values[key] ?? null;
    if (raw === null) {
      desired.set(key, null);
      continue;
    }
    const norm = normalizeSizeValue(key, raw);
    if ("error" in norm) return { ...empty, status: "error", reason: norm.error };
    desired.set(key, `${key}=${norm.value}`);
  }
  if (desired.size === 0) return empty;

  const hits = new Map<SizeKey, TikzOptionEntry | null>();
  for (const key of desired.keys()) {
    const found = stmt.entries.filter((e) => matchesSizeOption(e, key));
    if (found.length > 1) {
      return {
        ...empty,
        status: "error",
        reason: `检测到 ${found.length} 个 ${key}= 选项，请先在源码里整理，避免静默改语义。`,
      };
    }
    const hit = found[0] ?? null;
    if (hit && source.slice(hit.span.from, hit.span.to) !== hit.raw) {
      return { ...empty, status: "error", reason: "源码在选择期间已变化，请重新点击图元。" };
    }
    hits.set(key, hit);
  }

  // 有命中的条目按源码顺序排好；新增键合并到最后一个命中条目的 insert 里。
  const hitList = Array.from(hits.entries())
    .filter(([, hit]) => hit !== null)
    .map(([key, hit]) => ({ key, hit: hit as TikzOptionEntry }))
    .sort((a, b) => a.hit.span.from - b.hit.span.from);
  const additions: string[] = [];
  for (const [key, raw] of desired) {
    if (raw !== null && hits.get(key) === null) additions.push(raw);
  }

  const patches: SourceSpanPatch[] = [];
  const changedLabels: string[] = [];
  for (let i = 0; i < hitList.length; i += 1) {
    const { key, hit } = hitList[i];
    const raw = desired.get(key) ?? null;
    if (raw !== null && hit.raw.trim() === raw) continue;
    const isLastHit = i === hitList.length - 1;
    let insert = raw ?? "";
    if (isLastHit && additions.length > 0) {
      // 复用这个命中条目的 span 承载新键，避免「替换 + 插入到同一位置」的重叠补丁。
      insert = insert ? `${insert}, ${additions.join(", ")}` : additions.join(", ");
      additions.length = 0;
    }
    const patch = insert
      ? { from: hit.span.from, to: hit.span.to, insert }
      : removalPatch(stmt, hit, source);
    patches.push(patch);
    changedLabels.push(`${SIZE_LABELS[key]} → ${raw ?? "默认"}`);
  }
  if (additions.length > 0) {
    const patch = insertionPatch(source, stmt, additions.join(", "));
    if (!patch) return { ...empty, status: "error", reason: "选项范围已失效，请重新点击图元。" };
    patches.push(patch);
    changedLabels.push(`新增 ${additions.length} 个尺寸键`);
  }
  if (patches.length === 0) return empty;
  for (const p of patches) {
    if (p.from < 0 || p.to < p.from || p.to > source.length) {
      return { ...empty, status: "error", reason: "选项范围已失效，请重新点击图元。" };
    }
  }
  return {
    status: "ok",
    patches,
    label: `尺寸：${changedLabels.join(" · ")}`,
    reason: "",
  };
}

export interface SizePlan {
  status: "ok" | "empty" | "conflict" | "locked";
  patches: SourceSpanPatch[];
  nextSource: string;
  changedIds: string[];
  skipped: GroupMoveSkipped[];
  reason: string;
  label: string;
}

/** 对整个选中集合应用同一组尺寸值：逐元素 skip、冲突整次放弃、一次 dispatch = 一条 Ctrl+Z。 */
export function planSizePatches(args: {
  source: string;
  statements: readonly TikzStatement[];
  elementIds: readonly string[];
  values: SizeValues;
  compat: CompatReport | null;
  grouping: GroupingState;
}): SizePlan {
  const base: SizePlan = {
    status: "locked", patches: [], nextSource: args.source,
    changedIds: [], skipped: [], reason: "", label: "尺寸：无改动",
  };
  const byId = new Map(args.statements.map((s) => [s.id, s]));
  const patches: SourceSpanPatch[] = [];
  const skipped: GroupMoveSkipped[] = [];
  const changedIds: string[] = [];
  let label = "";
  for (const id of new Set(args.elementIds)) {
    if (isManuallyHidden(args.grouping, id)) {
      skipped.push({ id, reason: "已隐藏，先在图层面板显示后再改尺寸" }); continue;
    }
    if (isManuallyLocked(args.grouping, id)) {
      skipped.push({ id, reason: "已主动锁定，先解锁后再改尺寸" }); continue;
    }
    const compatReason = args.compat?.lockReasons?.[id] as string | undefined;
    if (compatReason) { skipped.push({ id, reason: compatReason }); continue; }
    const stmt = byId.get(id);
    if (!stmt) { skipped.push({ id, reason: "该图元没有可编辑的语句选项" }); continue; }
    const plan = planSizePatch(args.source, stmt, args.values);
    if (plan.status === "error") { skipped.push({ id, reason: plan.reason }); continue; }
    if (plan.status === "noop") continue;
    patches.push(...plan.patches);
    changedIds.push(id);
    if (!label) label = plan.label;
  }
  const merged = mergeSourcePatches(args.source, patches);
  if (!merged) {
    return {
      ...base, status: "conflict",
      skipped: [...skipped, { id: "*", reason: "补丁区间重叠或越界，已放弃整次写回" }],
      reason: "补丁区间重叠或越界",
    };
  }
  if (merged.nextSource === args.source) {
    return {
      ...base, status: "empty", changedIds, skipped,
      reason: changedIds.length === 0 ? "选中的图元都不可改尺寸或已是该值。" : "尺寸改动后源码未变化。",
      label,
    };
  }
  return {
    status: "ok", patches: merged.patches, nextSource: merged.nextSource,
    changedIds, skipped, reason: "", label: label || "尺寸已应用",
  };
}

/** 读取已有尺寸选项并换算成 world pt；非法 / 未设置返回 null（调用方回退到视觉外接框）。 */
export function sizeValueToPt(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(-?\d+(?:\.\d+)?)(pt|cm|mm|in|em|ex)?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const factors: Record<string, number> = {
    pt: 1,
    cm: CM_TO_PT,
    mm: CM_TO_PT / 10,
    in: 72.27,
    em: 10,
    ex: 5,
  };
  return n * (factors[m[2] || "pt"] ?? 1);
}

/** world pt → 带单位字符串（只用于写回选项，绝不用于坐标换算）。 */
export function ptToSizeString(pt: number, unit: "cm" | "pt" = "cm"): string {
  const n = unit === "cm" ? pt / CM_TO_PT : pt;
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n * 100) / 100;
  return `${String(rounded)}${unit}`;
}

export interface SizeDragValues {
  width: string | null;
  height: string | null;
}

/**
 * 8 点柄 → 按轴尺寸值。边中柄只改一个轴，角柄两键分别写（**不合成 scale**）。
 * sx / sy 直接来自 guides.scaleFromDrag，基准宽高优先读语句里已有的尺寸选项，
 * 读不到时用视觉外接框（world pt）兜底。
 */
export function sizeValuesFromDrag(args: {
  baseWidthPt: number;
  baseHeightPt: number;
  sx: number;
  sy: number;
  corner: number;
  unit?: "cm" | "pt";
}): SizeDragValues {
  const corner = ((args.corner % 8) + 8) % 8;
  const yOnly = corner === 1 || corner === 5;
  const xOnly = corner === 3 || corner === 7;
  const unit = args.unit ?? "cm";
  const s = (base: number, factor: number): string | null => {
    const v = ptToSizeString(base * factor, unit);
    return v || null;
  };
  return {
    width: yOnly ? null : s(args.baseWidthPt, args.sx),
    height: xOnly ? null : s(args.baseHeightPt, args.sy),
  };
}
