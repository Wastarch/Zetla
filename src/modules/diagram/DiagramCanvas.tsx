// M2·F1-3 / F1-6 / F2-1 / F2-2 / F2-3 / F2-4 / F3-1 / F3-2：TikZ 双通道画布 + 拖拽写回 + 点选图元 + 锁定提示 + 统一撤销栈 + 基础图元工具 + Illustrator 化手柄。
//  F3-2 视觉层：控制点 DOM 构建抽到 handleLayer.ts（无 JSX，jsdom 可回归），尺寸数值抽到
//  handleVisual.ts。视觉圆小、透明命中圈大（约 3×），选中图元另画虚线包围盒 + 四角方块；
//  两层都只在本地通道挂在已消毒 SVG 之后，pointer 命中与 F2-1 拖拽 marker 的 data 属性不变。
//  F3-1 形状工具：选工具 → 画布 pointerdown/move/up（或多点单击）→ 屏幕坐标经
//  getScreenCTM 完整仿射逆 → world pt → shapeInsert 生成标准 TikZ 语句 → 单点补丁
//  → commitDiagramPatch 写回 CM6（与键盘 / 拖拽 / 属性同一条 history）→ 重渲染后
//  按插入 span 自动选中。绘制预览层只用 createElementNS 追加到已消毒 SVG 之后。
//  精确通道（XeLaTeX）没有语义句柄，工具条整体禁用，保持只读。
//  本地通道：source → debounce 160ms → engine.renderTikz（动态加载 vendor bundle + LRU
//            缓存 + 诊断归一化 + editHandles）→ svg.sanitizeSvg 白名单消毒 → importNode 挂载
//            → 追加控制点 <circle> 图层（DOM API 创建，不经过 innerHTML）。
//  精确通道：source → debounce 800ms → Rust tikz_preview（XeLaTeX standalone → PDF → SVG）
//            → data URL 交给 <img>（隔离文档，不内联注入、不受白名单限制）。精确通道只读，
//            没有语义句柄，拖拽只在本地通道开放。
//  拖拽写回：pointerdown 命中控制点 → window 级 pointermove（屏幕 px 经 getScreenCTM 反算
//            world 位移）→ pointerup 调上游 applyEditIntent 得到新源码 → 求最小 span 补丁
//            → 经 sourceBridge dispatch 到 CM6 视图（与键盘改源码共用撤销栈）。
//  实时预览（F3-2 后续修复）：pointermove 期间同一份 applyEditIntent 产出**候选源码**，
//            renderTikz 得到候选 SVG，只替换根 SVG 的几何子节点（保持基准 viewBox 与
//            控制点 / 选中框辅助层不变），于是「拖命中圈 = 图形跟着动」；预览不写 source、
//            不进撤销栈、不动 renderMeta，松手才提交一次。命中圈只是 TikZ 句柄的交互代理，
//            编辑语义与结果仍然是原来的节点坐标改写（见 dragPreview.ts）。
//  选择 / 分组（F3-3）：空白区拖出框选矩形 → 按 getBoundingClientRect() 命中多个
//            data-source-id；Shift 加选 / 减选、点空白清空；多选时拖任一选中图元 =
//            整体平移（applyGroupEdit 把各元素最小补丁合并成一次 CM6 dispatch = 一条 history）。
//            虚拟分组只存 store + localStorage，源码零改动、绝不包 \begin{scope}；
//            图层面板的眼睛 / 锁是主动隐藏 / 主动锁定，与 F2-3 能力矩阵锁定并列。
//  点选图元：F2-2 pointerdown 从 data-source-id / 控制点 sourceRef 取 id 写入 store，
//            侧栏属性区据此定位语句选项；选中态只 toggle class，不重建 SVG、不打断拖拽。
//  锁定提示：F2-3 compat.ts 用 capabilityMatrix + featureUsage 把「展开 / 计算型构造」
//            归属到语句与控制点；锁定控制点画橙色挂锁 + 具体理由，拒绝拖拽；
//            画布常驻一条可展开的锁定清单（默认展开，不做死按钮）。
//  撤销栈：F2-4 拖拽与属性都经 diagramHistory.commitDiagramPatch 并组写回；
//            「仅画布」布局 CM6 无焦点，由 window keydown 把 Ctrl/Cmd+Z / Shift+Z / Y
//            转发到同一条 history，焦点在源码栏时仍交回 CM6 的 historyKeymap。
// 三布局下本组件常驻挂载（DiagramTab 用 hidden 切换），故不会因布局切换重复拉引擎。
// 精确通道只在绘图 Tab 真实激活时编译，Tab 隐藏/切到别的缓冲时不跑 XeLaTeX。
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useBuffersStore } from "@/editor/useBuffers";
import { useSettingsStore } from "@/core/settings";
import { useDiagramStore } from "./store";
import {
  applyDeltaEdit,
  applyDragEdit,
  applyGroupEdit,
  preloadTikzEngine,
  renderTikz,
  type DragEditOutcome,
  type TikzEditHandle,
  type TikzRender,
} from "./tikzEditor/engine";
import { hasDrawableContent, sanitizeSvg } from "./tikzEditor/svg";
import {
  clientDeltaToSvgDelta,
  clientToSvgPoint,
  dragDeltaLabel,
  isDraggableHandle,
  lockedHandleReason,
  svgDeltaToWorldDelta,
  svgToWorldPoint,
  worldToSvgPoint,
  type AffineMatrix,
  type MatrixLike,
  type PointLike,
} from "./dragEdit";
import {
  applyLayerVisibility,
  buildHandleLayer,
  createGridLayer,
  createGuideLayer,
  createRulerLayer,
  createSelectionLayer,
  createTransformLayer,
  drawGrid,
  drawGuides,
  drawRuler,
  drawSelectionBox,
  drawTransformHandles,
} from "./handleLayer";
import {
  applyMarqueeSelection,
  createGroup,
  deleteGroup,
  findGroupByMembers,
  isManuallyHidden,
  isManuallyLocked,
  marqueeBox,
  marqueeHits,
  toggleSelection,
  type GroupingState,
  type MarqueeBox,
  type RectLike,
} from "./grouping";
import {
  collectElementBoxes,
  planDragSnap,
  planTransformPatches,
  type ElementBox,
} from "./transform";
import type { GroupMovePlan } from "./grouping";
import {
  applyPreviewGeometry,
  isPreviewActive,
  shouldRenderPreview,
  updateHandleLayerPositions,
} from "./dragPreview";
import {
  HANDLE_SIZE_LABELS,
  clientRectToSvgBox,
  handleMetrics,
  handleSizeSummary,
  svgUnitScale,
  unionBoxes,
  isHandleSize,
  type HandleSize,
} from "./handleVisual";
import {
  addShapePoint,
  canFinishShape,
  createShapeSession,
  isShapeComplete,
  isToolMode,
  popShapePoint,
  shapeSessionHint,
  toolDef,
  type ShapePoint,
  type ShapeSession,
  type ToolMode,
} from "./shapeTools";
import {
  arcSweepDegrees,
  buildShapeStatement,
  insertShapeStatement,
  pickInsertedStatementId,
} from "./shapeInsert";
import {
  boxCenter,
  boxHeight,
  boxWidth,
  DEFAULT_SNAP_THRESHOLD_PT,
  rotationFromDrag,
  scaleFromDrag,
  snapAngle,
  svgBoxToWorldBox,
  unionWorldBox,
  type GuideLine,
  type WorldBox,
} from "./guides";
import {
  planSizePatches,
  sizeValueToPt,
  sizeValuesFromDrag,
  type SizeValues,
} from "./sizeEdit.ts";
import { GRID_STEP_PT, snapToGrid } from "./grid";
import { findEditableNodeText, planNodeTextEdit } from "./nodeTextEdit.ts";
import {
  canEditDiagramSource,
  isDiagramEditKey,
  isPreciseReadonly,
} from "./editability.ts";
import { pickNearestHandle, type HitCandidate } from "./handleHit.ts";
import { enhanceDiagramMath } from "./tikzEditor/mathRender";
import {
  getClipboard,
  getLastMoveDelta,
  hasClipboard,
  minimalSourcePatch,
  planDeleteEdit,
  planDuplicateEdit,
  planPaste,
  setClipboard,
  setLastMoveDelta,
  topLevelBlocks,
} from "./zOrder";
import { ShapeToolbar } from "./ShapeToolbar";
import { ToolbarIcon } from "./ToolbarIcon";
import { resolveHandleLock, type CompatReport } from "./tikzEditor/compat";
import {
  commitDiagramPatch,
  commitDiagramPatches,
  resetDiagramHistorySession,
  runDiagramHistoryCommand,
  shouldHandleHistoryKey,
} from "./diagramHistory";
import {
  getCachedPreview,
  previewKey,
  requestPrecisePreview,
  svgDataUrl,
} from "./precisePreview";
import type { TikzPreviewResult } from "@/types/diagram";
import { getEditorView } from "@/editor/activeView";
import {
  canvasPaperRect,
  canvasSizeToPt,
} from "./canvasSize.ts";
import { inferDocumentPaper } from "./documentPaper.ts";
import {
  DEFAULT_VIEWPORT,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitCanvasViewport,
  fitContentZoom,
  panBy,
  renderScale,
  viewportTransform,
  zoomStep,
  type Viewport,
} from "./viewport.ts";

const LOCAL_DEBOUNCE_MS = 160;
const PRECISE_DEBOUNCE_MS = 800;
const DIAGRAM_PATH = "diagram://editor";
const MAX_DIAG = 5;
const SVG_NS = "http://www.w3.org/2000/svg";
/** F3-2：恒屏尺寸统一由 handleVisual.handleMetrics(size, 实测 unitScale) 给出；
 *  单位比 = 屏幕 px / SVG 用户单位，已含 UI zoom 与 viewBox→px 缩放，不能只传 zoom。 */
const DRAG_THRESHOLD_PX = 3;
/** 常驻锁定清单最多列出几条；hover title 里始终带完整长说明 */
const MAX_LOCK_ITEMS = 4;
/** F3-1：形状工具的最小拖拽距离（屏幕 px），低于此值视为误点 */
const SHAPE_THRESHOLD_PX = 3;
/** F3-3：框选的最小拖动距离；低于此值按「点空白清空选择」处理 */
const MARQUEE_THRESHOLD_PX = 3;
/** 空白画布的默认环境（空源码时先建环境，才能在 SVG 上取坐标） */
const BLANK_DIAGRAM = "\\begin{tikzpicture}\n  \n\\end{tikzpicture}";

/** F3-3：空白区拖出的框选手势（window 级监听靠 ref 读最新闭包）。 */
interface MarqueeDrag {
  startClient: PointLike;
  additive: boolean;
  baseSelection: string[];
  moved: boolean;
}

interface ToolDragState {
  tool: ToolMode;
  start: ShapePoint;
  current: ShapePoint;
  startClient: PointLike;
  shift: boolean;
  moved: boolean;
}

/** 插入后等待重渲染，再按 span 定位新语句的 id 自动选中。 */
interface PendingSelection {
  source: string;
  from: number;
  to: number;
}

