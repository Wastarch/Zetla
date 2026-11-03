// F6 · 拼图画布内的真实选图入口：替换 F2 的「载入示例图片（测试）」按钮。
// 选图只记录原始磁盘路径（path 来源），【不】调用 Rust 落盘；落盘推迟到「生成代码」时，
// 且仅拷贝真正进入代码的图片，避免实验性选图污染项目 figure/ 目录。
//
// append=false：替换画布内容（空态「选择图片…」）。
// append=true ：追加到现有画布（工具栏「添加图片…」）。
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { EXT_IMG, notify, useProjectStore } from "@/project/useProject";
import type { FigureCellSource } from "@/types/figure";
import { precheck } from "@/editor/image/importImage";
import { useFigureStore } from "./figureStore";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";

/** 从画布内选择图片并载入画布（无论几张都进画布，区别于主管线单图直插） */
export async function pickImagesToCanvas(append = false): Promise<void> {
  const ctx = precheck();
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
  // 记录导入时的目标 .tex（生成代码时即便拼图 Tab 活动也能插入此文件）
  const targetTex = useBuffersStore.getState().activePath;
  if (append) {
    useFigureStore.getState().addImages(sources);
  } else {
    useFigureStore.getState().initFromImages(sources, targetTex);
  }
  // 确保在拼图画布视图（若从别处触发，自动切过去），并打开中心预览 Tab
  useAppStore.getState().setSidebarView("figure");
  useBuffersStore.getState().openFigure();
  void useProjectStore.getState().refresh();
  notify(`已载入 ${sources.length} 张图片`, "ok");
}
