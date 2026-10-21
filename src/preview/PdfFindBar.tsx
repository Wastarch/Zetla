// M0-10b · PDF 查找条（Ctrl+F）
import { useEffect, useRef } from "react";
import { Icon } from "@/ui/Icon";

export interface PdfFindBarProps {
  query: string;
  onQuery: (q: string) => void;
  /** 1-based 当前序号；无结果时为 0 */
  current: number;
  total: number;
  scanning: boolean;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function PdfFindBar({
  query,
  onQuery,
  current,
  total,
  scanning,
  onNext,
  onPrev,
  onClose,
}: PdfFindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="pv-find">
      <Icon name="search" style={{ color: "var(--txt-3)" }} />
      <input
        ref={inputRef}
        value={query}
        placeholder="在 PDF 中查找"
        aria-label="在 PDF 中查找"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="count">
        {scanning ? "检索中…" : total > 0 ? `${current}/${total}` : query.trim() ? "0/0" : ""}
      </span>
      <button
        type="button"
        className="ibtn"
        title="上一处（Shift+Enter）"
        disabled={total === 0}
        onClick={onPrev}
      >
        <Icon name="chev" style={{ transform: "rotate(180deg)" }} />
      </button>
      <button
        type="button"
        className="ibtn"
        title="下一处（Enter）"
        disabled={total === 0}
        onClick={onNext}
      >
        <Icon name="chev" />
      </button>
      <button type="button" className="ibtn" title="关闭（Esc）" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export default PdfFindBar;
