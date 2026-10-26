// M0-4/M0-5 · CM6 编辑器核心封装（见 docs/开发计划.md M0-4、M0-5）
// 职责：LaTeX 语法高亮 / 行号 / 括号配对 / 查找替换 / Ctrl+S 保存 / gotoLine 跳行 / 光标上报
// M1-2：语法高亮配色与主题联动（亮/暗双份，随 data-theme 切换）
// 「单文档受控组件」：多标签脏状态与实例驻留策略（方案 A）由 EditorWorkspace 上层接管。
import { forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  keymap,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { openSearchPanel } from "@codemirror/search";
import { latex } from "codemirror-lang-latex";
import { useSettingsStore } from "@/core/settings";
import type { EffectiveTheme } from "@/types/settings";
import { mathSlotsExtension } from "./mathSlots";
import { bibtexLanguage, BIB_HIGHLIGHT } from "./bibtex";
import { extOf } from "@/project/useProject";

/**
 * M1-2：LaTeX 语法高亮配色。
 * CM6 不内置语法色（@uiw 也不挂 defaultHighlightStyle），此前编辑器处于无配色状态；
 * 配色与 zetla.css 主题 token 同源，亮/暗双份（TS 单一来源，避免读 CSS 变量的时序竞争）。
 * tag 映射依据 codemirror-lang-latex 的 styleTags：keyword=控制序列/\begin/\end、
 * operator=控制符号与 & ~、variableName/processingInstruction=数学字符与 $、
 * className=环境名、heading=章节命令、labelName=\label/\ref、quote=\cite、
 * bracket=各类括号、string=字面参数、meta=verbatim 内容、strong/emphasis/monospace=文本样式命令。
 * 注意：TagStyle 列表中越靠后的规则优先级越高（meta 等宽泛 tag 放前面）。
 * M1-2b：键为生效主题（light/dark；"auto" 设置值已在 store 层解析，见 resolveTheme）。
 */
const LATEX_HIGHLIGHT: Record<EffectiveTheme, HighlightStyle> = {
  light: HighlightStyle.define([
    { tag: [t.meta, t.content], color: "#7a828c" },
    { tag: t.comment, color: "#8d959e" },
    { tag: [t.string, t.number], color: "#9a5b0d" },
    { tag: [t.keyword, t.definitionKeyword], color: "#2b62cf" },
    { tag: t.heading, color: "#1e4fae", fontWeight: "600" },
    { tag: [t.operator, t.variableName, t.processingInstruction], color: "#9a5b0d" },
    { tag: t.bracket, color: "#7a828c" },
    { tag: [t.className, t.labelName, t.quote], color: "#0d7a6e" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.monospace, fontFamily: "var(--font-mono, monospace)" },
    { tag: t.invalid, color: "#c2382f" },
  ]),
  dark: HighlightStyle.define([
    { tag: [t.meta, t.content], color: "#7e8794" },
    { tag: t.comment, color: "#6b7480" },
    { tag: [t.string, t.number], color: "#e0b169" },
    { tag: [t.keyword, t.definitionKeyword], color: "#7fb0ff" },
    { tag: t.heading, color: "#7fb0ff", fontWeight: "600" },
    { tag: [t.operator, t.variableName, t.processingInstruction], color: "#e0b169" },
    { tag: t.bracket, color: "#7e8794" },
    { tag: [t.className, t.labelName, t.quote], color: "#6fd3c4" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.monospace, fontFamily: "var(--font-mono, monospace)" },
    { tag: t.invalid, color: "#f26a60" },
  ]),
};

export interface CursorPos {
  /** 1-based 行 */
  line: number;
  /** 1-based 列 */
  col: number;
}

export interface LaTeXEditorHandle {
  /**
   * 跳转到指定行（1-based），滚动居中并聚焦 —— M0-12 错误定位、M1-4 synctex 依赖此接口。
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
  /** M0-14a · 自动换行（偏好设置）；默认开。作为 CM6 扩展随编辑器直接创建 */
  lineWrapping?: boolean;
  /** M1-4：Ctrl/⌘+点击源码行 → 正向跳转到 PDF 对应位置（synctex） */
  onJumpToPdf?: (line: number, col: number) => void;
  /** M1-14b：当前文档路径（区分 .tex / .bib 以切换语言与高亮） */
  path?: string;
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
      onJumpToPdf,
      path,
    },
    ref,
  ) {
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    // 字号/字体/换行变化后触发 CM6 重新测量（换行位置、行高、滚动范围）
    const editor = useSettingsStore((s) => s.settings.editor);
    // M1-2b：生效主题（驱动 CM6 基础主题与语法高亮配色；"auto" 跟随系统，见 store resolveTheme）
    const theme = useSettingsStore((s) => s.effectiveTheme);
    // Ctrl+滚轮缩放字号（M0-14a 用户追加）
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const wheelAccRef = useRef(0);

    // 闭包里拿到最新回调；扩展仅在换行开关变化时重建
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    const onCursorRef = useRef(onCursorChange);
    onCursorRef.current = onCursorChange;
    // M1-4：Ctrl/⌘+点击 → 正向 synctex 跳转（闭包经 ref 取最新回调，不触发扩展重建）
    const onJumpRef = useRef(onJumpToPdf);
    onJumpRef.current = onJumpToPdf;

    const isBib = path ? extOf(path) === "bib" : false;
    const extensions = useMemo(
      () => [
        // M1-14b：.bib 用专属词法 + 高亮，.tex 维持 LaTeX
        isBib
          ? bibtexLanguage
          : latex({ autoCloseBrackets: true, autoCloseTags: true }),
        // 软换行：只影响显示，不向文档写入换行符
        lineWrapping ? EditorView.lineWrapping : [],
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
        // 语法高亮配色（亮/暗双份，随主题切换；CM6 基础主题由 theme prop 接管）
        isBib
          ? syntaxHighlighting(BIB_HIGHLIGHT[theme])
          : syntaxHighlighting(LATEX_HIGHLIGHT[theme]),
        // M1-11：公式搭建器槽位导航（\Box 占位高亮 + Tab 跳转），仅 .tex 启用
        ...(isBib ? [] : mathSlotsExtension),
        // M1-4：Ctrl/⌘+点击源码行 → synctex 正向跳转（posAtCoords 取点击处行/列）
        EditorView.domEventHandlers({
          mousedown: (e, view) => {
            if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const line = view.state.doc.lineAt(pos);
            onJumpRef.current?.(line.number, pos - line.from + 1);
            e.preventDefault();
            return true;
          },
        }),
      ],
      [lineWrapping, theme, isBib],
    );

    // 字号/字体/换行开关变化后重新测量，避免放大后仍按旧字宽计算换行位置
    useEffect(() => {
      const id = requestAnimationFrame(() => {
        cmRef.current?.view?.requestMeasure();
      });
      return () => cancelAnimationFrame(id);
    }, [editor.fontSize, editor.fontFamily, lineWrapping]);

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
          theme={theme}
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
