// LaTeX 工作台 · 应用入口
// M0-5：mockup 全屏结构 .app > .workspace > .center（M0-6 加 sidebar、M0-13 加 titlebar/menubar/preview）
// M0-13：三栏宽度/显隐进 store（useWindowMemory 负责持久化与启动恢复），验收抽屉 LabDrawer 已移除
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/core/store";
import { useSettingsEffects, useSettingsStore } from "@/core/settings";
import { checkEnvOnStartup } from "@/env/useEnvCheck";
import { EditorWorkspace } from "@/editor/EditorWorkspace";
import { Sidebar } from "@/project/Sidebar";
import { ActivityBar } from "@/project/ActivityBar";
import { CtxMenu } from "@/project/CtxMenu";
import { EntryDialog } from "@/project/EntryDialog";
import { TemplateWizard } from "@/template/TemplateWizard";
import { MenuBar } from "@/ui/MenuBar";
import { StatusBar } from "@/ui/StatusBar";
import { LogPanel } from "@/ui/LogPanel";
import { SettingsDialog } from "@/ui/SettingsDialog";
import { EnvGuideDialog } from "@/ui/EnvGuideDialog";
import { EnvSetupWizard } from "@/env/EnvSetupWizard";
import { PdfPreview } from "@/preview/PdfPreview";
import { useCompileBridge } from "@/compile/useCompile";
import { useModuleRuntime } from "@/core/useModuleRuntime";
import { useProjectWatch } from "@/project/useProjectWatch";
import { useAutosave } from "@/editor/useAutosave";
import { useWindowMemory } from "@/window/useWindowMemory";
import "./styles/zetla.css";
import "./App.css";

/** M1-5a：活动栏固定宽度（常驻左侧；须与 zetla.css 中 .activity 的 width 一致） */
const ACTIVITY_W = 44;

function App() {
  // M0-13：侧栏/预览宽度与显隐进全局 store（useWindowMemory 启动恢复 + 防抖持久化）
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const previewVisible = useAppStore((s) => s.previewVisible);
  const previewRatio = useAppStore((s) => s.previewRatio);
  const settingsPane = useAppStore((s) => s.settingsDialog);

  // 拖拽中读 avail 不批最新值，用 ref
  const wsRef = useRef<HTMLDivElement | null>(null);
  const [wsW, setWsW] = useState(() => window.innerWidth);

  // M0-9：编译事件桥（全应用只注册一次）
  useCompileBridge();
  // M1-1：模块接口层运行时（能力登记 / DEV 演示模块 / 设置→注册表 / 总线钩子）
  useModuleRuntime();
  // M0-9a：项目目录变更 → 资源树自动刷新
  useProjectWatch();
  // M0-14a：偏好设置启动加载 + 编辑器 CSS 生效 + 定时自动保存
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);
  // M0-15a/15b：启动检测 TeX 环境；未找到时自动打开引导（每次启动一次，检测失败不弹窗）
  useEffect(() => {
    void checkEnvOnStartup();
  }, []);
  useSettingsEffects();
  useAutosave();
  // M0-13：窗口几何/布局/上次项目（settings 加载完成后统一恢复）
  useWindowMemory();

  const draggingRef = useRef(false);
  const RESIZER_W = 5;
  const avail = Math.max(
    0,
    wsW - ACTIVITY_W - (sidebarVisible ? sidebarWidth + RESIZER_W : 0) - RESIZER_W,
  );
  /** 预览宽度：比例换算，预览≥300、编辑区≥360 兜底 */
  const previewW = Math.round(
    Math.min(Math.max(previewRatio * avail, 300), Math.max(300, avail - 360)),
  );
  const availRef = useRef(avail);
  availRef.current = avail;

  useEffect(() => {
    const el = wsRef.current;
    if (!el) return;
    setWsW(el.clientWidth);
    const ro = new ResizeObserver(() => setWsW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const startResize = useCallback(() => {
    draggingRef.current = true;
    document.body.classList.add("col-resizing");
  }, []);
  // 右侧预览拖拽：从窗口右缘往左量宽度
  const prevDragRef = useRef(false);
  const startPrevResize = useCallback(() => {
    prevDragRef.current = true;
    document.body.classList.add("col-resizing");
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) {
        // 侧栏左边界在活动栏右侧 → 宽度 = 指针 x − 活动栏宽
        useAppStore.setState({
          sidebarWidth: Math.min(Math.max(e.clientX - ACTIVITY_W, 170), 560),
        });
      }
      if (prevDragRef.current) {
        // 从窗口右缘量，换算成比例（拖拽后窗口缩放仍按比例分配）
        const a = Math.max(availRef.current, 1);
        useAppStore.setState({
          previewRatio: Math.min(0.75, Math.max(0.2, (window.innerWidth - e.clientX) / a)),
        });
      }
    };
    const onUp = () => {
      if (!draggingRef.current && !prevDragRef.current) return;
      draggingRef.current = false;
      prevDragRef.current = false;
      document.body.classList.remove("col-resizing");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className="app">
      <MenuBar />
      <div className="workspace" ref={wsRef}>
        {/* M1-5a：活动栏常驻（侧栏折叠时仍在，用于切回/展开） */}
        <ActivityBar />
        {sidebarVisible && (
          <>
            <Sidebar style={{ width: sidebarWidth }} />
            <div
              className="resizer"
              title="拖拽调整侧栏宽度"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startResize();
              }}
            />
          </>
        )}
        <EditorWorkspace />
        {previewVisible && (
          <>
            <div
              className="resizer"
              title="拖拽调整预览宽度"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startPrevResize();
              }}
            />
            <PdfPreview style={{ width: previewW }} />
          </>
        )}
      </div>
      <LogPanel />
      <StatusBar />
      <CtxMenu />
      <EntryDialog />
      <TemplateWizard />
      {settingsPane !== null && <SettingsDialog />}
      {/* M0-15a：TeX 环境引导（放在设置页之后，同开时叠在其上层） */}
      <EnvGuideDialog />
      {/* M0-15b：TeX 自动安装向导 */}
      <EnvSetupWizard />
    </div>
  );
}

export default App;
