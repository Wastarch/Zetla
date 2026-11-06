// M2·F1-1：绘图工作台 Tab 内容根（挂在 `diagram://editor` 伪 buffer 上，见 useBuffers.openDiagram）。
// 本切片只搭骨架：顶部布局工具条占位 + 空态说明，保证「侧栏 → 独立 Tab」链路打通。
// F1-2 接三布局与复用既有 LaTeXEditor；F1-3 接 vendored tikz-editor 的 SVG 画布；
// F1-4 接「编辑完成 → 选导出方式 → 插入目标 .tex」。
import { useDiagramStore } from "./store";
import "./diagram.css";

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

export default function DiagramTab() {
  const source = useDiagramStore((s) => s.source);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const lineCount = source.split("\n").length;

  return (
    <div className="dg-tab">
      <div className="dg-tab-bar">
        <span className="dg-tab-title">绘图工作台 · TikZ</span>
        <div className="dg-tab-layouts" role="group" aria-label="画布布局（F1-2 接入）">
          <button type="button" className="dg-tab-layout" disabled title="F1-2 接入">
            仅画布
          </button>
          <button type="button" className="dg-tab-layout" disabled title="F1-2 接入">
            仅源码
          </button>
          <button type="button" className="dg-tab-layout" disabled title="F1-2 接入">
            分屏
          </button>
        </div>
        <span className="dg-tab-meta">三布局开关 · F1-2 接入</span>
      </div>

      <div className="dg-tab-body">
        <div className="dg-tab-empty">
          <h3 className="dg-tab-empty-title">TikZ 绘图工作台</h3>
          <p className="dg-tab-empty-sub">
            这是一个独立标签页，与左侧「绘图」侧栏、.tex 编辑器和 PDF 预览并存，不替换主编辑区。
          </p>
          <ul className="dg-tab-list">
            <li>F1-2：Tab 内三布局（仅画布 / 仅源码 / 左右分屏）+ 复用既有 LaTeXEditor</li>
            <li>F1-3：vendoring tikz-editor 引擎，把源码实时渲染为 SVG</li>
            <li>F1-4：编辑完成后选导出方式，插入目标 .tex（图片/代码插入复用既有管线）</li>
          </ul>
          <div className="dg-tab-status">
            <span>当前源码 {lineCount} 行</span>
            <span>
              目标文档：
              {targetTex ? basename(targetTex) : "未锁定（请先打开 .tex 再打开绘图 Tab）"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
