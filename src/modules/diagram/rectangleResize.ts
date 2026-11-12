// F6·矩形 8 点柄：按「角 / 边语义」真实改写矩形两个端点坐标的纯逻辑。
//
// 与 F3-4 `scale=` / F4-1 `text width` 严格划界：本模块只服务单个标准
// `\draw/\fill ... rectangle ...`，且只写坐标 span；其余图元一律由 eligibility
// 拒绝，交还原有选项路径。无 DOM / React / vendor 依赖，Node 侧可直接回归。
//
// 关键口径：
//   · world pt、Y 向上；1cm = 28.45275590551181pt，这里不做单位换算。
//   · 矩形在上游只有 2 个 path-point 句柄（两个对角端点），B/D 两角是 rectangle
//     语法隐含的；句柄下标与书写方向有关，必须按 world 坐标分类角点。
//   · 指针位移用「相对起手位置」，因为柄画在 getBoundingClientRect 的视觉框上
//     （含 padding），绝对指针会让起手瞬间跳一下。
import type { PointLike, SourceSpanPatch } from "./dragEdit.ts";
import { isDraggableHandle, lockedHandleReason } from "./dragEdit.ts";
import type { TikzEditHandle } from "./tikzEditor/engine.ts";
import type { TikzStatement } from "./optionsEdit.ts";
import { resolveHandleLock, type CompatReport } from "./tikzEditor/compat.ts";
import {
  boxHeight,
  boxWidth,
  cornerPoint,
  makeWorldBox,
  type WorldBox,
} from "./guides.ts";
import { isTransformKey } from "./transform.ts";
import {
  isManuallyHidden,
  isManuallyLocked,
  mergeSourcePatches,
  type GroupingState,
  type MoveIntent,
} from "./grouping.ts";

const CLASSIFY_EPS = 1e-4;
const MOVE_EPS = 1e-3;
const RECT_COMMANDS = new Set(["draw", "fill", "filldraw", "path"]);
const TRANSFORM_OPTION_RE = /\b(rotate|scale|xshift|yshift|cm|transform|fit)\s*=/;

export interface RectangleEndpoint {
  handleId: string;
  /** 起手 world 坐标（pt） */
  world: PointLike;
  /** 由 world 坐标分类得到，不是句柄下标 */
  corner: 0 | 2 | 4 | 6;
}

export interface RectangleEligibility {
  ok: boolean;
  /** ok=false 时给 UI 的具体理由 */
  reason: string;
  statement: TikzStatement | null;
  endpoints: RectangleEndpoint[];
  /** 由两个端点 world 归一得到的盒，不是视觉外接框 */
  box: WorldBox | null;
  allHandles: readonly TikzEditHandle[];
}

export interface RectangleResizeTarget {
  handleId: string;
  from: PointLike;
  to: PointLike;
}

export interface RectangleGeometry {
  nextBox: WorldBox;
  targets: RectangleResizeTarget[];
}

export type RectangleResizePlan =
  | {
      status: "ok";
      patches: SourceSpanPatch[];
      nextSource: string;
      targets: RectangleResizeTarget[];
      label: string;
    }
  | {
      status: "rejected" | "conflict" | "empty";
      reason: string;
      patches: SourceSpanPatch[];
      nextSource: string;
    };

const CORNER_LABEL = ["左上", "上中", "右上", "右中", "右下", "下中", "左下", "左中"];

function rejectEligibility(
  reason: string,
  statement: TikzStatement | null,
  handles: readonly TikzEditHandle[],
): RectangleEligibility {
  return { ok: false, reason, statement, endpoints: [], box: null, allHandles: handles };
}

/** 两端点归一盒上的角分类：world Y 向上，故 maxY 是视觉上边。 */
function cornerOf(p: PointLike, box: WorldBox): 0 | 2 | 4 | 6 {
  const left = Math.abs(p.x - box.minX) <= CLASSIFY_EPS;
  const top = Math.abs(p.y - box.maxY) <= CLASSIFY_EPS;
  if (top) return left ? 0 : 2;
  return left ? 6 : 4;
}

