// M2·F1-2：绘图工作台 Tab 内容根（挂在 `diagram://editor` 伪 buffer 上，见 useBuffers.openDiagram）。
// 三布局 canvas | code | split 全在**本 Tab 内部**切换：不新建 Tab、不替换主编辑区，
// .tex 编辑器 / 其它 Tab / PDF 预览始终可用。F1-3 接画布 SVG，F1-4 接插入主文档。
import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { DiagramLayoutBar } from "./DiagramLayoutBar";
import { DiagramCanvas } from "./DiagramCanvas";
import { DiagramInspector } from "./DiagramInspector";
import { DiagramCodePane } from "./DiagramCodePane";
import { useBuffersStore } from "@/editor/useBuffers";
import { useDiagramStore } from "./store";
import { discardSessionStagedImages } from "./imageStaging";
import "./diagram.css";

export default function DiagramTab() {
  const layoutMode = useDiagramStore((s) => s.layoutMode);
  const splitRatio = useDiagramStore((s) => s.splitRatio);
  const setSplitRatio = useDiagramStore((s) => s.setSplitRatio);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // P2：关闭绘图 Tab = 本次编辑会话结束 → 安静清理未转正的暂存图。
  // closeBuffer 先从 store 移除 buffer 再卸载组件；StrictMode 的假卸载 / Suspense 重挂载
  // 时 buffer 仍在，据此跳过，避免刚打开就误删。
  useEffect(
    () => () => {
      const stillOpen = useBuffersStore
        .getState()
        .buffers.some((b) => b.kind === "diagram");
      if (stillOpen) return;
      void discardSessionStagedImages({ keepIfEditing: false });
    },
    [],
  );

  // 分屏分隔条：沿用 App.tsx 侧栏/预览的 window 级拖拽范式（body.col-resizing 抑制选中）。
  // 比例按容器实际宽度换算，窗口缩放后仍按比例分配；钳取在 store 的 0.2–0.8。
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      setSplitRatio((e.clientX - rect.left) / rect.width);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("col-resizing");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("col-resizing");
    };
  }, [setSplitRatio]);

  const startResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.classList.add("col-resizing");
  }, []);

  const split = layoutMode === "split";

  return (
    <div className="dg-tab">
      <DiagramLayoutBar />
      <div className="dg-tab-body" ref={bodyRef} data-layout={layoutMode}>
        {/* 两个 pane 常驻挂载，用 hidden 隐藏：切布局不丢 CM 的撤销栈与光标位置 */}
        <div
          className="dg-pane dg-pane-canvas"
          hidden={layoutMode === "code"}
          style={split ? { width: `calc(${splitRatio * 100}% - 2.5px)` } : undefined}
        >
          {/* 2026-11-12：单个图元属性 / 尺寸 / 对齐变换常驻画布左侧；图元清单仍只在侧栏。
              代码区（.dg-pane-code）仍只有 LaTeXEditor 一个孩子，零改动。 */}
          <div className="dg-canvas-workspace">
            <DiagramInspector />
            <DiagramCanvas />
          </div>
        </div>
        {split && (
          <div
            className="resizer dg-splitter"
            title="拖拽调整画布 / 源码宽度"
            onMouseDown={startResize}
          />
        )}
        <div className="dg-pane dg-pane-code" hidden={layoutMode === "canvas"}>
          <DiagramCodePane />
        </div>
      </div>
    </div>
  );
}
