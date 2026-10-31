// M0-4/M0-5 · CM6 编辑器核心封装（见 docs/开发计划.md M0-4、M0-5）
// 职责：LaTeX 语法高亮 / 行号 / 括号配对 / 查找替换 / Ctrl+S 保存 / gotoLine 跳行 / 光标上报
// M1-2：语法高亮配色与主题联动（亮/暗双份，随 data-theme 切换）
// 「单文档受控组件」：多标签脏状态与实例驻留策略（方案 A）由 EditorWorkspace 上层接管。
import { forwardRef, useImperativeHandle, useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror, {
  EditorView,
  keymap,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { syntaxHighlighting } from "@codemirror/language";
import { search } from "@codemirror/search";
import { latex, latexCompletionSource, latexLinter } from "codemirror-lang-latex";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";
import { linter, lintGutter } from "@codemirror/lint";
import { useSettingsStore } from "@/core/settings";
import type { EffectiveTheme, HighlightGroup } from "@/types/settings";
import { mathSlotsExtension } from "./mathSlots";
import { bibtexLanguage, BIB_HIGHLIGHT } from "./bibtex";
import { bstLanguage, BST_HIGHLIGHT } from "./bst";
import { logLanguage, LOG_HIGHLIGHT } from "./log";
import { langOf, type EditorLang } from "./langByExt";
import { useLangOverride } from "./langOverride";
import { buildLatexHighlight } from "./highlightConfig";
import {
  citeCompletionSource,
  citeHoverSource,
  citeJumpHint,
  citeJumpAtCursor,
  citeLinkDecorations,
  ctrlHeldPlugin,
} from "@/modules/reference/citeSupport";
import {
  duplicateKeyLinter,
  missingCiteLinter,
} from "@/modules/reference/lint";
import { importAndInsert, isImageFile } from "./image/importImage";
import {
  inputJumpAtCursor,
  inputJumpHint,
  inputLinkDecorations,
  setInputJumpPath,
} from "./inputJump";
import { useProjectStore } from "@/project/useProject";
import { showMinimap, Scale, type MinimapConfig } from "@replit/codemirror-minimap";
import { registerEditorView, unregisterEditorView } from "./activeView";
import {
  snippetCompletionSource,
  snippetTabKeymap,
} from "./snippetsSupport";
import { searchMatchHighlighter } from "./searchUtil";

// M1 · 缩略图最大宽度：经 patch 暴露包的 Scale 后，此处一处可调（默认 100px；拐点 = MaxWidth×6 = 600px）
const MINIMAP_MAX_WIDTH = 80;
Scale.MaxWidth = MINIMAP_MAX_WIDTH;

// M2-5b：静态扩展常量（模块级，引用恒定）。此前内联在 extensions useMemo 依赖里，
// 每次渲染产生新引用 → @uiw 每次渲染都 StateEffect.reconfigure → 动态 appendConfig 的
// snippetState（片段占位符会话）被丢弃，Tab 跳占位符失效。静态引用必须放模块级。
const SEARCH_EXT = search();
const SEARCH_MATCH_HL = searchMatchHighlighter();

// M2-5b：basicSetup 必须模块级常量。内联对象字面量每次渲染都是新引用，而 @uiw 的
// reconfigure effect 把它列入依赖 → 每次渲染 dispatch StateEffect.reconfigure →
// 动态 appendConfig 挂载的 snippetState（片段占位符会话）被丢弃，Tab 跳占位符失效。
const BASIC_SETUP = {
  // 编辑基础：行号/高亮当前行/撤销重做/括号配对/自动闭合/缩进
  lineNumbers: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: true,
  foldGutter: false, // MVP 暂不做代码折叠（MVP.md Phase 1-2）
  autocompletion: false, // M1-14c：改由 autocompletion({override}) 提供（LaTeX + \cite）
  closeBrackets: true,
  bracketMatching: true,
  // M1-find：关闭默认 searchKeymap（Ctrl+F/F3 由 EditorWorkspace 接管，驱动自定义查找面板）
  searchKeymap: false,
} as const;

/**
 * M1 · 编辑器右侧缩略图（@replit/codemirror-minimap）。
 * 包内读取 .cm-content 的 computed style 取颜色/字体，故亮/暗主题自动跟随；
 * showMinimap 为 Facet，其 enables 会自动挂载渲染插件，传 null 即不显示。
 * 点击缩略图按纵向比例滚动编辑器（标准 minimap 交互）。
 */
const MINIMAP_CONFIG: MinimapConfig = {
  create: () => ({ dom: document.createElement("div") }),
  showOverlay: "always",
  displayText: "characters",
  eventHandlers: {
    mousedown: (e, view) => {
      const dom = e.currentTarget as HTMLElement;
      const rect = dom.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const max = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
      view.scrollDOM.scrollTop = Math.max(0, Math.min(1, ratio)) * max;
    },
  },
};

/**
 * M1-2 / M1-17：LaTeX 语法高亮配色。
 * 配色改为数据驱动：颜色来自设置 settings.highlight.latex（亮/暗各一份），
 * 由 src/editor/highlightConfig.ts 的 buildLatexHighlight 按「分组 → lezer tag」构建 HighlightStyle。
 * 默认配色见 src/types/settings.ts 的 DEFAULT_LATEX_HIGHLIGHT；设置页「外观与保存 → 语法高亮」可改。
 * tag 语义（keyword=控制序列/\begin/\end、className=环境名、heading=章节、operator=数学符号与 $ 等）
 * 由 codemirror-lang-latex 的 styleTags 决定，本项目不改词法。
 * 注意：HighlightStyle 列表中越靠后的规则优先级越高（meta 等宽泛 tag 放前面）。
 */

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

/**
 * M2 · LaTeX 诊断（接管 latex() 内置 linter，改为每次按「主文件 / 片段文件」判定参数）：
 * 被 \input 进来的章节片段本身没有 \documentclass 与 \bibliography，
 * 内置 linter 会误报「Missing document environment」「\cite used but no \bibliography」。
 * 因此对「非主文件」或「无 \documentclass 的片段」关掉这几项只有整篇文档才成立的检查；
 * 环境配对、括号闭合、重复 label、数学模式等文件内检查保持开启。
 */
function latexLintFor(getPath: () => string | undefined) {
  return (view: EditorView) => {
    const path = getPath();
    const main = useProjectStore.getState().tree?.mainFile;
    const isFragmentPath =
      !!path && !!main && main.toLowerCase() !== path.toLowerCase();
    // 兜底：无项目树 / 未识别主文件时，按内容判断是否为片段（长文档只看前 20000 字符的导言区）
    const head = view.state.doc.sliceString(
      0,
      Math.min(view.state.doc.length, 20000),
    );
    const isFragment = isFragmentPath || !/\\documentclass\b/.test(head);
    return latexLinter({
      fileName: path ?? "",
      ...(isFragment
        ? {
            checkMissingDocumentEnv: false,
            checkCitesWithoutBibliography: false,
            checkMissingReferences: false,
            checkMissingPackages: false,
          }
        : {}),
    })(view);
  };
}

/**
 * M1-14j：按语言档位装配「词法 + 诊断」扩展。
 * plain 不挂任何语言（交给 basicSetup 的默认高亮 fallback = 不染色），即纯文本渲染。
 */
function langSupport(lang: EditorLang, getPath: () => string | undefined) {
  switch (lang) {
    case "bib":
      return [
        bibtexLanguage,
        // M1-14e：.bib 内重复 key 告警（项目级判定，读 store 缓存定位）
        linter(duplicateKeyLinter(getPath), { delay: 400 }),
        lintGutter(),
      ];
    case "bst":
      return [bstLanguage];
    case "log":
      return [logLanguage];
    case "plain":
      return [];
    case "latex":
    default:
      return [
        // enableAutocomplete:false —— 关闭 latex() 自带的 autocompletion override，
        // 改由下方唯一的 autocompletion({override:[latex+cite]}) 提供，避免
        // 两个 override 配置冲突（Config merge conflict）导致编辑器崩溃白屏。
        // enableLinting:false —— 关闭内置 linter，改由 latexLintFor 按文件动态给参
        // （\input 进来的章节片段不该报「缺 document 环境 / 缺 \bibliography」）。
        latex({
          autoCloseBrackets: true,
          autoCloseTags: true,
          enableAutocomplete: false,
          enableLinting: false,
        }),
        linter(latexLintFor(getPath), { delay: 500 }),
        // M1-14e：.tex 内 \cite{key} 引用缺失告警（key 不在 store.byKey 即标红）
        linter(missingCiteLinter(), { delay: 400 }),
        lintGutter(),
      ];
  }
}

/** M1-14j / M1-17：按语言档位装配配色；plain 返回空数组（无语言 → basicSetup 默认高亮不生效）。
 * LaTeX 配色由设置驱动（latexGroups），其余语言沿用各自的固定 HighlightStyle。 */
function langHighlight(
  lang: EditorLang,
  theme: EffectiveTheme,
  latexGroups: HighlightGroup[],
) {
  switch (lang) {
    case "bib":
      return syntaxHighlighting(BIB_HIGHLIGHT[theme]);
    case "bst":
      return syntaxHighlighting(BST_HIGHLIGHT[theme]);
    case "log":
      return syntaxHighlighting(LOG_HIGHLIGHT[theme]);
    case "plain":
      return [];
    case "latex":
    default:
      return syntaxHighlighting(buildLatexHighlight(latexGroups, theme));
  }
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
    // M1-17：LaTeX 语法高亮配色（数据驱动；设置页「外观与保存 → 语法高亮」编辑，即时预览）
    const latexGroups = useSettingsStore((s) => s.settings.highlight.latex);
    // Ctrl+滚轮缩放字号（M0-14a 用户追加）
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const wheelAccRef = useRef(0);

    // 闭包里拿到最新回调；扩展仅在换行开关变化时重建
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;
    /**
     * M2-5b：onChange 经 ref 稳定化。@uiw 的 reconfigure effect 依赖 onChange 引用，
     * 父组件内联箭头（如 `(v) => updateContent(path, v)`）每次渲染都新建 → 每渲染
     * reconfigure → 片段占位符会话（appendConfig 的 snippetState）被丢弃。
     */
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const stableOnChange = useCallback(
      (v: string) => onChangeRef.current?.(v),
      [],
    );
    const onCursorRef = useRef(onCursorChange);
    onCursorRef.current = onCursorChange;
    // M1-4：Ctrl/⌘+点击 → 正向 synctex 跳转（闭包经 ref 取最新回调，不触发扩展重建）
    const onJumpRef = useRef(onJumpToPdf);
    onJumpRef.current = onJumpToPdf;
    // M1-14e：当前文档路径（经 ref 取最新值，供 linter 按文件过滤重复 key）
    const pathRef = useRef(path);
    pathRef.current = path;
    // \input 跳转的悬浮提示需要在点击/悬浮时拿到当前路径（模块级同步，避免切换标签重建扩展）
    setInputJumpPath(path);

    // M1-14j：状态栏手动指定的语言优先于扩展名自动识别（缺省按扩展名，未收录 → 纯文本）
    const langOverride = useLangOverride((s) => (path ? s.byPath[path] : undefined));
    const lang = langOverride ?? (path ? langOf(path) : "latex");
    // M1 · 右侧缩略图开关（设置 → 编辑器；缺省开，兼容旧配置无此字段）
    const minimapOn = editor.minimap ?? true;
    const extensions = useMemo(
      () => [
        // M1 · 右侧缩略图（null = 关闭；Facet 自动挂载渲染插件，主题色取自编辑器自身）
        showMinimap.of(minimapOn ? MINIMAP_CONFIG : null),
        // M1-14i/j：按档位装配词法（bib/bst/log 专属；plain 不挂语言；latex 含全部 LaTeX 方言）
        ...langSupport(lang, () => pathRef.current),
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
        // 语法高亮配色（亮/暗双份，随主题切换；plain 不染色；LaTeX 由设置驱动）
        langHighlight(lang, theme, latexGroups),
        // M1-11：公式搭建器槽位导航（\Box 占位高亮 + Tab 跳转），仅 LaTeX 文档启用
        ...(lang === "latex" ? mathSlotsExtension : []),
        // M1-14c：.tex 内 \cite{ 补全 + 悬浮预览。
        // 唯一的 autocompletion override（合并 LaTeX 命令补全 + 引用补全 + M2-5b 片段补全），
        // 因 latex() 已设 enableAutocomplete:false，此处不会再有第二个 override 冲突。
        // 片段项 type="text" + boost=-99（排在命令补全之后，视觉上以 text 图标区分）。
        ...(lang === "latex"
          ? [
              autocompletion({
                override: [
                  latexCompletionSource(true),
                  citeCompletionSource,
                  snippetCompletionSource,
                ],
                defaultKeymap: true,
                activateOnTyping: true,
                icons: true,
              }),
              keymap.of(completionKeymap),
              // M2-5b：Tab 直展触发词（最低优先级：弹窗 accept / 公式槽位导航先于此）
              snippetTabKeymap,
              hoverTooltip(citeHoverSource),
              // M1-14d+：Ctrl 按住时 \cite 显示可点链接提示（下划线+手型）+ 跳转提示气泡
              citeLinkDecorations,
              ctrlHeldPlugin,
              hoverTooltip(citeJumpHint),
              // M1-4+：\input / \include 文件跳转（同款：Ctrl 按住显链接 + 悬浮提示）
              inputLinkDecorations,
              hoverTooltip(inputJumpHint),
            ]
          : []),
        // M1-4：Ctrl/⌘+点击 → 优先 \cite 跳 bib 条目（M1-14d），否则回落 synctex 正向跳转
        EditorView.domEventHandlers({
          mousedown: (e, view) => {
            if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            // \input / \include 目标文件：Ctrl+点击打开并跳转（命中即消费）
            if (inputJumpAtCursor(view.state.doc, pos, pathRef.current)) {
              e.preventDefault();
              return true;
            }
            // M1-14d：点击落在 \cite{key} 上 → 跳 bib 条目（命中即消费，不回落 synctex）
            if (citeJumpAtCursor(view.state.doc, pos)) {
              e.preventDefault();
              return true;
            }
            // 否则回落现有 synctex 正向跳转
            const line = view.state.doc.lineAt(pos);
            onJumpRef.current?.(line.number, pos - line.from + 1);
            e.preventDefault();
            return true;
          },
        }),
        // R5 拖拽 / 粘贴图片导入（M1-7）：仅拦截含图片文件的拖放与粘贴，纯文本原样交还 CM 处理
        EditorView.domEventHandlers({
          dragover: (event, view) => {
            const dt = event.dataTransfer;
            if (dt && Array.from(dt.items).some((i) => i.kind === "file")) {
              event.preventDefault();
              view.dom.classList.add("drag-over");
              return true;
            }
            return false;
          },
          dragleave: (event, view) => {
            const related = event.relatedTarget;
            if (related == null || !view.dom.contains(related as Node)) {
              view.dom.classList.remove("drag-over");
            }
            return false;
          },
          drop: (event, view) => {
            const dt = event.dataTransfer;
            view.dom.classList.remove("drag-over");
            if (!dt) return false;
            const files = Array.from(dt.files).filter(isImageFile);
            if (files.length === 0) return false;
            event.preventDefault();
            void importAndInsert(files);
            return true;
          },
          paste: (_event, _view) => {
            const dt = _event.clipboardData;
            if (!dt) return false;
            const files = Array.from(dt.files).filter(isImageFile);
            if (files.length === 0) return false; // 纯文本粘贴 → 交还 CM，零副作用
            _event.preventDefault();
            void importAndInsert(files);
            return true;
          },
        }),
      ],
      [lineWrapping, theme, lang, minimapOn, latexGroups, SEARCH_EXT, SEARCH_MATCH_HL],
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

    // M1-find：把 CM 视图登记到全局注册表（路径 → 视图），供关闭查找面板时统一清理高亮。
    // 视图在 @uiw 的 layout effect 中创建，此处用 rAF 轮询确保已就绪。
    useEffect(() => {
      let raf = 0;
      const tryReg = () => {
        const v = cmRef.current?.view;
        if (v && path) {
          registerEditorView(path, v);
          return;
        }
        raf = requestAnimationFrame(tryReg);
      };
      tryReg();
      return () => {
        cancelAnimationFrame(raf);
        if (path) unregisterEditorView(path);
      };
    }, [path]);

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
          onChange={stableOnChange}
          // M2-5b：关闭 @uiw 默认 indentWithTab（其 keymap 被置于扩展数组最前=最高优先级，
          // 会压过片段 Tab 直展）；缩进 fallback 已并入 snippetTabKeymap（直展→缩进）
          indentWithTab={false}
          basicSetup={BASIC_SETUP}
        />
      </div>
    );
  },
);

export default LaTeXEditor;