/** pointerdown 时的只读预检；不触发写回，也不需要 vendor intent。 */
export function checkRectangleResizeEligibility(args: {
  source: string;
  statement: TikzStatement | null;
  handles: readonly TikzEditHandle[];
  elementIds: readonly string[];
  compat: CompatReport | null;
  grouping: GroupingState;
}): RectangleEligibility {
  const { source, statement, handles, elementIds, compat, grouping } = args;
  const reject = (reason: string) => rejectEligibility(reason, statement ?? null, handles);
  if (elementIds.length !== 1) return reject("端点缩放一次只支持选中 1 个矩形");
  if (!statement) return reject("没有找到对应的 TikZ 语句");
  if (!RECT_COMMANDS.has(statement.command)) return reject("选中的不是路径图元，无法按端点缩放");
  const body = source.slice(statement.span.from, statement.span.to);
  if (!/\brectangle\b/.test(body)) return reject("该路径不是 rectangle 语句");
  if (
    statement.entries.some((e) => isTransformKey(e.key)) ||
    (statement.optionsRaw && TRANSFORM_OPTION_RE.test(statement.optionsRaw))
  ) {
    return reject("矩形带 rotate / scale / xshift 等变换选项，端点坐标无法安全反算，请在源码栏修改");
  }
  if (!statement.topLevel) return reject("scope / foreach 内的矩形不支持端点缩放");
  const compatReason = compat?.lockReasons[statement.id];
  if (compatReason) return reject(compatReason);
  if (isManuallyHidden(grouping, statement.id)) return reject("该矩形已隐藏，先在图层面板显示");
  if (isManuallyLocked(grouping, statement.id)) return reject("该矩形已主动锁定，先解锁");

  const own = handles.filter(
    (h) => h.sourceRef?.sourceId === statement.id && h.kind === "path-point",
  );
  if (own.length !== 2) return reject("矩形端点不是恰好 2 个可写控制点");
  for (const h of own) {
    const reason = resolveHandleLock(
      compat,
      h.id,
      isDraggableHandle(h),
      lockedHandleReason(h),
    );
    if (reason !== null) return reject(reason);
    if (h.coordinateForm && h.coordinateForm !== "cartesian") {
      return reject("矩形端点含命名坐标 / 极坐标等不可安全写回的写法");
    }
    const span = h.sourceRef?.sourceSpan;
    if (span && typeof h.sourceText === "string") {
      const actual = source.slice(span.from, span.to).trim();
      if (actual !== h.sourceText.trim()) return reject("源码已变化，请重新点选矩形");
    }
  }
  const box = makeWorldBox(
    own[0].world.x,
    own[0].world.y,
    own[1].world.x,
    own[1].world.y,
  );
  if (!box || boxWidth(box) < MOVE_EPS || boxHeight(box) < MOVE_EPS) {
    return reject("矩形端点退化，无法按角 / 边缩放");
  }
  const endpoints: RectangleEndpoint[] = own.map((h) => ({
    handleId: h.id,
    world: h.world,
    corner: cornerOf(h.world, box),
  }));
  if (endpoints[0].corner === endpoints[1].corner) {
    return reject("矩形端点落在同一角，无法按角 / 边缩放");
  }
  return {
    ok: true,
    reason: "",
    statement,
    endpoints,
    box,
    allHandles: handles,
  };
}

/**
 * 纯几何核心：由被拖柄编号 + 指针位移推出新的矩形盒，再映射到两个端点目标坐标。
 * 角柄锚定对角；边中柄锚定对边。Shift / Alt 逃生舱已移除，矩形恒走端点 resize。
 */
