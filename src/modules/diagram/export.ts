// M2 · 绘图模块 F5-1：把 TikZ 片段编译后导出 PNG / SVG / PDF 并落盘。
// 复用 Rust tikz_export（与精确预览同一编译内核）；只负责前端落盘路径解析、
// 覆盖确认、结果反馈。F5-2（插入主文档）/ F5-3（仅保存）的落盘机制都走这里。
//
// 两条落盘路径：
//  · image 模式 → 写到项目 imageDir（默认 figure/），供后续 figure 插入；
//  · file  模式 → 弹系统保存框，用户自选路径，不改主文档（F5-3）。
import { save as saveDialog, confirm } from "@tauri-apps/plugin-dialog";
import { diagramApi } from "@/ipc/invoke";
import { useDiagramStore } from "./store";
import { useProjectStore, notify } from "@/project/useProject";
import { canvasSizeToPt } from "./canvasSize";
import type { TikzExportResult } from "@/types/diagram";

/** 默认图片目录（无项目 tree.imageDir 时回落），与 R5 导入 / 图形模块一致 */
const DEFAULT_IMAGE_DIR = "figure";

/**
 * 保证保存路径带正确扩展名。Tauri 的 save 对话框不会自动补扩展名：
 * 用户只输入 `foo` 时，Rust 会把 PDF 写成无扩展名的 `foo`，Windows 下极难辨认。
 * 仅当基础名完全没有扩展名时才补，尊重用户显式写出的扩展名。
 */
function withExtension(p: string, ext: string): string {
  const base = p.split(/[\\/]/).pop() ?? "";
  if (base.includes(".")) return p;
  return `${p}.${ext}`;
}

export type ExportFormat = "png" | "svg" | "pdf";

export interface ExportDiagramOptions {
  format: ExportFormat;
  /** image = 落项目 imageDir；file = 弹保存框 */
  mode: "image" | "file";
  /** 文件名（不含扩展名）；file 模式忽略，由保存框决定 */
  fileName?: string;
  /** file 模式：保存框默认文件名（含扩展名） */
  defaultPath?: string;
}

export interface ExportDiagramOutcome {
  status: "ok" | "error" | "cancel";
  result?: TikzExportResult;
  outPath?: string;
  message?: string;
}

/** 按当前导出设置换算固定画布尺寸（world pt）；未开启 / auto 时返回 null。 */
function resolveCanvas(): { widthPt: number; heightPt: number } | null {
  const { exportUseCanvas, canvasSize } = useDiagramStore.getState();
  if (!exportUseCanvas || canvasSize.preset === "auto") return null;
  return canvasSizeToPt(canvasSize);
}

/**
 * F5-1 主编排：落盘一份图片 / PDF 到磁盘。
 * 返回 outcome.status：
 *   · ok     —— 已落盘，outPath 可用；
 *   · error  —— 编译 / 转换 / 写入失败，message 已含原因；
 *   · cancel —— 用户在保存框 / 覆盖确认里取消。
 */
export async function exportDiagram(opts: ExportDiagramOptions): Promise<ExportDiagramOutcome> {
  const { source } = useDiagramStore.getState();
  if (!source.trim()) return { status: "error", message: "绘图源码为空，无法导出" };

  const canvas = resolveCanvas();
  const baseArgs = {
    source,
    engine: "xelatex", // 与精确预览一致；Rust 会按可用性回退 LuaLaTeX / pdfLaTeX
    canvas,
    format: opts.format,
  };

  // 1) 解析目标路径
  let outPath: string;
  if (opts.mode === "file") {
    let picked: string | null;
    try {
      picked = await saveDialog({
        defaultPath: opts.defaultPath ?? `diagram.${opts.format}`,
      });
    } catch (e) {
      return { status: "error", message: `打开保存对话框失败：${String(e)}` };
    }
    if (!picked) return { status: "cancel" };
    outPath = withExtension(picked, opts.format);
  } else {
    const root = useProjectStore.getState().root;
    if (!root) return { status: "error", message: "未打开项目，无法定位图片目录" };
    const imageDir =
      useProjectStore.getState().tree?.imageDir?.trim() || DEFAULT_IMAGE_DIR;
    const base = (opts.fileName || "diagram").replace(/[\\/:*?"<>|]/g, "_");
    outPath = `${root}/${imageDir}/${base}.${opts.format}`;
  }

  const callExport = (force: boolean) =>
    diagramApi.tikzExport({ ...baseArgs, outPath, force });

  // 2) 导出（覆盖前确认）。整段包 try/catch：任何异常（含 invoke 拒绝）都转成可见错误，
  //    不再静默失败（此前若 tikzExport 抛异常，Promise 直接 rejected，按钮复位却无任何提示）。
  try {
    let res = await callExport(false);
    if (res.status === "exists") {
      const ok = await confirm(`文件已存在：${outPath}\n是否覆盖？`, {
        title: "覆盖确认",
        kind: "warning",
      });
      if (!ok) return { status: "cancel" };
      res = await callExport(true);
    }
    if (res.status === "error") {
      notify(res.message ?? "导出失败", "err");
      return { status: "error", result: res, message: res.message };
    }
    return { status: "ok", result: res, outPath: res.outPath ?? outPath };
  } catch (e) {
    const msg = `导出调用失败：${String(e)}`;
    notify(msg, "err");
    return { status: "error", message: msg };
  }
}
