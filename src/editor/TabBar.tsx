// M0-5 · 标签条（对齐 docs/UI/code.html .tabbar / .tab）
// - 脏文件以 .tdot 圆点替代关闭按钮（点击触发原生确认关闭）
// - 右侧 .tab-tools：编译 / PDF 预览显隐 / 查找替换 / 验收面板
//   （打开文件、保存入口已按需求精简：仍可 Ctrl+O / Ctrl+S，菜单亦保留）
// - M0-9：编译按钮在运行中变为终止
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useProjectStore } from "@/project/useProject";
import { cancelCompile, startCompile } from "@/compile/useCompile";
import { useBuffersStore } from "./useBuffers";

export interface TabBarProps {
  onFind: () => void;
  onOpenLab: () => void;
}

export function TabBar({ onFind, onOpenLab }: TabBarProps) {
  const buffers = useBuffersStore((s) => s.buffers);
  const activePath = useBuffersStore((s) => s.activePath);
  const setActive = useBuffersStore((s) => s.setActive);
  const closeBuffer = useBuffersStore((s) => s.closeBuffer);

  const running = useAppStore((s) => s.compileStatus === "running");
  const hasMain = useProjectStore((s) => !!s.tree?.mainFile);
  const previewVisible = useAppStore((s) => s.previewVisible);
  const togglePreview = useAppStore((s) => s.togglePreview);

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
          className={running ? "ibtn on" : "ibtn"}
          title={
            running
              ? "终止编译"
              : hasMain
                ? "编译 (Ctrl+B)"
                : "未打开项目或未识别主文件"
          }
          disabled={!running && !hasMain}
          onClick={() => void (running ? cancelCompile() : startCompile())}
        >
          <Icon name={running ? "stop" : "play"} />
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
          title="验收面板（M0-13 后移除）"
          onClick={onOpenLab}
        >
          <Icon name="sliders" />
        </button>
        <button
          type="button"
          className={previewVisible ? "ibtn on" : "ibtn"}
          title={previewVisible ? "收起 PDF 预览" : "展开 PDF 预览"}
          onClick={togglePreview}
        >
          <Icon name="panel-right" />
        </button>
      </div>
    </div>
  );
}

export default TabBar;
