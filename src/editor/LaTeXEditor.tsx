// M0-4 · CM6 编辑器核心封装（见 docs/开发计划.md M0-4）
// 职责：LaTeX 语法高亮 / 行号 / 括号配对 / 查找替换(basicSetup) / Ctrl+S 保存 / gotoLine 跳行
// 状态（脏标记、多标签 EditorState）由上层在 M0-5 接管，本组件只做「单文档受控编辑器」
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  keymap,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";

export interface LaTeXEditorHandle {
  /** 跳转到指定行（1-based），滚动居中并聚焦 —— M0-11 错误定位、M3 synctex 依赖此接口 */
  gotoLine: (line: number, col?: number) => void;
  /** 当前光标所在行（1-based） */
  getCursorLine: () => number;
  focus: () => void;
}

export interface LaTeXEditorProps {
  /** 文档内容（受控） */
  value: string;
  /** 内容变化回调 */
  onChange?: (value: string) => void;
  /** Ctrl+S / Cmd+S 触发 */
  onSave?: () => void;
  /** 只读（查看生成文件用，P1） */
  readOnly?: boolean;
  placeholder?: string;
  /** 编辑区高度，默认 60vh */
  height?: string;
}

export const LaTeXEditor = forwardRef<LaTeXEditorHandle, LaTeXEditorProps>(
  function LaTeXEditor({ value, onChange, onSave, readOnly, placeholder, height = "60vh" }, ref) {
    const cmRef = useRef<ReactCodeMirrorRef>(null);

    // 闭包里拿到最新回调：keymap 扩展只创建一次
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

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
      ],
      [],
    );

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
      getCursorLine() {
        const head = cmRef.current?.state?.selection.main.head ?? 0;
        return cmRef.current?.state?.doc.lineAt(head).number ?? 1;
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
