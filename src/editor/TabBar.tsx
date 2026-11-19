// M0-5 · 标签条（对齐 docs/UI/code.html .tabbar / .tab）
// - 脏文件以 .tdot 圆点替代关闭按钮（点击触发原生确认关闭）
// - 右侧 .tab-tools：编译 / 查找替换 / PDF 预览显隐
//   （打开文件、保存入口已按需求精简：仍可 Ctrl+O / Ctrl+S，菜单亦保留）
// - M0-9：编译按钮在运行中变为终止；M0-13：验收面板按钮已移除
// - M2：编译按钮改为「▶ | ▾」拆分按钮 —— ▶ 编译/终止，▾ 打开流程菜单切换当前编译流程
import { Fragment, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useProjectStore } from "@/project/useProject";
import { cancelCompile, effectiveEngine, startCompile } from "@/compile/useCompile";
import { RecipeMenu } from "@/compile/RecipeMenu";
import { useCurrentRecipe } from "@/compile/recipePicker";
import { useBuffersStore } from "./useBuffers";
import { insertionIndex, type TabSpan } from "./bufferOrder";

export interface TabBarProps {
  onFind: () => void;
}

export function TabBar({ onFind }: TabBarProps) {
  const buffers = useBuffersStore((s) => s.buffers);
  const activePath = useBuffersStore((s) => s.activePath);
  const setActive = useBuffersStore((s) => s.setActive);
  const closeBuffer = useBuffersStore((s) => s.closeBuffer);
  const reorderBuffer = useBuffersStore((s) => s.reorderBuffer);

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

  // 标签拖拽排序：用指针事件而非 HTML5 draggable —— Tauri v2 在 Windows 默认
  // dragDropEnabled=true 会拦截网页内 HTML5 拖放（编辑器仍需原生文件拖入）。
  // 与拼图 CellList 同口径：位移超过阈值才算拖拽，结束后的 click 要吞掉。
  const barRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const suppressClick = useRef(false);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** 当前各标签的水平区间（拖拽期间不重排 DOM，位置稳定） */
  const spansOf = (): TabSpan[] =>
    tabRefs.current
      .slice(0, useBuffersStore.getState().buffers.length)
      .map((el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      })
      .filter((span): span is TabSpan => span !== null);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, path: string) => {
    if (e.button !== 0) return;
    // 关闭按钮 / 脏点交给自身 click，不从这里启动拖拽
    if ((e.target as HTMLElement).closest("button")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let active = false;
    let edge = 0;
    let raf = 0;

    // 拖到标签条左右边缘时自动滚动，才能把标签移到当前视口外的位置
    const autoScroll = () => {
      if (edge !== 0 && barRef.current) {
        barRef.current.scrollLeft += edge * 12;
        setDropIndex(insertionIndex(spansOf(), lastX));
      }
      if (active) raf = requestAnimationFrame(autoScroll);
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return;
        active = true;
        setDragPath(path);
        raf = requestAnimationFrame(autoScroll);
      }
      lastX = ev.clientX;
      ev.preventDefault();
      setDropIndex(insertionIndex(spansOf(), lastX));
      const bar = barRef.current;
      if (bar) {
        const r = bar.getBoundingClientRect();
        edge = lastX < r.left + 24 ? -1 : lastX > r.right - 24 ? 1 : 0;
      }
    };

    const finish = (ev: PointerEvent | null) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (active) {
        if (ev) reorderBuffer(path, insertionIndex(spansOf(), ev.clientX));
        // 拖拽尾随的 click 不应把被拖的标签激活
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
      }
      active = false;
      edge = 0;
      cancelAnimationFrame(raf);
      setDragPath(null);
      setDropIndex(null);
    };
    const onUp = (ev: PointerEvent) => finish(ev);
    const onCancel = () => finish(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  return (
    <>
      <div className="tabbar" ref={barRef} role="tablist" aria-label="打开的文档">
        {buffers.map((b, i) => {
          const active = b.path === activePath;
          const dirty = b.content !== b.savedContent;
          // 绘图 Tab 图标与侧栏「绘图」视图同源（sprite `#i-draw`，即
          // src/assets/icon/绘图.svg 的同一 path），改一处两边一致
          const iconName =
            b.kind === "image" ? "image"
              : b.kind === "pdf" ? "pdf"
                : b.kind === "figure" ? "image"
                  : b.kind === "diagram" ? "draw"
                    : b.kind === "settings" ? "sliders"
                      : "tex";
          const title =
            b.kind === "diagram"
              ? "绘图工作台（TikZ）"
              : b.kind === "settings"
                ? "偏好设置（可在设置页头切回弹窗）"
                : b.path;
          const cls = [
            "tab",
            active ? "active" : "",
            dragPath === b.path ? "is-dragging" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <Fragment key={b.path}>
              {dragPath && dropIndex === i && (
                <span className="tab-dropmark" aria-hidden />
              )}
              <div
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                aria-selected={active}
                title={`${title} · 拖动可调整顺序`}
                className={cls}
                onPointerDown={(e) => startDrag(e, b.path)}
                onClick={() => {
                  if (suppressClick.current) return;
                  setActive(b.path);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) void closeBuffer(b.path); // 中键关闭
                }}
              >
                <Icon
                  name={iconName}
                  size={13}
                  style={{
                    color:
                      b.kind === "text" ||
                      b.kind === "figure" ||
                      b.kind === "diagram" ||
                      b.kind === "settings"
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
            </Fragment>
          );
        })}
        {dragPath && dropIndex === buffers.length && (
          <span className="tab-dropmark" aria-hidden />
        )}

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
