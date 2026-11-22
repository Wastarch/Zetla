// M1-46 · 删除确认 → 应用内「删除」对话框（对齐 CreateFileAskDialog 的 modal sm 结构）
// 用户指令 2026-11-22：删除确认不用系统原生 confirm，保持软件风格统一。
// removeEntries 只负责 openDeleteAsk(paths)；本组件确认后调 confirmRemoveEntries
// （M1-40 逻辑：逐项删除、关闭受影响缓冲、刷新树）。取消零副作用。
import { useEffect } from "react";
import { Icon } from "@/ui/Icon";
import { relativePathOf } from "@/editor/tabCtx";
import { useProjectStore } from "./useProject";

/** 展示名：项目根之下取相对路径，根外回退末段名 */
function displayName(path: string, root: string | null): string {
  const rel = relativePathOf(path, root);
  return rel === path ? path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path : rel;
}

export function DeleteAskDialog() {
  const ask = useProjectStore((s) => s.deleteAsk);
  const close = useProjectStore((s) => s.closeDeleteAsk);
  const confirmRemove = useProjectStore((s) => s.confirmRemoveEntries);
  const root = useProjectStore((s) => s.root);

  // Esc 关闭 = 取消
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, close]);

  if (!ask) return null;

  const names = ask.paths.map((p) => displayName(p, root));
  const submit = () => {
    void confirmRemove(ask.paths);
  };

  return (
    <div className="modal-layer" onMouseDown={close}>
      <div
        className="modal sm"
        role="dialog"
        aria-label="删除"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>删除</h2>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body entry-body">
          <p className="entry-hint" style={{ marginTop: 4 }}>
            {names.length === 1 ? (
              <>
                确定删除「<b>{names[0]}</b>」吗？
              </>
            ) : (
              <>确定删除以下 {names.length} 项吗？</>
            )}
          </p>
          {names.length > 1 && (
            <ul className="entry-hint" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {names.slice(0, 8).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {names.length > 8 && <li>… 等共 {names.length} 项</li>}
            </ul>
          )}
          <p className="entry-hint">此操作不可撤销（不进回收站）。</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button type="button" className="btn danger" onClick={submit}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteAskDialog;
