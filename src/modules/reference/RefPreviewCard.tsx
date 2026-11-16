// M1-14g+ · 引用条目浮窗预览卡片（纯展示，无写操作）
// 左键点条目 → info 模式展示作者/标题/字段/来源；右键「查看反向引用」→ refs 模式列引用位置。
import type { BibEntry } from "./bibParser";
import {
  bibFieldUrl,
  plainBibValue,
  type ZoteroOpenTarget,
} from "@/modules/zotero/zoteroOpenTargets";
import { ZoteroOpenSplit } from "./ZoteroOpenSplit";
import { ZoteroCitationPane } from "./ZoteroCitationPane";

export type RefPreviewMode = "info" | "refs" | "cite";

/** P3-3：CSL 引文预览状态（父组件持有，卡片只渲染） */
export interface CitationPaneState {
  style: string;
  loading: boolean;
  error: string | null;
  bib: string;
  citation: string;
}

/** 摘要单独成块展示，不塞进下面的字段表 */
const ABSTRACT_FIELD = "abstract";
/** 预览中额外展示的字段（存在才显示） */
const EXTRA_FIELDS = [
  "journal",
  "booktitle",
  "publisher",
  "school",
  "institution",
  "organization",
  "volume",
  "number",
  "pages",
  "doi",
  "url",
];

/** 去掉 BibTeX 值里的花括号/常用命令并压平空白，便于阅读 */
function plain(s: string): string {
  return plainBibValue(s);
}

export interface RefPreviewCardProps {
  entry: BibEntry;
  refs: { file: string; line: number }[];
  mode: RefPreviewMode;
  left: number;
  top: number;
  onMode: (m: RefPreviewMode) => void;
  onClose: () => void;
  onJump: (file: string, line: number) => void;
  /** P3-1b：可选的「打开目标」分体按钮（由父组件注入，卡片保持纯展示） */
  onRun?: (target: ZoteroOpenTarget) => void;
  onOpenMenu?: (pos: { x: number; y: number }) => void;
  menuOpen?: boolean;
  busy?: boolean;
  /** P3-2：安全 http(s) 链接的打开回调（父组件负责 openUrl 与错误提示） */
  onOpenUrl?: (url: string) => void;
  /** P3-2：在 Zetla 内嵌预览该条目的 PDF 附件 */
  onPreviewPdf?: () => void;
  pdfBusy?: boolean;
  /** P3-3：CSL 引文预览（切换到「引文」页签时由父组件拉取） */
  cite?: CitationPaneState;
  onCiteStyle?: (id: string) => void;
  onCopyCitation?: (kind: "citation" | "bib") => void;
  /** P3-4：把当前 CSL 样式应用到主文档导言区（父组件弹确认窗） */
  onApplyPreamble?: () => void;
}

