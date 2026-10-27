// M1-15e · 模板库管理对话框（参考 docs/dev/UI/模板库.html 三栏布局）
// 左：分类导航（内置按 category 分组 + 用户模板）；右：搜索 + 列表 / 详情双栏。
// 能力：浏览/预览 manifest、导入（目录 / zip）、用此模板新建；「另存当前项目为模板」由菜单以另存模式打开。
import { useEffect, useMemo, useState } from "react";
import { confirm, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { templateApi } from "@/ipc/invoke";
import { Icon } from "@/ui/Icon";
import { notify, useProjectStore } from "@/project/useProject";
import type { TemplateManifest, TemplateMeta } from "@/types";

/** 分类展示名（内置模板 manifest 的 category → 中文标签） */
const CAT_LABELS: Record<string, string> = {
  article: "📄 文章 (Article)",
  slides: "📊 幻灯片 (Slides)",
  beamer: "📊 幻灯片 (Slides)",
  resume: "📑 简历 (Resume)",
  thesis: "🎓 论文 (Thesis)",
  other: "其他",
};

function catKey(m: TemplateMeta): string {
  return (m.category ?? "").trim().toLowerCase() || "other";
}

function catLabel(key: string): string {
  return CAT_LABELS[key] ?? key;
}

/** 取标签前缀的 emoji（emoji 仅在 CAT_LABELS 记录一次） */
const LEADING_EMOJI =
  /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u;

function catEmoji(key: string): string {
  const label = CAT_LABELS[key];
  return label?.match(LEADING_EMOJI)?.[1] ?? "";
}

/** 列表项 emoji（用户模板固定 📁，未知分类回退 📄） */
function emojiFor(m: TemplateMeta): string {
  if (m.isUser) return "📁";
  return catEmoji(catKey(m)) || "📄";
}

export function TemplateLibraryDialog() {
  const open = useProjectStore((s) => s.libraryOpen);
  const librarySaveMode = useProjectStore((s) => s.librarySaveMode);
  const close = useProjectStore((s) => s.closeLibrary);
  const root = useProjectStore((s) => s.root);
  const openWizard = useProjectStore((s) => s.openWizard);

  const [metas, setMetas] = useState<TemplateMeta[]>([]);
  const [selected, setSelected] = useState("");
  const [manifest, setManifest] = useState<TemplateManifest | null>(null);
  const [scope, setScope] = useState<string>("all"); // all | user | cat:<key>
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 「另存当前项目为模板」表单
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

  // 打开时拉列表 + 复位筛选；另存模式直接展开表单
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setScope("all");
    setQuery("");
    setSaveMode(librarySaveMode);
    setSaveName(librarySaveMode && root ? (root.split(/[\\/]/).pop() ?? "") : "");
    setLoading(true);
    void refresh()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
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

  const { builtin, user, builtinCats } = useMemo(() => {
    const b = metas.filter((m) => !m.isUser);
    const u = metas.filter((m) => m.isUser);
    const counts = new Map<string, number>();
    for (const m of b) {
      const k = catKey(m);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return {
      builtin: b,
      user: u,
      builtinCats: [...counts.entries()].sort((a, b2) =>
        a[0].localeCompare(b2[0]),
      ),
    };
  }, [metas]);

  const scopeMetas = useMemo(() => {
    if (scope === "user") return user;
    if (scope === "all") return metas; // 全部 = 内置 + 用户
    const key = scope.startsWith("cat:") ? scope.slice(4) : "";
    return builtin.filter((m) => catKey(m) === key);
  }, [scope, metas, user, builtin]);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return scopeMetas;
    return scopeMetas.filter(
      (m) =>
        m.name.toLowerCase().includes(kw) ||
        (m.description ?? "").toLowerCase().includes(kw) ||
        (m.category ?? "").toLowerCase().includes(kw) ||
        m.id.toLowerCase().includes(kw) ||
        (m.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
    );
  }, [scopeMetas, query]);

  // 过滤/切换分类后，保证选中项在可见列表内
  useEffect(() => {
    if (!open) return;
    if (filtered.length === 0) {
      setSelected("");
      return;
    }
    if (!filtered.some((m) => m.id === selected)) setSelected(filtered[0].id);
  }, [open, filtered, selected]);

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
      setScope(meta.isUser ? "user" : "all");
      notify(`已导入模板「${meta.name}」`, "ok");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 退出另存模式（同时复位 store 标志，便于下次菜单再次打开表单） */
  const endSaveMode = () => {
    setSaveMode(false);
    useProjectStore.setState({ librarySaveMode: false });
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
      endSaveMode();
      setSaveName("");
      await refresh(meta.id);
      setScope("user");
      notify(`已另存为模板「${meta.name}」`, "ok");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedMeta = metas.find((m) => m.id === selected);

  /** 删除用户模板（内置模板按钮不显示；后端也会拒绝） */
  const doDelete = async () => {
    if (!selectedMeta?.isUser) return;
    const name = selectedMeta.name;
    const ok = await confirm(
      `确定删除模板「${name}」？\n将从用户模板目录移除，且不可恢复。`,
      { title: "删除模板", kind: "warning", okLabel: "删除", cancelLabel: "取消" },
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await templateApi.deleteTemplate(selectedMeta.id);
      await refresh();
      notify(`已删除模板「${name}」`, "ok");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const item = (m: TemplateMeta) => (
    <button
      key={m.id}
      type="button"
      className={m.id === selected ? "tl-item on" : "tl-item"}
      onClick={() => setSelected(m.id)}
      title={m.description ?? m.id}
    >
      <span className="tl-item-emoji">{emojiFor(m)}</span>
      <span className="tl-item-info">
        <span className="tl-item-title">
          {m.name}
          {m.isUser && <span className="tl-user">用户</span>}
        </span>
        <span className="tl-item-meta">
          <span className="tl-tag">
            {m.isUser ? "USER" : catKey(m).toUpperCase()}
          </span>
          <span className="tl-engine">
            {m.engine || (m.isUser ? "用户模板" : m.id)}
          </span>
        </span>
      </span>
    </button>
  );

  const catBtn = (key: string, label: string, count: number) => (
    <button
      key={key}
      type="button"
      className={scope === key ? "tl-cat on" : "tl-cat"}
      onClick={() => setScope(key)}
    >
      <span>{label}</span>
      <span className="tl-count">{count}</span>
    </button>
  );

  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal tl-modal"
        role="dialog"
        aria-label="模板库"
        onMouseDown={(e) => e.stopPropagation()}
      >
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

        <div className="modal-body tl-body">
          {/* 左：分类导航 */}
            <aside className="tl-cats">
                <div className="tl-cat-group">
                    {catBtn("all", "全部", metas.length)}
                    <div className="tl-cat-title">内置模板</div>
                    {builtinCats.map(([k, n]) => catBtn(`cat:${k}`, catLabel(k), n))}
                      </div>
                <div className="tl-cat-group">
                    <div className="tl-cat-title">用户模板</div>
                    {catBtn("user", "📁 我的模板", user.length)}
                </div>
            </aside>
          {/* 右：搜索 + 列表/详情 */}
          <div className="tl-content">
            <div className="tl-search">
              <input
                className="tl-search-input"
                value={query}
                placeholder="搜索模板名称或标签…"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {err && <p className="error tl-err">{err}</p>}

            <div className="tl-split">
              <div className="tl-list">
                {loading ? (
                  <p className="set-note">加载中…</p>
                ) : filtered.length === 0 ? (
                  <p className="set-note">没有匹配的模板</p>
                ) : (
                  filtered.map(item)
                )}
              </div>

              {saveMode ? (
                <div className="tl-detail tl-save-panel">
                  <h2>另存当前项目为模板</h2>
                  <p className="tl-desc">
                    将当前项目文件复制到用户模板目录（排除 .ltex / 编译产物 /
                    依赖目录）。
                  </p>
                  <label className="entry-label" htmlFor="tl-save-name">
                    模板名
                  </label>
                  <input
                    id="tl-save-name"
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
                  <div className="tl-save-acts">
                    <button type="button" className="btn" onClick={endSaveMode}>
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
              ) : (
                <div className="tl-detail">
                  {manifest && selectedMeta ? (
                    <>
                      <div className="tl-detail-head">
                        <h2>{manifest.name}</h2>
                        {selectedMeta.isUser && (
                          <span className="tl-user">用户</span>
                        )}
                      </div>
                      <p className="tl-desc">{manifest.description ?? "无描述"}</p>

                      <div className="tl-meta-grid">
                        <div className="tl-meta">
                          <span className="tl-meta-label">引擎 (Engine)</span>
                          <span className="tl-meta-value">
                            {manifest.build.engine}
                          </span>
                        </div>
                        <div className="tl-meta">
                          <span className="tl-meta-label">主文件 (Main File)</span>
                          <span className="tl-meta-value">
                            {manifest.build.mainFile}
                          </span>
                        </div>
                        <div className="tl-meta">
                          <span className="tl-meta-label">变量 (Variables)</span>
                          <span className="tl-meta-value">
                            {manifest.variables?.length ?? 0}
                          </span>
                        </div>
                        <div className="tl-meta">
                          <span className="tl-meta-label">文件数 (Files)</span>
                          <span className="tl-meta-value">
                            {manifest.structure.files.length}
                          </span>
                        </div>
                        <div className="tl-meta">
                          <span className="tl-meta-label">版本 (Version)</span>
                          <span className="tl-meta-value">
                            {manifest.version ?? "—"}
                          </span>
                        </div>
                        <div className="tl-meta">
                          <span className="tl-meta-label">ID</span>
                          <span className="tl-meta-value">{manifest.id}</span>
                        </div>
                      </div>

                      <div className="tl-tags">
                        {(manifest.tags && manifest.tags.length > 0
                          ? manifest.tags
                          : [
                              manifest.category ??
                                (selectedMeta.isUser ? "用户模板" : "未分类"),
                            ]
                        ).map((t) => (
                          <span key={t} className="tl-tag-plain">
                            {t}
                          </span>
                        ))}
                      </div>

                      {selectedMeta.isUser && (
                        <div className="tl-danger-row">
                          <button
                            type="button"
                            className="btn danger"
                            disabled={busy}
                            onClick={() => void doDelete()}
                          >
                            删除模板
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="set-note">选择一个模板查看详情</p>
                  )}
                </div>
              )}
            </div>
          </div>
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
              disabled={!selected || saveMode || busy}
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
