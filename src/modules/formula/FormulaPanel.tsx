// M1-12c · 公式库（公式侧栏「公式模板」页签；M1-10 面板收敛）
// 相对 M1-10 的变化：
// - 移除收藏（页签 + 星标；settings.formula.favorites 字段保留兼容，UI 不再暴露）
// - 「行内/编号」开关提升到侧栏头部齿轮 popover（M1-12a），本面板不再自持
// - 「搭建」页签升为侧栏顶级页签（M1-12a），本面板只剩公式库
// - 「最近」改读 composeStore.recent——符号/模板/公式写入跨页签共享（M1-12b 起）
// 交互定稿（用户 2026-10-25）：单击 → 写入侧栏编写区；右键 → InsertCtxMenu 直插。
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippetWithSlots } from "@/editor/mathSlots";
import { notify } from "@/project/useProject";
import { useSettingsStore } from "@/core/settings";
import { useComposeStore, type RecentItem } from "@/modules/formula/composeStore";
import { wrapFormula } from "@/modules/formula/mathInsert";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import FormulaKaTeX from "./FormulaKaTeX";
import formulasData from "./formulas.json";
import type { FormulaConfig, FormulaDef } from "@/types/settings";

const BUILTIN = formulasData as FormulaDef[];

type Tab = "all" | "recent" | "custom";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "recent", label: "最近" },
  { id: "custom", label: "自定义" },
];

/** 回显时长（ms） */
const FLASH_MS = 1200;

/** 列表行：公式库条目与「最近」条目（符号/模板）统一形状 */
interface Row {
  key: string;
  label: string;
  latex: string;
  /** 分类徽标（最近条目无） */
  cat?: string;
  /** 自定义公式（可编辑/删除） */
  isCustom?: boolean;
  /** 原始定义（编辑用） */
  def?: FormulaDef;
}

export default function FormulaPanel() {
  const formula = useSettingsStore((s) => s.settings.formula);
  const recent = useComposeStore((s) => s.recent);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("全部");
  const [tab, setTab] = useState<Tab>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<FormulaDef | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; item: Row } | null>(null);
  const flashTimer = useRef<number | null>(null);

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

  // ── 写入公式配置（运行时 + 落盘，镜像 setTheme 双写） ──
  const updateFormula = (next: FormulaConfig) => {
    const st = useSettingsStore.getState();
    st.setSettings({ ...st.settings, formula: next });
    void st.persist({ formula: next });
  };

  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const say = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  /** 单击：写入侧栏编写区光标处 + 记最近使用 */
  const writeToCompose = (row: Row) => {
    const st = useComposeStore.getState();
    st.insert(row.latex);
    st.pushRecent({ key: row.key, label: row.label, latex: row.latex });
    say(`已写入编写区 ${row.latex}`);
  };

  /** 右键主项：直插主编辑器（公式按行内/编号包裹；isEnv/符号/模板原样） */
  const directInsert = (row: Row) => {
    const def = allDefs.find((d) => d.id === row.key);
    const code =
      def && !def.isEnv ? wrapFormula(def.latex, formula.numbered, formula.inline) : row.latex;
    if (insertSnippetWithSlots(code)) say(`已插入 ${row.latex}`);
  };

  const copyLatex = async (row: Row) => {
    try {
      await navigator.clipboard.writeText(row.latex);
      notify(`已复制 ${row.latex}`);
    } catch (e) {
      notify(`复制失败：${String(e)}`, "err");
    }
  };

  const menuFor = (row: Row): CtxAction[] => [
    { label: "直接插入到编辑器", primary: true, onClick: () => directInsert(row) },
    { label: "插入到编写区", onClick: () => writeToCompose(row) },
    { label: "复制 LaTeX", onClick: () => void copyLatex(row) },
  ];

  const defRow = (d: FormulaDef): Row => ({
    key: d.id,
    label: d.name,
    latex: d.latex,
    cat: d.category,
    isCustom: customMap.has(d.id),
    def: d,
  });

  /** 最近条目 → 行（公式 id 命中库内定义时用最新 latex；符号/模板原样） */
  const recentRow = (r: RecentItem): Row => {
    const def = allDefs.find((d) => d.id === r.key);
    return {
      key: r.key,
      label: r.label,
      latex: def?.latex ?? r.latex,
      cat: def?.category,
      isCustom: customMap.has(r.key),
      def,
    };
  };

  const rows = useMemo<Row[]>(() => {
    const kw = q.trim().toLowerCase();
    const hit = (r: Row) =>
      !kw ||
      r.label.toLowerCase().includes(kw) ||
      r.latex.toLowerCase().includes(kw) ||
      (r.cat ?? "").toLowerCase().includes(kw);

    if (tab === "recent") return recent.map(recentRow).filter(hit);
    let list: FormulaDef[] = tab === "custom" ? formula.custom : allDefs;
    if (cat !== "全部") list = list.filter((d) => d.category === cat);
    return list.map(defRow).filter(hit);
  }, [tab, q, cat, recent, allDefs, formula.custom, customMap]);

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

  return (
    <div className="symbol-panel formula-panel">
      <div className="symbol-toolbar">
        <input
          className="symbol-search"
          placeholder="搜索公式，如 frac / sum / 矩阵"
          value={q}
          onChange={(e) => setQ(e.target.value)}
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

      <div className="formula-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "formula-tab active" : "formula-tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
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

      {flash && <div className="symbol-flash">{flash}</div>}

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
        {rows.map((r) => (
          <div className="formula-item" key={r.key}>
            <button
              type="button"
              className="formula-insert"
              title={`${r.label}（${r.latex}）· 单击写入编写区，右键直插编辑器`}
              onClick={() => writeToCompose(r)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, item: r });
              }}
            >
              <span className="formula-name">{r.label}</span>
              <span className="formula-latex">
                <FormulaKaTeX tex={r.latex} strict />
              </span>
              {r.cat && <span className="formula-cat">{r.cat}</span>}
            </button>
            {r.isCustom && r.def && (
              <>
                <button
                  type="button"
                  className="formula-edit"
                  title="编辑"
                  onClick={() => openEdit(r.def!)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="formula-del"
                  title="删除"
                  onClick={() => deleteCustom(r.key)}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="symbol-empty">
            {tab === "custom"
              ? "尚无自定义公式，点击右上角 ＋ 新建"
              : tab === "recent"
                ? "还没有使用记录（符号 / 模板 / 公式的写入都会记入这里）"
                : "未找到匹配公式"}
          </div>
        )}
      </div>

      {ctx && (
        <InsertCtxMenu x={ctx.x} y={ctx.y} actions={menuFor(ctx.item)} onClose={() => setCtx(null)} />
      )}
    </div>
  );
}
