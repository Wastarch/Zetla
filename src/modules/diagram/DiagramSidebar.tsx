// M2 · 绘图模块左侧侧栏视图（参考拼图模块 FigureSidebar 的范式）。
// 形态：活动栏「绘图」→ 侧栏显示组件库 / 布局选项 / 导出方式；画布与源码放在
// 主编辑区的独立 Tab（diagram://editor 伪 buffer），两者并存、互不遮挡。
//
// F1-1 已接通「打开/聚焦绘图 Tab + 锁定 targetTex」；其余入口按切片陆续接入。
// 切片编号见 docs/dev/绘图模块开发计划.md。
import { useBuffersStore } from "@/editor/useBuffers";
import { useDiagramStore } from "./store";
import "./diagram.css";

const DIAGRAM_TAB_PATH = "diagram://editor";
const LAYOUT_LABEL: Record<string, string> = {
  canvas: "仅画布",
  code: "仅源码",
  split: "左右分屏",
};

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export function DiagramSidebar() {
  const source = useDiagramStore((s) => s.source);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const layoutMode = useDiagramStore((s) => s.layoutMode);
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
          源码栏复用 Zetla 既有 LaTeXEditor。
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
        </p>
      </section>

      <section className="dg-side-card">
        <h3 className="dg-side-card-title">导出与插入</h3>
        <p className="dg-side-card-sub">
          编辑完成后选择导出方式，再插入主 .tex 文档：TikZ 源码，或导出 PDF / PNG / SVG
          后按图片插入（复用 Zetla 既有的图片落盘与 figure 片段管线）。
        </p>
        <button type="button" className="btn" disabled>
          插入到文档（F1-4 接入）
        </button>
        <p className="dg-side-card-sub">
          目标文档：{targetTex ? basename(targetTex) : "未锁定（需先打开 .tex 文档）"}
        </p>
      </section>

      <p className="dg-side-note">
        主文档已有 tikzpicture 的反向编辑（✎ 徽标）按约定延后到 F5，v1 仅支持「绘图 Tab → 插入主文档」。
      </p>
    </div>
  );
}

export default DiagramSidebar;
