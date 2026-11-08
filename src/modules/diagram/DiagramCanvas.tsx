// M2·F1-3 / F1-6 / F2-1：TikZ 双通道画布 + 拖拽写回。
//  本地通道：source → debounce 160ms → engine.renderTikz（动态加载 vendor bundle + LRU
//            缓存 + 诊断归一化 + editHandles）→ svg.sanitizeSvg 白名单消毒 → importNode 挂载
//            → 追加控制点 <circle> 图层（DOM API 创建，不经过 innerHTML）。
//  精确通道：source → debounce 800ms → Rust tikz_preview（XeLaTeX standalone → PDF → SVG）
//            → data URL 交给 <img>（隔离文档，不内联注入、不受白名单限制）。精确通道只读，
//            没有语义句柄，拖拽只在本地通道开放。
//  拖拽写回：pointerdown 命中控制点 → window 级 pointermove（屏幕 px 经 getScreenCTM 反算
//            world 位移）→ pointerup 调上游 applyEditIntent 得到新源码 → 求最小 span 补丁
//            → 经 sourceBridge dispatch 到 CM6 视图（与键盘改源码共用撤销栈）。
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
  type TikzViewBox,
} from "./tikzEditor/engine";
import { hasDrawableContent, sanitizeSvg } from "./tikzEditor/svg";
import {
  MAX_VISIBLE_HANDLES,
  clientDeltaToSvgDelta,
  dragDeltaLabel,
  handleLabel,
  isDraggableHandle,
  lockedHandleReason,
  singleSpanPatch,
  svgDeltaToWorldDelta,
  worldToSvgPoint,
  type MatrixLike,
  type PointLike,
} from "./dragEdit";
import { getDiagramSourceBridge } from "./sourceBridge";
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
/** 控制点半径 / 线宽以「屏幕像素」为准，除以 zoom 换算到 SVG 用户单位 */
const HANDLE_R_PX = 4.2;
const HANDLE_STROKE_PX = 1.4;
const DRAG_THRESHOLD_PX = 3;

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10000) / 10000) : "0";
}

