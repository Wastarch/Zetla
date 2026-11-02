// M1-12a · 公式侧栏（符号面板 / 公式库 两模块合并入口；取代 M1-6b SymbolView 与 M1-10 FormulaView）
// M1-12b：输入区域挂载二级工具栏（颜色/字体/字号/环境 + 源码可视化 + 缩放）。
// 2026-10-25 反馈：移除「搭建」页签（原 M1-11 图形化搭建器，用户确认无用）；builderTypes.TPLS 保留供符号面板模板数据。
// 结构（单一「输入区域」承载全部交互，2026-11-02 起移除独立输出区域 Output）：
//   输入区域 Input：区域头（标题 + 插入偏好齿轮）→ 页签（快捷工具/公式模板）→ 面板挂载区 → 工具栏 → 编写区（含实时预览与底部动作条）
// 交互铁律（用户定稿）：单击符号/模板 → 写入编写区；右键 → 直插菜单；Ctrl+Enter / 按钮提交。
// 页签随「公式」模块整体启停：模块停用 → 空态 + 「去设置启用」；启用 → 两页签常驻。
// bundle：本组件经 Sidebar lazy 加载——katex（MathCompose 可视化模式 + 编写区预览）随本 chunk，
//          首开公式侧栏时按需拉取；SymbolPanel/FormulaPanel 仍为各自懒加载 chunk。
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { useModuleList } from "@/modules/useModuleList";
const SymbolPanel = lazy(() => import("@/modules/symbol/SymbolPanel"));
const FormulaPanel = lazy(() => import("@/modules/formula/FormulaPanel"));
import { Icon } from "@/ui/Icon";
import type { FormulaConfig } from "@/types/settings";
import MathCompose from "@/modules/formula/MathCompose";
import MathToolbar from "@/modules/formula/MathToolbar";
import { useComposeStore } from "@/modules/formula/composeStore";
import { useCtrlWheelZoom } from "@/modules/formula/useCtrlWheelZoom";

type MathTab = "tools" | "library";

const TAB_LABELS: { id: MathTab; label: string }[] = [
  { id: "tools", label: "快捷工具" },
  { id: "library", label: "公式模板" },
];

/** 编写区（下方工具栏+编写区）可调高度：默认/最小同值（320 = 工具栏70 + 输入框60 + 预览60 + 动作条43 + 间隙/内边距）；
 *  最大按输入区域高度动态计算。与 zetla.css 的 --math-bottom-min 保持一致（改值需同步两处）。 */
const DEFAULT_BOTTOM_H = 320;
const MIN_BOTTOM_H = 320;
/** bottom 之外的固定占位：区域头 26 + 页签 28 + 分割线 17 = 71 */
const FIXED_TOP_H = 71;
/** 常态下给上方符号面板保留的最小可用高度；仅极端矮窗口才允许压到 0（优先保下方编写区） */
const MIN_TOP_H = 60;

/** 读「公式」模块启用态（注册在 App 根部 effect，晚于本组件挂载 → 补一拍重读，防首帧误判停用） */
function useMathModuleEnabled(): boolean {
  const mods = useModuleList();
  const [, setRev] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setRev((r) => r + 1), 0);
    return () => window.clearTimeout(t);
  }, []);
  return mods.find((m) => m.id === "formula")?.enabled ?? false;
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

  const value = formula.inline
    ? "inline"
    : formula.numbered
      ? "numbered"
      : "star";
  const options: { v: string; label: string; patch: Partial<FormulaConfig> }[] =
    [
      { v: "inline", label: "行内公式 $…$", patch: { inline: true } },
      {
        v: "numbered",
        label: "编号公式 equation",
        patch: { inline: false, numbered: true },
      },
      {
        v: "star",
        label: "无编号公式 equation*",
        patch: { inline: false, numbered: false },
      },
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
  const mathEnabled = useMathModuleEnabled();
  // 页签（M1-19 提升进 composeStore：hover ✎ 载入公式时强制切回「快捷工具」，保证下方编写区可见）
  const tab = useComposeStore((s) => s.tab);
  const setTab = useComposeStore((s) => s.setTab);
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

  const avail = useMemo<MathTab[]>(
    () => (mathEnabled ? (["tools", "library"] as MathTab[]) : []),
    [mathEnabled],
  );

  // 输入区域 Ctrl+滚轮 → 编写区字号缩放（2026-10-25 用户反馈；对应工具栏「− 18 +」）
  const zoomFont = useComposeStore((s) => s.zoomFont);
  const inputZoomRef = useCtrlWheelZoom<HTMLElement>((dir) => zoomFont(dir));

  // 符号面板（上）与工具栏+编写区（下）之间的可拖拽分割线：下方容器高度 state
  const [bottomH, setBottomH] = useState(DEFAULT_BOTTOM_H);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  // 拖拽起始：记录起点，挂全局 move/up（复用 LogPanel 已验证口径；body.row-resizing 关掉文本选中）
  const onResizeDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { y: e.clientY, h: bottomH };
    setDragging(true);
    document.body.classList.add("row-resizing");
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // 上方常态至少留 MIN_TOP_H；Math.max 保证上限不低于下限（窗口过矮时优先压上方符号面板）
      const maxH = Math.max(
        MIN_BOTTOM_H,
        (inputZoomRef.current?.clientHeight ?? 600) - FIXED_TOP_H - MIN_TOP_H,
      );
      const next = Math.round(d.h - (e.clientY - d.y)); // 边界跟随鼠标：向下拖→分割线下移、下方变小；向上拖→分割线上移、下方变大
      setBottomH(Math.min(maxH, Math.max(MIN_BOTTOM_H, next)));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove("row-resizing");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("row-resizing");
    };
  }, [dragging]);

  // 窗口变小兜底：拖出的高度不得超过当前输入区域可容纳上限，避免上方符号面板被压没
  useEffect(() => {
    const onResize = () => {
      // 上方常态至少留 MIN_TOP_H；Math.max 保证上限不低于下限（窗口过矮时优先压上方符号面板）
      const maxH = Math.max(
        MIN_BOTTOM_H,
        (inputZoomRef.current?.clientHeight ?? 600) - FIXED_TOP_H - MIN_TOP_H,
      );
      setBottomH((h) => Math.min(maxH, Math.max(MIN_BOTTOM_H, h)));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  return (
    <div className="side-view math-view">
      {/* ── 输入区域 ── */}
      <section className="math-region math-input" ref={inputZoomRef}>
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
            {active === "tools" && <SymbolPanel />}
            {active === "library" && <FormulaPanel />}
          </Suspense>
        </div>
        <div className="math-divider">
          <div
            className="math-splitter"
            title="拖拽调整编写区高度"
            onMouseDown={onResizeDown}
          />
        </div>
        <div className="math-bottom" style={{ height: bottomH }}>
          <MathToolbar />
          <MathCompose />
        </div>
      </section>
    </div>
  );
}

export default MathView;
