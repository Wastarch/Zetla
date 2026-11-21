// M1-16 · 「根据本项目制作模板」向导（三步）
// ① 基本信息 + 文件勾选（分析结果预填）→ ② 变量确认/补充（自动候选 + 自定义）
// → ③ 导出 zip（统一交换格式）+ 可选安装到我的模板。
// 变量回填口径（与 Rust 端 BOUND_CMDS 对齐）：key 为 title/author/date 的变量，
// 生成时把 \title{...} 等命令的花括号内容回填为 <%= key %>；自定义变量需在导出后
// 手动在模板文件里插入 <%= 变量名 %> 占位符。
import { useCallback, useEffect, useState } from "react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { templateApi } from "@/ipc/invoke";
import { Icon } from "@/ui/Icon";
import { base, notify, useProjectStore } from "@/project/useProject";
import type { TemplateAnalysis, TemplateVar } from "@/types";

/** 与 Rust BOUND_CMDS 一致：这些 key 的变量会自动回填到同名命令 */
const BOUND_KEYS = ["title", "author", "date"] as const;

/** 向导内变量行（带启用开关） */
type CraftVar = TemplateVar & { enabled: boolean };

const STEP_TITLES = ["基本信息与文件", "变量", "导出"] as const;

function CraftDialog() {
  const open = useProjectStore((s) => s.craftOpen);
  const close = useProjectStore((s) => s.closeCraft);
  const root = useProjectStore((s) => s.root);

  const [analysis, setAnalysis] = useState<TemplateAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  // ① 基本信息
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [files, setFiles] = useState<Set<string>>(new Set());

  // ② 变量
  const [vars, setVars] = useState<CraftVar[]>([]);

  // ③ 导出
  const [exportPath, setExportPath] = useState("");
  const [install, setInstall] = useState(true);

  const reset = useCallback(() => {
    setAnalysis(null);
    setErr(null);
    setStep(1);
    setName("");
    setDescription("");
    setCategory("");
    setFiles(new Set());
    setVars([]);
    setExportPath("");
    setInstall(true);
  }, []);

  // 打开时分析项目（只读，可反复进入预览）
  useEffect(() => {
    if (!open || !root) return;
    reset();
    setLoading(true);
    templateApi
      .analyzeProject(root)
      .then((a) => {
        setAnalysis(a);
        setName(root.split(/[\\/]/).pop() ?? "");
        setFiles(new Set(a.files.map((f) => f.path)));
        setVars(
          a.candidates.map((c) => ({
            key: c.key,
            label: c.label,
            type: c.key === "date" ? ("date" as const) : ("string" as const),
            required: false,
            default: c.value,
            options: [],
            group: "基本信息",
            help: c.count > 1 ? `全项目出现 ${c.count} 次，将全部回填` : undefined,
            enabled: true,
          })),
        );
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [open, root, reset]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const toggleFile = (p: string) => {
    setFiles((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const setVar = (i: number, patch: Partial<CraftVar>) =>
    setVars((s) => s.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const addCustomVar = () =>
    setVars((s) => [
      ...s,
      {
        key: "",
        label: "",
        type: "string",
        required: false,
        default: "",
        options: [],
        group: "自定义",
        enabled: true,
      },
    ]);

  /** 变量列表是否可用于下一步（key 规则前端先挡一道，后端仍会校验） */
  const varsValid = vars.every(
    (v) =>
      !v.enabled ||
      (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.key.trim()) &&
        !["if", "else", "endif"].includes(v.key.trim()) &&
        v.label.trim() !== ""),
  );

  const pickExportPath = async () => {
    try {
      const picked = await saveFileDialog({
        title: "导出模板压缩包",
        defaultPath: `${(name.trim() || "template").replace(/[\\/:*?"<>|]/g, "-")}.zip`,
        filters: [{ name: "模板压缩包", extensions: ["zip"] }],
      });
      if (typeof picked === "string") setExportPath(picked);
    } catch (e) {
      notify(String(e), "err");
    }
  };

  const submit = async () => {
    if (!root || !analysis) return;
    const n = name.trim();
    if (!n) {
      setErr("模板名不能为空");
      return;
    }
    if (files.size === 0) {
      setErr("请至少勾选一个文件");
      return;
    }
    if (!varsValid) {
      setErr("存在未填写的变量名或显示名（变量名仅限字母/数字/下划线）");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const meta = await templateApi.makeTemplate({
        root,
        name: n,
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        variables: vars
          .filter((v) => v.enabled)
          .map(({ enabled: _enabled, ...v }) => ({ ...v, key: v.key.trim() })),
        files: [...files],
        exportPath: exportPath.trim() || undefined,
        install,
      });
      close();
      notify(
        install
          ? `已制作模板「${meta.name}」并安装到我的模板${exportPath.trim() ? `，压缩包已导出到 ${base(exportPath.trim())}` : ""}`
          : `已导出模板压缩包「${meta.name}」`,
        "ok",
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const canNext =
    step === 1 ? Boolean(name.trim()) && files.size > 0 : step === 2 ? varsValid : true;

  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal wizard"
        role="dialog"
        aria-label="根据本项目制作模板"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <Icon name="book" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>根据本项目制作模板</h2>
            <div className="sub">{root ? base(root) : ""}</div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          <div className="craft-steps">
            {STEP_TITLES.map((t, i) => (
              <span key={t} className={step === i + 1 ? "step on" : "step"}>
                {i + 1}. {t}
              </span>
            ))}
          </div>

          {err && <p className="error">{err}</p>}
          {loading && <p className="set-note">正在分析项目…</p>}

          {!loading && analysis && step === 1 && (
            <div className="wiz-form">
              <div className="fw-field">
                <label className="entry-label" htmlFor="craft-name">
                  模板名 *
                </label>
                <input
                  id="craft-name"
                  className="entry-input"
                  value={name}
                  placeholder="例如：我的论文模板"
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="fw-field">
                <label className="entry-label" htmlFor="craft-desc">
                  描述
                </label>
                <input
                  id="craft-desc"
                  className="entry-input"
                  value={description}
                  placeholder="模板用途说明（可空）"
                  spellCheck={false}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="fw-field">
                <label className="entry-label" htmlFor="craft-cat">
                  分类
                </label>
                <input
                  id="craft-cat"
                  className="entry-input"
                  value={category}
                  placeholder="article / thesis / slides…（可空）"
                  spellCheck={false}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </div>
              <div className="fw-field">
                <label className="entry-label">
                  编译配置（取自项目 .ltex/config.json）
                </label>
                <p className="entry-hint">
                  引擎 {analysis.engine} · 主文件 {base(analysis.mainFile)} · 产物目录{" "}
                  {analysis.outputDir}
                </p>
              </div>
              <div className="fw-field wiz-col-full">
                <label className="entry-label">
                  参与文件（{files.size}/{analysis.files.length}，编译产物已自动排除）
                </label>
                <div className="craft-files">
                  {analysis.files.map((f) => (
                    <label key={f.path}>
                      <input
                        type="checkbox"
                        checked={files.has(f.path)}
                        onChange={() => toggleFile(f.path)}
                      />
                      <span>{f.path}</span>
                      {f.tex && <span className="tex-badge">tex</span>}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!loading && analysis && step === 2 && (
            <div>
              <div className="craft-var-head">
                <span />
                <span>变量名</span>
                <span>显示名</span>
                <span>默认值</span>
                <span />
              </div>
              {vars.map((v, i) => (
                <div className="craft-var-row" key={`${v.key}-${i}`}>
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    title={v.enabled ? "包含此变量" : "已排除"}
                    onChange={(e) => setVar(i, { enabled: e.target.checked })}
                  />
                  {BOUND_KEYS.includes(v.key as (typeof BOUND_KEYS)[number]) ? (
                    <span className="craft-var-key">
                      {v.key}
                      <span className="bound">自动回填</span>
                    </span>
                  ) : (
                    <input
                      className="entry-input"
                      value={v.key}
                      placeholder="变量名"
                      spellCheck={false}
                      onChange={(e) => setVar(i, { key: e.target.value })}
                    />
                  )}
                  <input
                    className="entry-input"
                    value={v.label}
                    placeholder="显示名"
                    onChange={(e) => setVar(i, { label: e.target.value })}
                  />
                  <input
                    className="entry-input"
                    value={String(v.default ?? "")}
                    placeholder="默认值"
                    onChange={(e) => setVar(i, { default: e.target.value })}
                  />
                  <button
                    type="button"
                    className="ibtn x"
                    title="移除此变量"
                    onClick={() => setVars((s) => s.filter((_, j) => j !== i))}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn" onClick={addCustomVar}>
                添加自定义变量
              </button>
              <p className="craft-hint">
                title / author / date
                变量在生成时会自动回填：对应命令（如 \title{"{"}…{"}"}）的花括号内容替换为
                占位符。自定义变量需在导出后手动在模板文件里插入 {"<%= 变量名 %>"}。
              </p>
            </div>
          )}

          {!loading && analysis && step === 3 && (
            <div className="wiz-form">
              <div className="fw-field wiz-col-full">
                <label className="entry-label" htmlFor="craft-export">
                  导出压缩包（.zip，统一交换格式）
                </label>
                <div className="fw-row">
                  <input
                    id="craft-export"
                    className="entry-input"
                    value={exportPath}
                    placeholder="选择保存位置…"
                    spellCheck={false}
                    onChange={(e) => setExportPath(e.target.value)}
                  />
                  <button type="button" className="btn" onClick={() => void pickExportPath()}>
                    选择…
                  </button>
                </div>
              </div>
              <div className="fw-field wiz-col-full">
                <label className="fw-check">
                  <input
                    type="checkbox"
                    checked={install}
                    onChange={(e) => setInstall(e.target.checked)}
                  />
                  <span>同时安装到「我的模板」（立即可用于「用此模板新建」）</span>
                </label>
              </div>
              <div className="fw-field wiz-col-full">
                <p className="craft-summary">
                  模板名：{name.trim() || "—"}
                  <br />
                  文件：{files.size} 个 · 变量：{vars.filter((v) => v.enabled).length} 个
                  <br />
                  引擎 {analysis.engine} · 主文件 {base(analysis.mainFile)}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {step > 1 && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setStep((s) => s - 1)}
            >
              上一步
            </button>
          )}
          <button type="button" className="btn" onClick={close} disabled={busy}>
            取消
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="btn primary"
              disabled={!canNext}
              onClick={() => setStep((s) => s + 1)}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={busy || (!exportPath.trim() && !install)}
              title={!exportPath.trim() && !install ? "请选择导出位置或勾选安装" : undefined}
              onClick={() => void submit()}
            >
              {busy ? "生成中…" : "制作模板"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { CraftDialog as TemplateCraftDialog };
export default CraftDialog;
