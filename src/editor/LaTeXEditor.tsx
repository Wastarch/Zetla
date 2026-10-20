// M0-4/M0-5 · CM6 编辑器核心封装（见 docs/开发计划.md M0-4、M0-5）
// 职责：LaTeX 语法高亮 / 行号 / 括号配对 / 查找替换 / Ctrl+S 保存 / gotoLine 跳行 / 光标上报
// 「单文档受控组件」：多标签脏状态与实例驻留策略（方案 A）由 EditorWorkspace 上层接管。
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  keymap,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { openSearchPanel } from "@codemirror/search";
import { latex } from "codemirror-lang-latex";

export interface CursorPos {
  /** 1-based 行 */
  line: number;
  /** 1-based 列 */
  col: number;
}

export interface LaTeXEditorHandle {
  /** 跳转到指定行（1-based），滚动居中并聚焦 —— M0-11 错误定位、M3 synctex 依赖此接口 */
  gotoLine: (line: number, col?: number) => void;
  /** 当前光标位置（1-based 行/列） */
  getCursorPos: () => CursorPos;
  /** 当前光标所在行（1-based） */
  getCursorLine: () => number;
  /** 打开内置查找替换面板（tab-tools 查找按钮） */
  openFind: () => void;
  /** 隐藏→显示后重新测量布局（方案 A 切换标签时调用） */
  refresh: () => void;
  focus: () => void;
}

export interface LaTeXEditorProps {
  /** 文档内容（受控） */
  value: string;
  /** 内容变化回调 */
  onChange?: (value: string) => void;
  /** Ctrl+S / Cmd+S 触发 */
  onSave?: () => void;
  /** 光标/选区变化回调（面板状态条行,列） */
  onCursorChange?: (line: number, col: number) => void;
  /** 只读（查看生成文件用，P1） */
  readOnly?: boolean;
  placeholder?: string;
  /** 编辑区高度，默认 60vh */
  height?: string;
}

export const LaTeXEditor = forwardRef<LaTeXEditorHandle, LaTeXEditorProps>(
  function LaTeXEditor(
    { value, onChange, onSave, onCursorChange, readOnly, placeholder, height = "60vh" },
    ref,
  ) {
    const cmRef = useRef<ReactCodeMirrorRef>(null);

    // 闭包里拿到最新回调：扩展只创建一次
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onCursorRef = useRef(onCursorChange);
    onCursorRef.current = onCursorChange;

    const extensions = useMemo(
      () => [
        latex({ autoCloseBrackets: true, autoCloseTags: true }),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            onCursorRef.current?.(line.number, head - line.from + 1);
          }
        }),
      ],
      [],
    );

    function cursorPos(): CursorPos {
      const state = cmRef.current?.state;
      if (!state) return { line: 1, col: 1 };
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      return { line: line.number, col: head - line.from + 1 };
    }

    useImperativeHandle(ref, () => ({
      gotoLine(line, col) {
        const view = cmRef.current?.view;
        if (!view) return;
        const doc = view.state.doc;
        const no = Math.min(Math.max(Math.floor(line) || 1, 1), doc.lines);
        const target = doc.line(no);
        const offset = Math.min(Math.max((col ?? 1) - 1, 0), target.length);
        const pos = target.from + offset;
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
        view.focus();
      },
      getCursorPos: cursorPos,
      getCursorLine() {
        return cursorPos().line;
      },
      openFind() {
        const view = cmRef.current?.view;
        if (view) openSearchPanel(view);
      },
      refresh() {
        cmRef.current?.view?.requestMeasure();
      },
      focus() {
        cmRef.current?.view?.focus();
      },
    }));

    return (
      <div className="latex-editor" style={{ height }}>
        <CodeMirror
          ref={cmRef}
          value={value}
          height="100%"
          theme="light"
          readOnly={readOnly}
          placeholder={placeholder}
          extensions={extensions}
          onChange={onChange}
          basicSetup={{
            // 编辑基础：行号/高亮当前行/撤销重做/括号配对/自动闭合/缩进
            lineNumbers: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            foldGutter: false, // MVP 暂不做代码折叠（MVP.md Phase 1-2）
            autocompletion: true,
            closeBrackets: true,
            bracketMatching: true,
            searchKeymap: true,
          }}
        />
      </div>
    );
  },
);

export default LaTeXEditor;
