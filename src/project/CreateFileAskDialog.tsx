// M1-43 · 引入文件跳转未找到 → 应用内「创建文件」确认对话框
// 用户指令 2026-11-22：不用系统原生 confirm，保持软件风格统一（与 EntryDialog /
// ProjectActionDialog 同款 modal 结构）。确认后走 createEntry（自动补缺失父目录、
// 建完开标签、树中选中）；取消零副作用。
import { useEffect } from "react";
import { Icon } from "@/ui/Icon";
import { useProjectStore } from "./useProject";

export function CreateFileAskDialog() {
  const ask = useProjectStore((s) => s.createFileAsk);
  const close = useProjectStore((s) => s.closeCreateFileAsk);
  const createEntry = useProjectStore((s) => s.createEntry);

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

  const submit = () => {
    close();
    void createEntry(ask.dir, "file", ask.name, ask.ext);
  };

  return (
    <div className="modal-layer" onMouseDown={close}>
      <div
        className="modal sm"
        role="dialog"
        aria-label="创建文件"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>创建文件</h2>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body entry-body">
          <p className="entry-hint" style={{ marginTop: 4 }}>
            Ctrl+点击的目标不存在。要新建文件「<b>{ask.name}</b>」吗？
          </p>
          <p className="entry-hint">位置：{ask.displayPath}</p>
          {ask.withParentHint && (
            <p className="entry-hint">缺失的父目录会一并创建。</p>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateFileAskDialog;