export function RefPreviewCard({
  entry,
  refs,
  mode,
  left,
  top,
  onMode,
  onClose,
  onJump,
  onRun,
  onOpenMenu,
  menuOpen,
  busy,
  onOpenUrl,
  onPreviewPdf,
  pdfBusy,
  cite,
  onCiteStyle,
  onCopyCitation,
  onApplyPreamble,
}: RefPreviewCardProps) {
  const extras = EXTRA_FIELDS.map((name) => ({ name, value: entry.fields[name] })).filter(
    (x): x is { name: string; value: string } => !!x.value,
  );
  const abstract = plainBibValue(entry.fields[ABSTRACT_FIELD] ?? "");

  return (
    <div
      className="ref-preview"
      style={{ left, top }}
      role="dialog"
      aria-label="引用预览"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ref-preview-head">
        <span className="ref-preview-key">{entry.key}</span>
        <span className="ref-preview-type">@{entry.type}</span>
        <button type="button" className="ref-preview-close" title="关闭" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="ref-preview-tabs">
        <button
          type="button"
          className={mode === "info" ? "ref-preview-tab active" : "ref-preview-tab"}
          onClick={() => onMode("info")}
        >
          预览
        </button>
        <button
          type="button"
          className={mode === "refs" ? "ref-preview-tab active" : "ref-preview-tab"}
          onClick={() => onMode("refs")}
        >
          反向引用{refs.length > 0 ? ` ${refs.length}` : ""}
        </button>
        <button
          type="button"
          className={mode === "cite" ? "ref-preview-tab active" : "ref-preview-tab"}
          title="按 CSL 样式预览引文与参考文献（不改变正文 LaTeX 样式）"
          onClick={() => onMode("cite")}
        >
          引文
        </button>
      </div>

      {mode === "info" ? (
        <div className="ref-preview-body">
          {(entry.author || entry.year) && (
            <div className="ref-preview-author">
              {plain(entry.author ?? "—")}
              {entry.year ? ` (${entry.year})` : ""}
            </div>
          )}
          {entry.title && <div className="ref-preview-title">{plain(entry.title)}</div>}
          {abstract && (
            <div className="ref-preview-abstract" title={abstract}>
              <span className="ref-preview-abstract-label">摘要</span>
              <span className="ref-preview-abstract-text">{abstract}</span>
            </div>
          )}
          {onPreviewPdf && (
            <button
              type="button"
              className="ref-preview-pdf"
              disabled={!!pdfBusy}
              title="从 Zotero 附件读取 PDF，在 Zetla 内嵌预览（只读）"
              onClick={(e) => {
                e.stopPropagation();
                onPreviewPdf();
              }}
            >
              {pdfBusy ? "读取附件中…" : "在 Zetla 中预览 PDF"}
            </button>
          )}
          {extras.length > 0 && (
            <dl className="ref-preview-fields">
              {extras.map((f) => {
                const link = bibFieldUrl(f.name, f.value);
                return (
                  <div className="ref-preview-field" key={f.name}>
                    <dt>{f.name}</dt>
                    <dd>
                      {link && onOpenUrl ? (
                        <button
                          type="button"
                          className="ref-preview-link"
                          title={`在浏览器打开 ${link}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenUrl(link);
                          }}
                        >
                          {plain(f.value)}
                        </button>
                      ) : (
                        plain(f.value)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          <div className="ref-preview-foot">
            <span className="ref-preview-src" title={entry.file}>
              {entry.file.split(/[\\/]/).pop()}:{entry.line}
            </span>
            {onRun && onOpenMenu && (
              <ZoteroOpenSplit
                variant="card"
                busy={!!busy}
                menuOpen={menuOpen}
                onRun={onRun}
                onOpenMenu={onOpenMenu}
              />
            )}
            <span className="ref-preview-cites">
              {refs.length > 0 ? `被引用 ${refs.length} 次` : "未被引用"}
            </span>
          </div>
        </div>
      ) : mode === "refs" ? (
        <div className="ref-preview-body">
          {refs.length === 0 ? (
            <div className="ref-rev-empty">未被任何 .tex 引用</div>
          ) : (
            <div className="ref-rev">
              {refs.map((r, i) => (
                <button
                  type="button"
                  className="ref-rev-item"
                  key={`${r.file}:${r.line}:${i}`}
                  title={r.file}
                  onClick={() => onJump(r.file, r.line)}
                >
                  <span className="ref-rev-file">{r.file.split(/[\\/]/).pop()}</span>
                  <span className="ref-rev-line">:{r.line}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="ref-preview-body">
          {cite && onCiteStyle && onCopyCitation ? (
            <ZoteroCitationPane
              style={cite.style}
              loading={cite.loading}
              error={cite.error}
              bib={cite.bib}
              citation={cite.citation}
              onStyle={onCiteStyle}
              onCopy={onCopyCitation}
              onApplyPreamble={onApplyPreamble}
            />
          ) : (
            <div className="zo-cite-empty">Zotero 联动未接入，无法预览引文</div>
          )}
        </div>
      )}
    </div>
  );
}
