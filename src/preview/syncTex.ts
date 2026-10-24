// M1-4 · SyncTeX 双向跳转前端桥
// 正向（源码 → PDF）：编辑器 Ctrl+点击 / 视图菜单 → synctex_view → store.pdfSync
//   （PdfPreview 订阅后滚动定位 + 高亮闪现）
// 反向（PDF → 源码）：PDF 中 Ctrl+点击 → synctex_edit → 复用 M0-12 的 jumpToError 跳行
// 坐标约定：pt，y 自页顶向下（与 Rust 解析器、pdf.js 视口一致）。
import { synctexApi } from "@/ipc/invoke";
import { useAppStore } from "@/core/store";
import { notify, useProjectStore } from "@/project/useProject";
import { jumpToError } from "@/editor/jump";

/** 简单路径拼接（前端仅用于推导默认 PDF 路径；Tauri 侧走 PathBuf） */
function joinPath(dir: string, rel: string): string {
  const d = dir.replace(/[\\/]+$/, "");
  return `${d}\\${rel.replace(/^[\\/]+/, "")}`;
}

/** 主文件 → 预期 PDF 路径（扩展名替换；输出目录与主文件同目录，见开发文档 §3.3） */
function expectedPdf(root: string, mainFile: string): string {
  const rel = mainFile.replace(/\.[^.\\/]+$/, ".pdf");
  return joinPath(root, rel);
}

/** 当前用于 synctex 查询的 PDF 路径：预览中的优先，否则按项目主文件推导 */
function pdfForSync(): string | null {
  const st = useAppStore.getState();
  if (st.previewPdf) return st.previewPdf;
  const { root, tree } = useProjectStore.getState();
  if (root && tree?.mainFile) return expectedPdf(root, tree.mainFile);
  return null;
}

/**
 * 正向跳转：源码 (file, line, col) → PDF 位置。
 * 命中后才展开预览（避免为一次失败的跳转加载陈旧/缺失的 PDF）。
 */
export async function jumpToPdfFromSource(
  file: string,
  line: number,
  col: number,
): Promise<void> {
  const pdf = pdfForSync();
  if (!pdf) {
    notify("请先打开项目并编译，生成 PDF 与 SyncTeX 数据", "err");
    return;
  }
  try {
    const hit = await synctexApi.view(file, line, col, pdf);
    if (!hit) {
      notify("该位置没有同步数据（空白行或编译后已偏移）", "err");
      return;
    }
    // 预览不可见时展开；已有 previewPdf 则不动加载状态
    const st = useAppStore.getState();
    if (!st.previewVisible) {
      useAppStore.setState({ previewVisible: true });
    }
    st.setPdfSync({ page: hit.page, x: hit.x, y: hit.y, w: hit.width, h: hit.height });
  } catch (e) {
    notify(String(e), "err");
  }
}

/**
 * 反向跳转：PDF (page, x, y) → 源码行。
 * 复用 M0-12 错误定位的打开/切标签/跳行链路（jumpToError）。
 */
export async function jumpToSourceFromPdf(
  page: number,
  x: number,
  y: number,
): Promise<void> {
  const pdf = pdfForSync();
  if (!pdf) {
    notify("请先打开项目并编译，生成 PDF 与 SyncTeX 数据", "err");
    return;
  }
  try {
    const hit = await synctexApi.edit(
      pdf,
      page,
      x,
      y,
      useProjectStore.getState().root ?? null,
    );
    if (!hit) {
      notify("该位置没有对应的源码", "err");
      return;
    }
    jumpToError(hit.file, hit.line, hit.column > 0 ? hit.column : undefined);
    notify(`已跳转 ${hit.file.split(/[\\/]/).pop()} : ${hit.line}`, "ok");
  } catch (e) {
    notify(String(e), "err");
  }
}
