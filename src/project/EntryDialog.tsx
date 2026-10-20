// M0-6 · 自绘输入对话框（WebView 无 window.prompt）
// 新建 .tex / 新建文件夹 / 重命名 —— 对齐 .modal.sm 验收抽屉同款结构
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useProjectStore } from "./useProject";

export function EntryDialog() {
  const d = useProjectStore((s) => s.entryDialog);
  const close = useProjectStore((s) => s.closeEntryDialog);
  const createEntry = useProjectStore((s) => s.createEntry);
  const renameEntry = useProjectStore((s) => s.renameEntry);

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (d) {
      setValue(d.initial);
      // 聚焦并选中主体名（便于直接打字覆盖）
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [d]);

  // Esc 关闭（在输入框上按键时由 onKeyDown 处理，这里兜底）
  useEffect(() => {
    if (!d) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, close]);

  if (!d) return null;

  const isCreate = d.mode === "create";
  const title = isCreate ? (d.kind === "tex" ? "新建文档" : "新建文件夹") : "重命名";
  const label = isCreate
    ? d.kind === "tex"
      ? "文件名（可省略 .tex 后缀）"
      : "文件夹名"
    : "新名称";
  const placeholder = isCreate ? (d.kind === "tex" ? "untitled" : "新建文件夹") : "";

  function submit() {
    if (!d) return;
    if (d.mode === "create") void createEntry(d.dir, d.kind, value);
    else void renameEntry(d.from, value);
  }

  return (
    <div className="modal-layer" onMouseDown={close}>
      <div
        className="modal sm"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body entry-body">
          <label className="entry-label" htmlFor="entry-name">
            {label}
          </label>
          <input
            id="entry-name"
            ref={inputRef}
            className="entry-input"
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          <p className="entry-hint">Enter 确认 · Esc 取消 · 重名/非法字符将被拒绝</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export default EntryDialog;
