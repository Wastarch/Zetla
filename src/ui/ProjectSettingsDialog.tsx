// R5 · 项目设置对话框（M1-7）—— 目前承载「图片目录」设置
// 写入 .ltex/config.json 的 imageDir（相对项目根，缺省 figure），保存后刷新项目树使运行时生效。
import { useEffect, useState } from "react";
import { useProjectStore, notify } from "@/project/useProject";
import { projectApi } from "@/ipc/invoke";

export function ProjectSettingsDialog() {
  const open = useProjectStore((s) => s.projectSettingsOpen);
  const close = useProjectStore((s) => s.closeProjectSettings);
  const root = useProjectStore((s) => s.root);
  const current = useProjectStore((s) => s.tree?.imageDir);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 打开时同步当前值（无配置则默认 figure）
  useEffect(() => {
    if (open) {
      setValue(current?.trim() || "figure");
      setErr(null);
    }
  }, [open, current]);

  if (!open) return null;

  async function save() {
    if (!root) return;
    const v = value.trim();
    if (v.startsWith("/") || v.startsWith("\\") || v.includes("..")) {
      setErr("图片目录必须为相对项目根的路径（不允许绝对路径或 .. 穿越）");
      return;
    }
    setBusy(true);
    try {
      await projectApi.saveProjectConfig(root, v);
      await useProjectStore.getState().refresh();
      notify("已保存项目设置", "ok");
      close();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal sm" role="dialog" aria-label="项目设置">
        <div className="modal-head">
          <h2>项目设置</h2>
          <button className="x" onClick={close} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          <label className="proj-set-field">
            <span>图片目录</span>
            <input
              className="entry-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="figure"
              spellCheck={false}
              autoFocus
            />
          </label>
          <p className="proj-set-hint">
            相对于项目根目录，例如 <code>figure</code>、<code>figures</code>、
            <code>assets/img</code>。留空则使用默认 <code>figure</code>。
            拖拽 / 粘贴 / 插入的图片会写入此目录，生成的 <code>figure</code> 环境按相对路径引用。
          </p>
          {err && <p className="proj-set-err">{err}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProjectSettingsDialog;
