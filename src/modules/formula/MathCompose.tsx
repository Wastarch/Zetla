// M1-12a · 编写区（输入区域主体）：多行 LaTeX 源码编辑 + 可视化可编辑
// M1-12b：
// - 选区模型：onSelect/点击/键入都同步 selStart/selEnd
// - 真相源：composeStore.text（含 \Box 空槽），不新建节点树
// - 源码模式：上 textarea + 下 KaTeX 实时渲染（只读预览，点空槽仅定位光标）
// - 可视化模式：隐藏但可聚焦的 textarea 承载输入，公式可见渲染为主编辑面；
//   点 \Box 选中该槽（首键即替换）、Tab 在槽间循环、活动槽高亮 —— 轻量插槽式 WYSIWYG
// - Ctrl+Enter → mathInsert.submitCompose() 提交到主编辑器
import { useEffect, useMemo, useRef } from "react";
import FormulaKaTeX from "./FormulaKaTeX";
import { useComposeStore } from "./composeStore";
import { SLOT_MARK, SLOT_RE } from "@/editor/slotRange";
import { activeSlotFromSelection, boxOffset, serializeSlotsText, slotIdIndex } from "./mathTex";
import { copyCompose, submitCompose, updateCompose } from "./mathInsert";

export default function MathCompose() {
  const text = useComposeStore((s) => s.text);
  const selStart = useComposeStore((s) => s.selStart);
  const selEnd = useComposeStore((s) => s.selEnd);
  const cursorSeq = useComposeStore((s) => s.cursorSeq);
  const mode = useComposeStore((s) => s.mode);
  const fontSize = useComposeStore((s) => s.fontSize);
  const editTarget = useComposeStore((s) => s.editTarget);
  const setEditTarget = useComposeStore((s) => s.setEditTarget);
  const edit = useComposeStore((s) => s.edit);
  const setSelection = useComposeStore((s) => s.setSelection);
  const setCursor = useComposeStore((s) => s.setCursor);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);

  // 程序化选区同步（点预览空槽 / insert / wrapSelection 后）：
  // IME 组词期间不碰选区（会打断输入法）；值与现值一致时跳过，不与用户抢夺光标。
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || composing.current) return;
    const a = Math.min(Math.max(selStart, 0), text.length);
    const b = Math.min(Math.max(selEnd, a), text.length);
    if (ta.selectionStart !== a || ta.selectionEnd !== b) {
      ta.setSelectionRange(a, b);
    }
  }, [cursorSeq, selStart, selEnd, text]);

  // 进入可视化模式：聚焦隐藏 textarea，确保立即可输入
  useEffect(() => {
    if (mode === "visual") taRef.current?.focus();
  }, [mode]);

  const syncSelection = () => {
    const ta = taRef.current;
    if (ta) setSelection(ta.selectionStart, ta.selectionEnd);
  };

  // 点空槽：源码下区预览 → 仅定位光标（不切模式）；可视化主编辑面 → 选中 \Box（首键替换）+ 聚焦
  const onSlotClick = (id: string) => {
    const idx = slotIdIndex(id);
    if (idx < 0) return;
    const pos = boxOffset(text, idx);
    if (pos < 0) return;
    if (mode === "visual") {
      setSelection(pos, pos + SLOT_MARK.length);
      taRef.current?.focus();
    } else {
      setCursor(pos);
      taRef.current?.focus();
    }
  };

  // 可视化：Tab 在 \Box 间循环跳转（选中该槽，首键即替换）
  const jumpToNextSlot = () => {
    const len = text.length;
    const from = Math.min(Math.max(selStart, 0), len);
    let found = -1;
    SLOT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SLOT_RE.exec(text)) !== null) {
      if (m.index > from) {
        found = m.index;
        break;
      }
    }
    if (found < 0) {
      SLOT_RE.lastIndex = 0;
      const first = SLOT_RE.exec(text);
      if (first) found = first.index;
    }
    if (found >= 0) {
      setSelection(found, found + SLOT_MARK.length);
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mode === "visual" && e.key === "Tab") {
      e.preventDefault();
      jumpToNextSlot();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      // M1-19：编辑既有公式时提交 = 原地更新（指纹校验）；否则插入光标处
      if (editTarget) updateCompose();
      else submitCompose();
    }
  };

  // 活动槽（可视化模式）：光标/选区落在某 \Box 上 → 高亮对应方框
  const activeSlot = useMemo(
    () => (mode === "visual" ? activeSlotFromSelection(text, selStart, selEnd) : null),
    [mode, text, selStart, selEnd],
  );

  const { tex, slotIds } = serializeSlotsText(text);
  const empty = text.trim() === "";

  return (
    <div className={mode === "visual" ? "math-compose mode-visual" : "math-compose"}>
      {/* 始终挂载同一 textarea：源码可见（上）；可视化 sr-only 隐藏但可聚焦承载输入 */}
      <textarea
        ref={taRef}
        className={mode === "visual" ? "math-compose-ta vis-hidden" : "math-compose-ta"}
        style={{ fontSize }}
        placeholder="请输入您的 LaTeX 表达式"
        spellCheck={false}
        value={text}
        onChange={(e) => edit(e.target.value, e.target.selectionStart, e.target.selectionEnd)}
        onSelect={syncSelection}
        onKeyUp={syncSelection}
        onClick={syncSelection}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          syncSelection();
        }}
        onKeyDown={onKeyDown}
      />

      {empty ? (
        <div
          className="math-compose-render math-compose-render-empty"
          onClick={() => mode === "visual" && taRef.current?.focus()}
        >
          {mode === "visual" ? "（空公式，点此或切到源码开始输入）" : "LaTeX"}
        </div>
      ) : (
        <div
          className="math-compose-render"
          style={{ fontSize }}
          onClick={() => mode === "visual" && taRef.current?.focus()}
        >
          <FormulaKaTeX
            tex={tex}
            display
            slots={slotIds}
            activeSlot={activeSlot}
            onSlotClick={onSlotClick}
          />
        </div>
      )}

      <div className="math-compose-actions">
        {editTarget ? (
          <>
            <div className="math-compose-editing">
              正在编辑源码中的公式（{editTarget.from}–{editTarget.to}），「更新公式」指纹校验通过后原地替换
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={empty}
              title="写回源码原位置（Ctrl+Enter）"
              onClick={() => updateCompose()}
            >
              更新公式
            </button>
            <button
              type="button"
              className="btn"
              title="退出编辑态，保留编写区内容（变回新建模式）"
              onClick={() => setEditTarget(null)}
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={empty}
            title="插入到编辑器光标处（Ctrl+Enter）"
            onClick={() => submitCompose()}
          >
            插入编辑器
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={empty}
          title="复制 LaTeX 源码"
          onClick={() => void copyCompose()}
        >
          复制 LaTeX
        </button>
      </div>
    </div>
  );
}
