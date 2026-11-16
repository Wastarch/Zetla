// P9 · 「切换参考文献格式」确认弹窗（纯展示：预览字段改名 + 导言区 diff，确认后由调用方落笔）
//
// 明确四件事：目标格式、改哪个 .bib（字段改名摘要）、改哪个 .tex（导言区 before/after）、
// 是否可撤销。不提供「自动重新编译」，避免误触发长编译。
import { useEffect } from "react";
import type { BibFormatSwitchPreview } from "@/modules/zotero/zoteroRuntime";
import { engineLabel } from "@/modules/zotero/zoteroStyleMap";

export interface BibFormatSwitchDialogProps {
  preview: BibFormatSwitchPreview;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function baseName(p: string | null): string {
  if (!p) return "—";
  return p.split(/[\\/]/).pop() ?? p;
}

export function BibFormatSwitchDialog({
  preview,
  busy,
  onConfirm,
  onClose,
}: BibFormatSwitchDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const { bib, engine, from, target, bibPath, texPath } = preview;
  const renameCount = bib ? Object.keys(bib.renamed).length : 0;
  const conflictCount = bib
    ? Object.values(bib.conflicts).reduce((n, a) => n + a.length, 0)
    : 0;
  const renameSample = bib
    ? Object.values(bib.renamed).flat().slice(0, 8)
    : [];

  return (
    <div
      className="zo-style-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="zo-style-dialog" role="dialog" aria-label="切换参考文献格式">
        <div className="zo-style-title">切换参考文献格式</div>
        <div className="zo-style-meta">
          <span>{from ? engineLabel(from) : "未识别"}</span>
          <span className="zo-style-dot">→</span>
          <span>
            <code>{target}</code>
          </span>
        </div>

        <div className="zo-fmt-block">
          <b>.bib 字段转换</b>
          <span title={bibPath ?? ""}>{baseName(bibPath)}</span>
          {renameCount > 0 ? (
            <>
              <div className="zo-fmt-changes">
                {renameSample.map((s, i) => (
                  <code key={i}>{s}</code>
                ))}
                {renameCount > 0 && renameSample.length >= 8 && <span>…</span>}
              </div>
              <div className="zo-style-hint">
                共 {renameCount} 条条目字段改名；citekey、值、手写字段（note / eprint 等）原样保留。
                {conflictCount > 0 && ` ${conflictCount} 处目标字段已存在，将保留不覆盖。`}
              </div>
            </>
          ) : (
            <div className="zo-style-hint">没有需要改名的字段（已是目标格式，或 .bib 未读到）。</div>
          )}
        </div>

        {engine && !engine.noop && engine.edits.length > 0 ? (
          <div className="zo-fmt-block">
            <b>导言区</b>
            <span title={texPath ?? ""}>{baseName(texPath)}</span>
            <pre className="zo-style-diff">
              {engine.before.map((s, i) => (
                <span className="zo-style-old" key={`b${i}`}>{`- ${s}`}</span>
              ))}
              {engine.before.length > 0 && engine.after.length > 0 && "\n"}
              {engine.after.map((s, i) => (
                <span className="zo-style-new" key={`a${i}`}>{`+ ${s}`}</span>
              ))}
            </pre>
          </div>
        ) : (
          <div className="zo-fmt-block">
            <b>导言区</b>
            <span className="zo-style-hint">
              {engine?.noop ? "已是目标引擎，无需改动。" : "未找到可替换的声明（请手动调整导言区）。"}
            </span>
          </div>
        )}

        <div className="zo-style-note">
          导言区改动可用 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销；.bib 字段改名写入文件（保留 citekey）。
          不会自动重新编译，请确认后自行编译验证。
        </div>

        <div className="zo-style-actions">
          <button type="button" className="zo-style-cancel" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="zo-style-ok" onClick={onConfirm} disabled={busy}>
            {busy ? "切换中…" : "确认切换"}
          </button>
        </div>
      </div>
    </div>
  );
}
