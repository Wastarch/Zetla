// 表格反向编辑共用逻辑（M1-19）：面板按钮（handleEditCurrent/handleUpdate）与
// hover ✎ 标记（EnvEditor.load）两条入口汇入同一管线，store 操作只在此处一份。
import { getActiveView } from "@/editor/activeView";
import { notify } from "@/project/useProject";
import { generateTable } from "./tableGen";
import { parseTableAt, parseTableRange, fingerprintOf, type ParsedTable } from "./tableParse";
import type { TableModel } from "./tableModel";
import { useTableStore } from "./tableStore";

/** 解析结果 → 回填网格 + 绑定源码区间（两条入口共用） */
function applyParsed(parsed: ParsedTable): void {
  const st = useTableStore.getState();
  st.reset(parsed.model);
  st.setSource({ from: parsed.from, to: parsed.to, fingerprint: parsed.fingerprint });
  notify(`已载入表格（${parsed.model.rows}×${parsed.model.cols}）`, "ok");
}

/** 「编辑当前表格」：从光标处 tabular 回填网格（面板按钮入口） */
export function loadTableAtCursor(): boolean {
  const view = getActiveView();
  if (!view) {
    notify("请先在 .tex 标签页中使用", "err");
    return false;
  }
  const parsed = parseTableAt(view.state.doc.toString(), view.state.selection.main.head);
  if (!parsed) {
    notify("光标处未找到可编辑的表格", "err");
    return false;
  }
  applyParsed(parsed);
  return true;
}

/** hover ✎ 场景：已知精确区间，直接解析并载入（EnvEditor.load 入口） */
export function loadTableRange(from: number, to: number): boolean {
  const view = getActiveView();
  if (!view) return false;
  const parsed = parseTableRange(view.state.doc.toString(), from, to);
  if (!parsed) return false;
  applyParsed(parsed);
  return true;
}

/**
 * 「更新表格」：指纹校验通过才原地替换，避免覆盖用户手改的源码。
 * @param finalModel 面板 finalizeModel() 的产物（标签推导留在组件，结果作参数传入）
 */
export function updateTableInPlace(finalModel: TableModel): boolean {
  const { source } = useTableStore.getState();
  if (!source) return false;
  const view = getActiveView();
  if (!view) {
    notify("没有可更新的编辑器", "err");
    return false;
  }
  const doc = view.state.doc.toString();
  const current = doc.slice(source.from, source.to);
  if (fingerprintOf(current) !== source.fingerprint) {
    notify("表格源码已被修改，已取消更新（可改用「插入到编辑器」）", "err");
    return false;
  }
  const body = generateTable(finalModel);
  view.dispatch({ changes: { from: source.from, to: source.to, insert: body } });
  useTableStore.getState().setSource({
    from: source.from,
    to: source.from + body.length,
    fingerprint: fingerprintOf(body),
  });
  notify("已更新表格", "ok");
  return true;
}
