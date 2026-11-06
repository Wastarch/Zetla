// M2 · 绘图模块左侧侧栏视图（参考拼图模块 FigureSidebar 的范式）。
// 形态：活动栏「绘图」→ 侧栏显示组件库 / 布局选项 / 导出方式；画布与源码放在
// 主编辑区的独立 Tab（diagram://editor 伪 buffer），两者并存、互不遮挡。
//
// 本文件当前为占位骨架：列出新形态的入口分区，功能由后续切片接入。
// 切片编号见 docs/dev/绘图模块开发计划.md。
import { useDiagramStore } from "./store";
import "./diagram.css";

export function DiagramSidebar() {
  const source = useDiagramStore((s) => s.source);
  const lineCount = source.split("\n").length;

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
          在独立 Tab 中提供「仅画布 / 仅源码 / 左右分屏」三种布局，由 Tab 内开关切换。
        </p>
        <button type="button" className="btn" disabled>
          打开绘图 Tab（F1-1 接入）
        </button>
      </section>

      <section className="dg-side-card">
        <h3 className="dg-side-card-title">导出与插入</h3>
        <p className="dg-side-card-sub">
          编辑完成后选择导出方式，再插入主 .tex 文档：TikZ 源码，或导出 PDF / PNG / SVG
          后按图片插入（复用 Zetla 既有的图片落盘与 figure 片段管线）。
        </p>
        <button type="button" className="btn" disabled>
          插入到文档（F1-4 / F2 接入）
        </button>
      </section>

      <p className="dg-side-note">
        主文档已有 tikzpicture 的反向编辑（✎ 徽标）按约定延后到 F5，v1 仅支持「绘图 Tab → 插入主文档」。
      </p>
    </div>
  );
}

export default DiagramSidebar;
