// M1-15d · 项目生命周期对话框（重命名输入 / 删除确认）
// 自建 modal（WebView 无 window.prompt；与 EntryDialog 同款结构）。
// 打开中的项目由后端 guard 拒绝，此处仅给出确认/输入。
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useProjectStore } from "./useProject";

export function ProjectActionDialog() {
  const action = useProjectStore((s) => s.projectAction);
  const close = useProjectStore((s) => s.closeProjectAction);
  const renameProject = useProjectStore((s) => s.renameProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (action?.kind === "rename") {
      setValue(action.name);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [action]);

  // Esc 关闭（输入框上按键时由 onKeyDown 处理，这里兜底）
  useEffect(() => {
    if (!action) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action, close]);

  if (!action) return null;

  const isRename = action.kind === "rename";
  const title = isRename ? "重命名项目" : "删除项目";

  const submit = () => {
    if (action.kind === "rename") void renameProject(action.path, value);
    else void deleteProject(action.path);
  };

  return (
    <div className="modal-layer" onMouseDown={close}>
      <div
        className="modal sm"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body entry-body">
          {isRename ? (
            <>
              <label className="entry-label" htmlFor="project-name">
                新项目名（将重命名项目文件夹）
              </label>
              <input
                id="project-name"
                ref={inputRef}
                className="entry-input"
                value={value}
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
              <p className="entry-hint">
                将重命名项目文件夹并更新最近项目。打开中的项目不可重命名。
              </p>
            </>
          ) : (
            <>
              <p className="entry-hint" style={{ marginTop: 4 }}>
                确定删除项目「<b>{action.name}</b>」？
              </p>
              <p className="entry-hint" style={{ color: "var(--err)" }}>
                此操作会删除整个项目文件夹，且不可撤销（不进回收站）。打开中的项目不可删除。
              </p>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className={isRename ? "btn primary" : "btn danger"}
            onClick={submit}
            disabled={isRename && !value.trim()}
          >
            {isRename ? "重命名" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectActionDialog;
