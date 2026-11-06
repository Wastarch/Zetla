// M0-5 · 标签条（对齐 docs/UI/code.html .tabbar / .tab）
// - 脏文件以 .tdot 圆点替代关闭按钮（点击触发原生确认关闭）
// - 右侧 .tab-tools：编译 / 查找替换 / PDF 预览显隐
//   （打开文件、保存入口已按需求精简：仍可 Ctrl+O / Ctrl+S，菜单亦保留）
// - M0-9：编译按钮在运行中变为终止；M0-13：验收面板按钮已移除
// - M2：编译按钮改为「▶ | ▾」拆分按钮 —— ▶ 编译/终止，▾ 打开流程菜单切换当前编译流程
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useProjectStore } from "@/project/useProject";
import { cancelCompile, effectiveEngine, startCompile } from "@/compile/useCompile";
import { RecipeMenu } from "@/compile/RecipeMenu";
import { useCurrentRecipe } from "@/compile/recipePicker";
import { useBuffersStore } from "./useBuffers";

export interface TabBarProps {
  onFind: () => void;
}

export function TabBar({ onFind }: TabBarProps) {
  const buffers = useBuffersStore((s) => s.buffers);
  const activePath = useBuffersStore((s) => s.activePath);
  const setActive = useBuffersStore((s) => s.setActive);
  const closeBuffer = useBuffersStore((s) => s.closeBuffer);

  const running = useAppStore((s) => s.compileStatus === "running");
  const tree = useProjectStore((s) => s.tree);
  const hasMain = !!tree?.mainFile;
  const previewVisible = useAppStore((s) => s.previewVisible);
  const togglePreview = useAppStore((s) => s.togglePreview);
  // 活动缓冲类型：非文本（图片/PDF）时禁用仅适用于源码编辑器的工具
  const activeKind = useBuffersStore(
    (s) => s.buffers.find((b) => b.path === s.activePath)?.kind ?? null,
  );

  // M2：▾ 流程菜单（菜单是 fixed 定位，放在 .tabbar 外避免被 overflow 裁切）
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const engineSetting = useSettingsStore((s) => s.settings.build.engine);
  const defaultRecipe = useSettingsStore((s) => s.settings.build.defaultRecipe);
  const currentRecipe = useCurrentRecipe();
  const activeEngine = tree ? effectiveEngine(engineSetting, tree.engine) : "xelatex";
  const flowLabel = currentRecipe ?? defaultRecipe ?? "内置 latexmk（默认）";

  return (
    <>
      <div className="tabbar" role="tablist" aria-label="打开的文档">
        {buffers.map((b) => {
          const active = b.path === activePath;
          const dirty = b.content !== b.savedContent;
          const iconName =
            b.kind === "image" ? "image"
              : b.kind === "pdf" ? "pdf"
                : b.kind === "figure" ? "image"
                  : b.kind === "diagram" ? "wand"
                    : "tex";
          return (
            <div
              key={b.path}
              role="tab"
              aria-selected={active}
              title={b.kind === "diagram" ? "绘图工作台（TikZ）" : b.path}
              className={active ? "tab active" : "tab"}
              onClick={() => setActive(b.path)}
              onAuxClick={(e) => {
                if (e.button === 1) void closeBuffer(b.path); // 中键关闭
              }}
            >
              <Icon
                name={iconName}
                size={13}
                style={{
                  color:
                    b.kind === "text" || b.kind === "figure" || b.kind === "diagram"
                      ? "var(--accent)"
                      : "var(--txt-3)",
                  opacity: 0.75,
                }}
              />
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
          {/* M2：▶ | ▾ 拆分按钮（对齐参考图：无外框、两段独立 hover） */}
          <div className="compile-split">
            <button
              type="button"
              className={running ? "ibtn compile-run on" : "ibtn compile-run"}
              title={
                running
                  ? `终止编译 · 当前流程：${flowLabel}`
                  : hasMain
                    ? `编译 (Ctrl+B) · 当前流程：${flowLabel}`
                    : `未打开项目或未识别主文件 · 当前流程：${flowLabel}`
              }
              disabled={!running && !hasMain}
              onClick={() => void (running ? cancelCompile() : startCompile())}
            >
              <Icon name={running ? "stop" : "play"} />
            </button>
            <button
              type="button"
              className={menu ? "ibtn compile-more on" : "ibtn compile-more"}
              title={`切换编译流程（当前：${flowLabel}）· 状态栏编译按钮右键/长按亦可`}
              aria-haspopup="menu"
              aria-expanded={!!menu}
              // 菜单打开时再点 ▾ 要能收起：阻止 mousedown 冒泡到 InsertCtxMenu 的窗口监听
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu((prev) =>
                  prev ? null : { x: Math.max(6, r.right - 210), y: r.bottom + 4 },
                );
              }}
            >
              <Icon name="chev" size={11} />
            </button>
          </div>
          <button
            type="button"
            className="ibtn"
            title={activeKind === "text" ? "查找替换 (Ctrl+F)" : "查找替换仅适用于文本编辑器"}
            disabled={!activePath || activeKind !== "text"}
            onClick={onFind}
          >
            <Icon name="search" />
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
      {menu && (
        <RecipeMenu
          x={menu.x}
          y={menu.y}
          engine={activeEngine}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

export default TabBar;
