// M1-11 · 图形化公式搭建器（公式面板「搭建」页签）
// 交互：点结构模板插入活动槽 → 活动槽自动深入新结构首槽；符号/文本填入活动槽后推进到下一空槽；
//      树列表或预览渲染中的空槽方框点击均可改选活动槽（选后输入框自动聚焦，可直接键盘输入）；
//      模板按类别收起：同类只留一个类别钮，点击展开该类结构（省空间，M1-11 反馈迭代）；
//      插入时按公式模块的「编号/行内」开关包裹，\Box 空槽带入编辑器，由 mathSlots 的 Tab 导航逐个填写。
//      设计取舍见 docs/开发计划.md M1-11。
import { useEffect, useMemo, useRef, useState } from "react";
import { insertSnippetWithSlots } from "@/editor/mathSlots";
import { useSettingsStore } from "@/core/settings";
import symbolsData from "@/modules/symbol/symbols.json";
import FormulaKaTeX from "./FormulaKaTeX";
import {
  TPLS,
  TPL_GROUPS,
  appendText,
  appendToSlot,
  clearSlot,
  collectSlots,
  emptyTree,
  filledCount,
  firstEmptySlot,
  isTreeEmpty,
  makeStruct,
  serialize,
  serializeSlots,
  slotLatex,
  type FNode,
  type FSlot,
} from "./builderTypes";

/** 符号条：希腊字母全量 + 高频运算符/关系符白名单（填字符用，结构走模板） */
const SYM_PICK = new Set([
  "+", "-", "\\pm", "\\mp", "\\times", "\\div", "\\cdot", "=", "<", ">",
  "\\leq", "\\geq", "\\neq", "\\approx", "\\equiv", "\\infty", "\\partial", "\\to",
]);
const SYMS: { cmd: string; glyph: string }[] = (symbolsData as {
  name: string;
  cmd: string;
  category: string;
  glyph?: string;
}[])
  .filter((s) => s.category === "希腊字母" || SYM_PICK.has(s.cmd))
  .map((s) => ({ cmd: s.cmd, glyph: s.glyph ?? s.name }));

/** 树节点行（缩进列表；槽位可点击改选） */
function NodeRow({
  node,
  depth,
  activeId,
  onPick,
}: {
  node: FNode;
  depth: number;
  activeId: string;
  onPick: (id: string) => void;
}) {
  const pad = { paddingLeft: `${4 + depth * 11}px` };
  if (node.k === "text") {
    return (
      <div className="fbuilder-node is-text" style={pad}>
        <span className="fbuilder-node-mark">·</span>
        <span className="fbuilder-node-latex">{node.v}</span>
      </div>
    );
  }
  if (node.k === "struct") {
    const tpl = TPLS.find((t) => t.id === node.tpl);
    return (
      <div className="fbuilder-node" style={pad}>
        <span className="fbuilder-node-mark">{tpl?.icon ?? "?"}</span>
        <span className="fbuilder-node-label">{tpl?.name ?? node.tpl}</span>
      </div>
    );
  }
  const empty = node.children.length === 0;
  return (
    <button
      type="button"
      className={node.id === activeId ? "fbuilder-node is-active" : "fbuilder-node"}
      style={pad}
      title={empty ? "空槽（待填）" : "点击选为活动槽"}
      onClick={() => onPick(node.id)}
    >
      <span className="fbuilder-node-mark">{empty ? "▫" : "▸"}</span>
      <span className="fbuilder-node-label">{node.label}</span>
      <span className="fbuilder-node-latex">{empty ? "空槽" : slotLatex(node)}</span>
    </button>
  );
}

/** 递归渲染（结构槽 → 子节点） */
function SlotChildren({
  slot,
  depth,
  activeId,
  onPick,
}: {
  slot: FSlot;
  depth: number;
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <>
      {slot.children.map((c) =>
        c.k === "struct" ? (
          <div key={c.id}>
            <NodeRow node={c} depth={depth} activeId={activeId} onPick={onPick} />
            {c.slots.map((s) => (
              <SlotChildren key={s.id} slot={s} depth={depth + 1} activeId={activeId} onPick={onPick} />
            ))}
          </div>
        ) : (
          <NodeRow key={c.id} node={c} depth={depth} activeId={activeId} onPick={onPick} />
        ),
      )}
    </>
  );
}