/** window 级监听只注册一次，靠这个 ref 读最新的形状工具闭包（同 F2-1 的 commitDragRef 范式）。 */
interface ShapeApi {
  move: (e: PointerEvent) => void;
  up: () => void;
  /** 返回 true 表示该按键已被形状工具消费（Esc / Enter / Backspace） */
  key: (e: KeyboardEvent) => boolean;
  cancel: (silent?: boolean) => void;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

interface DragState {
  handleId: string;
  handle: TikzEditHandle;
  sourceAtStart: string;
  resultAtStart: TikzRender;
  startClient: PointLike;
  startWorld: PointLike;
  startSvg: PointLike;
  matrix: MatrixLike;
  marker: SVGCircleElement;
  /** F3-2：透明命中圈与视觉圆同步移动，避免拖拽时两者错位 */
  hitMarker: SVGCircleElement | null;
  guide: SVGLineElement | null;
  moved: boolean;
  newWorld: PointLike;
  /** F3-2 后续修复：最近一帧实时预览所用的候选源码 / 世界坐标 / 写回结果 */
  previewSource: string | null;
  previewWorld: PointLike | null;
  previewOutcome: DragEditOutcome | null;
  /** F3-3：非 null 表示本次是「拖组」整体平移（命中图元本体且多选 > 1） */
  groupIds: string[] | null;
  /** 拖组最后一帧的候选规划；松手复用它提交，保证看到的几何 == 写回的源码 */
  previewGroup: GroupMovePlan | null;
  /** 连续预览失败次数；超过阈值就停掉本手势的预览，避免每帧注定失败的重试 */
  previewFailures: number;
  /** F3-4：拖拽期间缓存的包围盒，用于智能参考线吸附（避免每帧重算） */
  snap: {
    selected: ElementBox[];
    others: ElementBox[];
    canvasCenter: PointLike;
    unitScale: number;
  } | null;
}

/** F3-4：旋转 / 缩放手势的状态（与坐标拖拽 DragState 平行，独立一路）。 */
interface TransformDrag {
  kind: "rotate" | "scale";
  corner: number;
  sourceAtStart: string;
  resultAtStart: TikzRender;
  startWorld: PointLike;
  /** 选中集合在 world 坐标下的联合包围盒（旋转 / 缩放数学用） */
  startBox: WorldBox;
  center: PointLike;
  value: number;
  compat: CompatReport | null;
  grouping: GroupingState;
  elementIds: string[];
  previewSource: string | null;
  previewFailures: number;
  /** F4-1：起手时的节点基准尺寸（world pt），优先读现有选项、否则用视觉外接框 */
  baseWidthPt: number;
  baseHeightPt: number;
  /** F4-1：非 Shift 尺寸路径最后一帧的值；null = 仍走 F3-4 的 scale= */
  sizeValues: SizeValues | null;
}

interface Notice {
  tone: "ok" | "warn" | "err";
  text: string;
}

/** F4-3：双击节点就地编辑的会话态；只存 id + 草稿，提交时才按当时 source 重算 span。 */
interface NodeTextEditState {
  nodeTextId: string;
  statementId: string;
  text: string;
  left: number;
  top: number;
  width: number;
}

/** window 级监听只注册一次，实时预览的闭包靠这个 ref 取最新值（同 shapeApiRef 范式）。 */
interface PreviewApi {
  schedule: (d: DragState) => void;
  /** 停止排帧但保留预览几何（提交成功后等重渲染自然替换） */
  deactivate: () => void;
  /** 取消 / 失败时把基准几何与控制点位置还原 */
  restore: () => void;
}

export function DiagramCanvas() {
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const setPreviewMode = useDiagramStore((s) => s.setPreviewMode);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const setSelectedId = useDiagramStore((s) => s.setSelectedId);
  // F3-3：多选 / 分组 / 主动隐藏锁定
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const setSelectedIds = useDiagramStore((s) => s.setSelectedIds);
  const grouping = useDiagramStore((s) => s.grouping);
  const setGrouping = useDiagramStore((s) => s.setGrouping);
  const pruneGroupingTo = useDiagramStore((s) => s.pruneGroupingTo);
  // F3-4：智能参考线（会话态）。订阅以便 setGuides 触发画布重绘并落参考线。
  const guides = useDiagramStore((s) => s.guides);
  const setGuides = useDiagramStore((s) => s.setGuides);
  // F3-5：网格 + 标尺显隐（挂载 effect 里重建，故需订阅其值）。
  const gridEnabled = useDiagramStore((s) => s.gridEnabled);
  // F3-7：画布尺寸 / 导出开关是配置（持久化）；viewport 只留组件 state，刷新即重置。
  const canvasSize = useDiagramStore((s) => s.canvasSize);
  const canvasSizeAuto = useDiagramStore((s) => s.canvasSizeAuto);
  const setCanvasSizeFromDocument = useDiagramStore((s) => s.setCanvasSizeFromDocument);
  const exportUseCanvas = useDiagramStore((s) => s.exportUseCanvas);
  const setRenderMeta = useDiagramStore((s) => s.setRenderMeta);
  const activePath = useBuffersStore((s) => s.activePath);
  const tabVisible = activePath === DIAGRAM_PATH;

  const [result, setResult] = useState<TikzRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  // F3-7：视角 state（不持久化）。zoom 派生自它，既有渲染 / 预览链路零改动。
  const [viewport, setViewport] = useState<Viewport>({ ...DEFAULT_VIEWPORT });
  const zoom = viewport.zoom;
  const [handTool, setHandTool] = useState(false);
  const [pointerWorldLabel, setPointerWorldLabel] = useState("—");
  // null = 跟随默认（有覆盖缺口就自动展开）；true/false = 用户手动展开/收起
  const [diagOpen, setDiagOpen] = useState<boolean | null>(null);
  const [precise, setPrecise] = useState<TikzPreviewResult | null>(null);
  const [preciseBusy, setPreciseBusy] = useState(false);
  const [handlesOn, setHandlesOn] = useState(true);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // F4-3：双击节点就地编辑文字 / 公式（本地即时通道专属，精确通道只读）
  const [nodeTextEdit, setNodeTextEdit] = useState<NodeTextEditState | null>(null);
  // Esc 取消时先标记，避免卸载 input 触发的 blur 又把草稿提交回去
  const nodeTextCancelRef = useRef(false);
  // F2-3 锁定清单：默认展开且常驻，不做「只有一个折叠按钮」的死 UI
  const [lockOpen, setLockOpen] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // F3-7 手势：空格 / 抓手 / 中键平移，靠 ref 让只注册一次的 window 监听读到最新值。
  const spaceRef = useRef(false);
  const handRef = useRef(false);
  const panRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  // F3-7：zoom → SVG width/height 百分比的换算结果（依赖 stage 尺寸，供事件 / 预览读取）。
  const renderPctRef = useRef(1);
  // 视角初始化：画布尺寸变化（含首次拿到纸张）时按「整页居中」重置一次；
  // 之后用户手动 pan / zoom 一律不再覆盖（zoom 变化不会重复触发，见 mount effect）。
  const fitKeyRef = useRef("");
  const lastPointerLabelRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  // F3-3：框选手势 + 屏幕矩形（position:fixed 直接用 client 坐标，无需再减容器偏移）
  const marqueeRef = useRef<MarqueeDrag | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeBox | null>(null);
  // pointerdown 的 client 坐标要传给 window 级监听，用 ref 中转（避免闭包捕获旧事件对象）
  const lastPointer = useRef<PointLike>({ x: 0, y: 0 }).current;
  // window 级 pointer 监听只注册一次，靠 ref 读最新状态，避免反复解绑/重绑
  const sourceRef = useRef(source);
  sourceRef.current = source;
  // F2-4：window 级 keydown 只注册一次，Tab 激活态靠 ref 读最新值，避免反复解绑
  const tabVisibleRef = useRef(tabVisible);
  tabVisibleRef.current = tabVisible;
  const resultRef = useRef(result);
  resultRef.current = result;
  const commitDragRef = useRef<(d: DragState) => void>(() => undefined);
  // F3-4：旋转 / 缩放手势独立一路，不占用坐标拖拽的 dragRef。
  const transformRef = useRef<TransformDrag | null>(null);
  // F4-1：refreshSelectionChrome 算出的视觉外接框（world pt），供尺寸柄起手读基准 W/H。
  const selectionBoxWorldRef = useRef<WorldBox | null>(null);
  // F3-4：setGuides 仅在参考线集合变化时触发重绘（避免每帧重渲染）。
  const lastGuideKeyRef = useRef<string>("");
  function setDragGuides(g: GuideLine[]): void {
    const key = g
      .map((x) => `${x.axis}:${x.kind}:${Math.round(x.at * 100) / 100}`)
      .join("|");
    if (key === lastGuideKeyRef.current) return;
    lastGuideKeyRef.current = key;
    setGuides(g);
  }
  // F3-1：形状工具状态。会话 / 拖拽只留在本组件，不写进 store（不是跨组件共享数据）。
  const toolMode = useDiagramStore((s) => s.toolMode);
  const setToolMode = useDiagramStore((s) => s.setToolMode);
  const [sessionHint, setSessionHint] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const shapeSessionRef = useRef<ShapeSession | null>(null);
  const toolDragRef = useRef<ToolDragState | null>(null);
  const shapeSeqRef = useRef(0);
  const shapeApiRef = useRef<ShapeApi>({
    move: () => undefined,
    up: () => undefined,
    key: () => false,
    cancel: () => undefined,
  });
  // F3-2 后续修复：拖拽实时预览（不写源码、不进撤销栈）。rAF 单帧节流 + 在途守卫，
  // 一帧只跑一次「候选源码 → 候选 SVG → 换几何」，指针跑得比渲染快就只保留最新坐标。
  const previewApiRef = useRef<PreviewApi>({
    schedule: () => undefined,
    deactivate: () => undefined,
    restore: () => undefined,
  });
  const previewFrameRef = useRef<number | null>(null);
  const previewBusyRef = useRef(false);
  const previewActiveRef = useRef(false);
  const previewBaseRef = useRef<DragState | null>(null);
  // F3-2：控制点档位（localStorage 偏好）× 实测单位比 → 一组真正恒屏的尺寸。
  // unitScale 不能写成 zoom：SVG 的 viewBox 会按 width:100% 铺进画布，默认示例
  // 124 单位 ≈ 400px，漏掉这层比例会让 3.3px 的手柄显示成 21px 直径。
  const handleSize = useDiagramStore((s) => s.handleSize);
  const setHandleSize = useDiagramStore((s) => s.setHandleSize);
  const [unitScale, setUnitScale] = useState(1);
  const unitScaleRef = useRef(1);
  const metrics = useMemo(() => handleMetrics(handleSize, unitScale), [handleSize, unitScale]);

  const empty = source.trim().length === 0;

  // 预热：3.39MB 的动态 chunk 在打开 Tab 时就开始拉，不等第一次敲键盘
  useEffect(() => {
    let alive = true;
    preloadTikzEngine().then(
      () => {
        if (alive) setEngineReady(true);
      },
      (err: unknown) => {
        if (alive) setError(`渲染引擎加载失败：${errorText(err)}`);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // 本地通道：source 变化 → debounce → 渲染。旧请求用 cancelled 标志丢弃。
  // 精确模式下也保持结果最新（引擎有 LRU 缓存，开销极小），切回本地可立即出图。
  useEffect(() => {
    if (empty) {
      setResult(null);
      setError(null);
      setBusy(false);
      setRenderMeta(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      renderTikz(source).then(
        async (r) => {
          if (cancelled) return;
          // F4-2：MathJax 公式增强只改预览 SVG 字符串，绝不写 source。
          // 放在 sanitizeSvg 之前合成 → 沿用既有消毒 / 注入 / 唯一真源管线，
          // cancelled 与本地渲染共用：源码在 await 期间变化则整帧丢弃，不覆盖新几何。
          // 无 `$` 时零调用（纯视觉增强不拖慢无公式的图）。
          let svg = r.svg;
          if (svg.includes("$")) {
            try {
              const boost = await enhanceDiagramMath(svg);
              if (cancelled) return;
              if (boost.enhanced > 0) svg = boost.svg;
            } catch {
              // MathJax 不可用 → 保留引擎原文（$...$ 字面量），不白屏、不报错中断渲染。
            }
          }
          if (cancelled) return;
          setResult({ ...r, svg });
          setError(null);
          setBusy(false);
          setRenderMeta({ source, statements: r.statements, compat: r.compat });
          // F3-3：源码换图 / 撤销后按最新语句 id 裁剪失效分组与多选，避免悬空引用。
          pruneGroupingTo(r.statements.map((s) => s.id));
        },
        (err: unknown) => {
          if (cancelled) return;
          setError(errorText(err));
          setResult(null);
          setBusy(false);
          setRenderMeta(null);
        },
      );
    }, LOCAL_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, empty]);

  // F3-7：开关关闭时传 undefined → 缓存 key / Rust 派生片段与 F1-6 逐字节一致。
  const canvasPt = canvasSizeToPt(canvasSize);
  const previewCanvasArg =
    exportUseCanvas && canvasSize.preset !== "auto"
      ? { widthPt: canvasPt.widthPt, heightPt: canvasPt.heightPt, useCanvas: true }
      : undefined;

  // F3-7：默认画布尺寸从主文档推断（正文宽），用户手改后不再覆盖；换目标文档重新推断。
  useEffect(() => {
    if (!canvasSizeAuto || !targetTex) return;
    const doc = getEditorView(targetTex)?.state.doc.toString() ?? "";
    if (!doc) return;
    const paper = inferDocumentPaper(doc);
    setCanvasSizeFromDocument({
      preset: paper.preset,
      widthCm: paper.widthCm,
      heightCm: paper.heightCm,
    });
  }, [targetTex, canvasSizeAuto, setCanvasSizeFromDocument]);

  // 精确通道：只在 Tab 激活 + 精确模式 + 有源码时编译。
  // 缓存命中直接出图；同 key 并发由 precisePreview 单飞；旧结果用 cancelled 丢弃。
  useEffect(() => {
    if (previewMode !== "precise" || empty || !tabVisible) {
      setPreciseBusy(false);
      return;
    }
    const engine = useSettingsStore.getState().settings.build.engine;
    const hit = getCachedPreview(previewKey(source, engine, previewCanvasArg));
    if (hit) {
      setPrecise(hit);
      setPreciseBusy(false);
      return;
    }
    let cancelled = false;
    setPreciseBusy(true);
    const timer = window.setTimeout(() => {
      requestPrecisePreview(source, engine, false, previewCanvasArg).then((r) => {
        if (cancelled) return;
        setPrecise(r);
        setPreciseBusy(false);
      });
    }, PRECISE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, empty, previewMode, tabVisible, exportUseCanvas, canvasSize]);

  // 手动重编译：跳过 800ms debounce 与成功缓存，立即用当前源码跑一次 XeLaTeX。
  // 主要解决「刚改完源码但看到的还是上一次结果」时无法强制刷新的问题。
  const recompilePrecise = async () => {
    if (empty || preciseBusy) return;
    const engine = useSettingsStore.getState().settings.build.engine;
    setPreciseBusy(true);
    try {
      const r = await requestPrecisePreview(source, engine, true, previewCanvasArg);
      setPrecise(r);
    } finally {
      setPreciseBusy(false);
    }
  };

  // F3-7：滚轮以指针为锚点连续缩放。挂在 canvas body（双通道共用），
  // {passive:false} 才能阻止页面滚动；源码栏 / 输入控件 / 手势中不抢事件。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (e: WheelEvent) => {
      if (!tabVisibleRef.current || !e.deltaY) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest(".cm-editor, input, textarea, [contenteditable]")) return;
      if (dragRef.current || marqueeRef.current || transformRef.current ||
          shapeSessionRef.current || toolDragRef.current || panRef.current) return;
      e.preventDefault();
      const rect = body.getBoundingClientRect();
      setViewport(zoomStep(
        viewportRef.current,
        e.deltaY,
        { x: e.clientX, y: e.clientY },
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      ));
    };
    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
  }, []);

  // F3-7：空格键按下期间临时切抓手。先过焦点守卫，绝不抢源码栏 / 输入框的空格。
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !tabVisibleRef.current) return;
      const el = e.target instanceof Element ? e.target : document.activeElement;
      if (!(el instanceof Element) ||
          el.closest(".cm-editor, input, textarea, [contenteditable], .modal-layer, [role=\"dialog\"]")) return;
      spaceRef.current = true;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    const blur = () => { spaceRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      spaceRef.current = false;
    };
  }, []);

