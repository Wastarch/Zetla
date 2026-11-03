// F6 · 拼图画布内的真实选图入口：替换 F2 的「载入示例图片（测试）」按钮。
// 复用 importImage 的 precheck / Rust importImageFromPath / relativePath，
// 保证落盘与命名口径与单图插入完全一致；区别仅在“载入画布”而非“直插 figure”。
//
// append=false：替换画布内容（空态「选择图片…」）。
// append=true ：追加到现有画布（工具栏「添加图片…」）。
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { projectApi } from "@/ipc/invoke";
import type { ImportImageResult } from "@/types";
import { EXT_IMG, notify, useProjectStore } from "@/project/useProject";
import { precheck } from "@/editor/image/importImage";
import { relativePath } from "@/editor/image/pathUtils";
import { useFigureStore } from "./figureStore";
import { useAppStore } from "@/core/store";

/** 从画布内选择图片并载入画布（无论几张都进画布，区别于主管线单图直插） */
export async function pickImagesToCanvas(append = false): Promise<void> {
  const ctx = precheck();
  if (!ctx) return;
  const picked = await openFileDialog({
    multiple: true,
    filters: [{ name: "图片", extensions: [...EXT_IMG] }],
  });
  if (!picked) return;
  const paths = typeof picked === "string" ? [picked] : picked;

  const results: ImportImageResult[] = [];
  for (const p of paths) {
    try {
      results.push(await projectApi.importImageFromPath(ctx.root, ctx.imageDir, p));
    } catch (e) {
      notify(`导入「${p}」失败：${String(e)}`, "err");
    }
  }
  if (results.length === 0) return;

  const rels = results.map((r) => relativePath(ctx.texDir, r.absPath));
  if (append) {
    useFigureStore.getState().addImages(rels);
  } else {
    useFigureStore.getState().initFromImages(rels);
  }
  // 确保在拼图画布视图（若从别处触发，自动切过去）
  useAppStore.getState().setSidebarView("figure");
  void useProjectStore.getState().refresh();
  notify(`已载入 ${results.length} 张图片`, "ok");
}
