// M1-1 · DEV 演示模块面板（懒加载组件，验证 slot 挂载 + Suspense 通路）
import { insertSnippet } from "@/core/moduleRegistry";

export default function DemoPanel() {
  return (
    <div className="mod-panel">
      <div className="mod-panel-row">
        <span className="mod-panel-k">模块</span>
        <span className="mod-panel-v">demo · 已启用</span>
      </div>
      <div className="mod-panel-row">
        <span className="mod-panel-k">插入测试</span>
        <button
          type="button"
          className="btn"
          onClick={() => insertSnippet("% demo snippet\n")}
        >
          向编辑器插入一行
        </button>
      </div>
    </div>
  );
}
