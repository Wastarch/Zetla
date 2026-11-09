// M2·F3-3：选择 / 虚拟分组 / 图层 / 组拖平移的 **纯逻辑**（无 DOM / React / vendor 依赖）。
//
// 长期口径（计划 §5 设计原则 2，别走回头路）：
//   · 分组、可见性、主动锁定都是**编辑器侧元数据**，只存 store + localStorage；
//     TikZ 里没有 group / layer 概念，绝不包 `\begin{scope}`、绝不写进源码。
//   · 拖组 = 对组内每个元素的所有可写控制点分别调 applyEditIntent 求最小 span 补丁，
//     合并成一组不重叠的 changes 一次写回 CM6（一条 history）。唯一真源仍是源码；
//     这里不引入第二份图元模型，也不实例化上游 EditorSession。
//   · 与 F2-3 的能力矩阵锁定严格区分：compat 锁定 = 上游改写会静默改语义（不能拖）；
//     lockedIds = 用户主动锁定（不想误改）。两者都让组拖跳过该元素。
//   · 分组按「源码内容 hash」命名空间持久化：换一张图不会串味；加载时按当前
//     statements 的 id 白名单裁剪，源码改过之后不留悬空引用。
import type { SourceSpanPatch } from "./dragEdit.ts";
import { isDraggableHandle, lockedHandleReason } from "./dragEdit.ts";
import type { TikzStatement } from "./optionsEdit.ts";
import type { TikzEditHandle } from "./tikzEditor/engine.ts";
import { resolveHandleLock, type CompatReport } from "./tikzEditor/compat.ts";

// ── 数据模型 ────────────────────────────────────────────────────────────────

export interface DiagramGroup {
  /** `group:<seq>`，由 createGroup 生成，不复用元素 id 命名空间 */
  id: string;
  name: string;
  /** 父组 id；null = 顶层。嵌套靠「成员全属于同一父组时再次编组」自然产生 */
  parentId: string | null;
  /** 直接成员的元素 id（与 SVG data-source-id / statement.id 一致） */
  memberIds: string[];
  collapsed: boolean;
  locked: boolean;
  hidden: boolean;
}

export interface GroupingState {
  groups: DiagramGroup[];
  /** 用户主动隐藏的元素（源码仍在，只是画布不显示） */
  hiddenIds: string[];
  /** 用户主动锁定的元素（区别于 F2-3 能力矩阵锁定） */
  lockedIds: string[];
  /** 单调递增序号，用于生成稳定 group id */
  seq: number;
}

export const EMPTY_GROUPING: GroupingState = {
  groups: [],
  hiddenIds: [],
  lockedIds: [],
  seq: 0,
};

const MAX_NAME_LEN = 60;
const MAX_GROUPS = 64;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, MAX_NAME_LEN) : fallback;
}

function uniqueIds(v: readonly unknown[] | unknown, valid?: ReadonlySet<string>): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string" || !raw || seen.has(raw)) continue;
    if (valid && !valid.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** 源码内容 → 稳定的 localStorage 命名空间（FNV-1a + 长度，与 engine 的缓存键同思路）。 */
export function groupingStorageKey(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 16777619);
  return `zetla.diagram.grouping.${source.length}:${(h >>> 0).toString(36)}`;
}

/**
 * 反序列化 + 严格归一化。手改 localStorage / 旧版本 / 换图后的脏数据都在这里挡掉：
 * id 去重、名称截断、父组存在性、parentId 成环、成员 id 白名单、空组清理。
 */
