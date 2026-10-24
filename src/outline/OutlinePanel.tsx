// M1-5 · 大纲导航面板（侧栏「大纲」区）
// 点击条目 → M0-12 的 jumpToError 打开/切标签并跳到对应行（含 \input 子文件）。
import { useEffect } from "react";
import { useProjectStore } from "@/project/useProject";
import { useAppStore } from "@/core/store";
import { useOutlineStore, base, type OutlineItem } from "./useOutline";
import { jumpToError } from "@/editor/jump";

export function OutlinePanel() {
  const root = useProjectStore((s) => s.root);
  const mainFile = useProjectStore((s) => s.tree?.mainFile ?? null);
  const previewRev = useAppStore((s) => s.previewRev);
  const { items, loading, error, manualRev, recompute, refresh } = useOutlineStore();

  useEffect(() => {
    if (root && mainFile) void recompute(root, mainFile);
  }, [root, mainFile, previewRev, manualRev]);

  const onJump = (it: OutlineItem) => jumpToError(it.file, it.line);

  return (
    <div className="outline">
      <div className="outline-head">
        <span className="outline-title">大纲</span>
        <span className="outline-count">{items.length ? `· ${items.length}` : ""}</span>
        <button
          className="outline-refresh"
          title="重新扫描章节结构"
          onClick={() => refresh()}
        >
          ⟳
        </button>
      </div>

      {!root || !mainFile ? (
        <div className="outline-empty">打开项目后显示大纲</div>
      ) : loading ? (
        <div className="outline-empty">扫描中…</div>
      ) : error ? (
        <div className="outline-empty outline-err">扫描失败：{error}</div>
      ) : items.length === 0 ? (
        <div className="outline-empty">未找到章节结构</div>
      ) : (
        <div className="outline-list">
          {items.map((it, i) => (
            <div
              key={`${it.file}#${it.line}#${i}`}
              className="outline-item"
              style={{ paddingLeft: 8 + it.depth * 12 }}
              title={`${base(it.file)} : ${it.line}`}
              onClick={() => onJump(it)}
            >
              <span className="outline-mark">{LEVEL_DOT[it.level] ?? "·"}</span>
              <span className="outline-text">{it.title || "(无标题)"}</span>
              {it.file !== mainFile && (
                <span className="outline-file">{base(it.file)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 层级前导标记（part/chapter/section… 用不同符号帮助快速辨识） */
const LEVEL_DOT: Record<number, string> = {
  0: "◉", // part
  1: "§", // chapter
  2: "▪", // section
  3: "–", // subsection
  4: "·", // subsubsection
  5: "›", // paragraph
  6: "»", // subparagraph
};

export default OutlinePanel;
