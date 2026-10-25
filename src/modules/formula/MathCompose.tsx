// M1-12a · 编写区（输入区域主体）：多行 LaTeX 源码编辑
// - 符号/模板点击 → composeStore.insert() 写入光标处（M1-12b 接通符号面板）
// - Ctrl+Enter → mathInsert.submitCompose() 提交到主编辑器
// - 光标变更经 cursorSeq 同步（点输出区空槽 → 编写区选中对应 \Box，MathType 式）
import { useEffect, useRef } from "react";
import { useComposeStore } from "./composeStore";
import { submitCompose } from "./mathInsert";

export default function MathCompose() {
  const text = useComposeStore((s) => s.text);
  const cursor = useComposeStore((s) => s.cursor);
  const cursorSeq = useComposeStore((s) => s.cursorSeq);
  const fontSize = useComposeStore((s) => s.fontSize);
  const setText = useComposeStore((s) => s.setText);
  const setCursor = useComposeStore((s) => s.setCursor);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 程序化光标定位（点预览空槽 / insert 后）：同步选区到光标处。
  // 用户自身输入也会走 setCursor，此时目标位与选区一致 → 比较后跳过，不抢夺光标。
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const c = Math.min(Math.max(cursor, 0), text.length);
    if (ta.selectionStart !== c || ta.selectionEnd !== c) {
      ta.setSelectionRange(c, c);
    }
  }, [cursorSeq, cursor, text]);

  // 仅在选区折叠（纯光标）时同步——拖拽/Shift 方向键选中的文字不折叠，
  // 否则 onClick（拖选完毕也会触发 click）会把用户选区抹成光标。
  const syncCursor = () => {
    const ta = taRef.current;
    if (ta && ta.selectionStart === ta.selectionEnd) setCursor(ta.selectionStart);
  };

  return (
    <div className="math-compose">
      <textarea
        ref={taRef}
        className="math-compose-ta"
        style={{ fontSize }}
        placeholder="请输入您的 LaTeX 表达式"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCursor(e.target.selectionStart);
        }}
        onSelect={syncCursor}
        onKeyUp={syncCursor}
        onClick={syncCursor}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submitCompose();
          }
        }}
      />
      {!text && <span className="math-compose-wm">LaTeX</span>}
    </div>
  );
}