export function normalizeGrouping(raw: unknown, validElementIds: readonly string[]): GroupingState {
  const valid = new Set(validElementIds);
  if (!raw || typeof raw !== "object") return { ...EMPTY_GROUPING };
  const obj = raw as Record<string, unknown>;
  const groupsRaw = Array.isArray(obj.groups) ? obj.groups : [];
  const groups: DiagramGroup[] = [];
  const ids = new Set<string>();
  for (const item of groupsRaw.slice(0, MAX_GROUPS)) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const id = typeof g.id === "string" ? g.id : "";
    if (!id || !/^group:[0-9]+$/.test(id) || ids.has(id)) continue;
    ids.add(id);
    groups.push({
      id,
      name: str(g.name) || "分组",
      // parentId 先原样收下，下面统一做存在性 / 成环校验
      parentId: typeof g.parentId === "string" ? g.parentId : null,
      memberIds: uniqueIds(g.memberIds, valid),
      collapsed: g.collapsed === true,
      locked: g.locked === true,
      hidden: g.hidden === true,
    });
  }
  for (const g of groups) {
    if (g.parentId && !ids.has(g.parentId)) g.parentId = null;
  }
  // 断环：沿 parentId 上溯，遇到重复访问就把当前组的 parentId 提到顶层。
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let cur = g.parentId;
    while (cur) {
      if (seen.has(cur)) {
        g.parentId = null;
        break;
      }
      seen.add(cur);
      const parent = groups.find((x) => x.id === cur);
      cur = parent?.parentId ?? null;
    }
  }
  const seqRaw = typeof obj.seq === "number" && Number.isFinite(obj.seq) ? obj.seq : 0;
  let seq = Math.max(0, Math.floor(seqRaw));
  for (const g of groups) {
    const n = Number(g.id.slice(6));
    if (Number.isFinite(n) && n > seq) seq = n;
  }
  return {
    groups,
    hiddenIds: uniqueIds(obj.hiddenIds, valid),
    lockedIds: uniqueIds(obj.lockedIds, valid),
    seq,
  };
}

/** 当前渲染的语句清单变了就裁掉失效 id；空组（连子组也没有）一并清掉。 */
export function pruneGrouping(state: GroupingState, validElementIds: readonly string[]): GroupingState {
  const valid = new Set(validElementIds);
  const groups = state.groups
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => valid.has(id)) }))
    .filter((g) => {
      if (g.memberIds.length > 0) return true;
      return state.groups.some((other) => other.parentId === g.id);
    });
  const alive = new Set(groups.map((g) => g.id));
  return {
    groups: groups.map((g) => ({
      ...g,
      parentId: g.parentId && alive.has(g.parentId) ? g.parentId : null,
    })),
    hiddenIds: state.hiddenIds.filter((id) => valid.has(id)),
    lockedIds: state.lockedIds.filter((id) => valid.has(id)),
    seq: state.seq,
  };
}

// ── 分组操作（全部返回新 state，不 mutate 入参） ──────────────────────────────

export function nextGroupId(state: GroupingState): string {
  return `group:${state.seq + 1}`;
}

/** 编组：至少 2 个有效元素；成员从其它组里移出，避免同一元素同时归属多个组。 */
export function createGroup(
  state: GroupingState,
  elementIds: readonly string[],
  name = "",
): { state: GroupingState; groupId: string | null } {
  const members = uniqueIds(elementIds);
  if (members.length < 2) return { state, groupId: null };
  const memberSet = new Set(members);
  // 成员全部直属同一个现有组时，「再次编组」= 在该组下面建子组（嵌套）；
  // 跨组或原本未分组则建顶层组。成员一律从原组移出，绝不重复归属。
  const owners = state.groups.filter((g) =>
    g.memberIds.some((id) => memberSet.has(id)),
  );
  const nestedParent = owners.length === 1 ? owners[0].id : null;
  const ownerIds = new Set(owners.map((g) => g.id));
  const id = nextGroupId(state);
  const groups = state.groups.map((g) =>
    ownerIds.has(g.id)
      ? { ...g, memberIds: g.memberIds.filter((m) => !memberSet.has(m)) }
      : { ...g },
  );
  groups.push({
    id,
    name: str(name) || `分组 ${state.seq + 1}`,
    parentId: nestedParent,
    memberIds: members,
    collapsed: false,
    locked: false,
    hidden: false,
  });
  return { state: { ...state, groups, seq: state.seq + 1 }, groupId: id };
}

/** 解组：只删组元数据，源码零改动；成员归还父组（没有父组就回到顶层），子组提级。 */
export function deleteGroup(state: GroupingState, groupId: string): GroupingState {
  const target = state.groups.find((g) => g.id === groupId);
  if (!target) return state;
  const parentId = target.parentId;
  const groups: DiagramGroup[] = [];
  for (const g of state.groups) {
    if (g.id === groupId) continue;
    if (g.parentId === groupId) {
      groups.push({ ...g, parentId });
      continue;
    }
    if (parentId && g.id === parentId) {
      groups.push({ ...g, memberIds: [...g.memberIds, ...target.memberIds] });
      continue;
    }
    groups.push({ ...g });
  }
  return { ...state, groups };
}

