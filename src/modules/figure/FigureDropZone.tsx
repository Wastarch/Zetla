// 拼图「粘贴 / 拖入」统一容器：侧栏（FigureSidebar）与中心预览 Tab（FigurePreviewTab）共用。
//
// 两种入口在此统一处理，避免两套组件各写一遍：
//   - 粘贴：容器可聚焦（tabIndex=-1），Ctrl+V 的图片 File → pasteImagesToCanvas(File[])
//   - 拖入：Tauri v2 默认 dragDropEnabled=true 在 Rust 层接管窗口级文件拖放，
//     webview 内 HTML5 onDrop 收不到，只能监听 drag-drop 事件拿 paths + position
//     → dropPathsToCanvas(path[])
//
// drag-drop 是窗口级事件，模块级只注册一次（单例），用 data-figure-dropzone 标记判断
// 落点是否属于任一拼图区域；侧栏 / 预览页同时挂载也不会把一次 drop 重复消费。
import { useEffect, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isImageFile } from "@/editor/image/importImage";
import { dropPathsToCanvas, pasteImagesToCanvas } from "./figureImport";

interface Props {
  /** 根元素 class（侧栏传 figside，预览页传 fig-preview-root） */
  className: string;
  children: ReactNode;
}

/** 视口坐标 (x,y) 是否落在任一拼图「粘贴/拖入」容器内 */
function hitDropZone(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  return !!el?.closest?.("[data-figure-dropzone]");
}

function onDragDrop(event: { payload: unknown }): void {
  const p = event.payload as {
    type?: string;
    paths?: string[];
    position?: { x: number; y: number };
  } | undefined;
  if (!p) return;
  if (typeof p.type === "string" && p.type.toLowerCase() !== "drop") return;
  const pos = p.position;
  const paths = p.paths ?? [];
  if (!pos || paths.length === 0) return;
  // Tauri position 单位不定（物理/逻辑像素随版本），两种坐标都试一次
  const dpr = window.devicePixelRatio || 1;
  if (hitDropZone(pos.x / dpr, pos.y / dpr) || hitDropZone(pos.x, pos.y)) {
    void dropPathsToCanvas(paths);
  }
}

// 应用生命周期内常驻一次；webview 生命周期即应用生命周期，无需随组件卸载。
let installed = false;
let unlisten: UnlistenFn | null = null;
function ensureDragDropListener(): void {
  if (installed) return;
  installed = true;
  void listen<unknown>("drag-drop", onDragDrop).then((u) => {
    unlisten = u;
  });
}
// HMR 时清理旧监听，避免 dev 热更新后重复注册
const hot = (import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }).hot;
hot?.dispose(() => {
  unlisten?.();
  unlisten = null;
  installed = false;
});

export default function FigureDropZone({ className, children }: Props) {
  useEffect(() => {
    ensureDragDropListener();
  }, []);

  return (
    <div
      data-figure-dropzone="1"
      className={className}
      tabIndex={-1}
      onMouseDown={(e) => {
        // 让容器获得焦点，使之后在此区域内 Ctrl+V 能路由到 onPaste（子元素焦点经冒泡同样生效）。
        // 但不抢表单控件 / 按钮自身的焦点——否则侧栏的「图片标题」「行列」输入框会无法输入。
        const t = e.target as HTMLElement;
        if (t.closest?.("input, textarea, select, button, [contenteditable='true']")) return;
        (e.currentTarget as HTMLDivElement).focus();
      }}
      onPaste={(e) => {
        const dt = e.clipboardData;
        if (!dt) return;
        const imgs = Array.from(dt.files).filter(isImageFile);
        if (imgs.length === 0) return; // 非图片粘贴（如行列框数字）→ 放行
        e.preventDefault();
        void pasteImagesToCanvas(imgs);
      }}
    >
      {children}
    </div>
  );
}