  // 消毒后挂载本地 SVG。精确模式下清空 stage（改由 <img> 显示，不内联注入）。
  // 每次重建都丢弃旧拖拽持有的 DOM 引用，避免把位移写到已被替换的控制点上。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    dragRef.current = null;
    // 新的渲染结果会整棵替换 SVG：停掉在途的实时预览，避免异步回调把旧几何写回新画布。
    previewApiRef.current.deactivate();
    setDragLabel(null);
    if (!result || previewMode === "precise") {
      stage.replaceChildren();
      return;
    }
    // F3-7：固定画布时 zoom=1 表示「整张纸完整可见」，需换算成 SVG 的 width/height 百分比；
    // auto 时 renderPct 退回 zoom（与 F1-6 一致）。
    const paper = canvasPaperRect(canvasSize, result.viewBox);
    const stageRect = stage.getBoundingClientRect();
    const pct = renderScale(zoom, stageRect, result.viewBox, paper);
    renderPctRef.current = pct;
    const node = sanitizeSvg(result.svg, result.viewBox, pct);
    if (!node) {
      stage.replaceChildren();
      setError("引擎返回的 SVG 无法解析，已阻止注入画布。");
      return;
    }
    // F3-2：辅助层的「屏幕 px」要换算成 SVG 用户单位，必须先挂到 DOM 才能用
    // getScreenCTM() 量出真实单位比（viewBox→CSS px 的缩放不等于 UI zoom）。
    stage.replaceChildren(node);
    const scale = svgUnitScale(node, result.viewBox, pct, stageRect);
    if (Math.abs(scale - unitScaleRef.current) > 1e-6) {
      unitScaleRef.current = scale;
      setUnitScale(scale);
    }
    // 首帧就用实测值建层，不等 setState 的重渲染，避免「先大后小」闪一下。
    const m = handleMetrics(handleSize, scale);
    // F3-7：固定画布 = SVG 内的纸张辅助层（几何底部、pointer-events:none）。
    // 矩形按 world 0..W / 0..H 经与 worldToSvgPoint 同式换算；viewBox 保持引擎值不动。
    if (paper) {
      // 纸张框通常大于引擎包围盒（A4 正文 426×702pt vs 默认图 110×82pt），
      // 根 SVG 默认 overflow:hidden 会把它裁掉 → 只允许这一层溢出，viewBox 仍不动。
      node.style.overflow = "visible";
      const layer = document.createElementNS(SVG_NS, "g");
      layer.setAttribute("data-dg-paper", "1");
      layer.setAttribute("pointer-events", "none");
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("class", "dg-paper-rect");
      rect.setAttribute("x", String(paper.x));
      rect.setAttribute("y", String(paper.y));
      rect.setAttribute("width", String(paper.width));
      rect.setAttribute("height", String(paper.height));
      layer.appendChild(rect);
      node.insertBefore(layer, node.firstChild);
    }
    // 先挂选中层（在控制点层之下），再挂控制点层。两层都只用 createElementNS
    // 追加到已消毒 SVG 之后；精确通道走 <img>，这里不会执行到。
    createSelectionLayer(node);
    // F3-4：参考线层 + 变换柄层（永远在几何之上，拖拽实时预览换几何时一起保留）。
    createGuideLayer(node);
    createTransformLayer(node);
    // F3-5：网格（底层，插到几何之前）+ 标尺（顶层）。仅开启时挂载，避免无谓 DOM。
    if (gridEnabled) {
      drawGrid(createGridLayer(node), result.viewBox, m);
      drawRuler(createRulerLayer(node), result.viewBox, m);
    }
    // F3-1：形状工具模式下不挂控制点，避免小圆点挡住起笔 / 抢 pointerdown。
    if (handlesOn && toolMode === "select" && result.handles.length > 0) {
      buildHandleLayer(node, result.handles, result.viewBox, result.compat, m);
    }
    // 纸张尺寸变化（首帧拿到画布 / 用户改尺寸）→ 整页居中重置一次；
    // 只在 key 变化时触发，所以缩放 / 拖拽不会被反复拉回。
    const fitKey = `${canvasSize.preset}:${canvasSize.widthCm}x${canvasSize.heightCm}:${paper ? 1 : 0}`;
    if (paper && fitKey !== fitKeyRef.current && stageRect.width > 0 && stageRect.height > 0) {
      fitKeyRef.current = fitKey;
      setViewport(fitCanvasViewport(stageRect, result.viewBox, paper));
    }
  }, [result, zoom, previewMode, handlesOn, toolMode, handleSize, unitScale, gridEnabled, canvasSize]);

  // 侧栏伸缩 / 分屏切换 / 窗口 resize 会改变 viewBox→px 的比例，也改变「整张纸适配窗口」
  // 的换算基准（renderScale）。这里只更新 SVG 的 width/height 属性并重测 unitScale，
  // 不重建 DOM（重建会让辅助层闪一下）；辅助层在 SVG 用户坐标里，自动跟随新尺寸。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const svg = stage.querySelector("svg") as SVGSVGElement | null;
      const res = resultRef.current;
      if (!svg || !res || previewMode === "precise") return;
      const rect = stage.getBoundingClientRect();
      const paper = canvasPaperRect(canvasSize, res.viewBox);
      const pct = renderScale(viewportRef.current.zoom, rect, res.viewBox, paper);
      renderPctRef.current = pct;
      const attr = `${Math.round(pct * 100)}%`;
      svg.setAttribute("width", attr);
      svg.setAttribute("height", attr);
      const scale = svgUnitScale(svg, res.viewBox, pct, rect);
      if (Math.abs(scale - unitScaleRef.current) > 1e-6) {
        unitScaleRef.current = scale;
        setUnitScale(scale);
      }
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [previewMode, canvasSize]);

  /**
   * F2-2 选中高亮 + F3-2 选中包围盒。抽成函数是为了让「实时预览换几何」也能复用：
   * 候选几何是全新的 DOM 节点，必须重新贴一次 dg-selected / is-selected 并重画虚线框，
   * 否则拖着拖着高亮和包围盒会留在旧位置。只改辅助层，不重建主 SVG、不打断拖拽。
   * 包围盒用 getBoundingClientRect()（屏幕像素，天然含 transform）经 getScreenCTM()
   * 完整仿射逆回到 SVG 用户坐标；零尺寸矩形跳过，避免把 (0,0) 并进来。
   */
  function refreshSelectionChrome(): void {
    const stage = stageRef.current;
    if (!stage || previewMode !== "local") return;
    const svg = stage.querySelector("svg") as SVGSVGElement | null;
    // F3-3：多选集合是唯一口径；selectedId 始终等于它的首项（属性面板零改动）。
    const picked = new Set(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []);
    const state = useDiagramStore.getState().grouping as GroupingState;
    const hidden = new Set<string>();
    for (const el of Array.from(stage.querySelectorAll("[data-source-id]"))) {
      const id = el.getAttribute("data-source-id") ?? "";
      if (id && !hidden.has(id) && isManuallyHidden(state, id)) hidden.add(id);
    }
    for (const el of Array.from(stage.querySelectorAll("[data-source-id]"))) {
      el.classList.toggle("dg-selected", picked.has(el.getAttribute("data-source-id") ?? ""));
    }
    for (const node of Array.from(stage.querySelectorAll("g.dg-handle-node"))) {
      node.classList.toggle(
        "is-selected",
        picked.has(node.getAttribute("data-dg-source-id") ?? ""),
      );
    }
    if (!svg) return;
    // 隐藏只切 class：源码仍在，切回可见再调一次即可（F3-3 主动隐藏）。
    applyLayerVisibility(svg, hidden);
    const layer = svg.querySelector("[data-dg-selection-layer]") as SVGGElement | null;
    if (!layer) return;
    // 多选虚线框 = 所有选中图元包围盒的并集，同时也是虚拟分组的淡色外框。
    const editable =
      previewMode === "local" && handlesOn && toolMode === "select" && picked.size > 0;
    const ctm = editable ? svg.getScreenCTM?.() : null;
    if (!ctm) {
      selectionBoxWorldRef.current = null;
      drawSelectionBox(layer, null, metrics);
      return;
    }
    const m: AffineMatrix = {
      a: ctm.a,
      b: ctm.b,
      c: ctm.c,
      d: ctm.d,
      e: ctm.e,
      f: ctm.f,
    };
    const boxes = Array.from(stage.querySelectorAll("[data-source-id]"))
      .filter((el) => picked.has(el.getAttribute("data-source-id") ?? ""))
      .filter((el) => !hidden.has(el.getAttribute("data-source-id") ?? ""))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => !(r.width === 0 && r.height === 0))
      .map((r) => clientRectToSvgBox(r, m));
    const selBox = unionBoxes(boxes);
    // F4-1：视觉外接框翻回 world，统一 8 点尺寸柄与 collectElementBoxes 两套包围盒口径。
    const vb = resultRef.current?.viewBox;
    selectionBoxWorldRef.current = selBox && vb
      ? svgBoxToWorldBox(
          {
            minX: selBox.x,
            minY: selBox.y,
            maxX: selBox.x + selBox.width,
            maxY: selBox.y + selBox.height,
          },
          vb,
        )
      : null;
    drawSelectionBox(layer, selBox, metrics);
    // F3-4：参考线层从 store 读取（拖拽吸附 / 对齐 / 分布后短暂显示）。
    const guideLayer = svg.querySelector("[data-dg-guide-layer]") as SVGGElement | null;
    drawGuides(guideLayer, useDiagramStore.getState().guides, resultRef.current?.viewBox ?? null);
    // F3-4：在选中包围盒上画旋转 / 缩放柄（仅本地 + 选择工具 + 有选中项）。
    const transformLayer = svg.querySelector("[data-dg-transform-layer]") as SVGGElement | null;
    if (editable && selBox) {
      drawTransformHandles(
        transformLayer,
        {
          minX: selBox.x,
          minY: selBox.y,
          maxX: selBox.x + selBox.width,
          maxY: selBox.y + selBox.height,
        },
        metrics,
      );
    } else {
      drawTransformHandles(transformLayer, null, metrics);
    }
  }

  useEffect(() => {
    refreshSelectionChrome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedIds, grouping, result, zoom, previewMode, handlesOn, toolMode, metrics, guides]);

  // ── F3-2 后续修复：拖命中圈 → 实时几何预览（不写源码、不进撤销栈） ──────────
  // 命中圈只是 TikZ 句柄的交互代理：每一帧仍用同一份 applyEditIntent 从「基准源码 +
  // 基准句柄」算出候选源码，再 renderTikz 出候选 SVG。根 SVG 的 viewBox 保持基准值，
  // 只换几何子节点并做 Y 基准差补偿（dragPreview.ts），所以画布不跳、控制点引用不丢。
  function cancelPreviewFrame(): void {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
  }

  /** 把基准几何 / 控制点 / 选中框还原（Esc、pointercancel、提交失败时用）。 */
  function restorePreviewGeometry(): void {
    const svg = stageSvg();
    const base = previewBaseRef.current;
    if (!svg || !base || !isPreviewActive(svg)) return;
    const vb = base.resultAtStart.viewBox;
    const ok = applyPreviewGeometry(svg, {
      markup: base.resultAtStart.svg,
      baseViewBox: vb,
      candidateViewBox: vb,
      zoom: renderPctRef.current,
      live: false,
    });
    if (!ok) return;
    const layer = svg.querySelector("[data-dg-handle-layer]") as SVGGElement | null;
    if (layer) updateHandleLayerPositions(layer, base.resultAtStart.handles, vb, metrics);
    base.marker.classList.remove("is-active");
    base.marker.setAttribute("cx", fmtNum(base.startSvg.x));
    base.marker.setAttribute("cy", fmtNum(base.startSvg.y));
    base.hitMarker?.setAttribute("cx", fmtNum(base.startSvg.x));
    base.hitMarker?.setAttribute("cy", fmtNum(base.startSvg.y));
    if (base.guide) base.guide.setAttribute("visibility", "hidden");
    refreshSelectionChrome();
  }

  function deactivatePreview(): void {
    cancelPreviewFrame();
    previewActiveRef.current = false;
  }

  function cancelAndRestorePreview(): void {
    cancelPreviewFrame();
    previewActiveRef.current = false;
    restorePreviewGeometry();
    previewBaseRef.current = null;
  }

  function schedulePreview(d: DragState): void {
    if (!previewActiveRef.current || dragRef.current !== d) return;
    if (previewFrameRef.current !== null || previewBusyRef.current) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      void runPreview(d);
    });
  }

  /** 连续 3 帧失败就停掉本手势的预览（上游对该句柄不支持是确定性的，重试没意义）。 */
  function notePreviewFailure(d: DragState): void {
    d.previewFailures += 1;
    if (d.previewFailures >= 3) previewActiveRef.current = false;
  }

  async function runPreview(d: DragState): Promise<void> {
    if (!previewActiveRef.current || dragRef.current !== d) return;
    previewBusyRef.current = true;
    const world = { x: d.newWorld.x, y: d.newWorld.y };
    try {
      // F3-3：拖组与单控制点拖拽共用同一条实时预览链路，只是候选源码的算不同：
      // 单句柄 → applyDragEdit；多选整体平移 → applyGroupEdit（多个最小补丁合并）。
      let newSource: string;
      if (d.groupIds) {
        const plan = await applyGroupEdit({
          source: d.sourceAtStart,
          handles: d.resultAtStart.handles,
          elementIds: d.groupIds,
          delta: { x: world.x - d.startWorld.x, y: world.y - d.startWorld.y },
          compat: d.resultAtStart.compat,
          grouping: useDiagramStore.getState().grouping,
        });
        if (!previewActiveRef.current || dragRef.current !== d) return;
        d.previewGroup = plan;
        d.previewOutcome = null;
        // 上游不支持 / 补丁冲突时不打断拖拽，松手由 commit 给出明确理由。
        if (plan.status !== "ok") {
          notePreviewFailure(d);
          d.previewWorld = world;
          return;
        }
        newSource = plan.nextSource;
      } else {
        const outcome = await applyDragEdit(
          d.sourceAtStart,
          d.resultAtStart.handles,
          d.handleId,
          world,
        );
        if (!previewActiveRef.current || dragRef.current !== d) return;
        if (outcome.status !== "ok") {
          notePreviewFailure(d);
          return;
        }
        d.previewOutcome = outcome;
        d.previewGroup = null;
        newSource = outcome.newSource;
      }
      if (!shouldRenderPreview(d.previewSource, newSource, d.sourceAtStart)) {
        // 源码没变（上游坐标量化）：几何已经正确，只记下这一帧的世界坐标供提交复用。
        d.previewWorld = world;
        return;
      }
      const candidate = await renderTikz(newSource);
      if (!previewActiveRef.current || dragRef.current !== d) return;
      const svg = stageSvg();
      if (!svg) {
        notePreviewFailure(d);
        return;
      }
      const changed = applyPreviewGeometry(svg, {
        markup: candidate.svg,
        baseViewBox: d.resultAtStart.viewBox,
        candidateViewBox: candidate.viewBox,
        zoom: renderPctRef.current,
        live: true,
      });
      if (!changed) {
        notePreviewFailure(d);
        return;
      }
      const layer = svg.querySelector("[data-dg-handle-layer]") as SVGGElement | null;
      if (layer) {
        // 活动控制点继续跟指针；其余控制点 / 挂锁跟着候选几何一起挪。
        updateHandleLayerPositions(
          layer,
          candidate.handles,
          d.resultAtStart.viewBox,
          metrics,
          d.handleId,
        );
      }
      refreshSelectionChrome();
      d.previewSource = newSource;
      d.previewWorld = world;
      d.previewFailures = 0;
    } catch (err) {
      // 单帧预览失败不阻断拖拽：松手仍走原写回路径。不弹提示条，避免一帧一次刷屏。
      notePreviewFailure(d);
      console.warn("[diagram] 实时预览渲染失败：", errorText(err));
    } finally {
      previewBusyRef.current = false;
      // 失败路径也记下这一帧的坐标：否则 previewWorld 一直是 null，会在拖拽期间
      // 每帧重试一次注定失败的渲染（上游不支持 / 引擎报错 / 消毒失败）。
      if (!d.previewWorld) d.previewWorld = world;
      // 指针跑得比渲染快时，用最新坐标再排一帧；相同坐标不重排，避免空转。
      if (
        previewActiveRef.current &&
        dragRef.current === d &&
        (Math.abs(d.previewWorld.x - d.newWorld.x) > 1e-6 ||
          Math.abs(d.previewWorld.y - d.newWorld.y) > 1e-6)
      ) {
        schedulePreview(d);
      }
    }
  }

  previewApiRef.current = {
    schedule: schedulePreview,
    deactivate: deactivatePreview,
    restore: cancelAndRestorePreview,
  };

  // 每次拿到新结果都回到「自动」模式，避免上一次手动收起延续到下一张图
  useEffect(() => {
    setDiagOpen(null);
  }, [result]);

  // F3-1：插入形状 → 源码变化 → debounce → renderTikz → 这里才会拿到与新源码同批的
  // statements。用 renderMeta.source 校验，绝不在 debounce 期间拿旧图元的 span 误选中。
  useEffect(() => {
    if (!pendingSelection || !result) return;
    const meta = useDiagramStore.getState().renderMeta;
    if (!meta || meta.source !== pendingSelection.source) {
      if (error) setPendingSelection(null); // 新语句导致渲染失败：放弃自动选中
      return;
    }
    const id = pickInsertedStatementId(meta.statements, {
      from: pendingSelection.from,
      to: pendingSelection.to,
    });
    if (id) setSelectedId(id);
    setPendingSelection(null);
  }, [result, pendingSelection, error, setSelectedId]);

  // F3-1：换工具 / 切预览通道时取消未完成的绘制会话（精确通道全程只读）。
  // F3-3：同时丢掉进行中的框选，避免切通道后残留一个 fixed 选区矩形。
  useEffect(() => {
    shapeApiRef.current.cancel(true);
    marqueeRef.current = null;
    setMarqueeRect(null);
  }, [toolMode, previewMode]);

  // 拖拽提交：只算一次新源码，再以最小 span 补丁写回 CM6（F2-1 与键盘编辑同撤销栈）。
  // F2-4：同一控制点的连续微调并入一组 history，一次 Ctrl+Z 回到这一串调整之前。
  // F3-2 后续修复：若最后一帧实时预览与松手坐标一致，直接复用它的写回结果 ——
  // 保证「眼睛看到的几何」和「真正提交的源码」是同一份，不会在松手瞬间跳一下。
  commitDragRef.current = (d: DragState) => {
    // 停止排帧但保留预览几何；160ms 后重渲染会整棵替换，期间不留视觉空档。
    previewApiRef.current.deactivate();
    const src = sourceRef.current;
    const res = resultRef.current;
    if (!res || src !== d.sourceAtStart || res !== d.resultAtStart) {
      previewApiRef.current.restore();
      setNotice({ tone: "warn", text: "源码在拖拽期间发生变化，请重新拖动。" });
      return;
    }
    const lastFrameMatches =
      !!d.previewWorld &&
      Math.abs(d.previewWorld.x - d.newWorld.x) < 1e-9 &&
      Math.abs(d.previewWorld.y - d.newWorld.y) < 1e-9;

    // F3-3：拖组走多段补丁一次 dispatch（一条 history = 一次 Ctrl+Z 退整组）。
    // 复用最后一帧的规划，保证「眼睛看到的几何」和「真正写回的源码」完全一致。
    if (d.groupIds) {
      const plan =
        d.previewGroup && lastFrameMatches && d.previewGroup.status === "ok"
          ? Promise.resolve(d.previewGroup)
          : applyGroupEdit({
              source: src,
              handles: res.handles,
              elementIds: d.groupIds,
              delta: { x: d.newWorld.x - d.startWorld.x, y: d.newWorld.y - d.startWorld.y },
              compat: res.compat,
              grouping: useDiagramStore.getState().grouping,
            });
      void plan.then((p) => {
        if (p.status !== "ok") {
          previewApiRef.current.restore();
          setNotice({ tone: "warn", text: `无法整体移动：${p.reason}` });
          return;
        }
        const write = commitDiagramPatches({
          patches: p.patches,
          source: src,
          nextSource: p.nextSource,
          fallback: setSource,
        });
        const skipped =
          p.skipped.length > 0
            ? ` · ${p.skipped.length} 个跳过（${p.skipped[0].id}：${p.skipped[0].reason}）`
            : "";
        setNotice({
          tone: write.written ? "ok" : "warn",
          text: `已整体移动 ${p.movedElements.length} 个图元${skipped}${
            write.written ? " · Ctrl+Z 一次退回整组" : " · 源码栏未就绪，无撤销记录"
          }`,
        });
      });
      return;
    }

    const reused =
      d.previewOutcome && lastFrameMatches ? d.previewOutcome : null;
    const pending = reused
      ? Promise.resolve(reused)
      : applyDragEdit(src, res.handles, d.handleId, d.newWorld);
    void pending.then((outcome) => {
      if (outcome.status !== "ok") {
        previewApiRef.current.restore();
        setNotice(
          outcome.status === "unsupported"
            ? { tone: "warn", text: `无法写回：${outcome.reason}` }
            : { tone: "err", text: `写回失败：${outcome.message}` },
        );
        return;
      }
      if (outcome.newSource === src) {
        previewApiRef.current.restore();
        setNotice({ tone: "warn", text: "位移太小，坐标未变化。" });
        return;
      }
      const write = commitDiagramPatch({
        key: `drag:${d.handleId}`,
        source: src,
        nextSource: outcome.newSource,
        fallback: (s) => setSource(s), // 降级：功能不丢，但无 CM6 撤销记录
      });
      const from = d.handle.sourceText ?? "";
      const to = outcome.replacement ?? "新坐标";
      const suffix = write.written
        ? write.merged
          ? " · 连续微调已并组，Ctrl+Z 撤回整组"
          : " · Ctrl+Z 可撤销"
        : " · 源码栏未就绪，无撤销记录";
      setNotice({
        tone: write.written ? "ok" : "warn",
        text:
          from && from !== to ? `已写回 ${from} → ${to}${suffix}` : `坐标已写回${suffix}`,
      });
    });
  };

  // ── F3-1 形状工具：坐标反算 / 预览层 / 会话状态机 / 写回 ──────────────────
  function stageSvg(): SVGSVGElement | null {
    return (stageRef.current?.querySelector("svg") as SVGSVGElement | null) ?? null;
  }

  /** 屏幕绝对点 → SVG 用户单位（完整仿射逆，含 e/f）→ world pt（Y 翻转）。 */
  function pointerWorld(clientX: number, clientY: number): ShapePoint | null {
    const svg = stageSvg();
    const res = resultRef.current;
    if (!svg || !res) return null;
    const ctm = svg.getScreenCTM?.();
    if (!ctm) return null;
    const m: AffineMatrix = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f };
    const p = clientToSvgPoint(m, clientX, clientY);
    return p ? svgToWorldPoint(p, res.viewBox) : null;
  }

  function clearShapePreview(): void {
    stageSvg()?.querySelector("[data-dg-shape-preview]")?.remove();
  }

  /** 预览层一律用 createElementNS 追加到**已消毒**的 SVG 之后，绝不拼 innerHTML。 */
  function ensurePreviewLayer(svg: SVGSVGElement): SVGGElement {
    const found = svg.querySelector("[data-dg-shape-preview]") as SVGGElement | null;
    if (found) return found;
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", "dg-shape-preview");
    layer.setAttribute("data-dg-shape-preview", "1");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "dg-shape-preview-path");
    const ellipse = document.createElementNS(SVG_NS, "ellipse");
    ellipse.setAttribute("class", "dg-shape-preview-ellipse");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("class", "dg-shape-preview-dot");
    for (const el of [path, ellipse, dot]) el.setAttribute("visibility", "hidden");
    layer.append(path, ellipse, dot);
    svg.appendChild(layer);
    applyPreviewMetrics(layer);
    return layer;
  }

  /** 预览线宽 / 虚线同样按实测单位比换算；缩放或窗口 resize 后每次绘制都刷新。 */
  function applyPreviewMetrics(layer: SVGGElement): void {
    const s = metrics.unitScale;
    for (const el of Array.from(layer.children)) {
      el.setAttribute("stroke-width", fmtNum(1.4 / s));
      el.setAttribute("stroke-dasharray", fmtNum(4 / s));
    }
  }

  /** 只更新属性、不重建 SVG，避免打断 F2-1 拖拽 / 反复触发渲染。 */
  function drawShapePreview(
    tool: ToolMode,
    points: readonly ShapePoint[],
    shift: boolean,
    hover: ShapePoint | null,
  ): void {
    const svg = stageSvg();
    const res = resultRef.current;
    if (!svg || !res || points.length === 0) return;
    const layer = ensurePreviewLayer(svg);
    applyPreviewMetrics(layer);
    const pathEl = layer.querySelector(".dg-shape-preview-path") as SVGPathElement | null;
    const ellipseEl = layer.querySelector(".dg-shape-preview-ellipse") as SVGEllipseElement | null;
    const dotEl = layer.querySelector(".dg-shape-preview-dot") as SVGCircleElement | null;
    if (!pathEl || !ellipseEl || !dotEl) return;
    pathEl.setAttribute("visibility", "hidden");
    ellipseEl.setAttribute("visibility", "hidden");
    dotEl.setAttribute("visibility", "hidden");

    const vb = res.viewBox;
    const s = points.map((p) => worldToSvgPoint(p, vb));
    const h = hover ? worldToSvgPoint(hover, vb) : null;
    const poly = (pts: PointLike[], close = false) =>
      pts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmtNum(p.x)} ${fmtNum(p.y)}`).join(" ") +
      (close ? " Z" : "");
    const showPath = (d: string) => {
      pathEl.setAttribute("d", d);
      pathEl.setAttribute("visibility", "visible");
    };

    switch (tool) {
      case "line":
      case "arrowLine":
        if (s.length >= 2) showPath(poly([s[0], h ?? s[1]]));
        break;
      case "rectangle": {
        if (s.length < 2) break;
        const b = h ?? s[1];
        let x2 = b.x;
        let y2 = b.y;
        if (shift) {
          const side = Math.max(Math.abs(b.x - s[0].x), Math.abs(b.y - s[0].y));
          x2 = s[0].x + (b.x < s[0].x ? -side : side);
          y2 = s[0].y + (b.y < s[0].y ? -side : side);
        }
        showPath(
          poly(
            [
              { x: s[0].x, y: s[0].y },
              { x: x2, y: s[0].y },
              { x: x2, y: y2 },
              { x: s[0].x, y: y2 },
            ],
            true,
          ),
        );
        break;
      }
      case "circle":
      case "ellipse": {
        if (s.length < 2) break;
        const b = h ?? s[1];
        let cx: number;
        let cy: number;
        let rx: number;
        let ry: number;
        if (tool === "circle" && !shift) {
          cx = s[0].x;
          cy = s[0].y;
          rx = ry = Math.hypot(b.x - cx, b.y - cy);
        } else {
          cx = (s[0].x + b.x) / 2;
          cy = (s[0].y + b.y) / 2;
          rx = Math.abs(b.x - s[0].x) / 2;
          ry = Math.abs(b.y - s[0].y) / 2;
          if (shift || tool === "circle") rx = ry = Math.max(rx, ry);
        }
        ellipseEl.setAttribute("cx", fmtNum(cx));
        ellipseEl.setAttribute("cy", fmtNum(cy));
        ellipseEl.setAttribute("rx", fmtNum(rx));
        ellipseEl.setAttribute("ry", fmtNum(ry));
        ellipseEl.setAttribute("visibility", "visible");
        break;
      }
      case "arc": {
        if (points.length >= 3) {
          // TikZ arc 是 world 逆时针；SVG y 向下，故 sweep-flag = 0、角度递减。
          const p1 = s[0];
          const c = s[1];
          const r = Math.hypot(p1.x - c.x, p1.y - c.y);
          const phi1 = Math.atan2(p1.y - c.y, p1.x - c.x);
          const delta = (arcSweepDegrees(points[0], points[1], points[2]) * Math.PI) / 180;
          const ex = c.x + r * Math.cos(phi1 - delta);
          const ey = c.y + r * Math.sin(phi1 - delta);
          showPath(
            `M ${fmtNum(p1.x)} ${fmtNum(p1.y)} A ${fmtNum(r)} ${fmtNum(r)} 0 ${delta > Math.PI ? 1 : 0} 0 ${fmtNum(ex)} ${fmtNum(ey)}`,
          );
        } else if (s.length > 0) {
          showPath(poly(h ? [...s, h] : s));
        }
        break;
      }
      case "polygon":
      case "polyline": {
        const pts = h ? [...s, h] : s;
        if (pts.length > 0) showPath(poly(pts, tool === "polygon" && !h));
        break;
      }
      case "dot": {
        dotEl.setAttribute("cx", fmtNum(s[0].x));
        dotEl.setAttribute("cy", fmtNum(s[0].y));
        dotEl.setAttribute("r", fmtNum(3 / metrics.unitScale));
        dotEl.setAttribute("visibility", "visible");
        break;
      }
      case "text": {
        const k = 8 / metrics.unitScale;
        showPath(
          `M ${fmtNum(s[0].x - k)} ${fmtNum(s[0].y)} L ${fmtNum(s[0].x + k)} ${fmtNum(s[0].y)} ` +
            `M ${fmtNum(s[0].x)} ${fmtNum(s[0].y - k)} L ${fmtNum(s[0].x)} ${fmtNum(s[0].y + k)}`,
        );
        break;
      }
      default:
        break;
    }
  }

  function cancelShape(silent = false): void {
    toolDragRef.current = null;
    shapeSessionRef.current = null;
    clearShapePreview();
    setSessionHint(null);
    setDragLabel(null);
    if (!silent) setNotice({ tone: "warn", text: "已取消绘制，源码未改动。" });
  }

  /** 生成语句 → 单点补丁 → commitDiagramPatch（与键盘 / 拖拽 / 属性同一条 CM6 history）。 */
  function commitShape(tool: ToolMode, points: readonly ShapePoint[], shift: boolean): void {
    const built = buildShapeStatement(tool, points, { shift });
    if (!built.ok) {
      setNotice({ tone: "warn", text: built.reason });
      return;
    }
    const src = sourceRef.current;
    const ins = insertShapeStatement(src, built.statement);
    // 唯一 key：相邻画出的两个形状是两次独立操作，绝不能被 1.5s 并组窗口合成一次撤销。
    const write = commitDiagramPatch({
      key: `shape:${tool}:${(shapeSeqRef.current += 1)}`,
      source: src,
      nextSource: ins.source,
      fallback: (s) => setSource(s),
    });
    resetDiagramHistorySession();
    setSelectedId(null);
    setPendingSelection({ source: ins.source, from: ins.selection.from, to: ins.selection.to });
    const suffix = write.written ? " · Ctrl+Z 可撤销" : " · 源码栏未就绪，无撤销记录";
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `已插入${built.label}${ins.note ? ` · ${ins.note}` : ""}${suffix} · 重渲染后自动选中`,
    });
  }

  /** 空白源码时先建一个空环境，才有 SVG 可承接指针与 getScreenCTM。 */
  function newBlankDiagram(): void {
    const src = sourceRef.current;
    if (src.trim()) return;
    const write = commitDiagramPatch({
      key: `shape:blank:${(shapeSeqRef.current += 1)}`,
      source: src,
      nextSource: BLANK_DIAGRAM,
      fallback: (s) => setSource(s),
    });
    resetDiagramHistorySession();
    setNotice({
      tone: "ok",
      text: `已新建空白 tikzpicture 环境${write.written ? " · Ctrl+Z 可撤销" : " · 源码栏未就绪，无撤销记录"}`,
    });
  }

  function finishMultiSession(): void {
    const s = shapeSessionRef.current;
    if (!s) return;
    const def = toolDef(s.tool);
    if (!canFinishShape(s)) {
      setNotice({ tone: "warn", text: `${def.label}至少需要 ${def.minPoints} 个点，请继续单击。` });
      return;
    }
    commitShape(s.tool, s.points, s.shift);
    shapeSessionRef.current = null;
    clearShapePreview();
    setSessionHint(null);
  }

  /** React 的 pointerdown 走这里；window 级 move/up/key 走下面注册的 ref。 */
  function beginShapeAt(e: ReactPointerEvent<HTMLDivElement>): void {
    if (previewMode !== "local") {
      setNotice({ tone: "warn", text: "XeLaTeX 精确通道只读，请切回本地即时预览再绘制。" });
      return;
    }
    if (!isToolMode(toolMode) || toolMode === "select") return;
    const def = toolDef(toolMode);
    const p = pointerWorld(e.clientX, e.clientY);
    if (!p) {
      setNotice({ tone: "warn", text: "画布尚未就绪（或坐标矩阵退化），请稍后再试。" });
      return;
    }

    if (def.interaction === "click") {
      commitShape(toolMode, [p], false);
      clearShapePreview();
      return;
    }

    if (def.interaction === "multi") {
      // 双击的第二次 pointerdown（detail >= 2）不再加点，直接闭合；
      // 这样「点 3 个顶点后在最后一个点上双击」得到的是 3 边形而不是 4 边形。
      if (e.detail >= 2) {
        finishMultiSession();
        return;
      }
      let s = shapeSessionRef.current;
      if (!s || s.tool !== toolMode) s = createShapeSession(toolMode);
      s = addShapePoint(s, p);
      shapeSessionRef.current = s;
      if (isShapeComplete(s)) {
        finishMultiSession(); // 圆弧集满三点自动提交
      } else {
        setSessionHint(shapeSessionHint(s));
        drawShapePreview(toolMode, s.points, s.shift, null);
      }
      return;
    }

    // drag：先确认矩阵可逆，再记录起点，预览只更新属性。
    const svg = stageSvg();
    const ctm = svg?.getScreenCTM?.();
    if (!ctm) return;
    const m: AffineMatrix = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f };
    if (!clientToSvgPoint(m, e.clientX, e.clientY)) return;
    toolDragRef.current = {
      tool: toolMode,
      start: p,
      current: p,
      startClient: { x: e.clientX, y: e.clientY },
      shift: e.shiftKey,
      moved: false,
    };
    drawShapePreview(toolMode, [p, p], e.shiftKey, null);
    setSessionHint(`${def.label} · 拖到终点松开（Shift 约束正形）· Esc 取消`);
  }

  function onToolMove(e: PointerEvent): void {
    if (!toolDragRef.current && !shapeSessionRef.current) return;
    const hover = pointerWorld(e.clientX, e.clientY);
    const d = toolDragRef.current;
    if (d) {
      const dxPx = e.clientX - d.startClient.x;
      const dyPx = e.clientY - d.startClient.y;
      if (!d.moved && Math.hypot(dxPx, dyPx) < SHAPE_THRESHOLD_PX) return;
      d.moved = true;
      if (hover) d.current = hover;
      d.shift = e.shiftKey;
      drawShapePreview(d.tool, [d.start, d.current], d.shift, null);
      setDragLabel(dragDeltaLabel(d.current.x - d.start.x, d.current.y - d.start.y));
      return;
    }
    const s = shapeSessionRef.current;
    if (s) drawShapePreview(s.tool, s.points, s.shift, hover);
  }

  function onToolUp(): void {
    const d = toolDragRef.current;
    if (!d) return;
    toolDragRef.current = null;
    setDragLabel(null);
    setSessionHint(null);
    clearShapePreview();
    if (!d.moved) {
      setNotice({ tone: "warn", text: "拖拽距离太小，形状未生成。" });
      return;
    }
    commitShape(d.tool, [d.start, d.current], d.shift);
  }

  /** 返回 true 表示按键已被形状工具消费（不让 F2-1 的 Esc / F2-4 的撤销再处理）。 */
  function onToolKey(e: KeyboardEvent): boolean {
    // window 级监听的 target 偶尔是 body，用 activeElement 兜底（同 F2-4 的判定口径）。
    const el =
      e.target instanceof Element
        ? e.target
        : document.activeElement instanceof Element
          ? document.activeElement
          : null;
    // 焦点在源码栏 / 输入框时不抢按键，否则会破坏正常输入。
    if (el?.closest(".cm-editor, input, textarea, [contenteditable]")) return false;
    const s = shapeSessionRef.current;
    if (e.key === "Escape") {
      if (toolDragRef.current || s) {
        cancelShape();
        return true;
      }
      if (toolMode !== "select") {
        setToolMode("select");
        return true;
      }
      return false;
    }
    if (e.key === "Enter" && s) {
      e.preventDefault();
      finishMultiSession();
      return true;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && s) {
      e.preventDefault();
      shapeSessionRef.current = popShapePoint(s);
      setSessionHint(shapeSessionHint(shapeSessionRef.current));
      drawShapePreview(s.tool, shapeSessionRef.current.points, s.shift, null);
      return true;
    }
    return false;
  }

  shapeApiRef.current = {
    move: onToolMove,
    up: onToolUp,
    key: onToolKey,
    cancel: cancelShape,
  };

  // window 级拖拽监听：即使指针移出 SVG / 画布仍能持续跟随，松手统一提交。
  useEffect(() => {
    const resetMarker = (d: DragState) => {
      d.marker.classList.remove("is-active");
      d.marker.setAttribute("cx", fmtNum(d.startSvg.x));
      d.marker.setAttribute("cy", fmtNum(d.startSvg.y));
      d.hitMarker?.setAttribute("cx", fmtNum(d.startSvg.x));
      d.hitMarker?.setAttribute("cy", fmtNum(d.startSvg.y));
      if (d.guide) d.guide.setAttribute("visibility", "hidden");
    };
    const onMove = (e: PointerEvent) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      // F3-7：视角平移最高优先级（空格 / 中键 / 抓手），不产生任何源码补丁 / 撤销步。
      const pan = panRef.current;
      if (pan) {
        setViewport((v) => panBy(
          { ...v, panX: pan.panX, panY: pan.panY },
          e.clientX - pan.clientX,
          e.clientY - pan.clientY,
        ));
        return;
      }
      // F3-7：状态栏指针坐标（world pt） throttle 到 ~8fps，避免每帧 setState。
      const now = performance.now();
      if (now - lastPointerLabelRef.current > 120) {
        lastPointerLabelRef.current = now;
        const w = pointerWorld(e.clientX, e.clientY);
        setPointerWorldLabel(w ? `(${w.x.toFixed(1)}, ${w.y.toFixed(1)}) pt` : "—");
      }
      // F3-1：形状工具会话优先；无会话时该函数立即返回，不影响 F2-1 控制点拖拽。
      shapeApiRef.current.move(e);
      // F3-3：空白区框选。屏幕矩形直接用 client 坐标，命中判定用
      // getBoundingClientRect()（天然含 zoom / viewBox 留白），不做 SVG 反算。
      const mq = marqueeRef.current;
      if (mq) {
        const dx = e.clientX - mq.startClient.x;
        const dy = e.clientY - mq.startClient.y;
        if (!mq.moved && Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return;
        mq.moved = true;
        setMarqueeRect(
          marqueeBox(mq.startClient.x, mq.startClient.y, e.clientX, e.clientY),
        );
        return;
      }
      // F3-4：变换柄手势（旋转 / 缩放）独立一路，优先级高于坐标拖拽。
      if (transformRef.current) {
        handleTransformMove(e);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const dxPx = e.clientX - d.startClient.x;
      const dyPx = e.clientY - d.startClient.y;
      if (!d.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const dSvg = clientDeltaToSvgDelta(d.matrix, dxPx, dyPx);
      if (!dSvg) return;
      const dWorld = svgDeltaToWorldDelta(dSvg);
      // F3-4：智能参考线吸附 —— 在指针位移上叠加对齐修正，并把命中参考线写入 store
      // 供 drawGuides 实时显示；未命中时清空（保证松手残留的参考线消失）。
      let effWorld = dWorld;
      const dragPrefs = useDiagramStore.getState();
      // F3-5：吸附网格优先于智能参考线 —— 把元素落点对齐到最近网格交点，
      // 与 drawGrid 画出的网格线同源（都在 world 空间取 step 整数倍）。
      if (dragPrefs.snapGridEnabled) {
        const target = snapToGrid(
          { x: d.startWorld.x + dWorld.x, y: d.startWorld.y + dWorld.y },
          GRID_STEP_PT,
        );
        effWorld = { x: target.x - d.startWorld.x, y: target.y - d.startWorld.y };
        setDragGuides([]);
      } else if (d.snap && dragPrefs.snapEnabled) {
        const snap = planDragSnap({
          selectedBoxes: d.snap.selected,
          otherBoxes: d.snap.others,
          delta: dWorld,
          threshold: DEFAULT_SNAP_THRESHOLD_PT * Math.max(0.25, d.snap.unitScale),
          canvasCenter: d.snap.canvasCenter,
        });
        effWorld = { x: dWorld.x + snap.delta.x, y: dWorld.y + snap.delta.y };
        setDragGuides(snap.guides);
      } else {
        setDragGuides([]);
      }
      d.newWorld = { x: d.startWorld.x + effWorld.x, y: d.startWorld.y + effWorld.y };
      const curSvg = worldToSvgPoint(d.newWorld, d.resultAtStart.viewBox);
      d.marker.setAttribute("cx", fmtNum(curSvg.x));
      d.marker.setAttribute("cy", fmtNum(curSvg.y));
      d.hitMarker?.setAttribute("cx", fmtNum(curSvg.x));
      d.hitMarker?.setAttribute("cy", fmtNum(curSvg.y));
      if (d.guide) {
        d.guide.setAttribute("x2", fmtNum(curSvg.x));
        d.guide.setAttribute("y2", fmtNum(curSvg.y));
      }
      setDragLabel(dragDeltaLabel(effWorld.x, effWorld.y));
      // F3-2 后续修复：同一帧排一次「候选源码 → 候选几何」的替换，图形跟着命中圈动。
      previewApiRef.current.schedule(d);
    };
    /** F3-3：框选松手 → 按屏幕矩形命中 data-source-id → 并入 / 替换多选。 */
    const finishMarquee = (client: PointLike): void => {
      const mq = marqueeRef.current;
      marqueeRef.current = null;
      setMarqueeRect(null);
      if (!mq || !mq.moved) return;
      const stage = stageRef.current;
      if (!stage) return;
      const box = marqueeBox(mq.startClient.x, mq.startClient.y, client.x, client.y);
      const state = useDiagramStore.getState();
      const items = Array.from(stage.querySelectorAll("[data-source-id]"))
        .map((el) => ({
          id: el.getAttribute("data-source-id") ?? "",
          rect: el.getBoundingClientRect() as RectLike,
        }))
        .filter((it) => !!it.id && !isManuallyHidden(state.grouping, it.id));
      const hits = marqueeHits(items, box);
      state.setSelectedIds(
        applyMarqueeSelection(mq.additive ? mq.baseSelection : [], hits, mq.additive),
      );
    };

    const onUp = (e: PointerEvent) => {
      // F3-7：视角平移松手只清状态，绝不写源码 / 留撤销步。
      if (panRef.current) {
        panRef.current = null;
        return;
      }
      // F3-1：形状工具松手提交；多点工具无 toolDragRef，这里会直接返回。
      shapeApiRef.current.up();
      if (marqueeRef.current) {
        finishMarquee({ x: e.clientX, y: e.clientY });
        return;
      }
      // F3-4：旋转 / 缩放柄松手 → 提交一次变换补丁。
      if (transformRef.current) {
        finishTransform();
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      d.marker.classList.remove("is-active");
      if (d.guide) d.guide.setAttribute("visibility", "hidden");
      setDragLabel(null);
      setDragGuides([]);
      if (d.moved) commitDragRef.current(d);
      else previewApiRef.current.deactivate();
    };
    const onCancel = () => {
      if (panRef.current) {
        panRef.current = null;
        return;
      }
      // F3-3：pointercancel 时丢弃框选，不加选任何东西。
      if (marqueeRef.current) {
        marqueeRef.current = null;
        setMarqueeRect(null);
        return;
      }
      // F3-4：变换手势取消 → 还原基准几何，参考线清空。
      if (transformRef.current) {
        transformRef.current = null;
        setDragLabel(null);
        setDragGuides([]);
        previewApiRef.current.restore();
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      resetMarker(d);
      setDragLabel(null);
      setDragGuides([]);
      // F3-2 后续修复：Esc / pointercancel 把预览几何还原成拖拽开始前的样子。
      previewApiRef.current.restore();
    };
    const onKey = (e: KeyboardEvent) => {
      // F3-1：Esc / Enter / Backspace 先给形状工具会话，绘制中不触发撤销栈。
      if (shapeApiRef.current.key(e)) return;
      if (e.key === "Escape" && (dragRef.current || marqueeRef.current || transformRef.current)) {
        if (marqueeRef.current) {
          marqueeRef.current = null;
          setMarqueeRect(null);
          return;
        }
        onCancel();
        return;
      }
      // F2-4：仅画布布局（或焦点在画布 / 侧栏而非源码栏）时 CM6 收不到按键，
      // 由这里把撤销 / 重做转发到同一条 history；分屏里焦点在源码栏时应交回 CM6。
      const inGesture =
        !!dragRef.current ||
        !!marqueeRef.current ||
        !!transformRef.current ||
        !!toolDragRef.current ||
        !!shapeSessionRef.current ||
        !!panRef.current ||
        spaceRef.current;
      // F3-6：统一只读判定 —— 精确通道下 F3-5 的 nudge / 复制粘贴 / Ctrl+D 一律拦截，
      // 焦点 / 手势 / Tab 隐藏等其它理由则静默放行，绝不抢键或弹无谓提示。
      const inTextEntry = isTextEntryFocused(e);
      const permission = canEditDiagramSource({
        previewMode: useDiagramStore.getState().previewMode,
        tabVisible: tabVisibleRef.current,
        inTextEntry,
        inGesture,
      });
      // F3-5：方向键 nudge / Delete 删除 / Ctrl+C/V/D（绘图 Tab + 焦点不在文本框 + 非手势 + 可写源码）。
      if (tabVisibleRef.current && !inTextEntry && permission.ok) {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod && !e.altKey && useDiagramStore.getState().selectedIds.length > 0) {
          if (
            !e.shiftKey &&
            (e.key === "Delete" || e.key === "Backspace")
          ) {
            e.preventDefault();
            deleteSelection();
            return;
          }
          const step = e.shiftKey ? 10 : 1;
          const dir =
            e.key === "ArrowLeft"
              ? { x: -step, y: 0 }
              : e.key === "ArrowRight"
                ? { x: step, y: 0 }
                : e.key === "ArrowUp"
                  ? { x: 0, y: step }
                  : e.key === "ArrowDown"
                    ? { x: 0, y: -step }
                    : null;
          if (dir) {
            e.preventDefault();
            void nudgeSelection(dir.x, dir.y);
            return;
          }
        }
        if (mod && !e.shiftKey && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === "c") {
            e.preventDefault();
            copySelection();
            return;
          }
          if (k === "v") {
            e.preventDefault();
            void pasteClipboard();
            return;
          }
          if (k === "d") {
            e.preventDefault();
            void duplicateSelection();
            return;
          }
        }
      } else if (
        tabVisibleRef.current &&
        !inTextEntry &&
        !inGesture &&
        isPreciseReadonly(permission) &&
        isDiagramEditKey(e)
      ) {
        // 精确通道只读：编辑键给出统一理由，Ctrl+Z / Y 仍落到下面的撤销栈分支。
        e.preventDefault();
        setNotice({ tone: "warn", text: permission.reason });
        return;
      }
      const kind = shouldHandleHistoryKey(e, tabVisibleRef.current, inGesture);
      if (!kind) return;
      e.preventDefault();
      if (runDiagramHistoryCommand(kind)) {
        setNotice({
          tone: "ok",
          text: kind === "undo" ? "已撤销 · 画布与源码同步还原" : "已重做",
        });
      } else {
        setNotice({
          tone: "warn",
          text: `没有可${kind === "undo" ? "撤销" : "重做"}的改动，或源码栏尚未就绪。`,
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // F2-4：切换预览通道后断开合并组。精确通道是 XeLaTeX 只读结果，
  // 不该把「回到本地画布后的下一次拖拽」并到切通道前的那组微调上。
  useEffect(() => {
    resetDiagramHistorySession();
    marqueeRef.current = null;
    setMarqueeRect(null);
  }, [previewMode]);

  // 提示条自动消失（4s），新提示会重置计时
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** 命中控制点，或直接拖图元本体（自动取它的 node-position 句柄）。 */
  function startDragFromEvent(target: EventTarget | null, client?: PointLike): void {
    if (previewMode !== "local" || !result || !handlesOn) return;
    // 实时预览让「连续快速拖拽」变常见：源码已提交但画布还在 160ms debounce 时，
    // result 仍是旧一批句柄，直接拖会因 sourceFingerprint 不符而写回失败。
    // 这里对齐 renderMeta.source 与当前源码，不匹配就等这一帧重渲染完成。
    const meta = useDiagramStore.getState().renderMeta;
    if (meta && meta.source !== sourceRef.current) {
      setNotice({ tone: "warn", text: "源码刚更新，画布正在重渲染，请稍候再拖。" });
      return;
    }
    if (!(target instanceof Element)) return;
    const svg = target.closest("svg") as SVGSVGElement | null;
    if (!svg) return;
    let hit: TikzEditHandle | undefined;
    const markerEl = target.closest("[data-dg-handle-id]");
    if (markerEl) {
      let id = markerEl.getAttribute("data-dg-handle-id");
      // F3-6：相邻控制点命中圈重叠时，浏览器按绘制顺序分发会选错。只有确实重叠
      // （落在 hitR 内的候选 > 1）才按「指针距离」覆盖 DOM 结果，否则原链路零回归。
      // 距离与 hitR 都用 SVG 用户单位，50%–200% 缩放判定一致。
      if (client) {
        const ctm = svg.getScreenCTM?.();
        if (ctm) {
          const p = clientToSvgPoint(
            { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f },
            client.x,
            client.y,
          );
          if (p) {
            const cands: HitCandidate[] = [];
            for (const c of Array.from(svg.querySelectorAll("[data-dg-hit-id]"))) {
              const cid = c.getAttribute("data-dg-hit-id") ?? "";
              const cx = Number(c.getAttribute("cx"));
              const cy = Number(c.getAttribute("cy"));
              if (cid && Number.isFinite(cx) && Number.isFinite(cy)) {
                cands.push({ id: cid, x: cx, y: cy });
              }
            }
            const pick = pickNearestHandle(cands, p, metrics.hitR);
            if (pick.overlapping > 1 && pick.id) id = pick.id;
          }
        }
      }
      hit = result.handles.find((h) => h.id === id);
    } else {
      const shape = target.closest("[data-source-id]");
      const sid = shape?.getAttribute("data-source-id");
      if (sid) {
        const own = result.handles.filter(
          (h) =>
            h.sourceRef?.sourceId === sid &&
            resolveHandleLock(result.compat, h.id, isDraggableHandle(h), lockedHandleReason(h)) === null,
        );
        hit = own.find((h) => h.kind === "node-position") ?? own[0];
      }
    }
    if (!hit) return;
    const state = useDiagramStore.getState();
    const shapeEl = target.closest("[data-source-id]");
    // F3-6：择优后把 sid 对齐到真正命中的句柄 —— 既避免「高亮 A、拖了 B」，也补上
    // 原先「点控制点时 sid 为 null、主动锁定检查被跳过」的 F3-3 绕过漏洞。
    const sid = hit.sourceRef?.sourceId ?? shapeEl?.getAttribute("data-source-id") ?? null;
    // F3-3：主动锁定优先于一切拖拽（与 F2-3 的能力矩阵锁定是两套语义）。
    if (sid && isManuallyLocked(state.grouping, sid)) {
      setNotice({ tone: "warn", text: "该图元已在图层面板主动锁定，先解锁后再拖动。" });
      return;
    }
    // F3-3：命中图元本体（不是控制点）且当前多选 > 1 → 整体平移整组。
    // 命中控制点仍走 F2-1 的单点几何编辑，保证拖拽语义不被多选抢走。
    const groupIds =
      !markerEl &&
      sid &&
      state.selectedIds.length > 1 &&
      state.selectedIds.includes(sid)
        ? state.selectedIds.filter((id) => !isManuallyHidden(state.grouping, id))
        : null;
    // F2-3：能力矩阵归因的锁定优先，理由更具体；F2-1 的 rewriteMode 兜底在后。
    const lockReason = resolveHandleLock(
      result.compat,
      hit.id,
      isDraggableHandle(hit),
      lockedHandleReason(hit),
    );
    if (lockReason !== null && !groupIds) {
      setNotice({ tone: "warn", text: lockReason });
      return;
    }
    const layer = svg.querySelector("[data-dg-handle-layer]");
    let marker: SVGCircleElement | null = null;
    for (const c of Array.from(layer?.querySelectorAll("circle[data-dg-handle-id]") ?? [])) {
      if (c.getAttribute("data-dg-handle-id") === hit.id) {
        marker = c as SVGCircleElement;
        break;
      }
    }
    if (!marker) {
      setNotice({ tone: "warn", text: "控制点过多已折叠，请缩小图形或用源码编辑。" });
      return;
    }
    const ctm = svg.getScreenCTM?.();
    if (!ctm) return;
    const matrix: MatrixLike = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d };
    if (!clientDeltaToSvgDelta(matrix, 1, 0)) return; // 退化矩阵（宽度为 0 等）
    const guide = layer?.querySelector("[data-dg-guide]") as SVGLineElement | null;
    const startSvg = worldToSvgPoint(hit.world, result.viewBox);
    dragRef.current = {
      handleId: hit.id,
      handle: hit,
      sourceAtStart: sourceRef.current,
      resultAtStart: result,
      startClient: { x: lastPointer.x, y: lastPointer.y },
      startWorld: { x: hit.world.x, y: hit.world.y },
      startSvg,
      matrix,
      marker,
      hitMarker: (marker.parentElement?.querySelector(".dg-handle-hit") as
        | SVGCircleElement
        | null) ?? null,
      guide,
      moved: false,
      newWorld: { x: hit.world.x, y: hit.world.y },
      previewSource: null,
      previewWorld: null,
      previewOutcome: null,
      groupIds: groupIds && groupIds.length > 1 ? groupIds : null,
      previewGroup: null,
      previewFailures: 0,
      snap: null,
    };
    // F3-4：拖拽开始时缓存选中 / 其余元素的「锚点包围盒」与画布中心，供实时吸附用
    // （避免每帧重算）。阈值按当前单位比换算成屏幕 ~6px，保证任何缩放下手感一致。
    {
      const d = dragRef.current;
      if (d) {
        const allIds = result.statements.map((s) => s.id);
        const selIds =
          d.groupIds && d.groupIds.length > 1
            ? d.groupIds
            : [hit.sourceRef?.sourceId].filter((x): x is string => !!x);
        const selBoxes = collectElementBoxes({
          handles: result.handles,
          elementIds: selIds,
          compat: result.compat,
          grouping: state.grouping,
        }).boxes;
        const otherBoxes = collectElementBoxes({
          handles: result.handles,
          elementIds: allIds.filter((id) => !selIds.includes(id)),
          compat: result.compat,
          grouping: state.grouping,
        }).boxes;
        const vb = result.viewBox;
        d.snap = selBoxes.length > 0
          ? {
              selected: selBoxes,
              others: otherBoxes,
              canvasCenter: { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 },
              unitScale: metrics.unitScale,
            }
          : null;
      }
    }
    // F3-2 后续修复：以此刻的源码 / 渲染结果为整段手势的**唯一基准**，之后每帧的
    // 候选源码都从它重算，绝不把上一帧的候选当基准（否则误差会累积、语义也会漂）。
    previewActiveRef.current = true;
    previewBaseRef.current = dragRef.current;
    marker.classList.add("is-active");
    if (guide) {
      guide.setAttribute("x1", fmtNum(startSvg.x));
      guide.setAttribute("y1", fmtNum(startSvg.y));
      guide.setAttribute("x2", fmtNum(startSvg.x));
      guide.setAttribute("y2", fmtNum(startSvg.y));
      guide.setAttribute("visibility", "visible");
    }
  }

  /** F3-4：把被变换预览换掉的几何还原成拖拽开始前的基准（不依赖坐标拖拽的 previewBaseRef）。 */
  function restoreTransformPreview(): void {
    const svg = stageSvg();
    const base = resultRef.current;
    if (!svg || !base) return;
    applyPreviewGeometry(svg, {
      markup: base.svg,
      baseViewBox: base.viewBox,
      candidateViewBox: base.viewBox,
      zoom: renderPctRef.current,
      live: false,
    });
    const layer = svg.querySelector("[data-dg-handle-layer]") as SVGGElement | null;
    if (layer) updateHandleLayerPositions(layer, base.handles, base.viewBox, metrics);
  }

  /** F3-4：从变换柄 pointerdown 起一次旋转 / 缩放手势（与坐标拖拽平行，独立一路）。 */
  function startTransformFromEvent(
    kind: "rotate" | "scale",
    corner: number,
    e: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (previewMode !== "local" || !result) return;
    const meta = useDiagramStore.getState().renderMeta;
    if (meta && meta.source !== sourceRef.current) {
      setNotice({ tone: "warn", text: "源码刚更新，画布正在重渲染，请稍候再变换。" });
      return;
    }
    const state = useDiagramStore.getState();
    const selIds =
      state.selectedIds.length > 0
        ? state.selectedIds
        : state.selectedId
          ? [state.selectedId]
          : [];
    if (selIds.length === 0) return;
    for (const id of selIds) {
      if (isManuallyLocked(state.grouping, id)) {
        setNotice({ tone: "warn", text: "含主动锁定的图元，先解锁后再变换。" });
        return;
      }
      if (isManuallyHidden(state.grouping, id)) {
        setNotice({ tone: "warn", text: "含已隐藏的图元，先显示后再变换。" });
        return;
      }
    }
    const { boxes } = collectElementBoxes({
      handles: result.handles,
      elementIds: selIds,
      compat: result.compat,
      grouping: state.grouping,
    });
    // F4-1：两套包围盒统一 —— collectElementBoxes 为空时不再误报「没有可写控制点」，
    // 回退到 getBoundingClientRect 的视觉外接框（节点尺寸柄必须以视觉为准）。
    const visual = selectionBoxWorldRef.current;
    const startBox = boxes.length > 0
      ? unionWorldBox(boxes.map((b) => b.box))
      : (visual ?? null);
    if (!startBox) {
      setNotice({ tone: "warn", text: "没有可用的包围盒，无法参与旋转 / 缩放 / 尺寸编辑。" });
      return;
    }
    // F4-1：基准尺寸优先读选中节点已有的 text width / minimum height，
    // 读不到则用视觉外接框（getBoundingClientRect 口径），绝不拿可写控制点包围盒冒充节点大小。
    const fallbackW = visual ? boxWidth(visual) : boxWidth(startBox);
    const fallbackH = visual ? boxHeight(visual) : boxHeight(startBox);
    let baseWidthPt = fallbackW > 1e-6 ? fallbackW : 28.45275590551181;
    let baseHeightPt = fallbackH > 1e-6 ? fallbackH : 28.45275590551181;
    const primary = result.statements.find((st) => st.id === selIds[0]);
    if (primary && primary.command === "node") {
      const readSize = (key: string): number | null => {
        const hit = primary.entries.find(
          (e) => e.value !== null && e.key.trim().toLowerCase() === key,
        );
        return sizeValueToPt(hit?.value ?? null);
      };
      baseWidthPt = readSize("text width") ?? baseWidthPt;
      baseHeightPt = readSize("minimum height") ?? baseHeightPt;
    }
    const center = boxCenter(startBox);
    const startWorld = pointerWorld(e.clientX, e.clientY) ?? center;
    transformRef.current = {
      kind,
      corner,
      sourceAtStart: sourceRef.current,
      resultAtStart: result,
      startWorld,
      startBox,
      center,
      value: kind === "rotate" ? 0 : 1,
      compat: result.compat,
      grouping: state.grouping,
      elementIds: selIds,
      previewSource: null,
      previewFailures: 0,
      baseWidthPt,
      baseHeightPt,
      sizeValues: null,
    };
    previewActiveRef.current = true;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
  }

  /** F3-4：旋转 / 缩放柄移动 → 算新值 → 实时换几何预览（不写源码、不进撤销栈）。 */
  function handleTransformMove(e: PointerEvent): void {
    const t = transformRef.current;
    if (!t) return;
    const cur = pointerWorld(e.clientX, e.clientY);
    if (!cur) return;
    let value: number;
    let candidate: string | null = null;
    if (t.kind === "rotate") {
      const deg = snapAngle(rotationFromDrag(t.startBox, t.startWorld, cur));
      value = deg;
      const plan = planTransformPatches({
        source: t.sourceAtStart,
        statements: t.resultAtStart.statements,
        elementIds: t.elementIds,
        key: "rotate",
        value: String(Math.round(deg)),
        compat: t.compat,
        grouping: t.grouping,
      });
      if (plan.status === "ok") candidate = plan.nextSource;
      setDragLabel(`旋转 ${Math.round(deg)}°`);
    } else {
      const res = scaleFromDrag({
        box: t.startBox,
        corner: t.corner,
        pointer: cur,
        uniform: e.shiftKey,
        center: e.altKey,
      });
      if (!res) return;
      value = res.scale;
      const hasNode = t.resultAtStart.statements.some(
        (st) => t.elementIds.includes(st.id) && st.command === "node",
      );
      // F4-1：Shift 等比、或选中集合里没有 \node → 仍走 F3-4 的 scale=，零回归。
      if (e.shiftKey || !hasNode) {
        t.sizeValues = null;
        const plan = planTransformPatches({
          source: t.sourceAtStart,
          statements: t.resultAtStart.statements,
          elementIds: t.elementIds,
          key: "scale",
          value: String(value),
          compat: t.compat,
          grouping: t.grouping,
        });
        if (plan.status === "ok") candidate = plan.nextSource;
        setDragLabel(`缩放 ${value.toFixed(2)}×`);
      } else {
        // 按轴改节点文本框尺寸：sx/sy 分别写 text width / minimum height，绝不合并成 scale。
        const vals = sizeValuesFromDrag({
          baseWidthPt: t.baseWidthPt,
          baseHeightPt: t.baseHeightPt,
          sx: res.sx,
          sy: res.sy,
          corner: t.corner,
        });
        const values: SizeValues = {};
        if (vals.width) values["text width"] = vals.width;
        if (vals.height) values["minimum height"] = vals.height;
        t.sizeValues = Object.keys(values).length > 0 ? values : null;
        const plan = t.sizeValues
          ? planSizePatches({
              source: t.sourceAtStart,
              statements: t.resultAtStart.statements,
              elementIds: t.elementIds,
              values,
              compat: t.compat,
              grouping: t.grouping,
            })
          : null;
        if (plan?.status === "ok") candidate = plan.nextSource;
        setDragLabel(`尺寸 ${vals.width ?? "—"} × ${vals.height ?? "—"}`);
      }
    }
    t.value = value;
    if (!candidate || candidate === t.sourceAtStart) return;
    if (!shouldRenderPreview(t.previewSource, candidate, t.sourceAtStart)) return;
    void renderTikz(candidate).then((r) => {
      const svg = stageSvg();
      if (!svg || transformRef.current !== t) return;
      const ok = applyPreviewGeometry(svg, {
        markup: r.svg,
        baseViewBox: t.resultAtStart.viewBox,
        candidateViewBox: r.viewBox,
        zoom: renderPctRef.current,
        live: true,
      });
      if (ok) t.previewSource = candidate;
    });
  }

  /** F3-4：旋转 / 缩放柄松手 → 提交一次变换补丁（一条 Ctrl+Z 退整组）。 */
  function finishTransform(): void {
    const t = transformRef.current;
    if (!t) return;
    transformRef.current = null;
    setDragLabel(null);
    setDragGuides([]);
    previewActiveRef.current = false;
    const sizeValues = t.sizeValues;
    const plan = sizeValues
      ? planSizePatches({
          source: t.sourceAtStart,
          statements: t.resultAtStart.statements,
          elementIds: t.elementIds,
          values: sizeValues,
          compat: t.compat,
          grouping: t.grouping,
        })
      : planTransformPatches({
          source: t.sourceAtStart,
          statements: t.resultAtStart.statements,
          elementIds: t.elementIds,
          key: t.kind,
          value:
            t.kind === "rotate"
              ? String(Math.round(t.value))
              : String(Math.round(t.value * 1000) / 1000),
          compat: t.compat,
          grouping: t.grouping,
        });
    if (plan.status !== "ok") {
      restoreTransformPreview();
      if (plan.status !== "empty") {
        setNotice({ tone: "warn", text: plan.reason || "无法应用变换" });
      }
      return;
    }
    restoreTransformPreview();
    const write = commitDiagramPatches({
      patches: plan.patches,
      source: t.sourceAtStart,
      nextSource: plan.nextSource,
      fallback: setSource,
    });
    const sk = plan.skipped.length
      ? ` · ${plan.skipped.length} 个跳过（${plan.skipped[0].id}：${plan.skipped[0].reason}）`
      : "";
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `已${sizeValues ? "修改尺寸" : t.kind === "rotate" ? "旋转" : "缩放"} ${plan.changedIds.length} 个图元${sk}${
        write.written ? " · Ctrl+Z 一次退回" : " · 源码栏未就绪，无撤销记录"
      }`,
    });
  }

  // ── F3-5 编辑效率：方向键 nudge / 复制粘贴 / Ctrl+D ─────────────────────────

  /** 焦点落在源码栏 / 文本框 / 模态框时把按键交还给它们（不抢编辑器的方向键与 Ctrl+C/V）。 */
  function isTextEntryFocused(e: KeyboardEvent): boolean {
    const el = e.target instanceof Element ? e.target : document.activeElement;
    if (!(el instanceof Element)) return false;
    if (el.closest(".cm-editor")) return true;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type")?.toLowerCase() ?? "text";
    const nonText = new Set([
      "button",
      "checkbox",
      "radio",
      "submit",
      "reset",
      "file",
      "range",
      "color",
      "image",
    ]);
    if (tag === "textarea") return true;
    if (tag === "input" && !nonText.has(type)) return true;
    if (el.closest('[contenteditable=""], [contenteditable="true"]')) return true;
    if (
      document.querySelector(
        '.modal-layer, .switcher-overlay, .find-panel[role="dialog"], [role="dialog"].modal',
      )
    )
      return true;
    return false;
  }

  /** 方向键 nudge：批量位移选中图元；key 固定 "nudge"，连按合并成一组 history。 */
  async function nudgeSelection(dx: number, dy: number): Promise<void> {
    const state = useDiagramStore.getState();
    const src = sourceRef.current;
    const res = resultRef.current;
    if (!res) return;
    const ids = state.selectedIds.filter(
      (id) => !isManuallyLocked(state.grouping, id) && !isManuallyHidden(state.grouping, id),
    );
    if (ids.length === 0) return;
    const handles = res.handles.filter((h) => ids.includes(h.sourceRef?.sourceId ?? ""));
    if (handles.length === 0) {
      setNotice({ tone: "warn", text: "选中的图元没有可位移的控制点。" });
      return;
    }
    const deltas = Object.fromEntries(ids.map((id) => [id, { x: dx, y: dy }]));
    const plan = await applyDeltaEdit({
      source: src,
      handles,
      deltas,
      compat: res.compat,
      grouping: state.grouping,
    });
    if (plan.status !== "ok") {
      if (plan.status !== "empty") setNotice({ tone: "warn", text: plan.reason || "无法移动" });
      return;
    }
    const write = commitDiagramPatch({
      key: "nudge",
      source: src,
      nextSource: plan.nextSource,
      fallback: setSource,
    });
    setLastMoveDelta(dx, dy);
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `已微移 ${plan.movedElements.length} 个图元${
        write.written ? " · 连按合并撤销" : " · 源码栏未就绪，无撤销记录"
      }`,
    });
  }

  /** 复制：把选中的顶层块原文放进会话剪贴板。 */
  function copySelection(): void {
    const state = useDiagramStore.getState();
    const blocks = topLevelBlocks(sourceRef.current, state.renderMeta?.statements ?? []);
    const want = new Set(state.selectedIds);
    const texts = blocks.filter((b) => want.has(b.id)).map((b) => b.text);
    if (texts.length === 0) {
      setNotice({ tone: "warn", text: "没有可复制的顶层图元（嵌套图元请在源码里复制）。" });
      return;
    }
    setClipboard(texts);
    setNotice({ tone: "ok", text: `已复制 ${texts.length} 个图元语句。` });
  }

  /**
   * Delete / Backspace：整段删除选中的顶层语句（含段间空白）。
   * 多块合并成一组不重叠补丁一次 dispatch = 一条 Ctrl+Z；图层面板主动锁定项不删。
   * renderMeta 带 source：debounce 期间源码已变就拒绝用过期 span 删除。
   */
  function deleteSelection(): void {
    const state = useDiagramStore.getState();
    const ids = state.selectedIds;
    if (ids.length === 0) return;
    const src = sourceRef.current;
    const meta = state.renderMeta;
    if (!meta || meta.source !== src) {
      setNotice({ tone: "warn", text: "源码刚更新，画布正在重渲染，请稍候再删除。" });
      return;
    }
    const locked = ids.filter((id) => isManuallyLocked(state.grouping, id));
    if (locked.length > 0) {
      setNotice({ tone: "warn", text: "选中的图元含主动锁定项，请先在图层面板解锁后再删除。" });
      return;
    }
    const plan = planDeleteEdit(src, meta.statements, ids);
    if (!plan) {
      setNotice({
        tone: "warn",
        text: "没有可删除的顶层图元（嵌套在 scope / foreach 里的图元请在源码栏删除）。",
      });
      return;
    }
    const write = commitDiagramPatches({
      patches: plan.patches,
      source: src,
      nextSource: plan.nextSource,
      fallback: setSource,
    });
    useDiagramStore.getState().setSelectedIds([]);
    const nested = ids.length - plan.deletedIds.length;
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `已删除 ${plan.deletedIds.length} 个图元${
        nested > 0 ? ` · ${nested} 个嵌套图元请在源码栏删除` : ""
      }${write.written ? " · Ctrl+Z 一次退回" : " · 源码栏未就绪，无撤销记录"}`,
    });
  }

  /** 粘贴：把剪贴板块文本插到锚点块之后，并选中新副本。 */
  async function pasteClipboard(): Promise<void> {
    if (!hasClipboard()) {
      setNotice({ tone: "warn", text: "剪贴板为空：先 Ctrl+C 复制图元。" });
      return;
    }
    const state = useDiagramStore.getState();
    const src = sourceRef.current;
    const pasted = planPaste(src, state.renderMeta?.statements ?? [], getClipboard(), state.selectedIds);
    if (!pasted) {
      setNotice({ tone: "warn", text: "粘贴失败：源码结构不支持在该位置插入。" });
      return;
    }
    const write = commitDiagramPatches({
      patches: pasted.patches,
      source: src,
      nextSource: pasted.nextSource,
      fallback: setSource,
    });
    // 重渲染新源码 → 选中插入区间内的块（id 由 renderTikz 确定性分配，与提交后 store 重渲染一致）。
    const r = await renderTikz(pasted.nextSource);
    const ids = topLevelBlocks(pasted.nextSource, r.statements)
      .filter((b) => b.from >= pasted.from && b.from < pasted.to)
      .map((b) => b.id);
    if (ids.length > 0) useDiagramStore.getState().setSelectedIds(ids);
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `已粘贴 ${ids.length || "若干"} 个图元${
        write.written ? " · Ctrl+Z 可撤销" : " · 源码栏未就绪，无撤销记录"
      }`,
    });
  }

  /** Ctrl+D：复制选中顶层块并重复上一次位移（无则默认右下 0.5cm），一次性补丁 = 一次撤销。 */
  async function duplicateSelection(): Promise<void> {
    const state = useDiagramStore.getState();
    const src = sourceRef.current;
    const statements = state.renderMeta?.statements ?? [];
    const ids = state.selectedIds.filter((id) => !isManuallyLocked(state.grouping, id));
    const dup = planDuplicateEdit(src, statements, ids);
    if (!dup) {
      setNotice({ tone: "warn", text: "没有可复制的顶层图元。" });
      return;
    }
    const delta = getLastMoveDelta() ?? { x: GRID_STEP_PT / 2, y: -GRID_STEP_PT / 2 };
    const dupRender = await renderTikz(dup.nextSource);
    const cloneIds = topLevelBlocks(dup.nextSource, dupRender.statements)
      .filter((b) => dup.clones.some((c) => c.from === b.from))
      .map((b) => b.id);
    const cloneHandles = dupRender.handles.filter((h) =>
      cloneIds.includes(h.sourceRef?.sourceId ?? ""),
    );
    let finalSource = dup.nextSource;
    if (cloneHandles.length > 0) {
      const move = await applyDeltaEdit({
        source: dup.nextSource,
        handles: cloneHandles,
        deltas: Object.fromEntries(cloneIds.map((id) => [id, delta])),
        compat: dupRender.compat,
        grouping: state.grouping,
      });
      if (move.status === "ok") finalSource = move.nextSource;
    }
    const patch = minimalSourcePatch(src, finalSource);
    if (!patch) {
      setNotice({ tone: "warn", text: "没有可复制的顶层图元。" });
      return;
    }
    const write = commitDiagramPatches({
      patches: [patch],
      source: src,
      nextSource: finalSource,
      fallback: setSource,
    });
    if (cloneIds.length > 0) useDiagramStore.getState().setSelectedIds(cloneIds);
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `已复制 ${cloneIds.length || "若干"} 个图元并重复位移${
        write.written ? " · Ctrl+Z 一次撤销" : " · 源码栏未就绪，无撤销记录"
      }`,
    });
  }

  /** F2-2：点图元本体或控制点都选中同一条语句；点空白清除选中。 */
  function resolveSelectedId(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const shape = target.closest("[data-source-id]");
    if (shape) return shape.getAttribute("data-source-id");
    const marker = target.closest("[data-dg-handle-id]");
    if (marker) {
      const id = marker.getAttribute("data-dg-handle-id");
      return resultRef.current?.handles.find((h) => h.id === id)?.sourceRef?.sourceId ?? null;
    }
    return null;
  }

  /** F3-7：空格 / 中键 / 抓手起视角平移；返回 true 表示已消费该次 pointerdown。 */
  function beginPan(e: ReactPointerEvent<HTMLElement>): boolean {
    if (panRef.current) return true;
    if (!tabVisibleRef.current) return false;
    if (!(spaceRef.current || e.button === 1 || handRef.current)) return false;
    e.preventDefault();
    panRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: viewportRef.current.panX,
      panY: viewportRef.current.panY,
    };
    return true;
  }

  /** F3-7：精确通道 stage 隐藏，平移要从外层 body 接管（只读通道视角操作仍可用）。 */
  function onBodyPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    beginPan(e);
  }

  function onStagePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (beginPan(e)) return;
    if (e.button !== 0) return;
    // F3-6：精确通道 stage 本来就 hidden，这里用统一只读判定再显式收口一次，
    // 保证选择 / 框选 / 拖拽 / 变换柄等所有画布编辑手势不会在该通道被触发。
    if (!canEditDiagramSource({ previewMode }).ok) return;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    // F3-1：非「选择」工具时画布归形状工具，绝不触发 F2-1 的控制点拖拽 / 点选。
    if (toolMode !== "select") {
      if (previewMode === "local") {
        e.preventDefault();
        beginShapeAt(e);
      }
      return;
    }
    // F3-4：先判变换柄（旋转 / 缩放），命中则只起变换手势，不动选择 / 不起框选 / 不拖坐标。
    const th = (e.target as Element | null)?.closest?.("[data-dg-transform-handle]") as
      | Element
      | null;
    if (th && previewMode === "local") {
      const kind = th.getAttribute("data-dg-transform-kind") === "scale" ? "scale" : "rotate";
      const corner = Number(th.getAttribute("data-dg-corner") ?? "0");
      startTransformFromEvent(kind, corner, e);
      if (transformRef.current) {
        e.preventDefault();
        return;
      }
    }
    // F3-3：点图元 = 单选 / Shift 加选减选；点空白 = 清空 + 起框选。
    // 多选且点中已选中的图元时**不重置选择**，交给 startDragFromEvent 判定「拖组」。
    const sid = resolveSelectedId(e.target);
    const additive = e.shiftKey;
    const current = useDiagramStore.getState().selectedIds;
    if (sid) {
      if (additive) {
        setSelectedIds(toggleSelection(current, sid, true));
      } else if (!(current.length > 1 && current.includes(sid))) {
        setSelectedId(sid);
      }
    } else {
      if (!additive) setSelectedIds([]);
      marqueeRef.current = {
        startClient: { x: e.clientX, y: e.clientY },
        additive,
        baseSelection: current,
        moved: false,
      };
      setMarqueeRect(null);
    }
    // Shift 点击只做加选 / 减选，绝不起拖，避免误改几何。
    if (sid && !additive) startDragFromEvent(e.target, { x: e.clientX, y: e.clientY });
    if (dragRef.current || marqueeRef.current) e.preventDefault();
  }

  /**
   * F4-3：双击节点文字 → 就地浮出输入框。
   * 命中 id 两种形态：顶层 \node 用 statement id，路径中间的 node 用 node item id，
   * findEditableNodeText 同时兼容。精确通道 stage 隐藏、双击落在 <img> 上，
   * 这里仍用统一只读判定拦截并提示，绝不弹可写输入框。
   */
  function onCanvasDoubleClick(e: ReactMouseEvent<HTMLDivElement>): void {
    const permission = canEditDiagramSource({ previewMode });
    if (!permission.ok) {
      setNotice({ tone: "warn", text: permission.reason });
      return;
    }
    if (nodeTextEdit) return; // 已在编辑：第二次双击不改草稿
    // 形状工具 / 视角手势下双击属于绘制 / 平移语义，绝不弹文字框
    if (toolMode !== "select" || panRef.current || transformRef.current || dragRef.current) return;
    const el = e.target instanceof Element ? e.target.closest("[data-source-id]") : null;
    if (!el) return; // 双击空白：静默交还，不改选中 / 不提示
    const hit = findEditableNodeText(
      resultRef.current?.statements ?? [],
      el.getAttribute("data-source-id") ?? "",
    );
    if (!hit) {
      setNotice({ tone: "warn", text: "该图元没有可就地编辑的文字，请在源码栏修改。" });
      return;
    }
    const state = useDiagramStore.getState();
    if (isManuallyLocked(state.grouping, hit.statement.id)) {
      setNotice({ tone: "warn", text: "该图元已在图层面板主动锁定，先解锁后再编辑文字。" });
      return;
    }
    const lockReason = resultRef.current?.compat?.lockReasons[hit.statement.id];
    if (lockReason) {
      setNotice({ tone: "warn", text: lockReason });
      return;
    }
    const body = bodyRef.current?.getBoundingClientRect();
    if (!body) return;
    const box = el.getBoundingClientRect();
    nodeTextCancelRef.current = false;
    setSelectedId(hit.statement.id);
    setNodeTextEdit({
      nodeTextId: hit.nodeText.id,
      statementId: hit.statement.id,
      text: hit.nodeText.text,
      left: Math.max(8, Math.min(box.left - body.left + box.width / 2 - 100, body.width - 220)),
      top: Math.max(8, box.top - body.top - 6),
      width: Math.max(160, Math.min(box.width + 24, body.width - 24)),
    });
  }

  /** F4-3：提交就地编辑；失败保留输入框让用户改，成功一次 dispatch = 一条 Ctrl+Z。 */
  function commitNodeTextEdit(): void {
    const edit = nodeTextEdit;
    if (!edit) return;
    const src = sourceRef.current;
    const stmt = (resultRef.current?.statements ?? []).find((s) => s.id === edit.statementId);
    if (!stmt) {
      setNodeTextEdit(null);
      setNotice({ tone: "warn", text: "画布正在重渲染，请重新双击节点编辑。" });
      return;
    }
    const plan = planNodeTextEdit(src, stmt, edit.nodeTextId, edit.text);
    if (plan.status === "error") {
      setNotice({ tone: "warn", text: plan.reason });
      return; // 保留输入框与草稿，用户可直接改
    }
    setNodeTextEdit(null);
    if (plan.status === "noop") {
      setNotice({ tone: "warn", text: "文字未变化，源码未改动。" });
      return;
    }
    const next = src.slice(0, plan.patch.from) + plan.patch.insert + src.slice(plan.patch.to);
    const write = commitDiagramPatch({
      key: `node-text:${edit.nodeTextId}`,
      source: src,
      nextSource: next,
      fallback: setSource,
    });
    setNotice({
      tone: write.written ? "ok" : "warn",
      text: `${plan.label}${
        write.written
          ? write.merged
            ? " · 连续修改已并组，Ctrl+Z 撤回整组"
            : " · Ctrl+Z 可撤销"
          : " · 源码栏未就绪，无撤销记录"
      }`,
    });
  }

  function historyCommand(kind: "undo" | "redo"): void {
    if (!runDiagramHistoryCommand(kind)) {
      setNotice({ tone: "warn", text: "没有可撤销 / 重做的改动，或源码栏尚未就绪。" });
    }
  }

  // F3-3：画布头部的编组 / 解组快捷入口（侧栏图层面板也有完整版）。
  // 解组按「当前多选是否恰好等于某组成员」定位，不需要额外的面板选中态。
  const selectionGroupId = useMemo(
    () => findGroupByMembers(grouping.groups, selectedIds),
    [grouping.groups, selectedIds],
  );

  function groupSelection(): void {
    if (selectedIds.length < 2) return;
    const out = createGroup(grouping, selectedIds);
    if (!out.groupId) return;
    setGrouping(out.state);
    setNotice({
      tone: "ok",
      text: `已编组 ${selectedIds.length} 个图元 · 源码零改动，拖组后一次 Ctrl+Z 退回整组`,
    });
  }

  function ungroupSelection(): void {
    if (!selectionGroupId) return;
    setGrouping(deleteGroup(grouping, selectionGroupId));
    setNotice({ tone: "ok", text: "已解组 · 只删除编辑器侧元数据，源码不变" });
  }

  const preciseImg = useMemo(
    () => (precise?.status === "ok" && precise.svg ? svgDataUrl(precise.svg) : null),
    [precise],
  );

  const canZoomOut = zoom > MIN_ZOOM + 1e-6;
  const canZoomIn = zoom < MAX_ZOOM - 1e-6;
  const currentViewBox = result?.viewBox ?? { x: 0, y: 0, width: 1, height: 1 };
  const currentPaper = canvasPaperRect(canvasSize, currentViewBox);
  // 精确通道的 <img> 与本地画布共用同一「纸面倍率」：zoom=1 时两边的图一样大。
  // 本地通道不渲染（stage 清空）时也要能跟随 zoom，所以在渲染期直接算一次。
  const preciseScale = renderScale(
    zoom,
    bodyRef.current?.getBoundingClientRect() ?? null,
    currentViewBox,
    currentPaper,
  );
  const localDiags = result?.diagnostics ?? [];
  const unsupported = result?.unsupported ?? [];
  const showDiags = diagOpen ?? unsupported.length > 0;
  const hasErrorDiag = localDiags.some((d) => d.severity === "error");
  const blankSvg =
    previewMode === "local" && !!result && !error && !hasDrawableContent(result.svg);
  const preciseFailed = previewMode === "precise" && precise?.status === "error";
  const preciseErrors = precise?.status === "error" ? precise.errors ?? [] : [];
  // 提示条按编译结果分态：只有 XeLaTeX 真正成功出图才显示绿色「已还原」，
  // 编译中 / 等待 / 失败都不能谎报成功。颜色由 CSS 的 --alert-tone 驱动。
  const preciseOk = previewMode === "precise" && precise?.status === "ok" && !!preciseImg;
  const alertTone = preciseFailed ? "err" : preciseOk ? "ok" : "warn";
  const unsupportedCount = unsupported.length;
  const handleCount = result?.handles.length ?? 0;
  // F2-3：兼容报告只在本地即时通道有语义句柄；精确通道是 XeLaTeX 只读结果，不显示锁定层。
  const compat = previewMode === "local" ? (result?.compat ?? null) : null;
  const compatIssues = compat?.issues ?? [];
  const compatUnrendered = compat?.unsupportedFeatures ?? [];
  const compatLocked = compat?.lockedHandleCount ?? 0;
  const compatItemCount = compatIssues.length + compatUnrendered.length;
  const showCompatBar = !!compat && !compat.empty;
  const selectionHint =
    selectedIds.length > 1
      ? `已选 ${selectedIds.length} 项（拖任一选中图元整体移动 · 可编组 · Delete 删除）`
      : selectedId
        ? `选中 ${selectedId}（画布左侧属性面板改属性 · Delete 删除）`
        : "未选中图元（点选后可改属性 / Delete 删除）";
  const footHint =
    previewMode !== "local"
      ? "精确预览只读 · 切回本地即时可绘制"
      : toolMode === "select"
        ? `拖动命中圈实时预览 · 松手写回坐标 · 空白拖框选 / Shift 加选 · ${handleCount} 个控制点${compatLocked > 0 ? `（${compatLocked} 个已锁定）` : ""} · ${selectionHint}`
        : `${toolDef(toolMode).label}工具已启用 · 绘制时隐藏控制点 · ${selectionHint}`;

  return (
    <div className="dg-canvas">
      <div className="dg-canvas-head">
        <span className="dg-canvas-badge">画布预览</span>
        <div className="dg-mode-switch dg-head-group" data-label="预览" role="group" aria-label="预览通道">
          <button
            type="button"
            className={previewMode === "local" ? "on" : ""}
            aria-pressed={previewMode === "local"}
            title="tikz-editor 即时预览（毫秒级，覆盖集有限，可拖拽写回）"
            onClick={() => setPreviewMode("local")}
          >
            本地即时
          </button>
          <button
            type="button"
            className={previewMode === "precise" ? "on" : ""}
            aria-pressed={previewMode === "precise"}
            title="XeLaTeX 编译 TikZ 片段（秒级，100% 还原；只读）"
            onClick={() => setPreviewMode("precise")}
          >
            XeLaTeX 精确
          </button>
        </div>
        <span className="dg-canvas-hint">
          {previewMode === "local" ? "tikz-editor · 可拖拽" : "standalone · 100% 还原"}
        </span>
        {/* F2-4：撤销 / 重做操作的是源码 history，与预览通道无关，两个通道常驻；
            控制点只在本地即时通道有意义。 */}
        <div className="dg-edit-tools dg-head-group" data-label="编辑" role="group" aria-label="编辑操作">
          {previewMode === "precise" && (
            <button
              type="button"
              className="dg-recompile-btn"
              disabled={empty || preciseBusy}
              title="忽略缓存并立即用当前 TikZ 源码重新跑一次 XeLaTeX"
              onClick={recompilePrecise}
            >
              {preciseBusy ? "编译中…" : "重新编译"}
            </button>
          )}
          {previewMode === "local" && (
            <button
              type="button"
              className={`dg-icon-btn${handlesOn ? " on" : ""}`}
              aria-label={handlesOn ? "隐藏控制点" : "显示控制点"}
              aria-pressed={handlesOn}
              title="显示 / 隐藏可拖拽控制点"
              onClick={() => setHandlesOn(!handlesOn)}
            >
              <ToolbarIcon name="handles" />
            </button>
          )}
          {/* F3-2：三档视觉半径；命中范围始终独立且更大。设置页「绘图」分区可改默认值。 */}
          {previewMode === "local" && (
            <label className="dg-handle-size" title={handleSizeSummary(handleSize)}>
              <ToolbarIcon name="handles" />
              <select
                value={handleSize}
                aria-label="控制点大小"
                title={`控制点视觉档位 · ${handleSizeSummary(handleSize)} · 设置页「绘图」可改默认值`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isHandleSize(v)) setHandleSize(v);
                }}
              >
                {(Object.keys(HANDLE_SIZE_LABELS) as HandleSize[]).map((s) => (
                  <option key={s} value={s}>
                    {HANDLE_SIZE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* F3-3：编组 / 解组只改编辑器侧元数据，源码零污染 */}
          {previewMode === "local" && (
            <>
              <button
                type="button"
                className="dg-icon-btn"
                aria-label="编组"
                disabled={selectedIds.length < 2}
                title="把当前多选编成虚拟分组（不写进 TikZ、不包 scope）"
                onClick={groupSelection}
              >
                <ToolbarIcon name="group" />
              </button>
              <button
                type="button"
                className="dg-icon-btn"
                aria-label="解组"
                disabled={!selectionGroupId}
                title="解散当前选中的虚拟分组（源码不变）"
                onClick={ungroupSelection}
              >
                <ToolbarIcon name="ungroup" />
              </button>
              <button
                type="button"
                className="dg-icon-btn dg-delete-btn"
                aria-label="删除选中图元"
                disabled={selectedIds.length === 0}
                title="删除选中的顶层图元（Delete / Backspace · Ctrl+Z 可撤销）"
                onClick={deleteSelection}
              >
                <ToolbarIcon name="delete" />
              </button>
            </>
          )}
          <button
            type="button"
            className="dg-icon-btn"
            aria-label="撤销"
            title="撤销上一次源码 / 拖拽 / 属性改动 (Ctrl+Z)"
            onClick={() => historyCommand("undo")}
          >
            <ToolbarIcon name="undo" />
          </button>
          <button
            type="button"
            className="dg-icon-btn"
            aria-label="重做"
            title="重做 (Ctrl+Shift+Z / Ctrl+Y)"
            onClick={() => historyCommand("redo")}
          >
            <ToolbarIcon name="redo" />
          </button>
        </div>
        {previewMode === "local" && localDiags.length > 0 && (
          <button
            type="button"
            className={`dg-diag-toggle${hasErrorDiag || unsupported.length > 0 ? " is-error" : ""}`}
            onClick={() => setDiagOpen(!showDiags)}
            title="展开 / 收起解析诊断"
          >
            {localDiags.length} 条诊断
          </button>
        )}
        {/* F3-7：视图分组。视角手势只改组件 state，不写源码 / 不入 history。 */}
        <div className="dg-view-tools dg-head-group" data-label="视图" role="group" aria-label="视图">
          <button
            type="button"
            className={`dg-view-btn dg-icon-btn${handTool ? " is-active" : ""}`}
            aria-label={handTool ? "关闭抓手" : "开启抓手"}
            aria-pressed={handTool}
            title="抓手：按住拖拽平移（空格可临时切换）"
            onClick={() => {
              handRef.current = !handTool;
              setHandTool(!handTool);
            }}
          >
            <ToolbarIcon name="hand" />
          </button>
          <button
            type="button"
            className="dg-view-btn dg-icon-btn"
            aria-label="适应画布"
            title="适应画布（100%：整张纸完整可见并居中）"
            onClick={() => {
              const rect = bodyRef.current?.getBoundingClientRect();
              setViewport(fitCanvasViewport(rect, currentViewBox, currentPaper));
            }}
          >
            <ToolbarIcon name="fitCanvas" />
          </button>
          <button
            type="button"
            className="dg-view-btn dg-icon-btn"
            aria-label="适应内容"
            title="适应内容：把图形包围盒铺满窗口（纸张会超出视口）"
            onClick={() => {
              const rect = bodyRef.current?.getBoundingClientRect();
              const zoomNext = fitContentZoom(rect, currentViewBox, currentPaper);
              setViewport({ zoom: zoomNext, panX: 0, panY: 0 });
            }}
          >
            <ToolbarIcon name="fitContent" />
          </button>
        </div>
        <div className="dg-zoom dg-head-group" data-label="缩放" role="group" aria-label="缩放">
          <button
            type="button"
            className="dg-zoom-btn dg-icon-btn"
            aria-label="缩小"
            disabled={!canZoomOut}
            title="缩小"
            onClick={() => setViewport((v) => ({ ...v, zoom: clampZoom(v.zoom / 1.25) }))}
          >
            <ToolbarIcon name="zoomOut" />
          </button>
          <button
            type="button"
            className="dg-zoom-btn dg-icon-btn"
            aria-label="整页"
            title="整页（画布完整可见并居中）"
            onClick={() => {
              const rect = bodyRef.current?.getBoundingClientRect();
              setViewport(fitCanvasViewport(rect, currentViewBox, currentPaper));
            }}
          >
            <ToolbarIcon name="fitPage" />
          </button>
          <button
            type="button"
            className="dg-zoom-btn dg-icon-btn"
            aria-label="放大"
            disabled={!canZoomIn}
            title="放大"
            onClick={() => setViewport((v) => ({ ...v, zoom: clampZoom(v.zoom * 1.25) }))}
          >
            <ToolbarIcon name="zoomIn" />
          </button>
          <span className="dg-zoom-val">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* F3-1：基础图元工具调色板（2026-11-12 从侧栏搬回，画布顶部第一行）。精确通道整排禁用。 */}
      <ShapeToolbar sessionHint={sessionHint} onNewBlank={newBlankDiagram} />

      {/* 覆盖缺口会被引擎静默丢弃（如 \pic{angle} / angles 库），画布看起来"正常"但少元素。
          常驻显式提示 + 一键切 XeLaTeX 精确预览，避免用户以为是自己代码写错。
          精确通道下不再挂按钮：成功已还原无需操作，失败时下方 XeLaTeX 报错列表本来就常驻，
          原「查看诊断」调用的 setDiagOpen 在精确通道没有任何可见效果（死点击）。 */}
      {unsupportedCount > 0 && !error && (
        <div className={`dg-canvas-alert dg-notice is-${alertTone}`} role="status">
          <strong>
            {preciseFailed
              ? "XeLaTeX 编译失败"
              : preciseOk
                ? "已用 XeLaTeX 还原"
                : previewMode === "precise"
                  ? "正在用 XeLaTeX 编译…"
                  : "预览不完整"}
          </strong>
          <span>
            {preciseOk
              ? `本地引擎不支持的 ${unsupportedCount} 处构造已完整呈现，与导出结果一致。`
              : preciseFailed
                ? `本地引擎不支持的 ${unsupportedCount} 处构造仍未还原，请查看下方 XeLaTeX 报错。`
                : `${unsupportedCount} 处构造本地引擎暂不支持，画布已省略；导出仍以 XeLaTeX 编译结果为准。`}
          </span>
          {previewMode === "local" && (
            <button type="button" onClick={() => setPreviewMode("precise")}>
              用 XeLaTeX 精确预览
            </button>
          )}
        </div>
      )}

      {/* F2-3：能力矩阵锁定清单。默认展开、理由常驻，用户可收起但不做「只有一个折叠按钮」。
          与上面的「预览不完整」提示互补：那条讲渲染缺口，这条讲编辑缺口（哪些对象不能拖 / 改属性）。 */}
      {showCompatBar && compat && (
        <div className="dg-lock-bar dg-notice is-warn" role="status">
          <div className="dg-lock-head">
            <span className="dg-lock-badge">
              {compatLocked > 0 ? "已锁定编辑" : "编辑能力提示"}
            </span>
            <strong>{compat.summary || `${compatItemCount} 处构造需要留意`}</strong>
            {compat.hasUnsupported && previewMode === "local" && (
              <button type="button" onClick={() => setPreviewMode("precise")}>
                XeLaTeX 精确还原
              </button>
            )}
            <button
              type="button"
              className="dg-lock-toggle"
              aria-expanded={lockOpen}
              onClick={() => setLockOpen(!lockOpen)}
            >
              {lockOpen ? "收起理由" : `查看 ${compatItemCount} 条理由`}
            </button>
          </div>
          {lockOpen && (
            <ul className="dg-lock-list">
              {compatIssues.slice(0, MAX_LOCK_ITEMS).map((it) => (
                <li key={it.id} className={`is-${it.severity}`} title={it.detail}>
                  <span className="dg-lock-tag">{it.severity === "lock" ? "锁定" : "留意"}</span>
                  <span className="dg-lock-text">{it.reason}</span>
                  <em>
                    {it.statementId ?? "全局"} · edit={it.support}
                  </em>
                </li>
              ))}
              {compatUnrendered.slice(0, Math.max(0, MAX_LOCK_ITEMS - compatIssues.length)).map((f) => (
                <li key={f.id} className="is-warn" title={f.notes || undefined}>
                  <span className="dg-lock-tag">未还原</span>
                  <span className="dg-lock-text">
                    {f.label}：上游语义层标记为未完整支持，本地画布可能缺元素。
                  </span>
                  <em>{f.id}</em>
                </li>
              ))}
              {compatItemCount > MAX_LOCK_ITEMS && (
                <li className="dg-lock-more">…另有 {compatItemCount - MAX_LOCK_ITEMS} 条，请展开诊断或检查源码</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div
        className="dg-canvas-body"
        ref={bodyRef}
        onPointerDown={onBodyPointerDown}
        onDoubleClick={onCanvasDoubleClick}
      >
        {/* F3-7：视角容器只做平移；zoom 仍走 SVG width/height 百分比与精确 img 的 scale，
            保证 getScreenCTM / svgUnitScale 的既有换算口径不变。 */}
        <div
          className="dg-viewport"
          style={{ transform: viewportTransform(viewport) }}
          data-pan={handTool ? "1" : undefined}
        >
          <div
            className="dg-canvas-stage"
            ref={stageRef}
            data-tool={toolMode}
            hidden={previewMode === "precise"}
            onPointerDown={onStagePointerDown}
          />
          {previewMode === "precise" && preciseImg && (
            <img
              className="dg-precise-img"
              src={preciseImg}
              alt="XeLaTeX 精确预览"
              style={{ transform: `scale(${preciseScale})` }}
            />
          )}
        </div>
        {/* F4-3：就地文字编辑浮层。定位相对 .dg-canvas-body（唯一裁剪层），
            不进 viewport 的 transform，pan / zoom 时不会被拉伸或截断。 */}
        {nodeTextEdit && (
          <div
            className="dg-text-edit"
            style={{ left: nodeTextEdit.left, top: nodeTextEdit.top, width: nodeTextEdit.width }}
          >
            <input
              autoFocus
              className="dg-text-edit-input"
              value={nodeTextEdit.text}
              placeholder="节点文字 · 可用 $...$ 公式"
              spellCheck={false}
              onChange={(e) =>
                setNodeTextEdit((cur) => (cur ? { ...cur, text: e.target.value } : null))
              }
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitNodeTextEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  nodeTextCancelRef.current = true;
                  setNodeTextEdit(null);
                }
              }}
              onBlur={() => {
                if (nodeTextCancelRef.current) {
                  nodeTextCancelRef.current = false;
                  return;
                }
                commitNodeTextEdit();
              }}
            />
            <span className="dg-text-edit-hint">Enter 应用 · Esc 取消</span>
          </div>
        )}
        {empty && (
          <div className="dg-canvas-overlay dg-state is-empty">
            源码为空。请切到「仅源码」或「左右分屏」编写 TikZ 代码。
          </div>
        )}
        {!empty && previewMode === "local" && error && (
          <div className="dg-canvas-overlay dg-canvas-error dg-state is-error">
            <strong>渲染失败</strong>
            <p>{error}</p>
            <span>修正源码后会自动重渲染；主文档不受影响。</span>
          </div>
        )}
        {!empty && previewMode === "local" && !error && !result && (
          <div className="dg-canvas-overlay dg-state is-loading">
            {engineReady ? "正在渲染…" : "正在加载渲染引擎（首次约 3.4 MB）…"}
          </div>
        )}
        {!empty && blankSvg && (
          <div className="dg-canvas-overlay dg-canvas-warn dg-state is-warn">
            画布为空：本地引擎未识别到可绘制对象。请检查 TikZ 语法、展开诊断，或切到 XeLaTeX 精确预览。
          </div>
        )}
        {!empty && previewMode === "precise" && !preciseImg && !preciseFailed && (
          <div className="dg-canvas-overlay dg-state is-loading">
            {preciseBusy
              ? "正在用 XeLaTeX 编译 TikZ 片段（首次可能较慢）…"
              : "等待精确预览…"}
          </div>
        )}
        {!empty && preciseFailed && (
          <div className="dg-canvas-overlay dg-canvas-error dg-state is-error">
            <strong>XeLaTeX 编译失败</strong>
            <p>{precise?.message ?? "未知错误"}</p>
            <span>
              {preciseErrors.length > 0
                ? `报错行号已换算为绘图源码行号（共 ${preciseErrors.length} 条）。`
                : "请检查 TeX 发行版是否安装、以及片段是否自包含（不引用主文档宏）。"}
              主文档不受影响。
            </span>
          </div>
        )}
        {previewMode === "local" && busy && result && !error && (
          <div className="dg-canvas-busy">渲染中…</div>
        )}
        {previewMode === "precise" && preciseBusy && preciseImg && (
          <div className="dg-canvas-busy">XeLaTeX 编译中…</div>
        )}
        {dragLabel && (
          <div className="dg-drag-chip">
            <strong>{dragLabel}</strong>
            <span>松开写回源码 · Esc 取消</span>
          </div>
        )}
        {notice && (
          <div className={`dg-drag-notice is-${notice.tone}`} role="status">
            {notice.text}
          </div>
        )}
        {/* F3-3：框选矩形用 position:fixed 直接吃 client 坐标，不做容器偏移换算；
            pointer-events:none 保证不拦截 stage 上的 pointerdown / move。 */}
        {marqueeRect && (
          <div
            className="dg-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: Math.max(0, marqueeRect.right - marqueeRect.left),
              height: Math.max(0, marqueeRect.bottom - marqueeRect.top),
            }}
          />
        )}
      </div>

      {previewMode === "local" && showDiags && localDiags.length > 0 && (
        <ul className="dg-diag-list">
          {localDiags.slice(0, MAX_DIAG).map((d, i) => (
            <li key={`${d.offset ?? -1}-${i}`} className={d.severity === "error" ? "is-error" : ""}>
              <span className="dg-diag-sev">{d.severity === "error" ? "错误" : "警告"}</span>
              {d.message}
              {typeof d.offset === "number" && <em> @{d.offset}</em>}
              {d.code && <em> [{d.code}]</em>}
            </li>
          ))}
          {localDiags.length > MAX_DIAG && (
            <li className="dg-diag-more">…另有 {localDiags.length - MAX_DIAG} 条</li>
          )}
        </ul>
      )}
      {previewMode === "precise" && preciseErrors.length > 0 && (
        <ul className="dg-diag-list">
          {preciseErrors.slice(0, MAX_DIAG).map((e, i) => (
            <li key={`${e.line}-${i}`} className={e.severity === "error" ? "is-error" : ""}>
              <span className="dg-diag-sev">XeLaTeX</span>
              {e.readable || e.raw}
              <em> 第 {e.line} 行</em>
            </li>
          ))}
        </ul>
      )}

      <div className="dg-canvas-foot">
        <span className="dg-foot-item">
          {previewMode === "local"
            ? result
              ? `${result.fromCache ? "缓存命中" : `渲染 ${result.elapsedMs.toFixed(0)} ms`} · ${result.viewBox.width.toFixed(0)}×${result.viewBox.height.toFixed(0)}`
              : "—"
            : precise?.status === "ok"
              ? `XeLaTeX 编译 ${precise.elapsedMs} ms · 矢量 SVG`
              : precise?.status === "error"
                ? "编译失败"
                : "—"}
        </span>
        {/* F3-7：倍率 + 指针 world 坐标 + 纸张尺寸，全部是视角元数据，不写源码 */}
        <span className="dg-foot-item">
          {Math.round(zoom * 100)}% · {pointerWorldLabel}
          {canvasSize.preset !== "auto" && ` · 画布 ${canvasSize.widthCm.toFixed(1)}×${canvasSize.heightCm.toFixed(1)}cm`}
        </span>
        <span className="dg-foot-item">{footHint}</span>
        <span className="dg-foot-item">插入目标：{targetTex ? basename(targetTex) : "未锁定"}</span>
      </div>
    </div>
  );
}
