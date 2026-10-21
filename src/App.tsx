// LaTeX 工作台 · 应用入口
// M0-5：mockup 全屏结构 .app > .workspace > .center（M0-6 加 sidebar、M0-13 加 titlebar/menubar/preview）
// 原 M0-1~M0-3 验收卡片收进「验收面板」抽屉，M0-13 布局壳落地后移除。
import { useCallback, useEffect, useRef, useState } from "react";
import { compileApi, coreApi, type PingReply } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { EditorWorkspace } from "@/editor/EditorWorkspace";
import { Sidebar } from "@/project/Sidebar";
import { CtxMenu } from "@/project/CtxMenu";
import { EntryDialog } from "@/project/EntryDialog";
import { TemplateWizard } from "@/template/TemplateWizard";
import { Icon } from "@/ui/Icon";
import { MenuBar } from "@/ui/MenuBar";
import { StatusBar } from "@/ui/StatusBar";
import { LogPanel } from "@/ui/LogPanel";
import { PdfPreview } from "@/preview/PdfPreview";
import { useCompileBridge } from "@/compile/useCompile";
import { useProjectWatch } from "@/project/useProjectWatch";
import type { TexDistInfo } from "@/types";
import "./styles/zetla.css";
import "./App.css";

/**
 * M0-3a：TeX 发行版检测卡片
 */
function EnvCard() {
  const [info, setInfo] = useState<TexDistInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function detect() {
    setLoading(true);
    try {
      setErr(null);
      setInfo(await compileApi.detectTexDistribution());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    detect();
  }, []);

  return (
    <div className="card">
      <h2>TeX 环境检测</h2>
      {err && <p className="error">失败: {err}</p>}
      {info && (
        <>
          {info.found ? (
            <p>
              <strong>{info.distribution}</strong>
              {info.version ? ` ${info.version}` : ""} · 推荐引擎{" "}
              <code>{info.recommended}</code>
            </p>
          ) : (
            <p className="error">
              未检测到 TeX 发行版，请先安装 MiKTeX（Windows）或 TeX Live
            </p>
          )}
          <p className="meta">
            引擎:{" "}
            {info.engines.length > 0
              ? info.engines.map((e) => <code key={e}>{e} </code>)
              : "无"}
          </p>
        </>
      )}
      <button className="btn" onClick={detect} disabled={loading}>
        {loading ? "检测中…" : "重新检测"}
      </button>
    </div>
  );
}

/**
 * 验收面板抽屉 —— 承载 M0-1/M0-2/M0-3a 的临时验收卡片。
 * M0-13 布局壳（状态栏环境提示 + titlebar 菜单）落地后整块移除。
 */
function LabDrawer({
  onClose,
  ping,
  pingErr,
  onPing,
}: {
  onClose: () => void;
  ping: PingReply | null;
  pingErr: string | null;
  onPing: () => void;
}) {
  const compileStatus = useAppStore((s) => s.compileStatus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-layer" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>验收面板</h2>
          <span className="sub">M0-1 ~ M0-5 · M0-13 后移除</span>
          <button type="button" className="ibtn x" title="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          <p className="milestone">当前切片：M0-7 模板引擎 + 新建向导（M0-4~M0-6 ✅）</p>

          <EnvCard />

          <div className="card">
            <h2>IPC 往返（ping）</h2>
            {pingErr ? (
              <p className="error">失败: {pingErr}</p>
            ) : ping ? (
              <p>
                {ping.msg} · <code>ts={ping.ts}</code>
              </p>
            ) : (
              <p>等待内核响应…</p>
            )}
            <button className="btn" onClick={onPing}>
              重新 Ping
            </button>
          </div>

          <div className="card">
            <h2>全局状态（zustand）</h2>
            <p>
              编译状态: <strong>{compileStatus}</strong>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [ping, setPing] = useState<PingReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  // M0-10：右侧 PDF 预览（宽度仅运行时，持久化留给 M0-13）
  const previewVisible = useAppStore((s) => s.previewVisible);
  const [prevW, setPrevW] = useState(432);

  // M0-9：编译事件桥（全应用只注册一次）
  useCompileBridge();
  // M0-9a：项目目录变更 → 资源树自动刷新
  useProjectWatch();

  // M0-6：侧栏 .resizer 拖拽（仅运行时，不持久化 —— M0-13 接 load/save_app_config）
  const [sideW, setSideW] = useState(258);
  const draggingRef = useRef(false);
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
      if (draggingRef.current) setSideW(Math.min(Math.max(e.clientX, 170), 560));
      if (prevDragRef.current) setPrevW(Math.min(Math.max(window.innerWidth - e.clientX, 300), 900));
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

  async function doPing() {
    try {
      setError(null);
      setPing(await coreApi.ping());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    doPing();
  }, []);

  return (
    <div className="app">
      <MenuBar />
      <div className="workspace">
        {sidebarVisible && (
          <>
            <Sidebar style={{ width: sideW }} />
            <div
              className="resizer"
              title="拖拽调整侧栏宽度"
              onMouseDown={(e) => {
                e.preventDefault();
                startResize();
              }}
            />
          </>
        )}
        <EditorWorkspace onOpenLab={() => setLabOpen(true)} />
        {previewVisible && (
          <>
            <div
              className="resizer"
              title="拖拽调整预览宽度"
              onMouseDown={(e) => {
                e.preventDefault();
                startPrevResize();
              }}
            />
            <PdfPreview style={{ width: prevW }} />
          </>
        )}
      </div>
      <LogPanel />
      <StatusBar />
      <CtxMenu />
      <EntryDialog />
      <TemplateWizard />
      {labOpen && (
        <LabDrawer
          onClose={() => setLabOpen(false)}
          ping={ping}
          pingErr={error}
          onPing={doPing}
        />
      )}
    </div>
  );
}

export default App;
