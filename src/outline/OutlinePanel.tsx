// M1-5 · 大纲导航面板
// M1-28 · 移入资源管理器底部：可折叠、顶部拖拽调高、⋯ 更多菜单；不再是独立侧栏视图。
// 点击条目 → M0-12 的 jumpToError 打开/切标签并跳到对应行（含 \input 子文件）。
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useProjectStore, notify } from "@/project/useProject";
import { useAppStore } from "@/core/store";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { Chevron } from "@/ui/Chevron";
import { OUTLINE_H_DEFAULT, OUTLINE_HEAD_H, clampOutlineHeight } from "./outlineLayout";
import { useOutlineStore, base, type OutlineItem } from "./useOutline";
import { jumpToError } from "@/editor/jump";

export function OutlinePanel() {
  const root = useProjectStore((s) => s.root);
  const mainFile = useProjectStore((s) => s.tree?.mainFile ?? null);
  const previewRev = useAppStore((s) => s.previewRev);
  const expanded = useAppStore((s) => s.outlineExpanded);
  const height = useAppStore((s) => s.outlineHeight);
  const toggleOutline = useAppStore((s) => s.toggleOutline);
  const setOutlineHeight = useAppStore((s) => s.setOutlineHeight);
  // M1-40：与上方「构建文件」面板互相扣减占用，保证项目树至少留 MIN_TREE_H
  const buildFilesExpanded = useAppStore((s) => s.buildFilesExpanded);
  const buildFilesHeight = useAppStore((s) => s.buildFilesHeight);
  const { items, loading, error, manualRev, recompute, refresh } = useOutlineStore();

  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ y: number; h: number } | null>(null);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (root && mainFile) void recompute(root, mainFile);
  }, [root, mainFile, previewRev, manualRev]);

  // 顶部横线拖拽改高度：上拖变高；clamp 保证项目树至少留 120px。
  // 拖拽中不写盘，useWindowMemory 的 layoutKey + 500ms 防抖负责持久化。
  const onResizeDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { y: e.clientY, h: height };
      setDragging(true);
      document.body.classList.add("row-resizing");
    },
    [height],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const sidebarH = sectionRef.current?.parentElement?.clientHeight ?? window.innerHeight - 100;
      const otherH = buildFilesExpanded ? buildFilesHeight : OUTLINE_HEAD_H;
      setOutlineHeight(clampOutlineHeight(d.h - (e.clientY - d.y), sidebarH, otherH));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove("row-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("row-resizing");
    };
  }, [dragging, setOutlineHeight, buildFilesExpanded, buildFilesHeight]);

  // 窗口变小时兜底：记忆的高度不得超过当前侧栏可容纳上限（同 LogPanel 口径，另加 resize 监听）
  useEffect(() => {
    const clamp = () => {
      const sidebarH = sectionRef.current?.parentElement?.clientHeight ?? window.innerHeight - 100;
      const otherH = buildFilesExpanded ? buildFilesHeight : OUTLINE_HEAD_H;
      const c = clampOutlineHeight(height, sidebarH, otherH);
      if (c !== height) setOutlineHeight(c);
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [height, setOutlineHeight, buildFilesExpanded, buildFilesHeight]);

  const onJump = (it: OutlineItem) => jumpToError(it.file, it.line);

  const onMore = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMore({ x: r.right, y: r.bottom + 2 });
  };
  const moreActions: CtxAction[] = [
    {
      label: "重新扫描",
      disabled: !root || !mainFile,
      onClick: () => {
        setMore(null);
        void refresh();
      },
    },
    {
      label: "复制大纲为文本",
      disabled: items.length === 0,
      onClick: () => {
        setMore(null);
        const text = items
          .map(
            (it) =>
              `${LEVEL_DOT[it.level] ?? "·"} ${it.title || "(无标题)"}\t${base(it.file)}:${it.line}`,
          )
          .join("\n");
        void navigator.clipboard
          .writeText(text)
          .then(() => notify("大纲已复制到剪贴板"))
          .catch(() => notify("复制失败", "err"));
      },
    },
    {
      label: expanded ? "折叠此区" : "展开此区",
      onClick: () => {
        setMore(null);
        toggleOutline();
      },
    },
    {
      label: "重置高度为默认",
      onClick: () => {
        setMore(null);
        setOutlineHeight(OUTLINE_H_DEFAULT);
      },
    },
  ];

  return (
    <div
      ref={sectionRef}
      className={`outline${expanded ? "" : " collapsed"}${dragging ? " dragging" : ""}`}
      style={{ height: expanded ? height : OUTLINE_HEAD_H }}
    >
      {expanded && (
        <div
          className="outline-resizer"
          title="拖拽调整大纲区高度"
          onPointerDown={onResizeDown}
        />
      )}
      <div className="outline-head">
        <button
          type="button"
          className="outline-caret"
          title={expanded ? "折叠大纲" : "展开大纲"}
          onClick={toggleOutline}
        >
          <Chevron open={expanded} />
        </button>
        <span className="outline-title">大纲</span>
        <span className="outline-count">{items.length ? `· ${items.length}` : ""}</span>
        <span className="outline-spacer" />
        <button
          type="button"
          className="outline-refresh"
          title="重新扫描章节结构"
          onClick={() => void refresh()}
        >
          ⟳
        </button>
        <button type="button" className="outline-more" title="更多操作" onClick={onMore}>
          ⋯
        </button>
      </div>

      {expanded && (
        <>
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
        </>
      )}

      {more && (
        <InsertCtxMenu
          x={more.x}
          y={more.y}
          actions={moreActions}
          onClose={() => setMore(null)}
        />
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
