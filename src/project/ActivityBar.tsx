// M1-5a · 活动栏（类 VSCode activity bar）：侧栏左侧竖排图标
// 交互口径：
//   - 点击某视图图标：切到该视图并展开侧栏
//   - 再点当前视图图标：折叠侧栏（图标保留高亮记忆，展开时回到原视图）
//   - 底部「收起/展开侧栏」按钮：纯显隐切换
import { Icon } from "@/ui/Icon";
import { useAppStore, type SidebarView } from "@/core/store";

interface Item {
  view: SidebarView;
  icon: string;
  label: string;
  hint: string;
}

const ITEMS: Item[] = [
  { view: "explorer", icon: "folder", label: "资源管理器", hint: "Ctrl+B 1" },
  { view: "outline", icon: "menu", label: "大纲", hint: "Ctrl+B 2" },
  // M1-12a：符号面板与公式合并为「公式」单视图（内部 符号/公式库/搭建 三页签）
  { view: "math", icon: "formula", label: "公式", hint: "Ctrl+B 3" },
];

export function ActivityBar() {
  const view = useAppStore((s) => s.sidebarView);
  const visible = useAppStore((s) => s.sidebarVisible);
  const select = useAppStore((s) => s.selectSidebarView);
  const toggle = useAppStore((s) => s.toggleSidebar);

  return (
    <nav className="activity" aria-label="侧栏视图">
      {ITEMS.map((it) => {
        const active = visible && view === it.view;
        return (
          <button
            key={it.view}
            type="button"
            className={active ? "activity-btn active" : "activity-btn"}
            title={`${it.label}（${it.hint}）${active ? " · 点击折叠" : ""}`}
            aria-pressed={active}
            onClick={() => select(it.view)}
          >
            <Icon name={it.icon} size={18} />
          </button>
        );
      })}

      <div className="activity-gap" />

      <button
        type="button"
        className="activity-btn"
        title={visible ? "折叠侧栏" : "展开侧栏"}
        onClick={toggle}
      >
        <Icon name="panel-left" size={17} />
      </button>
    </nav>
  );
}

export default ActivityBar;
