// M2·F1-3 / F1-6：TikZ 双通道只读画布。
//  本地通道：source → debounce 160ms → engine.renderTikz（动态加载 vendor bundle + LRU
//            缓存 + 诊断归一化）→ svg.sanitizeSvg 白名单消毒 → importNode 挂载。
//  精确通道：source → debounce 800ms → Rust tikz_preview（XeLaTeX standalone → PDF → SVG）
//            → data URL 交给 <img>（隔离文档，不内联注入、不受白名单限制）。
// 三布局下本组件常驻挂载（DiagramTab 用 hidden 切换），故不会因布局切换重复拉引擎。
// 精确通道只在绘图 Tab 真实激活时编译，Tab 隐藏/切到别的缓冲时不跑 XeLaTeX。
// F4 起在此叠加拖拽层；v1 只读。
import { useEffect, useMemo, useRef, useState } from "react";
import { useBuffersStore } from "@/editor/useBuffers";
import { useSettingsStore } from "@/core/settings";
import { useDiagramStore } from "./store";
import { preloadTikzEngine, renderTikz, type TikzRender } from "./tikzEditor/engine";
import { hasDrawableContent, sanitizeSvg } from "./tikzEditor/svg";
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

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function DiagramCanvas() {
  const source = useDiagramStore((s) => s.source);
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
  const stageRef = useRef<HTMLDivElement>(null);

  const empty = source.trim().length === 0;

  // 预热：3.32MB 的动态 chunk 在打开 Tab 时就开始拉，不等第一次敲键盘
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
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
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
    stage.replaceChildren(node);
  }, [result, zoom, previewMode]);

  // 每次拿到新结果都回到「自动」模式，避免上一次手动收起延续到下一张图
  useEffect(() => {
    setDiagOpen(null);
  }, [result]);

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

  return (
    <div className="dg-canvas">
      <div className="dg-canvas-head">
        <span className="dg-canvas-badge">画布预览</span>
        <div className="dg-mode-switch" role="group" aria-label="预览通道">
          <button
            type="button"
            className={previewMode === "local" ? "on" : ""}
            aria-pressed={previewMode === "local"}
            title="tikz-editor 即时预览（毫秒级，覆盖集有限）"
            onClick={() => setPreviewMode("local")}
          >
            本地即时
          </button>
          <button
            type="button"
            className={previewMode === "precise" ? "on" : ""}
            aria-pressed={previewMode === "precise"}
            title="XeLaTeX 编译 TikZ 片段（秒级，100% 还原）"
            onClick={() => setPreviewMode("precise")}
          >
            XeLaTeX 精确
          </button>
        </div>
        <span className="dg-canvas-hint">
          {previewMode === "local" ? "tikz-editor · 只读" : "standalone · 100% 还原"}
        </span>
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
        <div className="dg-canvas-stage" ref={stageRef} hidden={previewMode === "precise"} />
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
            {engineReady ? "正在渲染…" : "正在加载渲染引擎（首次约 3.3 MB）…"}
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
        <span>v1 画布为只读预览，拖拽编辑属 F4</span>
        <span>插入目标：{targetTex ? basename(targetTex) : "未锁定"}</span>
      </div>
    </div>
  );
}
