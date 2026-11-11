// M2 · 绘图模块左侧「工具箱」侧栏视图。
// 形态：活动栏「绘图」→ 侧栏显示基础元素 / 组件库 / 图层 / 插入选项；画布与源码放在
// 主编辑区的独立 Tab（diagram://editor 伪 buffer），两者并存、互不遮挡。
//
// F3-9（参考 docs/dev/UI/tikz编辑器.html 的布局重排）：
//   · 基础元素按钮从画布顶部工具条搬到侧栏（`ShapePalette`）；
//   · 组件库 / 图层管理 / 导出与插入 / 画布与布局统一为原生 <details> 手风琴
//     （零新增 state，键盘可用，折叠不丢面板内部状态）；
//   · 选中元素的属性编辑（F2-2 / F3-4）移到**预览窗口右侧**的 DiagramInspector，
//     不再堆在左侧栏；代码区（DiagramCodePane / LaTeXEditor）完全不碰。
// F1-1 打开/聚焦绘图 Tab + 锁定 targetTex；F1-4 导出方式单选与「插入到文档」主操作。
import type { ReactNode } from "react";
import { useBuffersStore } from "@/editor/useBuffers";
import { useDiagramStore } from "./store";
import { LayersPanel } from "./LayersPanel";
import { ShapePalette } from "./ShapeToolbar";
import { isToolMode, toolDef } from "./shapeTools";
import { insertDiagramCode } from "./insert";
import type { ExportMode } from "@/types/diagram";
import "./diagram.css";

const DIAGRAM_TAB_PATH = "diagram://editor";
const LAYOUT_LABEL: Record<string, string> = {
  canvas: "仅画布",
  code: "仅源码",
  split: "左右分屏",
};

/** image / file 由 F5 的 tikz_export 落盘链路接入，v1 展示但禁用 */
const EXPORT_MODES: { id: ExportMode; label: string; hint: string; ready: boolean }[] = [
  { id: "source", label: "TikZ 源码", hint: "插入完整 tikzpicture 环境", ready: true },
  { id: "image", label: "导出图片后插入", hint: "PDF / PNG / SVG → figure", ready: false },
  { id: "file", label: "仅保存文件", hint: "导出到指定路径，不改主文档", ready: false },
];

/** F6 组件库的 5 类模板：占位列表，不用按钮避免「死点击」（F3-8 口径）。 */
const LIBRARY_ITEMS: { label: string; hint: string }[] = [
  { label: "神经网络拓扑图", hint: "层 / 节点 / 连接权重" },
  { label: "概率图 · 贝叶斯网", hint: "随机变量 / 条件依赖" },
  { label: "流程图 · 结构图", hint: "判定 / 分支 / 汇聚" },
  { label: "张量 · 矩阵", hint: "网格 / 高亮 / 维度标注" },
  { label: "受力分析", hint: "力矢量 / 角度 / 标注" },
];

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** 手风琴标题：原生 summary + 纯 CSS 箭头，不引入组件 state。 */
function Accordion({
  title,
  meta,
  open = true,
  flush = false,
  children,
}: {
  title: string;
  meta?: string;
  open?: boolean;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="dg-accordion" open={open}>
      <summary className="dg-accordion-head">
        <span className="dg-accordion-title">{title}</span>
        {meta && <span className="dg-accordion-meta">{meta}</span>}
        <span className="dg-accordion-arrow" aria-hidden="true">▾</span>
      </summary>
      <div className={`dg-accordion-body${flush ? " is-flush" : ""}`}>{children}</div>
    </details>
  );
}

