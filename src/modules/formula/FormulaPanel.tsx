// M1-10 · 公式面板（懒加载组件，镜像 SymbolPanel 验证 slot 挂载 + Suspense 通路）
// 行为：9 分类 + 名称/LaTeX/描述搜索；分页签（全部/收藏/最近/自定义）+ 新建；
// 收藏星标；自定义公式增删改（落盘）；插入时按「编号/行内」开关智能包裹（见 wrapFormula）。
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippet } from "@/core/moduleRegistry";
import { useSettingsStore } from "@/core/settings";
import type { FormulaConfig, FormulaDef } from "@/types/settings";
import formulasData from "./formulas.json";

const BUILTIN = formulasData as FormulaDef[];
/** 最近使用上限（仅会话内记忆，不落盘） */
const RECENT_CAP = 12;

type Tab = "all" | "fav" | "recent" | "custom";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "fav", label: "收藏" },
  { id: "recent", label: "最近" },
  { id: "custom", label: "自定义" },
];

/** 按「编号/行内」开关包裹公式片段（M1-10 用户规格） */
function wrapFormula(def: FormulaDef, numbered: boolean, inline: boolean): string {
  if (def.isEnv) return def.latex; // 整段已是完整环境，原样插入
  if (inline) return `$${def.latex}$`; // 行内公式
  if (numbered) return `\\begin{equation}\n${def.latex}\n\\end{equation}`; // 带编号
  return `\\begin{equation*}\n${def.latex}\n\\end{equation*}`; // 无编号
}

