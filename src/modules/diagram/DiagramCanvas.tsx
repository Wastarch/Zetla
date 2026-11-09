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
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useBuffersStore } from "@/editor/useBuffers";
import { useSettingsStore } from "@/core/settings";
import { useDiagramStore } from "./store";
import {
  applyDragEdit,
  preloadTikzEngine,
  renderTikz,
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
  buildHandleLayer,
  createSelectionLayer,
  drawSelectionBox,
} from "./handleLayer";
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
import { ShapeToolbar } from "./ShapeToolbar";
import { resolveHandleLock } from "./tikzEditor/compat";
import {
  commitDiagramPatch,
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

const LOCAL_DEBOUNCE_MS = 160;
const PRECISE_DEBOUNCE_MS = 800;
const DIAGRAM_PATH = "diagram://editor";
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];
const MAX_DIAG = 5;
const SVG_NS = "http://www.w3.org/2000/svg";
/** F3-2：恒屏尺寸统一由 handleVisual.handleMetrics(size, 实测 unitScale) 给出；
 *  单位比 = 屏幕 px / SVG 用户单位，已含 UI zoom 与 viewBox→px 缩放，不能只传 zoom。 */
const DRAG_THRESHOLD_PX = 3;
/** 常驻锁定清单最多列出几条；hover title 里始终带完整长说明 */
const MAX_LOCK_ITEMS = 4;
/** F3-1：形状工具的最小拖拽距离（屏幕 px），低于此值视为误点 */
const SHAPE_THRESHOLD_PX = 3;
/** 空白画布的默认环境（空源码时先建环境，才能在 SVG 上取坐标） */
const BLANK_DIAGRAM = "\\begin{tikzpicture}\n  \n\\end{tikzpicture}";

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
}

interface Notice {
  tone: "ok" | "warn" | "err";
  text: string;
}

