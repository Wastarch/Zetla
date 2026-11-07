// M2 · 绘图模块左侧侧栏视图（参考拼图模块 FigureSidebar 的范式）。
// 形态：活动栏「绘图」→ 侧栏显示组件库 / 布局选项 / 导出方式；画布与源码放在
// 主编辑区的独立 Tab（diagram://editor 伪 buffer），两者并存、互不遮挡。
//
// F1-1 打开/聚焦绘图 Tab + 锁定 targetTex；F1-4 导出方式单选与「插入到文档」主操作。
// 切片编号见 docs/dev/绘图模块开发计划.md。
import { useBuffersStore } from "@/editor/useBuffers";
import { useDiagramStore } from "./store";
import { insertDiagramCode } from "./insert";
import type { ExportMode } from "@/types/diagram";
import "./diagram.css";

const DIAGRAM_TAB_PATH = "diagram://editor";
const LAYOUT_LABEL: Record<string, string> = {
  canvas: "仅画布",
  code: "仅源码",
  split: "左右分屏",
};

/** image / file 由 F2 的 tikz_export 落盘链路接入，v1 展示但禁用 */
const EXPORT_MODES: { id: ExportMode; label: string; hint: string; ready: boolean }[] = [
  { id: "source", label: "TikZ 源码", hint: "插入完整 tikzpicture 环境", ready: true },
  { id: "image", label: "导出图片后插入", hint: "PDF / PNG / SVG → figure", ready: false },
  { id: "file", label: "仅保存文件", hint: "导出到指定路径，不改主文档", ready: false },
];

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function DiagramSidebar() {
  const source = useDiagramStore((s) => s.source);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const layoutMode = useDiagramStore((s) => s.layoutMode);
  const previewMode = useDiagramStore((s) => s.previewMode);
  const exportMode = useDiagramStore((s) => s.exportMode);
  const setExportMode = useDiagramStore((s) => s.setExportMode);
  const wrapFigure = useDiagramStore((s) => s.wrapFigure);
  const setWrapFigure = useDiagramStore((s) => s.setWrapFigure);
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
        <span className="dg-side-title">绘图 · TikZ</span>
        <span className="dg-side-meta">{lineCount} 行源码</span>
      </div>

      <section className="dg-side-card">
        <h3 className="dg-side-card-title">组件库</h3>
        <p className="dg-side-card-sub">
          神经网络 / 概率图 / 流程框图 / 张量矩阵 / 受力分析，5 类模板。
        </p>
        <button type="button" className="btn" disabled>
          浏览组件（F3 接入）
        </button>
      </section>

      <section className="dg-side-card">
        <h3 className="dg-side-card-title">画布与布局</h3>
        <p className="dg-side-card-sub">
          独立 Tab 内提供「仅画布 / 仅源码 / 左右分屏」三种布局，开关在 Tab 顶部工具条；
          源码栏复用 Zetla 既有 LaTeXEditor。画布可切「本地 / 精确（XeLaTeX）」双通道。
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
      </section>

      <section className="dg-side-card">
        <h3 className="dg-side-card-title">导出与插入</h3>
        <p className="dg-side-card-sub">编辑完成后选择导出方式，再插入主 .tex 文档。</p>
        <div className="dg-side-radios">
          {EXPORT_MODES.map((m) => (
            <label
              key={m.id}
              className={`dg-side-radio${exportMode === m.id ? " is-on" : ""}${m.ready ? "" : " is-off"}`}
              title={m.ready ? m.hint : `${m.hint}（F2 接入）`}
            >
              <input
                type="radio"
                name="dg-export-mode"
                checked={exportMode === m.id}
                disabled={!m.ready}
                onChange={() => setExportMode(m.id)}
              />
              <span>{m.label}</span>
              {!m.ready && <em>F2</em>}
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
          className="btn primary"
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
          <p className="dg-side-warn">图片 / 仅保存依赖 F2 的 XeLaTeX 落盘链路，暂不可用。</p>
        )}
      </section>

      <p className="dg-side-note">
        主文档已有 tikzpicture 的反向编辑（✎ 徽标）按约定延后到 F5，v1 仅支持「绘图 Tab → 插入主文档」。
      </p>
    </div>
  );
}

export default DiagramSidebar;
