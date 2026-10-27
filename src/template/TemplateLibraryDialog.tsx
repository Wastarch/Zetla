// M1-15e · 模板库管理对话框
// 浏览内置 + 用户模板（%APPDATA%/Zetla/templates）；预览 manifest 元数据；
// 「另存当前项目为模板」「导入模板（目录 / zip）」「用此模板新建」。
import { useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { templateApi } from "@/ipc/invoke";
import { Icon } from "@/ui/Icon";
import { notify, useProjectStore } from "@/project/useProject";
import type { TemplateManifest, TemplateMeta } from "@/types";

export function TemplateLibraryDialog() {
  const open = useProjectStore((s) => s.libraryOpen);
  const librarySaveMode = useProjectStore((s) => s.librarySaveMode);
  const close = useProjectStore((s) => s.closeLibrary);
  const root = useProjectStore((s) => s.root);
  const openWizard = useProjectStore((s) => s.openWizard);

  const [metas, setMetas] = useState<TemplateMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 「另存当前项目为模板」内联表单
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState("");

  const refresh = async (selectId?: string) => {
    const ms = await templateApi.listTemplates();
    setMetas(ms);
    setSelected((cur) => {
      const want = selectId ?? cur;
      if (want && ms.some((m) => m.id === want)) return want;
      return ms[0]?.id ?? "";
    });
  };

  // 打开时拉列表；若从菜单「另存当前项目为模板…」进入，则直接展开另存表单
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setSaveMode(librarySaveMode);
    setSaveName(
      librarySaveMode && root ? (root.split(/[\\/]/).pop() ?? "") : "",
    );
    setLoading(true);
    void refresh()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
    // refresh 为内联函数，不纳入依赖（仅在 open / saveMode / root 变化时刷新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, librarySaveMode, root]);

  // 选中模板 → 拉清单详情
  useEffect(() => {
    if (!open || !selected) {
      setManifest(null);
      return;
    }
    let alive = true;
    void templateApi
      .getTemplate(selected)
      .then((m) => {
        if (alive) setManifest(m);
      })
      .catch((e) => {
        if (alive) setErr(String(e));
      });
    return () => {
      alive = false;
    };
  }, [open, selected]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const { builtin, user } = useMemo(
    () => ({
      builtin: metas.filter((m) => !m.isUser),
      user: metas.filter((m) => m.isUser),
    }),
    [metas],
  );

  if (!open) return null;

  const doImport = async (dirMode: boolean) => {
    try {
      const picked = await openFileDialog(
        dirMode
          ? { directory: true, multiple: false, title: "选择模板文件夹" }
          : {
              multiple: false,
              title: "选择模板压缩包",
              filters: [{ name: "模板压缩包", extensions: ["zip"] }],
            },
      );
      if (typeof picked !== "string") return;
      setBusy(true);
      setErr(null);
      const meta = await templateApi.importTemplate(picked);
      await refresh(meta.id);
      notify(`已导入模板「${meta.name}」`, "ok");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (!root) return;
    const name = saveName.trim();
    if (!name) {
      setErr("模板名不能为空");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const meta = await templateApi.saveAsTemplate(root, name);
      setSaveMode(false);
      setSaveName("");
      await refresh(meta.id);
      notify(`已另存为模板「${meta.name}」`, "ok");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const card = (m: TemplateMeta) => (
    <button
      key={m.id}
      type="button"
      className={m.id === selected ? "tpl-card on" : "tpl-card"}
      onClick={() => setSelected(m.id)}
      title={m.id}
    >
      <Icon name={m.isUser ? "folder" : "book"} size={18} />
      <span className="tn">
        {m.name}
        {m.isUser && <span className="tpl-user">用户</span>}
      </span>
      <span className="td">{m.description ?? "—"}</span>
      <span className="tm">{m.category ?? (m.isUser ? "用户模板" : m.id)}</span>
    </button>
  );

  const selectedMeta = metas.find((m) => m.id === selected);

  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal tpl-lib" role="dialog" aria-label="模板库">
        <div className="modal-head">
          <Icon name="book" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>模板库</h2>
            <div className="sub">
              内置 {builtin.length} · 用户 {user.length}
            </div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          {err && <p className="error">{err}</p>}
          {loading ? (
            <p className="set-note">加载中…</p>
          ) : (
            <>
              {builtin.length > 0 && (
                <>
                  <div className="tpl-sec">内置模板</div>
                  <div className="tpl-grid">{builtin.map(card)}</div>
                </>
              )}

              <div className="tpl-sec">
                用户模板
                {user.length === 0 && (
                  <span className="tpl-sec-hint">
                    暂无 —— 可用「另存当前项目为模板」或导入
                  </span>
                )}
              </div>
              {user.length > 0 && <div className="tpl-grid">{user.map(card)}</div>}

              <div className="tpl-detail">
                {manifest && selectedMeta ? (
                  <>
                    <div className="tpl-detail-head">
                      <b>{manifest.name}</b>
                      {selectedMeta.isUser && <span className="tpl-user">用户</span>}
                      <span className="tpl-detail-id">{manifest.id}</span>
                    </div>
                    <p className="tpl-detail-desc">
                      {manifest.description ?? "无描述"}
                    </p>
                    <div className="tpl-detail-meta">
                      <span>
                        引擎 <code>{manifest.build.engine}</code>
                      </span>
                      <span>
                        主文件 <code>{manifest.build.mainFile}</code>
                      </span>
                      <span>变量 {manifest.variables?.length ?? 0}</span>
                      <span>文件 {manifest.structure.files.length}</span>
                      {manifest.version && <span>版本 {manifest.version}</span>}
                    </div>
                    {manifest.tags && manifest.tags.length > 0 && (
                      <div className="tpl-detail-tags">
                        {manifest.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="set-note">选择一个模板查看详情</p>
                )}
              </div>

              {saveMode && (
                <div className="tpl-save">
                  <label className="entry-label" htmlFor="tpl-save-name">
                    模板名（将复制当前项目文件，排除 .ltex / 编译产物）
                  </label>
                  <input
                    id="tpl-save-name"
                    className="entry-input"
                    value={saveName}
                    placeholder="例如：我的论文模板"
                    spellCheck={false}
                    autoFocus
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void doSave();
                      }
                    }}
                  />
                  <div className="tpl-save-acts">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSaveMode(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy || !saveName.trim()}
                      onClick={() => void doSave()}
                    >
                      {busy ? "保存中…" : "保存模板"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void doImport(true)}
              title="从包含 manifest.json 的模板文件夹导入"
            >
              导入文件夹…
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void doImport(false)}
              title="从 .zip 模板包导入"
            >
              导入 zip…
            </button>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
            <button type="button" className="btn" onClick={close}>
              关闭
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!selected}
              onClick={() => {
                const id = selected;
                close();
                openWizard(undefined, id);
              }}
            >
              用此模板新建
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TemplateLibraryDialog;
