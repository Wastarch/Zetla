// F6 · 拼图画布内的真实选图入口：替换 F2 的「载入示例图片（测试）」按钮。
// 选图只记录原始磁盘路径（path 来源），【不】调用 Rust 落盘；落盘推迟到「生成代码」时，
// 且仅拷贝真正进入代码的图片，避免实验性选图污染项目 figures/ 目录。
//
// append=false：替换画布内容（空态「选择图片…」）。
// append=true ：追加到现有画布（工具栏「添加图片…」）。
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { EXT_IMG, extOf, notify, useProjectStore } from "@/project/useProject";
import type { FigureCellSource } from "@/types/figure";
import { isImageFile } from "@/editor/image/importImage";
import { useFigureStore } from "./figureStore";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";

/**
 * 画布导入专用上下文：只要求「项目已打开」，【不】要求当前活动 Tab 是 .tex。
 *
 * 不能用 importImage.precheck()：它校验的是「插入 figure 片段到当前 .tex」这一语义
 * （需要 activePath 来算 \includegraphics 相对路径）。而画布导入只记录来源，
 * 落盘 / 插入 .tex 推迟到「生成代码」，用的是 figureStore.targetTex，与当前活动 Tab 无关。
 * 第一张导入会 openFigure() 把 activePath 切到伪 buffer「figure://preview」，
 * 此时若沿用 precheck() 会误报「请在活动的 .tex 文档中插入图片」，导致第二张粘不进去。
 *
 * targetTex 解析优先级：当前活动 .tex → store 已记录的目标 .tex → 已打开 buffers 中首张 .tex。
 * 取不到时允许 null（生成代码时由 handleGenerate 给出「缺少目标 .tex」提示，不阻断导入）。
 */
function canvasContext(): { targetTex: string | null } | null {
  const project = useProjectStore.getState();
  if (!project.root) {
    notify("请先打开项目", "err");
    return null;
  }
  const buffers = useBuffersStore.getState();
  const candidates = [
    buffers.activePath,
    useFigureStore.getState().targetTex,
    ...buffers.buffers.map((b) => b.path),
  ];
  const targetTex = candidates.find((p): p is string => !!p && extOf(p) === "tex") ?? null;
  return { targetTex };
}

/** 从画布内选择图片并载入画布（无论几张都进画布，区别于主管线单图直插） */
export async function pickImagesToCanvas(append = false): Promise<void> {
  const ctx = canvasContext();
  if (!ctx) return;
  const picked = await openFileDialog({
    multiple: true,
    filters: [{ name: "图片与 PDF", extensions: [...EXT_IMG] }],
  });
  if (!picked) return;
  const paths = typeof picked === "string" ? [picked] : picked;
  if (paths.length === 0) return;

  // 仅记录来源（原始路径），此刻不落盘；落盘在生成代码时进行
  const sources: FigureCellSource[] = paths.map((p) => ({ kind: "path", abs: p }));
  if (append) {
    useFigureStore.getState().addImages(sources);
  } else {
    useFigureStore.getState().initFromImages(sources, ctx.targetTex);
  }
  // 确保在拼图画布视图（若从别处触发，自动切过去），并打开中心预览 Tab
  useAppStore.getState().setSidebarView("figure");
  useBuffersStore.getState().openFigure();
  void useProjectStore.getState().refresh();
  notify(`已载入 ${sources.length} 张图片`, "ok");
}

/**
 * 从剪贴板 / 拖拽的 File 列表载入拼图画布（截图一次只能截一张，故支持多次粘贴累积）。
 * 画布已有图 → 追加（addImages）；否则新建（initFromImages）并打开预览。
 * 与 pickImagesToCanvas 同口径：仅记录来源，落盘推迟到「生成代码」时。
 */
export async function pasteImagesToCanvas(files: File[]): Promise<void> {
  const ctx = canvasContext();
  if (!ctx) return;
  const imgs = files.filter(isImageFile);
  if (imgs.length === 0) return;

  // 仅记录来源（File，此刻不落盘）；落盘在生成代码时进行
  const sources: FigureCellSource[] = imgs.map((f) => ({ kind: "file", file: f }));
  const store = useFigureStore.getState();
  const hadCells = store.layout.cells.length > 0;
  if (hadCells) {
    store.addImages(sources);
  } else {
    store.initFromImages(sources, ctx.targetTex);
  }

  // 确保在拼图画布视图并打开中心预览 Tab（即便从别处触发也切过去）
  useAppStore.getState().setSidebarView("figure");
  useBuffersStore.getState().openFigure();
  void useProjectStore.getState().refresh();
  notify(`已${hadCells ? "追加" : "载入"} ${imgs.length} 张图片到拼图`, "ok");
}

/**
 * 从 Tauri 原生拖放拿到的文件路径载入拼图画布。
 * Tauri v2 默认 dragDropEnabled=true 会接管窗口级文件拖放，webview 内 HTML5 onDrop 收不到，
 * 只能监听 TauriEvent.DRAG_DROP（tauri://drag-drop）；
 * 本函数由 FigureDropZone 在 drop 命中任一拼图区域（侧栏 / 中心预览页）时调用。
 * 与 pickImagesToCanvas 同口径：仅记录 path 来源（零拷贝预览），落盘推迟到「生成代码」时。
 * 画布已有图 → 追加（addImages）；否则新建（initFromImages）并打开预览。
 */
export async function dropPathsToCanvas(paths: string[]): Promise<void> {
  const ctx = canvasContext();
  if (!ctx) return;
  const imgs = paths.filter((p) => EXT_IMG.has(p.split(".").pop()?.toLowerCase() ?? ""));
  if (imgs.length === 0) return;

  // 仅记录来源（path，此刻不落盘）；落盘在生成代码时进行
  const sources: FigureCellSource[] = imgs.map((abs) => ({ kind: "path", abs }));
  const store = useFigureStore.getState();
  const hadCells = store.layout.cells.length > 0;
  if (hadCells) {
    store.addImages(sources);
  } else {
    store.initFromImages(sources, ctx.targetTex);
  }

  // 确保在拼图画布视图并打开中心预览 Tab（即便从别处触发也切过去）
  useAppStore.getState().setSidebarView("figure");
  useBuffersStore.getState().openFigure();
  void useProjectStore.getState().refresh();
  notify(`已${hadCells ? "追加" : "载入"} ${imgs.length} 张图片到拼图`, "ok");
}
