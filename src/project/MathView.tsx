// M1-12a · 公式侧栏（符号面板 / 公式 / 搭建 三模块合并入口；取代 M1-6b SymbolView 与 M1-10 FormulaView）
// M1-12b：输入区域挂载二级工具栏（颜色/字体/字号/环境 + 源码可视化 + 缩放）；
//          搭建页签按定案**不套双区**（M1-11 自含布局：类别钮 → 预览主区 → 树 → 符号条 → 插入）。
// 结构（对齐 docs/Formula.html 输入/输出双区参考，用户 2026-10-25 确认）：
//   输入区域 Input：区域头（标题 + 插入偏好齿轮）→ 页签（快捷工具/公式模板/搭建）→ 面板挂载区 → 工具栏 → 编写区
//   输出区域 Output：区域头（标题 + 预览缩放）→ KaTeX 实时预览 → 动作条（插入编辑器 / 复制 LaTeX）
// 交互铁律（用户定稿）：单击符号/模板 → 写入编写区；右键 → 直插菜单；Ctrl+Enter / 按钮提交。
// 页签按模块启停生成：symbol 停用 → 无「快捷工具」；formula 停用 → 无「公式模板/搭建」；
// 双停用 → 空态 + 「去设置启用」。
// bundle：本组件经 Sidebar lazy 加载——katex（MathCompose 可视化模式 + MathOutput）随本 chunk，
//          首开公式侧栏时按需拉取；SymbolPanel/FormulaPanel/FormulaBuilder 仍为各自懒加载 chunk。
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { lazy } from "react";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { moduleRegistry } from "@/core/moduleRegistry";
import { useModuleList } from "@/modules/useModuleList";
import { Icon } from "@/ui/Icon";
import type { FormulaConfig } from "@/types/settings";
import MathCompose from "@/modules/formula/MathCompose";
import MathOutput from "@/modules/formula/MathOutput";
import MathToolbar from "@/modules/formula/MathToolbar";

type MathTab = "tools" | "library" | "builder";

const TAB_LABELS: { id: MathTab; label: string }[] = [
  { id: "tools", label: "快捷工具" },
  { id: "library", label: "公式模板" },
  { id: "builder", label: "搭建" },
];

/** 搭建器非注册模块（formula 模块内部页签），独立懒加载 chunk */
const BuilderComp = lazy(() => import("@/modules/formula/FormulaBuilder"));

/** 读模块注册态 + 启用态（注册在 App 根部 effect，晚于本组件挂载 → 补一拍重读，防首帧误判停用） */
function useMathModules() {
  const mods = useModuleList();
  const [, setRev] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setRev((r) => r + 1), 0);
    return () => window.clearTimeout(t);
  }, []);
  return {
    symbol: {
      enabled: mods.find((m) => m.id === "symbol")?.enabled ?? false,
      Comp: moduleRegistry.get("symbol")?.component ?? null,
    },
    formula: {
      enabled: mods.find((m) => m.id === "formula")?.enabled ?? false,
      Comp: moduleRegistry.get("formula")?.component ?? null,
    },
  };
}

/** 插入偏好 popover（行内 / 编号 / 无编号 → settings.formula，即时生效并落盘；纯展示，关闭由外层管） */
function InsertPrefs() {
  const formula = useSettingsStore((s) => s.settings.formula);

  const update = (patch: Partial<FormulaConfig>) => {
    const next = { ...formula, ...patch };
    const st = useSettingsStore.getState();
    st.setSettings({ ...st.settings, formula: next });
    void st.persist({ formula: next });
  };

  const value = formula.inline ? "inline" : formula.numbered ? "numbered" : "star";
  const options: { v: string; label: string; patch: Partial<FormulaConfig> }[] = [
    { v: "inline", label: "行内公式 $…$", patch: { inline: true } },
    { v: "numbered", label: "编号公式 equation", patch: { inline: false, numbered: true } },
    { v: "star", label: "无编号公式 equation*", patch: { inline: false, numbered: false } },
  ];

  return (
    <div className="math-prefs" role="dialog" aria-label="插入偏好">
      <div className="math-prefs-title">插入偏好</div>
      {options.map((o) => (
        <label key={o.v} className="math-prefs-item">
          <input
            type="radio"
            name="math-insert-pref"
            checked={value === o.v}
            onChange={() => update(o.patch)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function MathView() {
  const { symbol, formula } = useMathModules();
  const [tab, setTab] = useState<MathTab>("tools");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prefsAnchor = useRef<HTMLDivElement>(null);

  // 偏好 popover：点击锚点外 / Esc 关闭（锚点含齿轮钮——点齿轮走按钮自身 toggle，不在此关）
  useEffect(() => {
    if (!prefsOpen) return;
    const down = (e: MouseEvent) => {
      if (!prefsAnchor.current?.contains(e.target as Node)) setPrefsOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPrefsOpen(false);
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [prefsOpen]);

  const avail = useMemo<MathTab[]>(() => {
    const a: MathTab[] = [];
    if (symbol.enabled) a.push("tools");
    if (formula.enabled) a.push("library", "builder");
    return a;
  }, [symbol.enabled, formula.enabled]);

  // 双模块全停用：空态 + 去设置启用（复用 .side-empty 构图）
  if (avail.length === 0) {
    return (
      <div className="side-view">
        <div className="side-empty">
          <div>公式面板已停用</div>
          <button
            type="button"
            className="btn"
            onClick={() => useAppStore.getState().openSettings("modules")}
          >
            去设置启用
          </button>
        </div>
      </div>
    );
  }

  // 当前页签不可用（模块被停用）→ 回落到第一个可用页签
  const active: MathTab = avail.includes(tab) ? tab : avail[0];
  // 搭建页签自含布局（M1-12a 定案）：工具栏/编写区/输出区不参与，builder 占满输入区
  const isBuilder = active === "builder";

  return (
    <div className="side-view math-view">
      {/* ── 输入区域 ── */}
      <section className="math-region math-input">
        <div className="math-region-head">
          <span className="math-region-title">输入区域 Input</span>
          <div className="math-prefs-anchor" ref={prefsAnchor}>
            <button
              type="button"
              className={prefsOpen ? "math-gear on" : "math-gear"}
              title="插入偏好（行内 / 编号）"
              aria-expanded={prefsOpen}
              onClick={() => setPrefsOpen((v) => !v)}
            >
              <Icon name="sliders" size={14} />
            </button>
            {prefsOpen && <InsertPrefs />}
          </div>
        </div>

        <nav className="math-tabs" aria-label="公式面板页签">
          {TAB_LABELS.filter((t) => avail.includes(t.id)).map((t) => (
            <button
              key={t.id}
              type="button"
              className={active === t.id ? "math-tab active" : "math-tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="math-input-body">
          <Suspense fallback={<div className="side-loading">加载中…</div>}>
            {active === "tools" && symbol.Comp ? <symbol.Comp /> : null}
            {active === "library" && formula.Comp ? <formula.Comp /> : null}
            {active === "builder" ? <BuilderComp /> : null}
          </Suspense>
        </div>

        {!isBuilder && (
          <>
            <MathToolbar />
            <MathCompose />
          </>
        )}
      </section>

      {/* ── 输出区域（搭建页签不套双区） ── */}
      {!isBuilder && <MathOutput />}
    </div>
  );
}

export default MathView;
