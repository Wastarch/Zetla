// M2·绘图模块（F1-1）：活动栏右侧竖工具栏（仅绘图工作台激活时显示）。
// F1-1 仅搭骨架：插入组件 / ✎ 反向编辑 / 导出 三个入口先置为待接入（disabled），
// 关闭按钮在 F1-1 即生效（恢复编辑器 + 预览）。功能在对应切片（F3 / F1-5 / F1-4）落地。
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";

interface RailTool {
  icon: string;
  label: string;
  hint: string;
  /** 落地该入口的切片编号（仅展示用） */
  pending: string;
}

const TOOLS: RailTool[] = [
  { icon: "plus", label: "插入组件", hint: "组件库浏览与一键插入", pending: "F3" },
  { icon: "edit", label: "✎ 反向编辑", hint: "从 tikzpicture 环境载入源码", pending: "F1-5" },
  { icon: "save", label: "导出", hint: "PDF / PNG / SVG", pending: "F1-4" },
];

export function DiagramToolRail() {
  const closePanel = useAppStore((s) => s.closeModulePanel);

  return (
    <div className="dg-rail" role="toolbar" aria-label="绘图工具栏">
      {TOOLS.map((t) => (
        <button
          key={t.label}
          type="button"
          className="dg-rail-btn"
          title={`${t.label}（${t.hint} · ${t.pending} 接入）`}
          disabled
        >
          <Icon name={t.icon} size={18} />
          <span className="dg-rail-label">{t.label}</span>
        </button>
      ))}

      <div className="dg-rail-gap" />

      <button
        type="button"
        className="dg-rail-btn"
        title="关闭绘图工作台（恢复编辑器与预览）"
        onClick={() => closePanel()}
      >
        <Icon name="panel-right" size={18} />
        <span className="dg-rail-label">关闭</span>
      </button>
    </div>
  );
}

export default DiagramToolRail;
