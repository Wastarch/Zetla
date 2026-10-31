// M1-5a · 活动栏（类 VSCode activity bar）：侧栏左侧竖排图标
// 交互口径：
//   - 点击某视图图标：切到该视图并展开侧栏
//   - 再点当前视图图标：折叠侧栏（图标保留高亮记忆，展开时回到原视图）
//   - 底部「收起/展开侧栏」按钮：纯显隐切换
// M1-8：内置 4 项之后追加「模块自带视图」（LatexModule.view，如表格）；模块停用即消失。
import { Icon } from "@/ui/Icon";
import { useAppStore, type SidebarView } from "@/core/store";
import { useModuleViews } from "@/modules/useModuleList";

interface Item {
  view: SidebarView;
  icon: string;
  label: string;
  hint: string;
}

/** 内置视图（编号与 Ctrl+B 1/2/3/4 对应） */
const ITEMS: Item[] = [
  { view: "explorer", icon: "folder", label: "资源管理器", hint: "Ctrl+B 1" },
  { view: "outline", icon: "menu", label: "大纲", hint: "Ctrl+B 2" },
  // M1-12a：符号面板与公式合并为「公式」单视图（内部 符号/公式库 两页签）
  { view: "math", icon: "formula", label: "公式", hint: "Ctrl+B 3" },
  // M1-14f：引用管理面板（校验汇总 + 条目列表 + 导入 .bib）
  { view: "references", icon: "bib", label: "引用", hint: "Ctrl+B 4" },
  // M1-find：全局搜索（侧栏视图，参考 VS Code 搜索）
  { view: "search", icon: "search", label: "搜索", hint: "Ctrl+Shift+F" },
];

export function ActivityBar() {
  const view = useAppStore((s) => s.sidebarView);
  const visible = useAppStore((s) => s.sidebarVisible);
  const select = useAppStore((s) => s.selectSidebarView);
  const toggle = useAppStore((s) => s.toggleSidebar);
  // M1-8：模块自带视图（按 view.order → 注册序，见 registry.listViews）
  const moduleViews = useModuleViews();
  const items: Item[] = [
    ...ITEMS,
    ...moduleViews.map(({ view: v }) => ({
      view: v.id,
      icon: v.icon,
      label: v.label,
      hint: v.hint ?? "",
    })),
  ];

  return (
    <nav className="activity" aria-label="侧栏视图">
      {items.map((it) => {
        const active = visible && view === it.view;
        const hint = it.hint ? `（${it.hint}）` : "";
        return (
          <button
            key={it.view}
            type="button"
            className={active ? "activity-btn active" : "activity-btn"}
            title={`${it.label}${hint}${active ? " · 点击折叠" : ""}`}
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
