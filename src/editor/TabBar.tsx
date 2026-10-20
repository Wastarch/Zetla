// M0-5 · 标签条（对齐 docs/UI/code.html .tabbar / .tab）
// - 脏文件以 .tdot 圆点替代关闭按钮（点击触发原生确认关闭）
// - 右侧 .tab-tools：打开文件 / 保存 / 查找替换 / 验收面板
import { Icon } from "@/ui/Icon";
import { useBuffersStore } from "./useBuffers";

export interface TabBarProps {
  onOpenFiles: () => void;
  onFind: () => void;
  onOpenLab: () => void;
}

export function TabBar({ onOpenFiles, onFind, onOpenLab }: TabBarProps) {
  const buffers = useBuffersStore((s) => s.buffers);
  const activePath = useBuffersStore((s) => s.activePath);
  const setActive = useBuffersStore((s) => s.setActive);
  const closeBuffer = useBuffersStore((s) => s.closeBuffer);
  const saveBuffer = useBuffersStore((s) => s.saveBuffer);

  return (
    <div className="tabbar" role="tablist" aria-label="打开的文档">
      {buffers.map((b) => {
        const active = b.path === activePath;
        const dirty = b.content !== b.savedContent;
        return (
          <div
            key={b.path}
            role="tab"
            aria-selected={active}
            title={b.path}
            className={active ? "tab active" : "tab"}
            onClick={() => setActive(b.path)}
            onAuxClick={(e) => {
              if (e.button === 1) void closeBuffer(b.path); // 中键关闭
            }}
          >
            <Icon name="tex" size={13} style={{ color: "var(--accent)", opacity: 0.75 }} />
            <span className="tname">{b.name}</span>
            {dirty ? (
              <button
                type="button"
                className="tdot"
                title="未保存（点击关闭）"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeBuffer(b.path);
                }}
              />
            ) : (
              <button
                type="button"
                className="tclose"
                title="关闭"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeBuffer(b.path);
                }}
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </div>
        );
      })}

      <div className="tab-tools">
        <button
          type="button"
          className="ibtn"
          title="打开文件…（Ctrl+O）"
          onClick={onOpenFiles}
        >
          <Icon name="file-plus" />
        </button>
        <button
          type="button"
          className="ibtn"
          title="保存 (Ctrl+S)"
          disabled={!activePath}
          onClick={() => activePath && saveBuffer(activePath)}
        >
          <Icon name="save" />
        </button>
        <button
          type="button"
          className="ibtn"
          title="查找替换 (Ctrl+F)"
          disabled={!activePath}
          onClick={onFind}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          className="ibtn"
          title="验收面板（M0-12 后移除）"
          onClick={onOpenLab}
        >
          <Icon name="sliders" />
        </button>
      </div>
    </div>
  );
}

export default TabBar;
