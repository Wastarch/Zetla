// P3-4 · 「应用到导言区」确认弹窗（纯展示：预览 diff，确认后由父组件落笔）
//
// 只改导言区一处 \bibliographystyle / biblatex style；弹窗里明确三件事：
//   改哪个文件、改哪一行、改前改后各是什么。不提供「自动重新编译」，避免误触发长编译。
import { useEffect } from "react";
import type { BibEngine } from "@/modules/zotero/zoteroStyleMap";
import { engineLabel } from "@/modules/zotero/zoteroStyleMap";

export interface ZoteroStyleApplyDialogProps {
  fileName: string;
  engine: BibEngine;
  /** CSL 展示名（用户在下拉里选的那个） */
  styleLabel: string;
  /** 目标 LaTeX 样式名（bst 参数 / biblatex style 值） */
  target: string;
  line?: number;
  before?: string;
  after?: string;
  /** 映射依赖说明（缺宏包时提示） */
  note?: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ZoteroStyleApplyDialog({
  fileName,
  engine,
  styleLabel,
  target,
  line,
  before,
  after,
  note,
  busy,
  onConfirm,
  onClose,
}: ZoteroStyleApplyDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="zo-style-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="zo-style-dialog" role="dialog" aria-label="应用到 LaTeX 导言区">
        <div className="zo-style-title">应用到 LaTeX 导言区</div>
        <div className="zo-style-meta">
          <span title={fileName}>{fileName}</span>
          <span className="zo-style-dot">·</span>
          <span>{engineLabel(engine)}</span>
          <span className="zo-style-dot">·</span>
          <span>
            {styleLabel} → <code>{target}</code>
          </span>
        </div>

        {before !== undefined && after !== undefined ? (
          <pre className="zo-style-diff">
            <span className="zo-style-old">{`- ${line ? `第 ${line} 行：` : ""}${before}`}</span>
            {"\n"}
            <span className="zo-style-new">{`+ ${line ? `第 ${line} 行：` : ""}${after}`}</span>
          </pre>
        ) : (
          <div className="zo-style-diff zo-style-empty">未生成补丁预览</div>
        )}

        <div className="zo-style-note">
          只改导言区这一处，可用 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销；不会自动重新编译。
          {note ? <div className="zo-style-hint">{note}</div> : null}
        </div>

        <div className="zo-style-actions">
          <button type="button" className="zo-style-cancel" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="zo-style-ok" onClick={onConfirm} disabled={busy}>
            {busy ? "写入中…" : "应用到导言区"}
          </button>
        </div>
      </div>
    </div>
  );
}
