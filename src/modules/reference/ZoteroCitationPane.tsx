// P3-3 · 引用卡片「引文」页签（纯展示：数据与动作由父组件注入）
//
// 只做 CSL 预览 / 复制：Zotero 本地 API 按样式返回 bib + citation，
// 正文最终样式仍由 .bst / biblatex 决定，这里不写 .tex、不改 preamble。
import { CSL_STYLES, cslStyleLabel } from "@/modules/zotero/zoteroCitation";

export interface ZoteroCitationPaneProps {
  /** 当前样式 id（已归一） */
  style: string;
  loading: boolean;
  error: string | null;
  /** 参考文献条目（纯文本） */
  bib: string;
  /** 文内引文（纯文本） */
  citation: string;
  onStyle: (id: string) => void;
  onCopy: (kind: "citation" | "bib") => void;
}

function CopyButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="zo-cite-copy"
      disabled={disabled}
      title={disabled ? "暂无可复制内容" : `复制${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      复制
    </button>
  );
}

export function ZoteroCitationPane({
  style,
  loading,
  error,
  bib,
  citation,
  onStyle,
  onCopy,
}: ZoteroCitationPaneProps) {
  const hasCitation = !!citation;
  const hasBib = !!bib;

  return (
    <div className="zo-cite">
      <div className="zo-cite-head">
        <select
          className="zo-cite-style"
          value={style}
          title="CSL 样式：只影响这里的预览与复制，不改变正文 LaTeX 样式"
          onChange={(e) => onStyle(e.target.value)}
        >
          {CSL_STYLES.map((s) => (
            <option key={s.id} value={s.id} title={s.note}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="zo-cite-badge" title={`Zotero 样式 id：${style}`}>
          仅预览
        </span>
      </div>

      {loading ? (
        <div className="zo-cite-empty">正在向 Zotero 取引文…</div>
      ) : error ? (
        <div className="zo-cite-error">{error}</div>
      ) : (
        <>
          <div className="zo-cite-block">
            <div className="zo-cite-label">
              <span>文内引文</span>
              <CopyButton
                label="引文"
                disabled={!hasCitation}
                onClick={() => onCopy("citation")}
              />
            </div>
            <div className="zo-cite-text">{hasCitation ? citation : "—"}</div>
          </div>
          <div className="zo-cite-block">
            <div className="zo-cite-label">
              <span>参考文献</span>
              <CopyButton label="参考文献" disabled={!hasBib} onClick={() => onCopy("bib")} />
            </div>
            <div className="zo-cite-text">{hasBib ? bib : "—"}</div>
          </div>
        </>
      )}

      <div className="zo-cite-foot">
        CSL 只用于预览/复制（{cslStyleLabel(style)}）；正文样式仍由
        <code>\bibliographystyle</code> 或 biblatex 决定。
      </div>
    </div>
  );
}