export function DiagramCanvas() {
  const source = useDiagramStore((s) => s.source);
  const setSource = useDiagramStore((s) => s.setSource);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const setPreviewMode = useDiagramStore((s) => s.setPreviewMode);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const setSelectedId = useDiagramStore((s) => s.setSelectedId);
  const setRenderMeta = useDiagramStore((s) => s.setRenderMeta);
  const activePath = useBuffersStore((s) => s.activePath);
  const tabVisible = activePath === DIAGRAM_PATH;

  const [result, setResult] = useState<TikzRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  // null = 跟随默认（有覆盖缺口就自动展开）；true/false = 用户手动展开/收起
  const [diagOpen, setDiagOpen] = useState<boolean | null>(null);
  const [precise, setPrecise] = useState<TikzPreviewResult | null>(null);
  const [preciseBusy, setPreciseBusy] = useState(false);
  const [handlesOn, setHandlesOn] = useState(true);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // F2-3 锁定清单：默认展开且常驻，不做「只有一个折叠按钮」的死 UI
  const [lockOpen, setLockOpen] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
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
        (r) => {
          if (cancelled) return;
          setResult(r);
          setError(null);
          setBusy(false);
          setRenderMeta({ source, statements: r.statements, compat: r.compat });
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

  // 精确通道：只在 Tab 激活 + 精确模式 + 有源码时编译。
  // 缓存命中直接出图；同 key 并发由 precisePreview 单飞；旧结果用 cancelled 丢弃。
  useEffect(() => {
    if (previewMode !== "precise" || empty || !tabVisible) {
      setPreciseBusy(false);
      return;
    }
    const engine = useSettingsStore.getState().settings.build.engine;
    const hit = getCachedPreview(previewKey(source, engine));
    if (hit) {
      setPrecise(hit);
      setPreciseBusy(false);
      return;
    }
    let cancelled = false;
    setPreciseBusy(true);
    const timer = window.setTimeout(() => {
      requestPrecisePreview(source, engine).then((r) => {
        if (cancelled) return;
        setPrecise(r);
        setPreciseBusy(false);
      });
    }, PRECISE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, empty, previewMode, tabVisible]);

  // 消毒后挂载本地 SVG。精确模式下清空 stage（改由 <img> 显示，不内联注入）。
  // 每次重建都丢弃旧拖拽持有的 DOM 引用，避免把位移写到已被替换的控制点上。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    dragRef.current = null;
    setDragLabel(null);
    if (!result || previewMode === "precise") {
      stage.replaceChildren();
      return;
    }
    const node = sanitizeSvg(result.svg, result.viewBox, zoom);
    if (!node) {
      stage.replaceChildren();
      setError("引擎返回的 SVG 无法解析，已阻止注入画布。");
      return;
    }
    // F3-2：辅助层的「屏幕 px」要换算成 SVG 用户单位，必须先挂到 DOM 才能用
    // getScreenCTM() 量出真实单位比（viewBox→CSS px 的缩放不等于 UI zoom）。
    stage.replaceChildren(node);
    const scale = svgUnitScale(node, result.viewBox, zoom, stage.getBoundingClientRect());
    if (Math.abs(scale - unitScaleRef.current) > 1e-6) {
      unitScaleRef.current = scale;
      setUnitScale(scale);
    }
    // 首帧就用实测值建层，不等 setState 的重渲染，避免「先大后小」闪一下。
    const m = handleMetrics(handleSize, scale);
    // 先挂选中层（在控制点层之下），再挂控制点层。两层都只用 createElementNS
    // 追加到已消毒 SVG 之后；精确通道走 <img>，这里不会执行到。
    createSelectionLayer(node);
    // F3-1：形状工具模式下不挂控制点，避免小圆点挡住起笔 / 抢 pointerdown。
    if (handlesOn && toolMode === "select" && result.handles.length > 0) {
      buildHandleLayer(node, result.handles, result.viewBox, result.compat, m);
    }
  }, [result, zoom, previewMode, handlesOn, toolMode, handleSize, unitScale]);

  // 侧栏伸缩 / 分屏切换 / 窗口 resize 会改变 viewBox→px 的比例，重测一次单位比。
  // ResizeObserver 观察的是 stage 尺寸，replaceChildren 不会造成回调循环。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const svg = stage.querySelector("svg") as SVGSVGElement | null;
      const res = resultRef.current;
      if (!svg || !res || previewMode === "precise") return;
      const scale = svgUnitScale(svg, res.viewBox, zoom, stage.getBoundingClientRect());
      if (Math.abs(scale - unitScaleRef.current) > 1e-6) {
        unitScaleRef.current = scale;
        setUnitScale(scale);
      }
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [previewMode, zoom]);

  // F2-2 选中高亮：只 toggle class，不重建 SVG —— 重建会丢弃正在拖拽的 DOM 引用，
  // 也会让 CM6 视图之外的画布状态抖动。drop-shadow 不改变实际描边颜色，避免误以为改了色。
  // F3-2：同一条 effect 里给控制点 <g> 标 is-selected，选中图元的手柄会填充强调色。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || previewMode !== "local") return;
    for (const el of Array.from(stage.querySelectorAll("[data-source-id]"))) {
      el.classList.toggle("dg-selected", el.getAttribute("data-source-id") === selectedId);
    }
    for (const node of Array.from(stage.querySelectorAll("g.dg-handle-node"))) {
      node.classList.toggle(
        "is-selected",
        !!selectedId && node.getAttribute("data-dg-source-id") === selectedId,
      );
    }
  }, [selectedId, result, zoom, previewMode, handlesOn, metrics]);

  // F3-2：选中包围盒。只重画辅助层（不重建主 SVG、不打断 F2-1 拖拽）。
  // 用 getBoundingClientRect()（屏幕像素，天然含 transform）再经 getScreenCTM() 完整仿射逆
  // 回到 SVG 用户坐标；不用 getBBox()，避免局部坐标系与元素 transform 叠加算错。
  // 零尺寸（display:none / 尚未布局）矩形跳过，否则会把 (0,0) 并进包围盒。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const svg = stage.querySelector("svg") as SVGSVGElement | null;
    const layer = svg?.querySelector("[data-dg-selection-layer]") as SVGGElement | null;
    if (!svg || !layer) return;
    const editable =
      previewMode === "local" && handlesOn && toolMode === "select" && !!selectedId;
    const ctm = editable ? svg.getScreenCTM?.() : null;
    if (!ctm) {
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
      .filter((el) => el.getAttribute("data-source-id") === selectedId)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => !(r.width === 0 && r.height === 0))
      .map((r) => clientRectToSvgBox(r, m));
    drawSelectionBox(layer, unionBoxes(boxes), metrics);
  }, [selectedId, result, zoom, previewMode, handlesOn, toolMode, metrics]);

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
  useEffect(() => {
    shapeApiRef.current.cancel(true);
  }, [toolMode, previewMode]);

  // 拖拽提交：只算一次新源码，再以最小 span 补丁写回 CM6（F2-1 与键盘编辑同撤销栈）。
  // F2-4：同一控制点的连续微调并入一组 history，一次 Ctrl+Z 回到这一串调整之前。
  commitDragRef.current = (d: DragState) => {
    const src = sourceRef.current;
    const res = resultRef.current;
    if (!res || src !== d.sourceAtStart || res !== d.resultAtStart) {
      setNotice({ tone: "warn", text: "源码在拖拽期间发生变化，请重新拖动。" });
      return;
    }
    void applyDragEdit(src, res.handles, d.handleId, d.newWorld).then((outcome) => {
      if (outcome.status !== "ok") {
        setNotice(
          outcome.status === "unsupported"
            ? { tone: "warn", text: `无法写回：${outcome.reason}` }
            : { tone: "err", text: `写回失败：${outcome.message}` },
        );
        return;
      }
      if (outcome.newSource === src) {
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
      // F3-1：形状工具会话优先；无会话时该函数立即返回，不影响 F2-1 控制点拖拽。
      shapeApiRef.current.move(e);
      const d = dragRef.current;
      if (!d) return;
      const dxPx = e.clientX - d.startClient.x;
      const dyPx = e.clientY - d.startClient.y;
      if (!d.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const dSvg = clientDeltaToSvgDelta(d.matrix, dxPx, dyPx);
      if (!dSvg) return;
      const dWorld = svgDeltaToWorldDelta(dSvg);
      d.newWorld = { x: d.startWorld.x + dWorld.x, y: d.startWorld.y + dWorld.y };
      const curSvg = { x: d.startSvg.x + dSvg.x, y: d.startSvg.y + dSvg.y };
      d.marker.setAttribute("cx", fmtNum(curSvg.x));
      d.marker.setAttribute("cy", fmtNum(curSvg.y));
      d.hitMarker?.setAttribute("cx", fmtNum(curSvg.x));
      d.hitMarker?.setAttribute("cy", fmtNum(curSvg.y));
      if (d.guide) {
        d.guide.setAttribute("x2", fmtNum(curSvg.x));
        d.guide.setAttribute("y2", fmtNum(curSvg.y));
      }
      setDragLabel(dragDeltaLabel(dWorld.x, dWorld.y));
    };
    const onUp = () => {
      // F3-1：形状工具松手提交；多点工具无 toolDragRef，这里会直接返回。
      shapeApiRef.current.up();
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      d.marker.classList.remove("is-active");
      if (d.guide) d.guide.setAttribute("visibility", "hidden");
      setDragLabel(null);
      if (d.moved) commitDragRef.current(d);
    };
    const onCancel = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      resetMarker(d);
      setDragLabel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      // F3-1：Esc / Enter / Backspace 先给形状工具会话，绘制中不触发撤销栈。
      if (shapeApiRef.current.key(e)) return;
      if (e.key === "Escape" && dragRef.current) {
        onCancel();
        return;
      }
      // F2-4：仅画布布局（或焦点在画布 / 侧栏而非源码栏）时 CM6 收不到按键，
      // 由这里把撤销 / 重做转发到同一条 history；分屏里焦点在源码栏时应交回 CM6。
      const inGesture = !!dragRef.current || !!toolDragRef.current || !!shapeSessionRef.current;
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
  }, [previewMode]);

  // 提示条自动消失（4s），新提示会重置计时
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** 命中控制点，或直接拖图元本体（自动取它的 node-position 句柄）。 */
  function startDragFromEvent(target: EventTarget | null): void {
    if (previewMode !== "local" || !result || !handlesOn) return;
    if (!(target instanceof Element)) return;
    const svg = target.closest("svg") as SVGSVGElement | null;
    if (!svg) return;
    let hit: TikzEditHandle | undefined;
    const markerEl = target.closest("[data-dg-handle-id]");
    if (markerEl) {
      const id = markerEl.getAttribute("data-dg-handle-id");
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
    // F2-3：能力矩阵归因的锁定优先，理由更具体；F2-1 的 rewriteMode 兜底在后。
    const lockReason = resolveHandleLock(
      result.compat,
      hit.id,
      isDraggableHandle(hit),
      lockedHandleReason(hit),
    );
    if (lockReason !== null) {
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
    };
    marker.classList.add("is-active");
    if (guide) {
      guide.setAttribute("x1", fmtNum(startSvg.x));
      guide.setAttribute("y1", fmtNum(startSvg.y));
      guide.setAttribute("x2", fmtNum(startSvg.x));
      guide.setAttribute("y2", fmtNum(startSvg.y));
      guide.setAttribute("visibility", "visible");
    }
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

  function onStagePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
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
    const sid = resolveSelectedId(e.target);
    if (useDiagramStore.getState().selectedId !== sid) setSelectedId(sid);
    startDragFromEvent(e.target);
    if (dragRef.current) e.preventDefault();
  }

  function historyCommand(kind: "undo" | "redo"): void {
    if (!runDiagramHistoryCommand(kind)) {
      setNotice({ tone: "warn", text: "没有可撤销 / 重做的改动，或源码栏尚未就绪。" });
    }
  }

  const preciseImg = useMemo(
    () => (precise?.status === "ok" && precise.svg ? svgDataUrl(precise.svg) : null),
    [precise],
  );

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex >= 0 && zoomIndex < ZOOM_STEPS.length - 1;
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
  const footHint =
    previewMode !== "local"
      ? "精确预览只读 · 切回本地即时可绘制"
      : toolMode === "select"
        ? `拖动控制点写回坐标 · ${handleCount} 个控制点${compatLocked > 0 ? `（${compatLocked} 个已锁定）` : ""} · 选中 ${selectedId ?? "无"}（侧栏改属性）`
        : `${toolDef(toolMode).label}工具已启用 · 绘制时隐藏控制点 · 选中 ${selectedId ?? "无"}（插入后自动选中）`;

  return (
    <div className="dg-canvas">
      <div className="dg-canvas-head">
        <span className="dg-canvas-badge">画布预览</span>
        <div className="dg-mode-switch" role="group" aria-label="预览通道">
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
        <div className="dg-edit-tools">
          {previewMode === "local" && (
            <button
              type="button"
              className={handlesOn ? "on" : ""}
              aria-pressed={handlesOn}
              title="显示 / 隐藏可拖拽控制点"
              onClick={() => setHandlesOn(!handlesOn)}
            >
              控制点
            </button>
          )}
          {/* F3-2：三档视觉半径；命中范围始终独立且更大。设置页「绘图」分区可改默认值。 */}
          {previewMode === "local" && (
            <label className="dg-handle-size" title={handleSizeSummary(handleSize)}>
              <span>节点</span>
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
          <button
            type="button"
            title="撤销上一次源码 / 拖拽 / 属性改动 (Ctrl+Z)"
            onClick={() => historyCommand("undo")}
          >
            撤销
          </button>
          <button
            type="button"
            title="重做 (Ctrl+Shift+Z / Ctrl+Y)"
            onClick={() => historyCommand("redo")}
          >
            重做
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
        <div className="dg-zoom">
          <button
            type="button"
            className="dg-zoom-btn"
            disabled={!canZoomOut}
            title="缩小"
            onClick={() => setZoom(ZOOM_STEPS[zoomIndex - 1] ?? 1)}
          >
            −
          </button>
          <button type="button" className="dg-zoom-btn" title="适应窗口" onClick={() => setZoom(1)}>
            适应
          </button>
          <button
            type="button"
            className="dg-zoom-btn"
            disabled={!canZoomIn}
            title="放大"
            onClick={() => setZoom(ZOOM_STEPS[zoomIndex + 1] ?? 1)}
          >
            ＋
          </button>
          <span className="dg-zoom-val">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* F3-1：基础图元工具调色板。精确通道只读，组件内部整条禁用并给出常驻说明。 */}
      <ShapeToolbar sessionHint={sessionHint} onNewBlank={newBlankDiagram} />

      {/* 覆盖缺口会被引擎静默丢弃（如 \pic{angle} / angles 库），画布看起来"正常"但少元素。
          常驻显式提示 + 一键切 XeLaTeX 精确预览，避免用户以为是自己代码写错。
          精确通道下不再挂按钮：成功已还原无需操作，失败时下方 XeLaTeX 报错列表本来就常驻，
          原「查看诊断」调用的 setDiagOpen 在精确通道没有任何可见效果（死点击）。 */}
      {unsupportedCount > 0 && !error && (
        <div className={`dg-canvas-alert is-${alertTone}`} role="status">
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
        <div className="dg-lock-bar" role="status">
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

      <div className="dg-canvas-body">
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
            style={{ transform: `scale(${zoom})` }}
          />
        )}
        {empty && (
          <div className="dg-canvas-overlay">
            源码为空。请切到「仅源码」或「左右分屏」编写 TikZ 代码。
          </div>
        )}
        {!empty && previewMode === "local" && error && (
          <div className="dg-canvas-overlay dg-canvas-error">
            <strong>渲染失败</strong>
            <p>{error}</p>
            <span>修正源码后会自动重渲染；主文档不受影响。</span>
          </div>
        )}
        {!empty && previewMode === "local" && !error && !result && (
          <div className="dg-canvas-overlay">
            {engineReady ? "正在渲染…" : "正在加载渲染引擎（首次约 3.4 MB）…"}
          </div>
        )}
        {!empty && blankSvg && (
          <div className="dg-canvas-overlay dg-canvas-warn">
            画布为空：本地引擎未识别到可绘制对象。请检查 TikZ 语法、展开诊断，或切到 XeLaTeX 精确预览。
          </div>
        )}
        {!empty && previewMode === "precise" && !preciseImg && !preciseFailed && (
          <div className="dg-canvas-overlay">
            {preciseBusy
              ? "正在用 XeLaTeX 编译 TikZ 片段（首次可能较慢）…"
              : "等待精确预览…"}
          </div>
        )}
        {!empty && preciseFailed && (
          <div className="dg-canvas-overlay dg-canvas-error">
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
        <span>
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
        <span>{footHint}</span>
        <span>插入目标：{targetTex ? basename(targetTex) : "未锁定"}</span>
      </div>
    </div>
  );
}
