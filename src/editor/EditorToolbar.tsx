// M1 · 编辑器快捷操作工具栏（Overleaf 风格；位于 TabBar 之下、代码区之上）
// 左侧：文本格式组（加粗 / 斜体 / 下划线 / 删除线）
// 中间：插入功能组（链接 / 图片 / 无序列表 / 公式 / 表格）
// 右侧：章节结构组（章节下拉：chapter / section / subsection …；复用 .ctx 弹层）
// 命令经 src/editor/activeView.ts 的 getActiveView() 派发到当前活动 CM 视图，多标签自动跟随。
// （按需求未纳入 Code/Visual 段控与查找按钮）
import { useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "@/ui/Icon";
import { wrapSelection, insertSnippetSelect } from "@/core/moduleRegistry";
import { getActiveView } from "@/editor/activeView";
import { importImageFromPaths } from "@/editor/image/importImage";
import { useAppStore } from "@/core/store";
import { useBuffersStore } from "@/editor/useBuffers";
import { EXT_IMG } from "@/project/useProject";
import { InsertCtxMenu } from "@/ui/InsertCtxMenu";

// 无序列表片段；光标落在 \item 之后（空项就绪）
const ITEMIZE = "\\begin{itemize}\n  \\item\n\\end{itemize}";

// 章节层级（下拉菜单项）；插入 `\cmd{}` 并让光标落在花括号内
// size/weight 逐级递减，模拟 LaTeX 各级标题的真实观感（对齐 Overleaf 章节菜单）
const SECTION_LEVELS: {
  label: string;
  cmd: string;
  size: number;
  weight: number;
}[] = [
  { label: "Chapter", cmd: "\\chapter", size: 18, weight: 800 },
  { label: "Section", cmd: "\\section", size: 16, weight: 700 },
  { label: "Subsection", cmd: "\\subsection", size: 14.5, weight: 700 },
  { label: "Subsubsection", cmd: "\\subsubsection", size: 13, weight: 600 },
  { label: "Paragraph", cmd: "\\paragraph", size: 12, weight: 600 },
  { label: "Subparagraph", cmd: "\\subparagraph", size: 11, weight: 500 },
];

export function EditorToolbar() {
  const activeKind = useBuffersStore(
    (s) => s.buffers.find((b) => b.path === s.activePath)?.kind ?? null,
  );
  const canEdit = activeKind === "text";

  // 章节下拉锚点与开关
  const sectionBtnRef = useRef<HTMLButtonElement>(null);
  const [sectionMenu, setSectionMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // 插入章节命令：\cmd{}，光标落在花括号内（空标题就绪）
  const insertSection = (cmd: string) => {
    const code = `${cmd}{}`;
    const caret = code.indexOf("{}") + 1;
    insertSnippetSelect(code, caret, caret);
  };

  // 插入链接：\href{}{选中}，光标落在 URL 空括号内
  const insertLink = () => {
    const view = getActiveView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const sel = view.state.sliceDoc(from, to);
    const code = `\\href{}{${sel}}`;
    const caret = code.indexOf("{}") + 1;
    insertSnippetSelect(code, caret, caret);
  };

  // 插入无序列表：块插入，光标落在 \item 之后
  const insertList = () => {
    const caret = ITEMIZE.indexOf("\\item") + "\\item".length;
    insertSnippetSelect(ITEMIZE, caret, caret);
  };

  // 插入图片：复用现有的导入管线（落盘 + 组装 figure + 插入编辑器）
  const insertImage = async () => {
    const picked = await openFileDialog({
      multiple: true,
      filters: [{ name: "图片", extensions: [...EXT_IMG] }],
    });
    if (!picked) return;
    const paths = typeof picked === "string" ? [picked] : picked;
    await importImageFromPaths(paths);
  };

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="编辑器快捷操作">
      {/* 左：文本格式组 */}
      <div className="et-group">
        <button
          type="button"
          ref={sectionBtnRef}
          className="ibtn et-dropdown"
          title="插入章节（chapter / section / subsection …）"
          disabled={!canEdit}
          onClick={() => {
            const r = sectionBtnRef.current?.getBoundingClientRect();
            if (r) setSectionMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <span className="tt">
            <span className="big">T</span>
            <span className="sm">T</span>
          </span>
          {/* <span className="caret">▾</span> */}
        </button>
        <button
          type="button"
          className="ibtn et-letter"
          title="加粗 (\\textbf{})"
          disabled={!canEdit}
          onClick={() => wrapSelection("\\textbf{", "}")}
        >
          <span style={{ fontWeight: 800 }}>B</span>
        </button>
        <button
          type="button"
          className="ibtn et-letter"
          title="斜体 (\\textit{})"
          disabled={!canEdit}
          onClick={() => wrapSelection("\\textit{", "}")}
        >
          <span style={{ fontStyle: "italic", fontFamily: "serif" }}>I</span>
        </button>
        <button
          type="button"
          className="ibtn et-letter"
          title="下划线 (\\underline{})"
          disabled={!canEdit}
          onClick={() => wrapSelection("\\underline{", "}")}
        >
          <span style={{ textDecoration: "underline" }}>U</span>
        </button>
        <button
          type="button"
          className="ibtn et-letter"
          title="删除线 (\\sout{}，需 ulem 宏包)"
          disabled={!canEdit}
          onClick={() => wrapSelection("\\sout{", "}")}
        >
          <span style={{ textDecoration: "line-through" }}>S</span>
        </button>
      </div>

      <span className="et-sep" />

      {/* 中：插入功能组 */}
      <div className="et-group">
        <button
          type="button"
          className="ibtn"
          title="插入链接 (\\href)"
          disabled={!canEdit}
          onClick={insertLink}
        >
          <Icon name="link" size={15} />
        </button>
        <button
          type="button"
          className="ibtn"
          title="插入图片"
          disabled={!canEdit}
          onClick={() => void insertImage()}
        >
          <Icon name="image" size={15} />
        </button>
        <button
          type="button"
          className="ibtn"
          title="插入无序列表 (itemize)"
          disabled={!canEdit}
          onClick={insertList}
        >
          <Icon name="list" size={15} />
        </button>
        <button
          type="button"
          className="ibtn"
          title="插入数学公式"
          disabled={!canEdit}
          onClick={() => useAppStore.getState().setSidebarView("math")}
        >
          <Icon name="formula" size={15} />
        </button>
        <button
          type="button"
          className="ibtn"
          title="插入表格"
          disabled={!canEdit}
          onClick={() => useAppStore.getState().setSidebarView("table")}
        >
          <Icon name="table" size={15} />
        </button>
      </div>

      <span className="et-sep" />

      {/* 右：章节结构组（下拉菜单，复用 .ctx 弹层） */}
      <div className="et-group"></div>

      {sectionMenu && (
        <InsertCtxMenu
          x={sectionMenu.x}
          y={sectionMenu.y}
          actions={SECTION_LEVELS.map((lv) => ({
            label: lv.label,
            hint: lv.cmd,
            style: {
              fontSize: lv.size,
              fontWeight: lv.weight,
              lineHeight: 1.25,
            },
            onClick: () => insertSection(lv.cmd),
          }))}
          onClose={() => setSectionMenu(null)}
        />
      )}
    </div>
  );
}

export default EditorToolbar;
