// M0-4/M0-5 · CM6 编辑器核心封装（见 docs/开发计划.md M0-4、M0-5）
// 职责：LaTeX 语法高亮 / 行号 / 括号配对 / 查找替换 / Ctrl+S 保存 / gotoLine 跳行 / 光标上报
// 「单文档受控组件」：多标签脏状态与实例驻留策略（方案 A）由 EditorWorkspace 上层接管。
import { forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  keymap,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { Compartment } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";
import { latex } from "codemirror-lang-latex";
import { useSettingsStore } from "@/core/settings";

export interface CursorPos {
  /** 1-based 行 */
  line: number;
  /** 1-based 列 */
  col: number;
}

export interface LaTeXEditorHandle {
  /**
   * 跳转到指定行（1-based），滚动居中并聚焦 —— M0-12 错误定位、M3 synctex 依赖此接口。
   * selectLine=true 时把整行选区选中（错误定位的高亮口径，MVP 不做 decoration）
   */
  gotoLine: (line: number, col?: number, selectLine?: boolean) => void;
  /** 当前光标位置（1-based 行/列） */
  getCursorPos: () => CursorPos;
  /** 当前光标所在行（1-based） */
  getCursorLine: () => number;
  /** 打开内置查找替换面板（tab-tools 查找按钮） */
  openFind: () => void;
  /** 隐藏→显示后重新测量布局（方案 A 切换标签时调用） */
  refresh: () => void;
  focus: () => void;
  /** 底层 CM6 视图（菜单栏命令桥 activeView.ts 登记用） */
  getView: () => EditorView | null;
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
  /** M0-14a · 自动换行（偏好设置）；默认开。切换经 Compartment 热生效 */
  lineWrapping?: boolean;
}

export const LaTeXEditor = forwardRef<LaTeXEditorHandle, LaTeXEditorProps>(
  function LaTeXEditor(
    {
      value,
      onChange,
      onSave,
      onCursorChange,
      readOnly,
      placeholder,
      height = "60vh",
      lineWrapping = true,
    },
    ref,
  ) {
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    // 自动换行经 Compartment 独立管理（偏好设置热切换）
    const wrapCompartment = useRef(new Compartment());
    // Ctrl+滚轮缩放字号（M0-14a 用户追加）
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const wheelAccRef = useRef(0);

    // 闭包里拿到最新回调：扩展只创建一次
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onCursorRef = useRef(onCursorChange);
    onCursorRef.current = onCursorChange;

    const extensions = useMemo(
      () => [
        latex({ autoCloseBrackets: true, autoCloseTags: true }),
        // 初始占位空扩展；实际开关由下方 useEffect reconfigure（偏好设置驱动）
        wrapCompartment.current.of([]),
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

    // 偏好设置的自动换行开关（含首挂载同步）
    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartment.current.reconfigure(
          lineWrapping ? EditorView.lineWrapping : [],
        ),
      });
    }, [lineWrapping]);

    // Ctrl+滚轮缩放：React 的 wheel 是 passive，必须原生监听才能 preventDefault
    // - 编辑区内按住 Ctrl 滚动一律拦截（避免 WebView 整页缩放），开关关闭只是不缩放字号
    // - deltaY 累积阈值 100 ≈ 常规鼠标一格 1px 步进；触控板小位移也会平滑累积
    useEffect(() => {
      const el = wrapRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) {
          wheelAccRef.current = 0; // 松开 Ctrl 后清掉残留累积
          return;
        }
        e.preventDefault();
        if (!useSettingsStore.getState().settings.editor.mouseWheelZoom) return;
        wheelAccRef.current += e.deltaY;
        const TH = 100;
        while (Math.abs(wheelAccRef.current) >= TH) {
          // deltaY<0（向上滚）= 放大；zoomEditorFont 里再 clamp 8–32
          const step = wheelAccRef.current > 0 ? 100 : -100;
          wheelAccRef.current -= Math.sign(wheelAccRef.current) * TH;
          useSettingsStore.getState().zoomEditorFont(step);
        }
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, []);

    function cursorPos(): CursorPos {
      const state = cmRef.current?.state;
      if (!state) return { line: 1, col: 1 };
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      return { line: line.number, col: head - line.from + 1 };
    }

    useImperativeHandle(ref, () => ({
      gotoLine(line, col, selectLine) {
        const view = cmRef.current?.view;
        if (!view) return;
        const doc = view.state.doc;
        const no = Math.min(Math.max(Math.floor(line) || 1, 1), doc.lines);
        const target = doc.line(no);
        const offset = Math.min(Math.max((col ?? 1) - 1, 0), target.length);
        const pos = target.from + offset;
        const selection =
          selectLine !== false ? { anchor: target.from, head: target.to } : { anchor: pos };
        // 上限钳取的行号可能与请求行号不同（文件在编译后又被改过），以后缀提示
        if (no !== line && selectLine) {
          console.warn(`[gotoLine] 行号已钳取：请求 ${line}，实际 ${no}（文件在编译后可能被修改过）`);
        }
        view.dispatch({
          selection,
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
      getView() {
        return cmRef.current?.view ?? null;
      },
    }));

    return (
      <div ref={wrapRef} className="latex-editor" style={{ height }}>
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
