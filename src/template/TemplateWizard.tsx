// M1-9 · 「从模板新建」向导（开发文档 §5.6 · 多文件模板 + 动态变量表单）
// 选模板 → 按 manifest.variables 动态渲染表单（string/text/number/select/bool/date/multiselect，
// 支持分组 group、必填 required、placeholder/help）→ 选位置 → create_project 生成项目并打开。
import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { templateApi } from "@/ipc/invoke";
import { Icon } from "@/ui/Icon";
import { useBuffersStore } from "@/editor/useBuffers";
import { base, notify, useProjectStore } from "@/project/useProject";
import type { TemplateManifest, TemplateMeta, TemplateVar } from "@/types";

/** 变量默认值（按类型 + manifest default 初始化） */
function defaultValue(v: TemplateVar): unknown {
  if (v.default != null) return v.default;
  switch (v.type) {
    case "bool":
      return false;
    case "multiselect":
      return [];
    case "select":
      return v.options?.[0] ?? "";
    default:
      return "";
  }
}

/** 分组后的变量（保持首次出现顺序） */
function groupVars(vars: TemplateVar[]): { group: string; items: TemplateVar[] }[] {
  const order: string[] = [];
  const map = new Map<string, TemplateVar[]>();
  for (const v of vars) {
    const g = v.group ?? "基本信息";
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(v);
  }
  return order.map((g) => ({ group: g, items: map.get(g)! }));
}

/** 必填校验：返回缺失的 label 列表 */
function missingRequired(vars: TemplateVar[], values: Record<string, unknown>): string[] {
  const miss: string[] = [];
  for (const v of vars) {
    if (!v.required) continue;
    const val = values[v.key];
    if (v.type === "multiselect") {
      if (!Array.isArray(val) || val.length === 0) miss.push(v.label);
    } else if (v.type === "bool") {
      /* 布尔必有默认值，无需校验 */
    } else if (val == null || String(val).trim() === "") {
      miss.push(v.label);
    }
  }
  return miss;
}

export function TemplateWizard() {
  const open = useProjectStore((s) => s.wizardOpen);
  const closeWizard = useProjectStore((s) => s.closeWizard);
  const wizardDir = useProjectStore((s) => s.wizardDir);
  const wizardTemplateId = useProjectStore((s) => s.wizardTemplateId);

  const [metas, setMetas] = useState<TemplateMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
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
        setSelected((s) => {
          // M1-15e：模板库「用此模板新建」优先生效
          if (wizardTemplateId && ms.some((m) => m.id === wizardTemplateId)) {
            return wizardTemplateId;
          }
          return s && ms.some((m) => m.id === s) ? s : (ms[0]?.id ?? "");
        });
      })
      .catch((e) => setErr(String(e)));
    setTarget((t) => t || wizardDir || "");
  }, [open, wizardDir, wizardTemplateId]);

  // 选中模板 → 拉清单并按默认值初始化表单
  useEffect(() => {
    if (!open || !selected) return;
    templateApi
      .getTemplate(selected)
      .then((m) => {
        setManifest(m);
        const init: Record<string, unknown> = {};
        for (const v of m.variables ?? []) {
          init[v.key] = defaultValue(v);
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

  const groups = useMemo(
    () => groupVars(manifest?.variables ?? []),
    [manifest],
  );

  const setVal = (key: string, val: unknown) =>
    setValues((s) => ({ ...s, [key]: val }));

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
    const miss = missingRequired(manifest.variables ?? [], values);
    if (miss.length > 0) {
      setErr(`请填写必填项：${miss.join("、")}`);
      return;
    }
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
          <span className="sub">M1-9 · 内置 {metas.length} 套</span>
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

          {/* 动态变量表单（全类型 + 分组） */}
          {groups.map((g) => (
            <fieldset className="fw-group" key={g.group}>
              <legend>{g.group}</legend>
              {g.items.map((v) => (
                <div className="fw-field" key={v.key}>
                  <label className="entry-label" htmlFor={`tpl-var-${v.key}`}>
                    {v.label}
                    {v.required ? " *" : ""}
                  </label>
                  {v.type === "text" ? (
                    <textarea
                      id={`tpl-var-${v.key}`}
                      className="entry-input fw-textarea"
                      value={String(values[v.key] ?? "")}
                      placeholder={v.placeholder}
                      onChange={(e) => setVal(v.key, e.target.value)}
                    />
                  ) : v.type === "select" ? (
                    <select
                      id={`tpl-var-${v.key}`}
                      className="entry-input"
                      value={String(values[v.key] ?? "")}
                      onChange={(e) => setVal(v.key, e.target.value)}
                    >
                      {(v.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : v.type === "bool" ? (
                    <label className="fw-check">
                      <input
                        type="checkbox"
                        checked={Boolean(values[v.key])}
                        onChange={(e) => setVal(v.key, e.target.checked)}
                      />
                      <span>{v.placeholder ?? "启用"}</span>
                    </label>
                  ) : v.type === "multiselect" ? (
                    <div className="fw-checks">
                      {(v.options ?? []).map((opt) => {
                        const arr = Array.isArray(values[v.key])
                          ? (values[v.key] as string[])
                          : [];
                        const checked = arr.includes(opt);
                        return (
                          <label className="fw-check" key={opt}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setVal(
                                  v.key,
                                  e.target.checked
                                    ? [...arr, opt]
                                    : arr.filter((x) => x !== opt),
                                )
                              }
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : v.type === "date" ? (
                    <input
                      id={`tpl-var-${v.key}`}
                      type="date"
                      className="entry-input"
                      value={String(values[v.key] ?? "")}
                      onChange={(e) => setVal(v.key, e.target.value)}
                    />
                  ) : (
                    <input
                      id={`tpl-var-${v.key}`}
                      type={v.type === "number" ? "number" : "text"}
                      className="entry-input"
                      value={String(values[v.key] ?? "")}
                      placeholder={v.placeholder}
                      spellCheck={false}
                      onChange={(e) =>
                        setVal(
                          v.key,
                          v.type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                  {v.help && <p className="entry-hint">{v.help}</p>}
                </div>
              ))}
            </fieldset>
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
              将生成主文件与配套结构，并自动打开项目、把主文件开到编辑器
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
