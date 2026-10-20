// M0-7 · 「从模板新建」向导（开发文档 §5.6 流程 · MVP 极简版）
// 选模板 → 填变量（manifest.variables 中 string/text 类型，MVP 仅标题/作者）→ 选位置
// → create_project 生成 main.tex + .ltex/config.json → 自动打开项目并把主文件开到标签
import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { templateApi } from "@/ipc/invoke";
import { Icon } from "@/ui/Icon";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, notify, useProjectStore } from "@/project/useProject";
import type { TemplateManifest, TemplateMeta, TemplateVar } from "@/types";

/** MVP 只渲染单行文本变量；select/bool/多行 → M1 复杂表单 */
function isFormField(v: TemplateVar): boolean {
  return v.type === "string" || v.type === "text";
}

export function TemplateWizard() {
  const open = useProjectStore((s) => s.wizardOpen);
  const closeWizard = useProjectStore((s) => s.closeWizard);
  const wizardDir = useProjectStore((s) => s.wizardDir);

  const [metas, setMetas] = useState<TemplateMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 打开时拉模板列表 + 默认位置
  useEffect(() => {
    if (!open) return;
    setErr(null);
    templateApi
      .listTemplates()
      .then((ms) => {
        setMetas(ms);
        setSelected((s) => (s && ms.some((m) => m.id === s) ? s : (ms[0]?.id ?? "")));
      })
      .catch((e) => setErr(String(e)));
    setTarget((t) => t || wizardDir || "");
  }, [open, wizardDir]);

  // 选中模板 → 拉清单并按默认值初始化表单
  useEffect(() => {
    if (!open || !selected) return;
    templateApi
      .getTemplate(selected)
      .then((m) => {
        setManifest(m);
        const init: Record<string, string> = {};
        for (const v of m.variables ?? []) {
          init[v.key] = v.default != null ? String(v.default) : "";
        }
        setValues(init);
      })
      .catch((e) => setErr(String(e)));
  }, [selected, open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWizard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeWizard]);

  const formVars = useMemo(
    () => (manifest?.variables ?? []).filter(isFormField),
    [manifest],
  );

  async function pickDir() {
    try {
      const picked = await openFileDialog({
        directory: true,
        multiple: false,
        title: "选择项目位置",
      });
      if (typeof picked === "string") setTarget(picked);
    } catch (e) {
      notify(String(e), "err");
    }
  }

  async function submit() {
    if (!manifest || !target.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const info = await templateApi.createProject(manifest.id, values, target.trim());
      closeWizard();
      await useProjectStore.getState().openProject(info.path);
      await useBuffersStore.getState().openFiles([info.mainFile]);
      notify(`已用「${manifest.name}」创建 ${info.name} · 主文件 ${base(info.mainFile)}`, "ok");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-layer" onMouseDown={closeWizard}>
      <div
        className="modal wizard"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="从模板新建"
      >
        <div className="modal-head">
          <h2>从模板新建</h2>
          <span className="sub">M0-7 · 内置 {metas.length} 套</span>
          <button
            type="button"
            className="ibtn x"
            title="关闭"
            onClick={closeWizard}
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          {err && <p className="error">{err}</p>}

          <label className="entry-label">模板</label>
          <div className="tpl-grid">
            {metas.length === 0 && !err && (
              <p className="entry-hint">正在加载模板…</p>
            )}
            {metas.map((m) => (
              <button
                key={m.id}
                type="button"
                className={m.id === selected ? "tpl-card on" : "tpl-card"}
                onClick={() => setSelected(m.id)}
              >
                <Icon name="book" size={18} />
                <span className="tn">{m.name}</span>
                <span className="td">{m.description}</span>
                <span className="tm">{m.category ?? m.id}</span>
              </button>
            ))}
          </div>

          {formVars.map((v) => (
            <div className="fw-field" key={v.key}>
              <label className="entry-label" htmlFor={`tpl-var-${v.key}`}>
                {v.label}
                {v.required ? " *" : ""}
              </label>
              <input
                id={`tpl-var-${v.key}`}
                className="entry-input"
                value={values[v.key] ?? ""}
                placeholder={v.placeholder}
                spellCheck={false}
                onChange={(e) =>
                  setValues((s) => ({ ...s, [v.key]: e.target.value }))
                }
              />
            </div>
          ))}

          <div className="fw-field">
            <label className="entry-label" htmlFor="tpl-target">
              位置（项目文件夹）
            </label>
            <div className="fw-row">
              <input
                id="tpl-target"
                className="entry-input"
                value={target}
                placeholder="选择或输入一个空文件夹路径…"
                spellCheck={false}
                onChange={(e) => setTarget(e.target.value)}
              />
              <button type="button" className="btn" onClick={() => void pickDir()}>
                选择…
              </button>
            </div>
            <p className="entry-hint">
              将生成 main.tex 与 .ltex/config.json，并自动打开该项目、把主文件开到编辑器
            </p>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={closeWizard}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !selected || !target.trim()}
            onClick={() => void submit()}
          >
            {busy ? "创建中…" : "创建并打开"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TemplateWizard;
