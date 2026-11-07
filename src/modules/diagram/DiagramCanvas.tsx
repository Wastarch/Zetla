// M2·F1-3：TikZ 只读 SVG 画布（替换 F1-2 的源码摘要占位）。
// 链路：diagram store 的 source → debounce 160ms → engine.renderTikz（动态加载 vendor
// bundle + LRU 缓存 + 诊断归一化）→ svg.sanitizeSvg（白名单消毒）→ importNode 挂载。
// 三布局下本组件常驻挂载（DiagramTab 用 hidden 切换），故不会因布局切换重复拉引擎。
// F4 起在此叠加拖拽层；v1 只读。
import { useEffect, useRef, useState } from "react";
import { useDiagramStore } from "./store";
import { preloadTikzEngine, renderTikz, type TikzRender } from "./tikzEditor/engine";
import { hasDrawableContent, sanitizeSvg } from "./tikzEditor/svg";

const DEBOUNCE_MS = 160;
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

  const [result, setResult] = useState<TikzRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  // null = 跟随默认（有覆盖缺口就自动展开）；true/false = 用户手动展开/收起
  const [diagOpen, setDiagOpen] = useState<boolean | null>(null);
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
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  // source 变化 → debounce → 渲染。旧请求用 cancelled 标志丢弃，避免乱序覆盖新结果。
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
        }
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, empty]);

  // 消毒后挂载。stage 由 React 渲染为**空容器**（JSX 中无 children），
  // 这里的 replaceChildren 不与 React 的子节点协调冲突；overlay 是同级兄弟节点。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!result) {
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
  }, [result, zoom]);

  // 每次拿到新结果都回到「自动」模式，避免上一次手动收起延续到下一张图
  useEffect(() => {
    setDiagOpen(null);
  }, [result]);

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const canZoomOut = zoomIndex > 0;
  const canZoomIn = zoomIndex >= 0 && zoomIndex < ZOOM_STEPS.length - 1;
  const diags = result?.diagnostics ?? [];
  const unsupported = result?.unsupported ?? [];
  const showDiags = diagOpen ?? unsupported.length > 0;
  const hasErrorDiag = diags.some((d) => d.severity === "error");
  const blankSvg = !!result && !error && !hasDrawableContent(result.svg);

  return (
    <div className="dg-canvas">
      <div className="dg-canvas-head">
        <span className="dg-canvas-badge">画布预览</span>
        <span className="dg-canvas-hint">tikz-editor · 只读</span>
        {diags.length > 0 && (
          <button
            type="button"
            className={`dg-diag-toggle${hasErrorDiag || unsupported.length > 0 ? " is-error" : ""}`}
            onClick={() => setDiagOpen(!showDiags)}
            title="展开 / 收起解析诊断"
          >
            {diags.length} 条诊断
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
          必须常驻一条显式提示，并自动展开诊断，避免用户以为是自己代码写错。 */}
      {unsupported.length > 0 && !error && (
        <div className="dg-canvas-alert" role="status">
          <strong>预览不完整</strong>
          <span>
            {unsupported.length} 处构造引擎暂不支持，画布已省略；导出仍以 XeLaTeX 编译结果为准。
            建议改用 <code>\draw ... arc</code> 等基础语法，或切到源码模式编辑。
          </span>
          <button type="button" onClick={() => setDiagOpen(true)}>
            查看诊断
          </button>
        </div>
      )}

      <div className="dg-canvas-body">
        <div className="dg-canvas-stage" ref={stageRef} />
        {empty && (
          <div className="dg-canvas-overlay">
            源码为空。请切到「仅源码」或「左右分屏」编写 TikZ 代码。
          </div>
        )}
        {!empty && error && (
          <div className="dg-canvas-overlay dg-canvas-error">
            <strong>渲染失败</strong>
            <p>{error}</p>
            <span>修正源码后会自动重渲染；主文档不受影响。</span>
          </div>
        )}
        {!empty && !error && !result && (
          <div className="dg-canvas-overlay">
            {engineReady ? "正在渲染…" : "正在加载渲染引擎（首次约 3.3 MB）…"}
          </div>
        )}
        {!empty && !error && result && blankSvg && (
          <div className="dg-canvas-overlay dg-canvas-warn">
            画布为空：未识别到可绘制对象。请检查 TikZ 语法或展开诊断。
          </div>
        )}
        {busy && result && !error && <div className="dg-canvas-busy">渲染中…</div>}
      </div>

      {showDiags && diags.length > 0 && (
        <ul className="dg-diag-list">
          {diags.slice(0, MAX_DIAG).map((d, i) => (
            <li key={`${d.offset ?? -1}-${i}`} className={d.severity === "error" ? "is-error" : ""}>
              <span className="dg-diag-sev">{d.severity === "error" ? "错误" : "警告"}</span>
              {d.message}
              {typeof d.offset === "number" && <em> @{d.offset}</em>}
              {d.code && <em> [{d.code}]</em>}
            </li>
          ))}
          {diags.length > MAX_DIAG && <li className="dg-diag-more">…另有 {diags.length - MAX_DIAG} 条</li>}
        </ul>
      )}

      <div className="dg-canvas-foot">
        <span>
          {result
            ? `${result.fromCache ? "缓存命中" : `渲染 ${result.elapsedMs.toFixed(0)} ms`} · ${result.viewBox.width.toFixed(0)}×${result.viewBox.height.toFixed(0)}`
            : "—"}
        </span>
        <span>v1 画布为只读预览，拖拽编辑属 F4</span>
        <span>插入目标：{targetTex ? basename(targetTex) : "未锁定"}</span>
      </div>
    </div>
  );
}
