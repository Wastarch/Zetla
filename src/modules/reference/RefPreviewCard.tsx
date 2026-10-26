// M1-14g+ · 引用条目浮窗预览卡片（纯展示，无写操作）
// 左键点条目 → info 模式展示作者/标题/字段/来源；右键「查看反向引用」→ refs 模式列引用位置。
import type { BibEntry } from "./bibParser";

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

/** 去掉 BibTeX 值里的花括号并压平空白，便于阅读 */
function plain(s: string): string {
  return s.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export interface RefPreviewCardProps {
  entry: BibEntry;
  refs: { file: string; line: number }[];
  mode: "info" | "refs";
  left: number;
  top: number;
  onMode: (m: "info" | "refs") => void;
  onClose: () => void;
  onJump: (file: string, line: number) => void;
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
}: RefPreviewCardProps) {
  const extras = EXTRA_FIELDS.map((name) => ({ name, value: entry.fields[name] })).filter(
    (x): x is { name: string; value: string } => !!x.value,
  );

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
          {extras.length > 0 && (
            <dl className="ref-preview-fields">
              {extras.map((f) => (
                <div className="ref-preview-field" key={f.name}>
                  <dt>{f.name}</dt>
                  <dd>{plain(f.value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="ref-preview-foot">
            <span className="ref-preview-src" title={entry.file}>
              {entry.file.split(/[\\/]/).pop()}:{entry.line}
            </span>
            <span className="ref-preview-cites">
              {refs.length > 0 ? `被引用 ${refs.length} 次` : "未被引用"}
            </span>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