export function DiagramSidebar() {
  const source = useDiagramStore((s) => s.source);
  const toolMode = useDiagramStore((s) => s.toolMode);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const layoutMode = useDiagramStore((s) => s.layoutMode);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const exportMode = useDiagramStore((s) => s.exportMode);
  const setExportMode = useDiagramStore((s) => s.setExportMode);
  const wrapFigure = useDiagramStore((s) => s.wrapFigure);
  const setWrapFigure = useDiagramStore((s) => s.setWrapFigure);
  // F3-7：按画布尺寸导出开关（默认关）；只影响派生导出片段，绝不改 CM6 source。
  const exportUseCanvas = useDiagramStore((s) => s.exportUseCanvas);
  const setExportUseCanvas = useDiagramStore((s) => s.setExportUseCanvas);
  const canvasSize = useDiagramStore((s) => s.canvasSize);
  const caption = useDiagramStore((s) => s.caption);
  const setCaption = useDiagramStore((s) => s.setCaption);
  const label = useDiagramStore((s) => s.label);
  const setLabel = useDiagramStore((s) => s.setLabel);

  const diagramOpen = useBuffersStore((s) => s.buffers.some((b) => b.kind === "diagram"));
  const diagramActive = useBuffersStore((s) => s.activePath === DIAGRAM_TAB_PATH);
  const lineCount = source.split("\n").length;

  /**
   * 打开 / 聚焦绘图 Tab。打开时把当前活动 .tex 锁定为插入目标
   * （同 figureImport.ts:30 的做法）：伪 buffer Tab 激活时 getActiveView() 会失效，
   * F1-4 插入必须靠 targetTex 取 getEditorView(targetTex)。
   */
  const handleOpenDiagram = () => {
    const activePath = useBuffersStore.getState().activePath;
    if (activePath && /\.tex$/i.test(activePath)) {
      useDiagramStore.getState().setTargetTex(activePath);
    }
    useBuffersStore.getState().openDiagram();
  };

  const canInsert = exportMode === "source" && !!targetTex && source.trim().length > 0;

  return (
    <div className="dg-side">
      <div className="dg-side-head">
        <span className="dg-side-title">绘图 · 工具箱</span>
        <span className="dg-side-meta">{lineCount} 行源码</span>
      </div>

      {/* 当前工具名放在折叠标题右侧（跟随 store），不再单独占一行 */}
      <Accordion title="基础元素" meta={`当前：${toolDef(isToolMode(toolMode) ? toolMode : "select").label}`}>
        <ShapePalette />
      </Accordion>

      <Accordion title="组件库" meta="5 类模板">
        <ul className="dg-library-list">
          {LIBRARY_ITEMS.map((it) => (
            <li key={it.label} className="dg-library-item" title={`${it.hint} · 即将支持`}>
              <span>{it.label}</span>
              <em>即将</em>
            </li>
          ))}
        </ul>
        <p className="dg-side-card-sub">高层可复用模板，接入后一次性生成标准 TikZ 语句。</p>
      </Accordion>

      {/* F3-3：图层 / 虚拟分组面板留在侧栏；面板自带的折叠开关不重复包一层 */}
      <Accordion title="图层管理" flush>
        <LayersPanel />
      </Accordion>

      <Accordion title="导出与插入" meta="主 .tex 文档">
        <p className="dg-side-card-sub">编辑完成后选择导出方式，再插入主 .tex 文档。</p>
        <div className="dg-side-radios">
          {EXPORT_MODES.map((m) => (
            <label
              key={m.id}
              className={`dg-side-radio${exportMode === m.id ? " is-on" : ""}${m.ready ? "" : " is-off"}`}
              title={m.ready ? m.hint : `${m.hint}（即将支持）`}
            >
              <input
                type="radio"
                name="dg-export-mode"
                checked={exportMode === m.id}
                disabled={!m.ready}
                onChange={() => setExportMode(m.id)}
              />
              <span>{m.label}</span>
              {!m.ready && <em>即将</em>}
            </label>
          ))}
        </div>

        <label className="dg-side-check">
          <input
            type="checkbox"
            checked={wrapFigure}
            onChange={(e) => setWrapFigure(e.target.checked)}
          />
          套 figure 环境（caption / label）
        </label>
        <label
          className="dg-side-check"
          title="打开后，XeLaTeX 精确预览与导出按固定画布留白；只在派生片段加 bounding box，绘图源码一字不改"
        >
          <input
            type="checkbox"
            checked={exportUseCanvas}
            disabled={canvasSize.preset === "auto"}
            onChange={(e) => setExportUseCanvas(e.target.checked)}
          />
          按画布尺寸导出（{canvasSize.preset === "auto" ? "需先设置纸张" : `${canvasSize.widthCm.toFixed(1)}×${canvasSize.heightCm.toFixed(1)}cm`}）
        </label>
        {wrapFigure && (
          <div className="dg-side-fields">
            <input
              className="dg-side-input"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="图题（留空用占位文字）"
            />
            <input
              className="dg-side-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="标签，如 fig:diagram"
            />
          </div>
        )}

        <button
          type="button"
          className="btn primary dg-side-primary"
          disabled={!canInsert}
          onClick={() => insertDiagramCode()}
        >
          插入到文档
        </button>
        <p className="dg-side-card-sub">
          目标文档：{targetTex ? basename(targetTex) : "未锁定（需先打开 .tex 文档）"}
        </p>
        {!targetTex && (
          <p className="dg-side-warn">插入按钮已禁用：请先在 .tex 标签页活动时打开绘图 Tab。</p>
        )}
        {exportMode !== "source" && (
          <p className="dg-side-warn">图片导出 / 仅保存文件将在后续版本支持，暂不可用。</p>
        )}
      </Accordion>

      <Accordion title="画布与布局" open={false}>
        <p className="dg-side-card-sub">
          仅画布 / 仅源码 / 左右分屏三种布局在 Tab 顶部切换；预览可切「本地即时 / XeLaTeX 精确」两个通道。
        </p>
        <button type="button" className="btn" onClick={handleOpenDiagram}>
          {diagramOpen ? "切换到绘图 Tab" : "打开绘图 Tab"}
        </button>
        <p className="dg-side-card-sub">
          状态：
          {!diagramOpen
            ? "未打开"
            : diagramActive
              ? "绘图 Tab 已激活"
              : "绘图 Tab 已打开（未激活）"}
          {diagramOpen && ` · 当前布局：${LAYOUT_LABEL[layoutMode] ?? layoutMode}`}
          {` · 预览：${previewMode === "precise" ? "XeLaTeX 精确" : "本地即时"}`}
        </p>
      </Accordion>

      <p className="dg-side-note">
        主文档已有 tikzpicture 的反向编辑（✎ 徽标）将在后续版本支持，当前仅支持「绘图 Tab → 插入主文档」。
      </p>
    </div>
  );
}

export default DiagramSidebar;
