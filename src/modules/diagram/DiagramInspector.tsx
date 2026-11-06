// M2·绘图模块（F1-1）：右坞检查器占位。
// 选中画布图元后显示其属性（颜色 / 线宽 / 箭头样式），F2-2 接入；
// F1-1 仅渲染空态占位，保证「右坞」布局槽位存在。
export function DiagramInspector() {
  return (
    <aside className="dg-inspector" aria-label="属性检查器">
      <div className="dg-pane-head">
        <span className="dg-pane-title">属性</span>
        <span className="dg-pane-tag">F2-2 接入</span>
      </div>
      <div className="dg-inspector-empty">
        <p className="dg-inspector-title">未选中图元</p>
        <p className="dg-inspector-sub">选中画布对象后显示其颜色 / 线宽 / 箭头样式（F2 起）</p>
      </div>
    </aside>
  );
}

export default DiagramInspector;