/** 控制点图层：画在消毒后的 SVG 之上，全部由 DOM API 创建，绝不拼 HTML 字符串。 */
function buildHandleLayer(
  svg: SVGSVGElement,
  handles: readonly TikzEditHandle[],
  viewBox: TikzViewBox,
  zoom: number,
): SVGGElement {
  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("data-dg-handle-layer", "1");
  const r = HANDLE_R_PX / zoom;
  const stroke = HANDLE_STROKE_PX / zoom;
  for (const h of handles.slice(0, MAX_VISIBLE_HANDLES)) {
    if (!h.world || !Number.isFinite(h.world.x) || !Number.isFinite(h.world.y)) continue;
    const p = worldToSvgPoint(h.world, viewBox);
    const draggable = isDraggableHandle(h);
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", `dg-handle${draggable ? "" : " is-locked"}`);
    c.setAttribute("cx", fmtNum(p.x));
    c.setAttribute("cy", fmtNum(p.y));
    c.setAttribute("r", fmtNum(r));
    c.setAttribute("stroke-width", fmtNum(stroke));
    c.setAttribute("data-dg-handle-id", h.id);
    c.setAttribute("data-dg-locked", draggable ? "0" : "1");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = draggable
      ? `${handleLabel(h)}：按住拖动可改写源码坐标`
      : lockedHandleReason(h);
    c.appendChild(title);
    layer.appendChild(c);
  }
  // 拖拽时的虚线引导（从起点到当前位置），平时 hidden
  const guide = document.createElementNS(SVG_NS, "line");
  guide.setAttribute("class", "dg-handle-guide");
  guide.setAttribute("data-dg-guide", "1");
  guide.setAttribute("stroke-width", fmtNum(stroke));
  guide.setAttribute("stroke-dasharray", fmtNum(4 / zoom));
  guide.setAttribute("visibility", "hidden");
  layer.appendChild(guide);
  svg.appendChild(layer);
  return layer;
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
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // pointerdown 的 client 坐标要传给 window 级监听，用 ref 中转（避免闭包捕获旧事件对象）
  const lastPointer = useRef<PointLike>({ x: 0, y: 0 }).current;
  // window 级 pointer 监听只注册一次，靠 ref 读最新状态，避免反复解绑/重绑
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const resultRef = useRef(result);
  resultRef.current = result;
  const commitDragRef = useRef<(d: DragState) => void>(() => undefined);

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
        },
        (err: unknown) => {
          if (cancelled) return;
          setError(errorText(err));
          setResult(null);
          setBusy(false);
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
    if (handlesOn && result.handles.length > 0) {
      buildHandleLayer(node, result.handles, result.viewBox, zoom);
    }
    stage.replaceChildren(node);
  }, [result, zoom, previewMode, handlesOn]);

  // 每次拿到新结果都回到「自动」模式，避免上一次手动收起延续到下一张图
  useEffect(() => {
    setDiagOpen(null);
  }, [result]);

  // 拖拽提交：只算一次新源码，再以最小 span 补丁写回 CM6（F2-1 与键盘编辑同撤销栈）。
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
      const patch = singleSpanPatch(src, outcome.newSource);
      const bridge = getDiagramSourceBridge();
      const written = !!patch && !!bridge && bridge.patch(patch, src);
      if (!written) setSource(outcome.newSource); // 降级：功能不丢，但无 CM6 撤销记录
      const from = d.handle.sourceText ?? "";
      const to = outcome.replacement ?? "新坐标";
      setNotice({
        tone: "ok",
        text:
          from && from !== to
            ? `已写回 ${from} → ${to}${written ? " · Ctrl+Z 可撤销" : ""}`
            : `坐标已写回${written ? " · Ctrl+Z 可撤销" : ""}`,
      });
    });
  };

  // window 级拖拽监听：即使指针移出 SVG / 画布仍能持续跟随，松手统一提交。
  useEffect(() => {
    const resetMarker = (d: DragState) => {
      d.marker.classList.remove("is-active");
      d.marker.setAttribute("cx", fmtNum(d.startSvg.x));
      d.marker.setAttribute("cy", fmtNum(d.startSvg.y));
      if (d.guide) d.guide.setAttribute("visibility", "hidden");
    };
    const onMove = (e: PointerEvent) => {
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
      if (d.guide) {
        d.guide.setAttribute("x2", fmtNum(curSvg.x));
        d.guide.setAttribute("y2", fmtNum(curSvg.y));
      }
      setDragLabel(dragDeltaLabel(dWorld.x, dWorld.y));
    };
    const onUp = () => {
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
      if (e.key === "Escape" && dragRef.current) onCancel();
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
          (h) => isDraggableHandle(h) && h.sourceRef?.sourceId === sid,
        );
        hit = own.find((h) => h.kind === "node-position") ?? own[0];
      }
    }
    if (!hit) return;
    if (!isDraggableHandle(hit)) {
      setNotice({ tone: "warn", text: lockedHandleReason(hit) });
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

  function onStagePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;
    startDragFromEvent(e.target);
    if (dragRef.current) e.preventDefault();
  }

  function historyCommand(kind: "undo" | "redo"): void {
    const ok = getDiagramSourceBridge()?.[kind]();
    if (!ok) setNotice({ tone: "warn", text: "没有可撤销 / 重做的改动，或源码栏尚未就绪。" });
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
        {previewMode === "local" && (
          <div className="dg-edit-tools">
            <button
              type="button"
              className={handlesOn ? "on" : ""}
              aria-pressed={handlesOn}
              title="显示 / 隐藏可拖拽控制点"
              onClick={() => setHandlesOn(!handlesOn)}
            >
              控制点
            </button>
            <button type="button" title="撤销上一次源码或拖拽改动 (Ctrl+Z)" onClick={() => historyCommand("undo")}>
              撤销
            </button>
            <button type="button" title="重做 (Ctrl+Shift+Z)" onClick={() => historyCommand("redo")}>
              重做
            </button>
          </div>
        )}
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

      <div className="dg-canvas-body">
        <div
          className="dg-canvas-stage"
          ref={stageRef}
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
        <span>
          {previewMode === "local"
            ? `拖动控制点写回坐标 · ${handleCount} 个控制点（F2-1）`
            : "精确预览只读 · 切回本地即时可拖拽"}
        </span>
        <span>插入目标：{targetTex ? basename(targetTex) : "未锁定"}</span>
      </div>
    </div>
  );
}
