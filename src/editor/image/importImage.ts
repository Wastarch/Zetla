// R5 · 图片导入主干（M1-7）—— 拖拽 / 粘贴 / 菜单 三条入口汇入同一管线
// 流程：校验 → 落盘到项目图片目录（Rust import_image*）→ 由文件名生成 slug →
//       计算相对当前 .tex 目录的路径 → 组装 figure 片段 → 插入编辑器并选中空 caption。
// 图片二进制落盘与路径解析都在 Rust 侧完成；前端只拼源码块。
import { projectApi } from "@/ipc/invoke";
import type { ImportImageResult } from "@/types";
import { EXT_IMG, extOf, notify, parentOf, useProjectStore } from "@/project/useProject";
import { useBuffersStore } from "@/editor/useBuffers";
import { getActiveView } from "@/editor/activeView";
import { insertSnippetSelect } from "@/core/moduleRegistry";
import { buildFigure } from "@/core/latexTemplates";
import { relativePath, slugify } from "./pathUtils";

/** 默认图片目录（无 .ltex/config.json/imageDir 时回落） */
const DEFAULT_IMAGE_DIR = "figure";

/** 校验上下文：未打开项目 / 无活动 .tex / 取不到图片目录则提示并返回 null */
function precheck(): { root: string; imageDir: string; texDir: string } | null {
  const project = useProjectStore.getState();
  const root = project.root;
  if (!root) {
    notify("请先打开项目", "err");
    return null;
  }
  const activePath = useBuffersStore.getState().activePath;
  if (!activePath || extOf(activePath) !== "tex") {
    notify("请在活动的 .tex 文档中插入图片", "err");
    return null;
  }
  const imageDir = project.tree?.imageDir?.trim() || DEFAULT_IMAGE_DIR;
  return { root, imageDir, texDir: parentOf(activePath) };
}

/** 文件对象是否为图片（按扩展名或 MIME 判断） */
export function isImageFile(f: File): boolean {
  if (EXT_IMG.has(extOf(f.name))) return true;
  return f.type.startsWith("image/");
}

/** 组装一个 figure 环境片段（M2-5d：与 fig 片段共用 core/latexTemplates.buildFigure） */
export function buildFigureSnippet(relPath: string, slug: string, labelPrefix = "fig:"): string {
  return buildFigure({ path: relPath, caption: "", label: `${labelPrefix}${slug}` });
}

/** 把落盘结果组装成 figure 片段并插入编辑器（光标落于空 caption 内） */
function finalize(results: ImportImageResult[], texDir: string): void {
  if (results.length === 0) return;
  const snippets = results.map((r) =>
    buildFigureSnippet(relativePath(texDir, r.absPath), slugify(r.fileName)),
  );
  const combined = snippets.join("\n\n");

  // 选中空 caption 的内容位置（\caption{ 之后、} 之前）
  const capIdx = combined.indexOf("\\caption{");
  const caret = capIdx >= 0 ? capIdx + "\\caption{".length : 0;

  const view = getActiveView();
  if (!view) {
    notify("无活动编辑器，图片已保存但未插入源码", "err");
    return;
  }
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  // 块前保证至少一个空行：光标不在行首、且前一字符不是换行时补一个换行
  const needLeading = pos > 0 && !doc.sliceString(pos - 1, pos).includes("\n");
  let text = combined;
  let lead = 0;
  if (needLeading) {
    text = "\n" + text;
    lead = 1;
  }
  text = text + "\n";
  const sel = lead + caret;
  insertSnippetSelect(text, sel, sel);

  // 刷新资源树（图片已落盘，让文件树出现该文件）
  void useProjectStore.getState().refresh();
  notify(`已插入 ${results.length} 张图片`, "ok");
}

/** 拖拽 / 粘贴入口：直接拿到 File 对象（字节从 File.arrayBuffer 取出） */
export async function importAndInsert(files: File[]): Promise<void> {
  const ctx = precheck();
  if (!ctx) return;
  const imgs = files.filter(isImageFile);
  if (imgs.length === 0) {
    notify("没有可插入的图片文件", "err");
    return;
  }
  const results: ImportImageResult[] = [];
  for (const f of imgs) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      results.push(await projectApi.importImage(ctx.root, ctx.imageDir, f.name, bytes));
    } catch (e) {
      notify(`导入「${f.name}」失败：${String(e)}`, "err");
    }
  }
  finalize(results, ctx.texDir);
}

/** 菜单选图入口：openFileDialog 返回磁盘路径，由 Rust 侧读取并落盘 */
export async function importImageFromPaths(paths: string[]): Promise<void> {
  const ctx = precheck();
  if (!ctx) return;
  if (paths.length === 0) return;
  const results: ImportImageResult[] = [];
  for (const p of paths) {
    try {
      results.push(await projectApi.importImageFromPath(ctx.root, ctx.imageDir, p));
    } catch (e) {
      notify(`导入「${p}」失败：${String(e)}`, "err");
    }
  }
  finalize(results, ctx.texDir);
}