/** 当前多选是否恰好等于某个组的成员集合 —— 画布头部「解组」按钮据此定位目标组。 */
export function findGroupByMembers(
  groups: readonly DiagramGroup[],
  ids: readonly string[],
): string | null {
  const wanted = new Set(ids);
  if (wanted.size < 2) return null;
  const key = Array.from(wanted).sort().join("|");
  for (const g of groups) {
    if (g.memberIds.length !== wanted.size) continue;
    if (Array.from(new Set(g.memberIds)).sort().join("|") === key) return g.id;
  }
  return null;
}

export function patchGroup(
  state: GroupingState,
  groupId: string,
  patch: Partial<Pick<DiagramGroup, "name" | "collapsed" | "locked" | "hidden">>,
): GroupingState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            ...(typeof patch.name === "string" ? { name: str(patch.name) || "分组" } : {}),
            ...(typeof patch.collapsed === "boolean" ? { collapsed: patch.collapsed } : {}),
            ...(typeof patch.locked === "boolean" ? { locked: patch.locked } : {}),
            ...(typeof patch.hidden === "boolean" ? { hidden: patch.hidden } : {}),
          }
        : g,
    ),
  };
}

/** 展开一个组的所有元素（含嵌套子组），带环检测与去重。 */
export function expandGroupElements(
  groups: readonly DiagramGroup[],
  groupId: string,
): string[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const visited = new Set<string>();
  const out: string[] = [];
  const seenElements = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const g = byId.get(id);
    if (!g) return;
    for (const member of g.memberIds) {
      if (!seenElements.has(member)) {
        seenElements.add(member);
        out.push(member);
      }
    }
    for (const child of groups) if (child.parentId === id) walk(child.id);
  };
  walk(groupId);
  return out;
}

/** 元素所属的组链（由内到外），用于继承组级锁定 / 隐藏。 */
export function groupAncestors(
  groups: readonly DiagramGroup[],
  elementId: string,
): DiagramGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const chain: DiagramGroup[] = [];
  const visited = new Set<string>();
  let cur = groups.find((g) => g.memberIds.includes(elementId)) ?? null;
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null;
  }
  return chain;
}

/** 用户主动锁定或所属任一祖先组被锁定。F2-3 能力锁定由 compat 在别处判定。 */
export function isManuallyLocked(state: GroupingState, elementId: string): boolean {
  if (state.lockedIds.includes(elementId)) return true;
  return groupAncestors(state.groups, elementId).some((g) => g.locked);
}

export function isManuallyHidden(state: GroupingState, elementId: string): boolean {
  if (state.hiddenIds.includes(elementId)) return true;
  return groupAncestors(state.groups, elementId).some((g) => g.hidden);
}

export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// ── 多选 / 框选 ─────────────────────────────────────────────────────────────

/** 点选：additive(Shift) 时切换该项，否则单选 / 清空。 */
export function toggleSelection(
  current: readonly string[],
  id: string | null,
  additive: boolean,
): string[] {
  if (!id) return additive ? [...current] : [];
  if (!additive) return [id];
  return toggleId(current, id);
}

/** 框选：additive 时并入当前选择，否则替换。 */
export function applyMarqueeSelection(
  current: readonly string[],
  hits: readonly string[],
  additive: boolean,
): string[] {
  if (!additive) return Array.from(new Set(hits));
  const out = new Set(current);
  for (const id of hits) out.add(id);
  return Array.from(out);
}

export interface MarqueeBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** 指针拖出的矩形可能为负方向，统一成左上 / 右下。 */
export function marqueeBox(x1: number, y1: number, x2: number, y2: number): MarqueeBox {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

export function rectIntersectsBox(r: RectLike, box: MarqueeBox): boolean {
  if (!(r.width > 0 || r.height > 0)) return false;
  return (
    r.left <= box.right && r.right >= box.left && r.top <= box.bottom && r.bottom >= box.top
  );
}

export function rectInsideBox(r: RectLike, box: MarqueeBox): boolean {
  if (!(r.width > 0 || r.height > 0)) return false;
  return (
    r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom
  );
}

/**
 * 框选命中：屏幕 client 矩形，直接和 getBoundingClientRect() 比，不做 SVG 坐标反算
 * （与 F3-2 包围盒同一口径：天然含 transform / zoom / preserveAspectRatio 留白）。
 * mode = intersect（默认，碰到就选）/ contain（完全框住才选，Shift 反向框选可留口）。
 */
export function marqueeHits(
  items: readonly { id: string; rect: RectLike }[],
  box: MarqueeBox,
  mode: "intersect" | "contain" = "intersect",
  allowedIds?: ReadonlySet<string>,
): string[] {
  if (!(box.right > box.left || box.bottom > box.top)) return [];
  const test = mode === "contain" ? rectInsideBox : rectIntersectsBox;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    if (allowedIds && !allowedIds.has(item.id)) continue;
    if (test(item.rect, box)) {
      seen.add(item.id);
      out.push(item.id);
    }
  }
  return out;
}

