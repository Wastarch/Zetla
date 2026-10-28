// M0-5 · 编辑工作区（TabBar + 多实例编辑区）
// 方案 A：每个缓冲区一个 LaTeXEditor 实例，首次激活后常驻、切走仅 hidden 隐藏 ——
// 撤销栈 / 光标 / 滚动由 CM 原生状态天然隔离，切回无状态搬运。
// M0-13 前移：移除编辑器内部状态行，光标位置经 useBuffers.cursor 上提到全局状态栏。
import { useCallback, useEffect, useRef } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { TabBar } from "./TabBar";
import { LaTeXEditor, type LaTeXEditorHandle } from "./LaTeXEditor";
import { ImageViewer } from "./ImageViewer";
import { PdfPreview } from "@/preview/PdfPreview";
import { setActiveView, setActiveEditorHandle } from "./activeView";
import { takePendingJump } from "./jump";
import { jumpToPdfFromSource } from "@/preview/syncTex";
import { useBuffersStore } from "./useBuffers";
import { useSettingsStore } from "@/core/settings";

export function EditorWorkspace() {
  const buffers = useBuffersStore((s) => s.buffers);
  const activePath = useBuffersStore((s) => s.activePath);
  const openFiles = useBuffersStore((s) => s.openFiles);
  const updateContent = useBuffersStore((s) => s.updateContent);
  const saveBuffer = useBuffersStore((s) => s.saveBuffer);
  const markMounted = useBuffersStore((s) => s.markMounted);
  const setCursor = useBuffersStore((s) => s.setCursor);
  // M0-14a：自动换行来自偏好设置（LaTeXEditor Compartment 热生效）
  const settings = useSettingsStore((s) => s.settings);

  /** 每个已挂载缓冲的编辑器句柄 */
  const handles = useRef<Record<string, LaTeXEditorHandle | null>>({});
  const setHandle = useCallback(
    (path: string) => (h: LaTeXEditorHandle | null) => {
      handles.current[path] = h;
    },
    [],
  );

  /** 光标位置已上提至 useBuffers.cursor（全局状态栏消费） */

  // 激活切换：标记已挂载 + 隐藏→显示后重新测量 + 刷新行/列 + 登记菜单栏命令桥
  // M0-12：登记句柄给 jump.ts；有待跳错误时在此落地（选中整行）
  useEffect(() => {
    if (!activePath) {
      setActiveView(null);
      setActiveEditorHandle(null);
      setCursor({ line: 1, col: 1 });
      return;
    }
    markMounted(activePath);
    const h = handles.current[activePath];
    h?.refresh();
    setActiveView(h?.getView() ?? null);
    setActiveEditorHandle(h ?? null);
    const pos = h?.getCursorPos();
    setCursor(pos ?? { line: 1, col: 1 });
    const j = takePendingJump(activePath);
    if (j) h?.gotoLine(j.line, j.col, true);
  }, [activePath, markMounted, setCursor]);

  // 打开文件（Ctrl+O / 文件菜单共用）
  const openDialog = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        multiple: true,
        filters: [
          { name: "LaTeX 源文件", extensions: ["tex", "ltx", "cls", "sty"] },
          { name: "BibTeX 文献", extensions: ["bib"] },
          { name: "BibTeX 样式", extensions: ["bst"] },
          {
            name: "BibLaTeX / docTeX / ConTeXt",
            extensions: ["bbx", "cbx", "lbx", "dtx", "ins", "ctx"],
          },
          { name: "编译日志", extensions: ["log"] },
        ],
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

  const doFind = useCallback(() => {
    if (activePath) handles.current[activePath]?.openFind();
  }, [activePath]);

  // M1-9：活动文本缓冲被外部修改时的提示条
  const activeExternal = buffers.find(
    (b) => b.path === activePath && b.externallyChanged,
  )?.externallyChanged;

  const reloadExternal = useCallback(() => {
    if (activePath) void useBuffersStore.getState().revertBuffer(activePath);
  }, [activePath]);

  const ignoreExternal = useCallback(() => {
    if (activePath) useBuffersStore.getState().dismissExternal(activePath);
  }, [activePath]);

  return (
    <section className="center">
      <TabBar onFind={doFind} />

      {activeExternal && (
        <div className="ext-changed-bar">
          <span>
            此文件已在编辑器外部被修改，是否重新加载？（未保存的本地修改将丢失）
          </span>
          <button type="button" className="btn primary" onClick={reloadExternal}>
            重新加载
          </button>
          <button type="button" className="btn" onClick={ignoreExternal}>
            忽略
          </button>
        </div>
      )}

      <div className="code-wrap">
        {buffers.length === 0 ? (
          <div className="empty">
            <img
              className="empty-mark"
              src="/logo.svg"
              alt="Zetla"
              draggable={false}
            />
            <div className="big">未打开任何文档</div>
            <p>按 Ctrl+O 或「文件 → 打开文件…」选择 .tex 文档开始编辑</p>
          </div>
        ) : (
          buffers.map((b) => (
            <div
              key={b.path}
              className="buffer-pane"
              hidden={b.path !== activePath}
            >
              {b.mounted || b.path === activePath ? (
                b.kind === "image" ? (
                  <ImageViewer path={b.path} name={b.name} />
                ) : b.kind === "pdf" ? (
                  <PdfPreview path={b.path} style={{ position: "absolute", inset: 0 }} />
                ) : (
                  <LaTeXEditor
                    ref={setHandle(b.path)}
                    value={b.content}
                    height="100%"
                    lineWrapping={settings.editor.lineWrapping}
                    onChange={(v) => updateContent(b.path, v)}
                    onSave={() => saveBuffer(b.path)}
                    onCursorChange={(line, col) => {
                      // 只接收活动编辑器的光标事件
                      if (useBuffersStore.getState().activePath === b.path) setCursor({ line, col });
                    }}
                    onJumpToPdf={(line, col) => void jumpToPdfFromSource(b.path, line, col)}
                    path={b.path}
                    placeholder="开始输入 LaTeX…"
                  />
                )
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default EditorWorkspace;
