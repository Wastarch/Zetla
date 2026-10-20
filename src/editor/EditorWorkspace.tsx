// M0-5 · 编辑工作区（TabBar + 多实例编辑区 + 面板状态条）
// 方案 A：每个缓冲区一个 LaTeXEditor 实例，首次激活后常驻、切走仅 hidden 隐藏 ——
// 撤销栈 / 光标 / 滚动由 CM 原生状态天然隔离，切回无状态搬运。
import { useCallback, useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { TabBar } from "./TabBar";
import { LaTeXEditor, type LaTeXEditorHandle } from "./LaTeXEditor";
import { selectActive, useBuffersStore } from "./useBuffers";

export interface EditorWorkspaceProps {
  /** 打开验收抽屉（M0-12 布局壳落地后移除） */
  onOpenLab: () => void;
}

export function EditorWorkspace({ onOpenLab }: EditorWorkspaceProps) {
  const buffers = useBuffersStore((s) => s.buffers);
  const activePath = useBuffersStore((s) => s.activePath);
  const active = useBuffersStore(selectActive);
  const notice = useBuffersStore((s) => s.notice);
  const openFiles = useBuffersStore((s) => s.openFiles);
  const updateContent = useBuffersStore((s) => s.updateContent);
  const saveBuffer = useBuffersStore((s) => s.saveBuffer);
  const markMounted = useBuffersStore((s) => s.markMounted);
  const clearNotice = useBuffersStore((s) => s.clearNotice);

  const dirty = !!active && active.content !== active.savedContent;

  /** 每个已挂载缓冲的编辑器句柄 */
  const handles = useRef<Record<string, LaTeXEditorHandle | null>>({});
  const setHandle = useCallback(
    (path: string) => (h: LaTeXEditorHandle | null) => {
      handles.current[path] = h;
    },
    [],
  );

  // 面板状态条：行/列（活动编辑器）
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [gotoInput, setGotoInput] = useState("");

  // 激活切换：标记已挂载 + 隐藏→显示后重新测量 + 刷新行/列
  useEffect(() => {
    if (!activePath) return;
    markMounted(activePath);
    const h = handles.current[activePath];
    h?.refresh();
    const pos = h?.getCursorPos();
    if (pos) setCursor(pos);
  }, [activePath, markMounted]);

  // 打开文件（工具条 / Ctrl+O 共用）
  const openDialog = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        multiple: true,
        filters: [{ name: "LaTeX 源文件", extensions: ["tex", "ltx", "cls", "sty"] }],
      });
      if (!picked) return; // 用户取消
      await openFiles(typeof picked === "string" ? [picked] : picked);
    } catch (e) {
      useBuffersStore.setState({ notice: { text: String(e), kind: "err" } });
    }
  }, [openFiles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "o") {
        e.preventDefault();
        void openDialog();
      }
      if ((e.ctrlKey || e.metaKey) && k === "s") {
        // 焦点在编辑器内时 CM 的 Mod-s 已 preventDefault，这里不重复保存
        if (e.defaultPrevented) return;
        e.preventDefault();
        const p = useBuffersStore.getState().activePath;
        if (p) void saveBuffer(p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDialog, saveBuffer]);

  // 反馈 toast 自动消失
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => clearNotice(), 4500);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  const doFind = useCallback(() => {
    if (activePath) handles.current[activePath]?.openFind();
  }, [activePath]);

  const doGoto = useCallback(() => {
    const n = parseInt(gotoInput, 10);
    if (Number.isFinite(n) && activePath) {
      handles.current[activePath]?.gotoLine(n);
      setCursor(handles.current[activePath]?.getCursorPos() ?? { line: n, col: 1 });
    }
  }, [gotoInput, activePath]);

  return (
    <section className="center">
      <TabBar onOpenFiles={openDialog} onFind={doFind} onOpenLab={onOpenLab} />

      <div className="code-wrap">
        {buffers.length === 0 ? (
          <div className="empty">
            <div className="mark" style={{ width: 40, height: 40, fontSize: 22, borderRadius: 11 }}>
              Z
            </div>
            <div className="big">未打开任何文档</div>
            <p>点击标签栏右侧「打开文件…」选择 .tex 文档开始编辑（Ctrl+O）</p>
          </div>
        ) : (
          buffers.map((b) => (
            <div
              key={b.path}
              className="buffer-pane"
              hidden={b.path !== activePath}
            >
              {b.mounted || b.path === activePath ? (
                <LaTeXEditor
                  ref={setHandle(b.path)}
                  value={b.content}
                  height="100%"
                  onChange={(v) => updateContent(b.path, v)}
                  onSave={() => saveBuffer(b.path)}
                  onCursorChange={(line, col) => {
                    // 只接收活动编辑器的光标事件
                    if (useBuffersStore.getState().activePath === b.path) setCursor({ line, col });
                  }}
                  placeholder="开始输入 LaTeX…"
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="editor-status">
        {active ? (
          <>
            <span>
              行 <b>{cursor.line}</b>,列 <b>{cursor.col}</b>
            </span>
            <span>空格 2</span>
            <span className="file-p" title={active.path}>
              {active.path}
            </span>
            {dirty && <span style={{ color: "var(--warn)" }}>● 未保存</span>}
            <span className="sp">
              <span>
                编码 <b>{active.encoding.toUpperCase()}</b>
              </span>
              <span>
                换行 <b>{active.eol === "crlf" ? "CRLF" : "LF"}</b>
              </span>
              <span>
                语言 <b>LaTeX</b>
              </span>
              <span>
                Tab宽 <b>2</b>
              </span>
              <input
                value={gotoInput}
                title="跳转到行"
                placeholder="行号"
                spellCheck={false}
                onChange={(e) => setGotoInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doGoto();
                }}
              />
            </span>
          </>
        ) : (
          <span>Zetla · M0-5 多文件标签页 · 未打开文档</span>
        )}
      </div>

      {notice && (
        <div className="toast-wrap">
          <div className={`toast ${notice.kind}`}>{notice.text}</div>
        </div>
      )}
    </section>
  );
}

export default EditorWorkspace;