export default function FormulaPanel() {
  const formula = useSettingsStore((s) => s.settings.formula);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("全部");
  const [tab, setTab] = useState<Tab>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [editing, setEditing] = useState<FormulaDef | null>(null);
  const flashTimer = useRef<number | null>(null);

  const favSet = useMemo(() => new Set(formula.favorites), [formula.favorites]);
  const customMap = useMemo(
    () => new Map(formula.custom.map((d) => [d.id, d])),
    [formula.custom],
  );

  // 全部可选项（内置 + 自定义；自定义按 id 覆盖内置）
  const allDefs = useMemo<FormulaDef[]>(() => {
    const m = new Map<string, FormulaDef>();
    for (const d of BUILTIN) m.set(d.id, d);
    for (const d of formula.custom) m.set(d.id, d);
    return [...m.values()];
  }, [formula.custom]);

  const CATEGORIES = useMemo(
    () => ["全部", ...Array.from(new Set(allDefs.map((d) => d.category)))],
    [allDefs],
  );

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let list = allDefs;
    if (tab === "fav") list = list.filter((d) => favSet.has(d.id));
    else if (tab === "recent")
      list = recent.map((id) => allDefs.find((d) => d.id === id)).filter(Boolean) as FormulaDef[];
    else if (tab === "custom") list = list.filter((d) => customMap.has(d.id));

    return list.filter((d) => {
      if (cat !== "全部" && d.category !== cat) return false;
      if (!kw) return true;
      return (
        d.name.toLowerCase().includes(kw) ||
        d.latex.toLowerCase().includes(kw) ||
        (d.category ?? "").toLowerCase().includes(kw) ||
        (d.desc ?? "").toLowerCase().includes(kw)
      );
    });
  }, [allDefs, favSet, recent, customMap, tab, cat, q]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    };
  }, []);

  // ── 写入公式配置（运行时 + 落盘，镜像 setTheme 双写） ──
  const updateFormula = (next: FormulaConfig) => {
    const st = useSettingsStore.getState();
    st.setSettings({ ...st.settings, formula: next });
    void st.persist({ formula: next });
  };

  const insert = (def: FormulaDef) => {
    const ok = insertSnippet(wrapFormula(def, formula.numbered, formula.inline));
    if (!ok) return;
    setFlash(def.name);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1200);
    setRecent((r) => [def.id, ...r.filter((id) => id !== def.id)].slice(0, RECENT_CAP));
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && visible.length > 0) {
      e.preventDefault();
      insert(visible[0]);
    }
  };

  const toggleFav = (id: string) => {
    const next = favSet.has(id)
      ? formula.favorites.filter((f) => f !== id)
      : [...formula.favorites, id];
    updateFormula({ ...formula, favorites: next });
  };

  const toggleInline = () =>
    updateFormula({ ...formula, inline: !formula.inline });
  const toggleNumbered = () =>
    updateFormula({ ...formula, numbered: !formula.numbered });

  // ── 自定义公式编辑 ──
  const openNew = () =>
    setEditing({
      id: "",
      name: "",
      latex: "",
      category: "自定义",
      desc: "",
      isEnv: false,
    });
  const openEdit = (def: FormulaDef) => setEditing({ ...def });
  const closeEditor = () => setEditing(null);

  const saveCustom = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const latex = editing.latex.trim();
    const category = editing.category.trim() || "自定义";
    if (!name || !latex) return; // 必填校验（与 Rust 归一化一致）
    const def: FormulaDef = {
      id: editing.id || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      latex,
      category,
      desc: editing.desc?.trim() || undefined,
      isEnv: editing.isEnv,
    };
    const custom = editing.id
      ? formula.custom.map((d) => (d.id === def.id ? def : d))
      : [...formula.custom, def];
    updateFormula({ ...formula, custom });
    closeEditor();
  };

  const deleteCustom = (id: string) => {
    updateFormula({ ...formula, custom: formula.custom.filter((d) => d.id !== id) });
  };

  const modeLabel = formula.inline
    ? "行内公式 $…$"
    : formula.numbered
      ? "编号公式 equation"
      : "无编号公式 equation*";

  return (
    <div className="symbol-panel formula-panel">
      <div className="symbol-toolbar">
        <input
          className="symbol-search"
          placeholder="搜索公式，如 frac / sum / 矩阵"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onSearchKey}
        />
        <select
          className="symbol-cat"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label="公式分类"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* 插入模式开关（编号 / 行内）—— 直接驱动公式外观 */}
      <div className="formula-mode">
        <label className="formula-mode-item">
          <input type="checkbox" checked={formula.inline} onChange={toggleInline} />
          行内公式 $…$
        </label>
        <label className={`formula-mode-item ${formula.inline ? "is-disabled" : ""}`}>
          <input
            type="checkbox"
            checked={formula.numbered}
            disabled={formula.inline}
            onChange={toggleNumbered}
          />
          公式编号
        </label>
        <span className="formula-mode-hint">插入为：{modeLabel}</span>
      </div>

      <div className="formula-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "formula-tab active" : "formula-tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "fav" && formula.favorites.length > 0 && (
              <span className="formula-tab-badge">{formula.favorites.length}</span>
            )}
            {t.id === "custom" && formula.custom.length > 0 && (
              <span className="formula-tab-badge">{formula.custom.length}</span>
            )}
          </button>
        ))}
        <button
          type="button"
          className="formula-new"
          title="新建自定义公式"
          onClick={openNew}
        >
          ＋
        </button>
      </div>

      {flash && <div className="symbol-flash">已插入 {flash}</div>}

      {editing && (
        <div className="formula-editor">
          <div className="formula-editor-row">
            <input
              className="formula-editor-name"
              placeholder="名称（必填）"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <input
              className="formula-editor-cat"
              placeholder="分类（必填）"
              value={editing.category}
              onChange={(e) => setEditing({ ...editing, category: e.target.value })}
            />
          </div>
          <textarea
            className="formula-editor-latex"
            placeholder="LaTeX 内容（必填；含完整环境时勾选下方）"
            value={editing.latex}
            rows={3}
            onChange={(e) => setEditing({ ...editing, latex: e.target.value })}
          />
          <input
            className="formula-editor-desc"
            placeholder="描述（可选，参与搜索）"
            value={editing.desc ?? ""}
            onChange={(e) => setEditing({ ...editing, desc: e.target.value })}
          />
          <label className="formula-editor-env">
            <input
              type="checkbox"
              checked={editing.isEnv}
              onChange={(e) => setEditing({ ...editing, isEnv: e.target.checked })}
            />
            整段已是完整环境（插入时不套编号/行内包裹）
          </label>
          <div className="formula-editor-actions">
            <button type="button" className="btn" onClick={saveCustom}>
              保存
            </button>
            <button type="button" className="btn" onClick={closeEditor}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="symbol-grid">
        {visible.map((d) => {
          const isFav = favSet.has(d.id);
          const isCustom = customMap.has(d.id);
          return (
            <div className="formula-item" key={d.id}>
              <button
                type="button"
                className="formula-insert"
                title={`插入 ${d.name}（${d.latex}）`}
                onClick={() => insert(d)}
              >
                <span className="formula-name">{d.name}</span>
                <span className="formula-latex">{d.latex}</span>
                <span className="formula-cat">{d.category}</span>
              </button>
              <button
                type="button"
                className={isFav ? "fav-star on" : "fav-star"}
                title={isFav ? "取消收藏" : "收藏"}
                onClick={() => toggleFav(d.id)}
              >
                {isFav ? "★" : "☆"}
              </button>
              {isCustom && (
                <>
                  <button
                    type="button"
                    className="formula-edit"
                    title="编辑"
                    onClick={() => openEdit(d)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="formula-del"
                    title="删除"
                    onClick={() => deleteCustom(d.id)}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="symbol-empty">
            {tab === "custom" ? "尚无自定义公式，点击右上角 ＋ 新建" : "未找到匹配公式"}
          </div>
        )}
      </div>
    </div>
  );
}
