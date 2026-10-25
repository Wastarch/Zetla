// M1-12a · 编写区（输入区域主体）：多行 LaTeX 源码编辑
// M1-12b：
// - 选区模型：onSelect/点击/键入都同步 selStart/selEnd（不再折叠拖拽选区——
//   工具栏的「字体/字号/环境」要包裹选区，符号插入要替换选区）
// - 源码/可视化双模式：源码 = textarea；可视化 = KaTeX 只读渲染（点空槽切回源码并定位光标）
// - Ctrl+Enter → mathInsert.submitCompose() 提交到主编辑器
import { useEffect, useRef } from "react";
import FormulaKaTeX from "./FormulaKaTeX";
import { useComposeStore } from "./composeStore";
import { boxOffset, serializeSlotsText, slotIdIndex } from "./mathTex";
import { submitCompose } from "./mathInsert";

export default function MathCompose() {
  const text = useComposeStore((s) => s.text);
  const selStart = useComposeStore((s) => s.selStart);
  const selEnd = useComposeStore((s) => s.selEnd);
  const cursorSeq = useComposeStore((s) => s.cursorSeq);
  const mode = useComposeStore((s) => s.mode);
  const fontSize = useComposeStore((s) => s.fontSize);
  const edit = useComposeStore((s) => s.edit);
  const setSelection = useComposeStore((s) => s.setSelection);
  const setCursor = useComposeStore((s) => s.setCursor);
  const setMode = useComposeStore((s) => s.setMode);
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

  const syncSelection = () => {
    const ta = taRef.current;
    if (ta) setSelection(ta.selectionStart, ta.selectionEnd);
  };

  // 可视化模式：点空槽 → 切回源码并把光标放回该 \Box（看得见才能改）
  const onSlotClick = (id: string) => {
    const idx = slotIdIndex(id);
    if (idx < 0) return;
    const pos = boxOffset(text, idx);
    if (pos < 0) return;
    setMode("source");
    setCursor(pos);
  };

  const { tex, slotIds } = serializeSlotsText(text);
  const empty = text.trim() === "";

  return (
    <div className="math-compose">
      {mode === "visual" ? (
        <div className="math-compose-fx" style={{ fontSize }}>
          {empty ? (
            <span className="math-compose-fx-empty">（空公式，切到源码开始输入）</span>
          ) : (
            <FormulaKaTeX tex={tex} display slots={slotIds} onSlotClick={onSlotClick} />
          )}
          <span className="math-compose-fx-hint">可视化预览 · 点击空槽切回源码编辑</span>
        </div>
      ) : (
        <textarea
          ref={taRef}
          className="math-compose-ta"
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submitCompose();
            }
          }}
        />
      )}
      {mode === "source" && !text && <span className="math-compose-wm">LaTeX</span>}
    </div>
  );
}