// ── 图层面板行 ──────────────────────────────────────────────────────────────

export interface LayerRow {
  kind: "group" | "element";
  id: string;
  label: string;
  depth: number;
  /** 元素行：所属直接组；组行：自己的 id */
  groupId: string | null;
  collapsed: boolean;
  locked: boolean;
  hidden: boolean;
  /** 组行：成员数（含子组展开后的元素数） */
  count: number;
}

function statementLabel(s: TikzStatement, index: number): string {
  const cmd = (s.command || s.kind || "图元").trim();
  return `${cmd} ${index + 1}`;
}

/**
 * 图层树：顶层组（按创建顺序）→ 组内成员 + 子组（递归）→ 未分组元素（按源码顺序）。
 * 折叠的组只出一行；环 / 悬空 parentId 由 normalizeGrouping 保证不会出现。
 */
export function buildLayerRows(
  statements: readonly TikzStatement[],
  state: GroupingState,
): LayerRow[] {
  const labels = new Map(statements.map((s, i) => [s.id, statementLabel(s, i)]));
  const grouped = new Set<string>();
  for (const g of state.groups) for (const id of g.memberIds) grouped.add(id);
  const rows: LayerRow[] = [];
  const visited = new Set<string>();

  const emitGroup = (g: DiagramGroup, depth: number): void => {
    if (visited.has(g.id)) return;
    visited.add(g.id);
    const all = expandGroupElements(state.groups, g.id);
    rows.push({
      kind: "group",
      id: g.id,
      label: g.name,
      depth,
      groupId: g.id,
      collapsed: g.collapsed,
      locked: g.locked,
      hidden: g.hidden,
      count: all.length,
    });
    if (g.collapsed) return;
    for (const id of g.memberIds) {
      rows.push({
        kind: "element",
        id,
        label: labels.get(id) ?? id,
        depth: depth + 1,
        groupId: g.id,
        collapsed: false,
        locked: isManuallyLocked(state, id),
        hidden: isManuallyHidden(state, id),
        count: 0,
      });
    }
    for (const child of state.groups) {
      if (child.parentId === g.id) emitGroup(child, depth + 1);
    }
  };

  for (const g of state.groups) if (g.parentId === null) emitGroup(g, 0);
  // parentId 指向已不存在的组（脏数据兜底）：仍要显示，别把用户的组藏没了
  for (const g of state.groups) if (!visited.has(g.id)) emitGroup(g, 0);

  for (const s of statements) {
    if (grouped.has(s.id)) continue;
    rows.push({
      kind: "element",
      id: s.id,
      label: labels.get(s.id) ?? s.id,
      depth: 0,
      groupId: null,
      collapsed: false,
      locked: isManuallyLocked(state, s.id),
      hidden: isManuallyHidden(state, s.id),
      count: 0,
    });
  }
  return rows;
}

// ── 组拖：多段最小补丁 ──────────────────────────────────────────────────────

export type MoveIntentResult =
  | { ok: true; patches: SourceSpanPatch[] }
  | { ok: false; reason: string };

/** 注入上游 applyEditIntent 的薄适配：让纯逻辑可在 Node 侧用 fake 回归。 */
export type MoveIntent = (
  source: string,
  handles: readonly TikzEditHandle[],
  handleId: string,
  newWorld: { x: number; y: number },
) => MoveIntentResult;

export interface GroupMoveSkipped {
  id: string;
  reason: string;
}

export type GroupMovePlan =
  | {
      status: "ok";
      patches: SourceSpanPatch[];
      nextSource: string;
      movedElements: string[];
      skipped: GroupMoveSkipped[];
    }
  | {
      status: "empty" | "conflict";
      patches: SourceSpanPatch[];
      nextSource: string;
      movedElements: string[];
      skipped: GroupMoveSkipped[];
      reason: string;
    };

/**
 * 合并一组基于**同一份基准源码**的 span 补丁。排序 + 越界 / 重叠 / 非有限值校验，
 * 任何异常都返回 null（调用方必须放弃整次写回，绝不静默改语义）。
 */