export default function FormulaBuilder() {
  const formula = useSettingsStore((s) => s.settings.formula);
  const [tree, setTree] = useState<FSlot>(emptyTree);
  const [activeId, setActiveId] = useState(() => emptyTree().id);
  const [text, setText] = useState("");
  const [flash, setFlash] = useState(false);
  // 模板类别收起状态：null = 全收起（只显示类别钮）；展开时只显示该类结构
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 活动槽失效防护（清空/重建后回落根槽）
  const active = collectSlots(tree).find((s) => s.id === activeId) ?? tree;

  const latex = useMemo(() => serialize(tree), [tree]);
  // 预览专用序列化：空槽 → \z 命令 + 同序 id（FormulaKaTeX 后处理为可点选方框）
  const preview = useMemo(() => serializeSlots(tree), [tree]);
  const empty = isTreeEmpty(tree);
  const done = filledCount(tree);
  const total = collectSlots(tree).length;

  // 树列表视口内滚动到活动行（点预览选槽后树中同步可见）
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = treeRef.current?.querySelector<HTMLElement>(".fbuilder-node.is-active");
    el?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  /** 选槽后聚焦输入框：点完槽直接键盘输入（MathType 式，无需再点输入框） */
  const focusInput = () => inputRef.current?.focus();

  /** 改选活动槽（树 / 预览共用）：选中即聚焦输入框 */
  const pickSlot = (id: string) => {
    setActiveId(id);
    focusInput();
  };

  /** 活动槽后移：优先下一个空槽；无则原地 */
  const advance = (t: FSlot) => {
    const next = firstEmptySlot(t);
    setActiveId(next ? next.id : t.id);
  };

  const insertTpl = (tplId: string) => {
    const st = makeStruct(tplId);
    const t = appendToSlot(tree, active.id, st);
    setTree(t);
    // 深入新结构的第一个槽，连续搭建不打断
    setActiveId(st.slots[0].id);
    focusInput();
  };

  const fillText = (v: string) => {
    const s = v.trim();
    if (!s) return;
    const t = appendText(tree, active.id, s);
    setTree(t);
    setText("");
    advance(t);
  };

  const onSymClick = (cmd: string) => fillText(cmd);

  const clearActive = () => {
    const t = clearSlot(tree, active.id);
    setTree(t);
    setActiveId(active.id);
  };

  const reset = () => {
    const fresh = emptyTree();
    setTree(fresh);
    setActiveId(fresh.id);
  };

  const insert = () => {
    if (empty) return;
    // 与公式库同一包裹口径（编号/行内），见 FormulaPanel.wrapFormula
    const body = formula.inline
      ? `$${latex}$`
      : formula.numbered
        ? `\\begin{equation}\n${latex}\n\\end{equation}`
        : `\\begin{equation*}\n${latex}\n\\end{equation*}`;
    if (!insertSnippetWithSlots(body)) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 1200);
    reset();
  };

  return (
    <div className="fbuilder">
      {/* 结构模板：同一种类只保留一个类别钮，点击展开该类结构（M1-11 反馈迭代，省空间） */}
      <div className="fbuilder-cats">
        {TPL_GROUPS.map((g) => {
          const open = openGroup === g;
          const names = TPLS.filter((t) => t.group === g).map((t) => t.name);
          return (
            <button
              key={g}
              type="button"
              className={open ? "fbuilder-cat is-open" : "fbuilder-cat"}
              title={open ? `收起「${g}」` : `「${g}」：${names.join(" / ")}`}
              onClick={() => setOpenGroup(open ? null : g)}
            >
              {g}
            </button>
          );
        })}
      </div>
      {openGroup ? (
        <div className="fbuilder-tpls">
          {TPLS.filter((t) => t.group === openGroup).map((t) => (
            <button
              key={t.id}
              type="button"
              className="fbuilder-tpl"
              title={`插入「${t.name}」到活动槽（${t.slotLabels.join(" / ")}）`}
              onClick={() => insertTpl(t.id)}
            >
              <span className="fbuilder-tpl-icon">{t.icon}</span>
              <span className="fbuilder-tpl-name">{t.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="fbuilder-tpls-hint">点击上方类别，展开该类公式结构</div>
      )}

      {/* 公式预览（主区）：KaTeX 实时渲染 + LaTeX 源码（空槽 \Box 渲染为空心方框，可点击选槽） */}
      <div className="fbuilder-preview">
        <div className="fbuilder-preview-fx">
          {empty ? (
            "（空公式）"
          ) : (
            <FormulaKaTeX
              tex={preview.tex}
              slots={preview.slotIds}
              activeSlot={active.id}
              onSlotClick={pickSlot}
            />
          )}
        </div>
        {!empty && <pre className="fbuilder-preview-src">{latex}</pre>}
      </div>

      {/* 公式树（缩进列表；点击槽位改选；活动行自动滚入可见） */}
      <div className="fbuilder-tree" ref={treeRef}>
        {empty ? (
          <div className="fbuilder-empty">
            点击上方类别展开模板，开始搭建{"\n"}空槽会以 \Box 带入编辑器
            <br />
            点预览里的方框可直接选槽，选后键盘输入
            <br />
            Tab 键在槽位间跳转
          </div>
        ) : (
          <NodeRow node={tree} depth={0} activeId={active.id} onPick={pickSlot} />
        )}
        {!empty && <SlotChildren slot={tree} depth={1} activeId={active.id} onPick={pickSlot} />}
      </div>

      {/* 符号条（填入活动槽） */}
      <div className="fbuilder-syms">
        {SYMS.map((s) => (
          <button
            key={s.cmd}
            type="button"
            className="fbuilder-sym"
            title={`填入 ${s.cmd}`}
            onClick={() => onSymClick(s.cmd)}
          >
            {s.glyph}
          </button>
        ))}
      </div>

      {/* 活动槽操作 */}
      <div className="fbuilder-actions">
        <input
          ref={inputRef}
          className="fbuilder-input"
          placeholder={`填入「${active.label}」，回车确认`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              fillText(text);
            }
          }}
        />
        <button type="button" className="fbuilder-btn" disabled={empty} onClick={clearActive}>
          清空槽
        </button>
        <button type="button" className="fbuilder-btn" disabled={empty} onClick={reset}>
          重建
        </button>
      </div>

      {/* 插入 */}
      <div className="fbuilder-actions">
        <button
          type="button"
          className="fbuilder-btn primary"
          style={{ flex: 1 }}
          disabled={empty}
          onClick={insert}
        >
          {flash ? "已插入 ✓" : `插入公式（${done}/${total} 槽已填）`}
        </button>
      </div>
    </div>
  );
}
