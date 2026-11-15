// 拼图「粘贴 / 拖入」统一容器：侧栏（FigureSidebar）与中心预览 Tab（FigurePreviewTab）共用。
//
// 两种入口在此统一处理，避免两套组件各写一遍：
//   - 粘贴：容器可聚焦（tabIndex=-1），Ctrl+V 的图片 File → pasteImagesToCanvas(File[])
//   - 拖入：双通道兜底，任一生效即可
//     (a) Tauri 原生：默认 dragDropEnabled=true 时窗口级文件拖放由 Rust 接管，
//         webview 内 HTML5 drop 常被禁用，须监听 tauri://drag-drop 等事件拿 paths + position。
//         【坑】事件名是 TauriEvent.DRAG_DROP（"tauri://drag-drop"），
//         直接 listen("drag-drop", …) 永远收不到 → 光标有反馈但图片不进拼图。
//         position 是**物理像素**、相对 webview 左上角，须 ÷ devicePixelRatio 再比 DOM rect。
//     (b) HTML5 onDrop：某些平台/版本仍会派发，作为兜底（dragover 必须 preventDefault，
//         且要用 dataTransfer.types 判文件——dragover 阶段 files 恒为空）。
//     两通道由 claimDrop() 去重，一次拖放只消费一次。
//
// 窗口级 Tauri 事件在模块级只注册一次（单例），用 data-figure-dropzone 标记 + 几何命中
// 判断落点是否属于任一拼图区域；侧栏 / 预览页同时挂载也不会把一次 drop 重复消费。
import { useEffect, type ReactNode } from "react";
import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { isImageFile } from "@/editor/image/importImage";
import { dropPathsToCanvas, pasteImagesToCanvas } from "./figureImport";

interface Props {
  /** 根元素 class（侧栏传 figside，预览页传 fig-preview-root） */
  className: string;
  children: ReactNode;
}

/** Tauri 原生拖放 payload（enter/drop 带 paths，enter/over/drop 带 position；leave 无） */
interface DragPayload {
  paths?: string[];
  position?: { x: number; y: number };
}

/** 一次拖放可能被两个通道同时上报，300ms 内只消费一次（人手连续拖放远大于此间隔） */
let lastDropAt = 0;
function claimDrop(): boolean {
  const now = Date.now();
  if (now - lastDropAt < 300) return false;
  lastDropAt = now;
  return true;
}

/** 当前挂载的所有拼图「粘贴/拖入」容器 */
function dropZones(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-figure-dropzone]"));
}

/**
 * 用视口 CSS 坐标做几何命中：比 elementFromPoint 更稳（拖放时不受拖影 / 遮罩干扰）。
 * Tauri DragDropEvent.position 是物理像素（见 webview.d.ts:54），
 * 而 getBoundingClientRect() 是 CSS 逻辑像素 → 必须先 ÷ devicePixelRatio。
 * 少数平台/版本若已给逻辑像素，换算不命中时再用原值试一次兜底。
 */
function zoneAt(cssX: number, cssY: number): HTMLElement | null {
  for (const z of dropZones()) {
    const r = z.getBoundingClientRect();
    if (cssX >= r.left && cssX <= r.right && cssY >= r.top && cssY <= r.bottom) return z;
  }
  return null;
}

function resolveZone(pos: { x: number; y: number }): HTMLElement | null {
  const dpr = window.devicePixelRatio || 1;
  return zoneAt(pos.x / dpr, pos.y / dpr) ?? zoneAt(pos.x, pos.y);
}

/** 悬停高亮：over 事件高频触发，只在目标变化时改 DOM 属性，不让 React 重渲染 */
let highlighted: HTMLElement | null = null;
function setHighlight(zone: HTMLElement | null): void {
  if (highlighted === zone) return;
  highlighted?.removeAttribute("data-figure-dropover");
  zone?.setAttribute("data-figure-dropover", "1");
  highlighted = zone;
}

function setHighlightFromPos(pos?: { x: number; y: number }): void {
  setHighlight(pos ? resolveZone(pos) : null);
}

// 应用生命周期内常驻一次；webview 生命周期即应用生命周期，无需随组件卸载。
let installed = false;
let unlisteners: UnlistenFn[] = [];
function ensureDragDropListener(): void {
  if (installed) return;
  installed = true;
  void Promise.all([
    // 悬停：明确提示「松手即加入拼图」（Tauri 接管拖放时系统光标反馈不足）
    listen<DragPayload>(TauriEvent.DRAG_ENTER, (e) => setHighlightFromPos(e.payload?.position)),
    listen<DragPayload>(TauriEvent.DRAG_OVER, (e) => setHighlightFromPos(e.payload?.position)),
    listen(TauriEvent.DRAG_LEAVE, () => setHighlight(null)),
    // 松手：只有落在任一拼图区域内才导入；拖到别处（如代码区）不干预既有逻辑
    listen<DragPayload>(TauriEvent.DRAG_DROP, (e) => {
      const p = e.payload;
      // position 若因版本/平台差异解析失败，回落到最近一次悬停命中的区域
      const zone = (p?.position ? resolveZone(p.position) : null) ?? highlighted;
      setHighlight(null);
      if (zone && p?.paths?.length && claimDrop()) void dropPathsToCanvas(p.paths);
    }),
  ])
    .then((fns) => {
      unlisteners = fns;
    })
    .catch((e) => {
      // 非 Tauri 环境（纯浏览器预览）或注册失败：允许下一次挂载重试
      installed = false;
      console.warn("[figure] 拖放监听注册失败", e);
    });
}

// HMR 时清理旧监听，避免 dev 热更新后重复注册
const hot = (import.meta as ImportMeta & { hot?: { dispose: (cb: () => void) => void } }).hot;
hot?.dispose(() => {
  unlisteners.forEach((u) => void u());
  unlisteners = [];
  installed = false;
  setHighlight(null);
});

/** dragover 阶段 dataTransfer.files 恒为空，只能用 types 判断是否为文件拖入 */
function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes("Files");
}

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
      // HTML5 兜底通道：Tauri 未禁用 webview 拖放时由此生效（与 Tauri 通道经 claimDrop 去重）
      onDragEnter={(e) => {
        if (isFileDrag(e.dataTransfer)) setHighlight(e.currentTarget);
      }}
      onDragOver={(e) => {
        // 不 preventDefault 则浏览器不会派发 drop 事件
        if (isFileDrag(e.dataTransfer)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHighlight(null);
      }}
      onDrop={(e) => {
        const imgs = Array.from(e.dataTransfer?.files ?? []).filter(isImageFile);
        if (imgs.length === 0) return;
        e.preventDefault();
        setHighlight(null);
        if (claimDrop()) void pasteImagesToCanvas(imgs);
      }}
    >
      {children}
    </div>
  );
}