export function rectangleTargetsFromDrag(args: {
  box: WorldBox;
  endpoints: RectangleEndpoint[];
  corner: number;
  startWorld: PointLike;
  pointer: PointLike;
}): RectangleGeometry | null {
  const { box, endpoints, startWorld, pointer } = args;
  const corner = ((args.corner % 8) + 8) % 8;
  const dx = pointer.x - startWorld.x;
  const dy = pointer.y - startWorld.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  let nextBox: WorldBox | null;

  if (corner % 2 === 0) {
    const start = cornerPoint(box, corner);
    const moved = { x: start.x + dx, y: start.y + dy };
    const anchor = cornerPoint(box, (corner + 4) % 8);
    nextBox = makeWorldBox(anchor.x, anchor.y, moved.x, moved.y);
  } else {
    const nb = { ...box };
    if (corner === 1 || corner === 5) {
      nb[corner === 1 ? "maxY" : "minY"] = box[corner === 1 ? "maxY" : "minY"] + dy;
    } else {
      nb[corner === 3 ? "maxX" : "minX"] = box[corner === 3 ? "maxX" : "minX"] + dx;
    }
    // 拖过对边会让矩形翻面、端点语义对调，直接拒绝。
    if (nb.minX >= nb.maxX || nb.minY >= nb.maxY) return null;
    nextBox = makeWorldBox(nb.minX, nb.minY, nb.maxX, nb.maxY);
  }
  if (!nextBox || boxWidth(nextBox) < MOVE_EPS || boxHeight(nextBox) < MOVE_EPS) return null;

  const targets: RectangleResizeTarget[] = endpoints.map((e) => ({
    handleId: e.handleId,
    from: e.world,
    to: cornerPoint(nextBox!, e.corner),
  }));
  return { nextBox, targets };
}

function moveIsReal(t: RectangleResizeTarget): boolean {
  return (
    Math.abs(t.to.x - t.from.x) >= MOVE_EPS || Math.abs(t.to.y - t.from.y) >= MOVE_EPS
  );
}

/** 完整规划：几何 → 逐端点 vendor intent → 合并为一次最小 span 写回。 */
export function planRectangleResize(args: {
  source: string;
  eligibility: RectangleEligibility;
  corner: number;
  startWorld: PointLike;
  pointer: PointLike;
  intent: MoveIntent;
}): RectangleResizePlan {
  const { source, eligibility, corner, startWorld, pointer, intent } = args;
  if (!eligibility.ok || !eligibility.box) {
    return {
      status: "rejected",
      reason: eligibility.reason || "该图元不支持端点缩放",
      patches: [],
      nextSource: source,
    };
  }
  const geo = rectangleTargetsFromDrag({
    box: eligibility.box,
    endpoints: eligibility.endpoints,
    corner,
    startWorld,
    pointer,
  });
  if (!geo) {
    return {
      status: "rejected",
      reason: "矩形已退化或指针位移无效",
      patches: [],
      nextSource: source,
    };
  }
  const changed = geo.targets.filter(moveIsReal);
  const patches: SourceSpanPatch[] = [];
  for (const t of changed) {
    const res = intent(source, eligibility.allHandles, t.handleId, t.to);
    if (!res.ok) {
      return {
        status: "rejected",
        reason: `端点写回失败：${res.reason}`,
        patches: [],
        nextSource: source,
      };
    }
    patches.push(...res.patches);
  }
  const merged = mergeSourcePatches(source, patches);
  if (!merged) {
    return {
      status: "conflict",
      reason: "端点补丁区间重叠或越界，已放弃整次写回",
      patches: [],
      nextSource: source,
    };
  }
  if (merged.nextSource === source) {
    return {
      status: "empty",
      reason: "端点位置未变化",
      patches: merged.patches,
      nextSource: source,
    };
  }
  const label = CORNER_LABEL[((corner % 8) + 8) % 8];
  return {
    status: "ok",
    patches: merged.patches,
    nextSource: merged.nextSource,
    targets: changed,
    label:
      corner % 2 === 0
        ? `调整${label}角 · 对角固定`
        : `调整${label}边 · 对边固定`,
  };
}