export function mergeSourcePatches(
  source: string,
  patches: readonly SourceSpanPatch[],
): { patches: SourceSpanPatch[]; nextSource: string } | null {
  const sorted = [...patches]
    .filter((p) => p && Number.isFinite(p.from) && Number.isFinite(p.to))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  let cursor = 0;
  let out = "";
  for (const p of sorted) {
    if (p.from < 0 || p.to < p.from || p.to > source.length || p.from < cursor) return null;
    if (typeof p.insert !== "string") return null;
    out += source.slice(cursor, p.from) + p.insert;
    cursor = p.to;
  }
  out += source.slice(cursor);
  return { patches: sorted, nextSource: out };
}

/**
 * 规划一次「整体平移」：对选中集合里每个元素的**所有**可写控制点分别求补丁，
 * 再合并成一组不重叠的 changes。与 F2-1 单控制点拖拽共用同一套 applyEditIntent
 * 语义（world 单位 pt、Y 向上），只是把「一个句柄」扩成「一组句柄」。
 * 每个 intent 都传原始 source + 原始 handles，故所有 oldSpan 同一坐标系、可直接合并。
 */
export function planGroupMove(args: {
  source: string;
  handles: readonly TikzEditHandle[];
  elementIds: readonly string[];
  delta: { x: number; y: number };
  compat: CompatReport | null;
  grouping: GroupingState;
  intent: MoveIntent;
}): GroupMovePlan {
  const emptyBase = {
    patches: [] as SourceSpanPatch[],
    nextSource: args.source,
    movedElements: [] as string[],
    skipped: [] as GroupMoveSkipped[],
  };
  if (
    !Number.isFinite(args.delta.x) ||
    !Number.isFinite(args.delta.y) ||
    (args.delta.x === 0 && args.delta.y === 0)
  ) {
    return { status: "empty", ...emptyBase, reason: "位移为零" };
  }
  const patches: SourceSpanPatch[] = [];
  const moved = new Set<string>();
  const skipped: GroupMoveSkipped[] = [];
  const byElement = new Map<string, TikzEditHandle[]>();
  for (const h of args.handles) {
    const sid = h?.sourceRef?.sourceId;
    if (!sid || !h.world || !Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
    const list = byElement.get(sid) ?? [];
    list.push(h);
    byElement.set(sid, list);
  }

  for (const id of new Set(args.elementIds)) {
    if (isManuallyHidden(args.grouping, id)) {
      skipped.push({ id, reason: "已隐藏，先在图层面板显示后再移动" });
      continue;
    }
    if (isManuallyLocked(args.grouping, id)) {
      skipped.push({ id, reason: "已主动锁定，先解锁后再移动" });
      continue;
    }
    const own = byElement.get(id) ?? [];
    const reasons = own.map((h) =>
      resolveHandleLock(args.compat, h.id, isDraggableHandle(h), lockedHandleReason(h)),
    );
    const writable = own.filter((h, i) => isDraggableHandle(h) && reasons[i] === null);
    if (writable.length === 0) {
      // 优先透出 F2-3 能力矩阵的具体理由（如「\foreach 展开会静默改语义」），
      // 没有再退到 F2-1 的 rewriteMode 兜底说明。
      const specific = reasons.find((r): r is string => typeof r === "string" && !!r);
      skipped.push({
        id,
        reason: specific ?? (own.length > 0 ? "上游不支持改写" : "没有可写控制点"),
      });
      continue;
    }
    let okCount = 0;
    let lastReason = "上游未返回补丁";
    for (const h of writable) {
      const res = args.intent(args.source, args.handles, h.id, {
        x: h.world.x + args.delta.x,
        y: h.world.y + args.delta.y,
      });
      if (!res.ok) {
        lastReason = res.reason || lastReason;
        continue;
      }
      for (const p of res.patches) {
        if (p && Number.isFinite(p.from) && Number.isFinite(p.to)) patches.push(p);
      }
      okCount += 1;
    }
    if (okCount === 0) skipped.push({ id, reason: lastReason });
    else moved.add(id);
  }

  const merged = mergeSourcePatches(args.source, patches);
  if (!merged) {
    return {
      status: "conflict",
      ...emptyBase,
      skipped: [...skipped, { id: "*", reason: "补丁区间重叠或越界，已放弃整次写回" }],
      reason: "补丁区间重叠或越界",
    };
  }
  const base = {
    patches: merged.patches,
    nextSource: merged.nextSource,
    movedElements: Array.from(moved),
    skipped,
  };
  if (merged.nextSource === args.source) {
    return { status: "empty", ...base, reason: "位移太小，坐标未变化" };
  }
  return { status: "ok", ...base };
}
