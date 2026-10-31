// 单文件查找替换浮动面板（参考全局搜索图2 / VS Code 查找小组件）。
// 位置：编辑区右上角浮层（由 EditorWorkspace 渲染于 .code-wrap 内）。
// 交互：查找框 + Aa/ab/.* 开关 + 计数 n/N + ↑↓ + ✕；替换框（可展开）+ AB（保留大小写）+ 替换/全部替换。
// 键盘：Enter 下一项、Shift+Enter 上一项、Esc 关闭、Ctrl+F 保持焦点。
// 驱动：复用 @codemirror/search 的 SearchQuery；高亮由 LaTeXEditor 的 searchMatchHighlighter 完成。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "@/ui/Icon";
import { useFindStore, findPanelBridge } from "./findStore";
import { getActiveEditorHandle } from "./activeView";
import { useBuffersStore } from "./useBuffers";
import {
  buildQuery,
  collectMatches,
  matchStats,
  applyQueryToView,
  clearQueryInView,
  selectFirstMatch,
  goNext,
  goPrev,
  replaceRangeInView,
  replaceAllInView,
} from "./searchUtil";

export function FindReplacePanel() {
  const open = useFindStore((s) => s.open);
  const replaceMode = useFindStore((s) => s.replaceMode);
  const preserveCase = useFindStore((s) => s.preserveCase);
  const query = useFindStore((s) => s.query);
  const replace = useFindStore((s) => s.replace);
  const caseSensitive = useFindStore((s) => s.caseSensitive);
  const wholeWord = useFindStore((s) => s.wholeWord);
  const regexp = useFindStore((s) => s.regexp);
  const setQuery = useFindStore((s) => s.setQuery);
  const setReplace = useFindStore((s) => s.setReplace);
  const toggleCase = useFindStore((s) => s.toggleCase);
  const toggleWord = useFindStore((s) => s.toggleWord);
  const toggleRegex = useFindStore((s) => s.toggleRegex);
  const toggleReplaceMode = useFindStore((s) => s.toggleReplaceMode);
  const togglePreserveCase = useFindStore((s) => s.togglePreserveCase);
  const closeFind = useFindStore((s) => s.closeFind);

  // 当前活动文档路径：切换标签时重新把查询应用到新编辑器
  const activePath = useBuffersStore((s) => s.activePath);

  const [stats, setStats] = useState({ count: 0, index: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const getView = () => getActiveEditorHandle()?.getView() ?? null;

  const queryObj = useMemo(
    () => buildQuery(query, { caseSensitive, wholeWord, regexp }, replace),
    [query, caseSensitive, wholeWord, regexp, replace],
  );
  const invalid = query !== "" && !queryObj.valid;

  const recompute = useCallback(() => {
    const view = getView();
    if (!view) {
      setStats({ count: 0, index: 0 });
      return;
    }
    if (!queryObj.valid || queryObj.search === "") {
      setStats({ count: 0, index: 0 });
      return;
    }
    const matches = collectMatches(view.state.doc, queryObj);
    setStats(matchStats(matches, view.state.selection.main.head));
  }, [queryObj]);

  const apply = useCallback(() => {
    const view = getView();
    if (!view) return;
    if (!queryObj.valid || queryObj.search === "") {
      clearQueryInView(view);
      setStats({ count: 0, index: 0 });
      return;
    }
    applyQueryToView(view, queryObj);
    selectFirstMatch(view, queryObj);
    const matches = collectMatches(view.state.doc, queryObj);
    setStats(matchStats(matches, view.state.selection.main.head));
  }, [queryObj]);

  // 打开 / 查询或选项变化 / 切换标签 → 应用查询到活动编辑器并刷新计数
  useEffect(() => {
    if (!open) return;
    apply();
  }, [open, queryObj, apply, activePath]);

  // 打开时聚焦查找框
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => findInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // 展开替换框时聚焦替换输入框
  useEffect(() => {
    if (open && replaceMode) {
      const id = window.setTimeout(() => replaceInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open, replaceMode]);

  const onNext = () => {
    const v = getView();
    if (!v) return;
    goNext(v);
    recompute();
  };
  const onPrev = () => {
    const v = getView();
    if (!v) return;
    goPrev(v);
    recompute();
  };

  // 把导航/聚焦动作挂到桥上，供 EditorWorkspace 的 F3 / Ctrl+F 快捷键调用（保持计数同步）
  useEffect(() => {
    findPanelBridge.next = onNext;
    findPanelBridge.prev = onPrev;
    findPanelBridge.focusFind = () => findInputRef.current?.focus();
    return () => {
      findPanelBridge.next = null;
      findPanelBridge.prev = null;
      findPanelBridge.focusFind = null;
    };
  }, [onNext, onPrev]);

  const onReplaceCurrent = () => {
    const v = getView();
    if (!v) return;
    if (!queryObj.valid) return;
    replaceRangeInView(v, queryObj, preserveCase);
    recompute();
  };
  const onReplaceAll = () => {
    const v = getView();
    if (!v) return;
    if (!queryObj.valid) return;
    const n = replaceAllInView(v, queryObj, preserveCase);
    recompute();
    useBuffersStore.setState({
      notice: { text: `已替换 ${n} 处`, kind: n > 0 ? "ok" : "err" },
    });
  };

  const onFindKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  };

  if (!open) return null;

  return (
    <div className="find-panel" role="dialog" aria-label="查找替换">
      <div className="fp-row">
        <button
          type="button"
          className="fp-caret"
          title={replaceMode ? "折叠替换" : "展开替换"}
          onClick={toggleReplaceMode}
        >
          <Icon name="chev" size={12} style={{ transform: replaceMode ? "rotate(0deg)" : "rotate(-90deg)" }} />
        </button>
        <input
          ref={findInputRef}
          className={`fp-input${invalid ? " invalid" : ""}`}
          type="text"
          placeholder={regexp ? "查找（正则）" : "查找"}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFindKeyDown}
        />
        <div className="fp-toggles">
          <button
            type="button"
            className={caseSensitive ? "fp-tg on" : "fp-tg"}
            title="区分大小写"
            onClick={toggleCase}
          >
            Aa
          </button>
          <button
            type="button"
            className={wholeWord ? "fp-tg on" : "fp-tg"}
            title="整词匹配"
            onClick={toggleWord}
          >
            ab
          </button>
          <button
            type="button"
            className={regexp ? "fp-tg on" : "fp-tg"}
            title="正则表达式"
            onClick={toggleRegex}
          >
            .*
          </button>
        </div>
        <span className={`fp-count${stats.count === 0 ? " none" : ""}`}>
          {stats.count === 0 ? "无结果" : `${stats.index}/${stats.count}`}
        </span>
        <button type="button" className="fp-nav" title="上一个匹配 (Shift+Enter)" onClick={onPrev}>
          ↑
        </button>
        <button type="button" className="fp-nav" title="下一个匹配 (Enter)" onClick={onNext}>
          ↓
        </button>
        <button type="button" className="fp-x" title="关闭 (Esc)" onClick={closeFind}>
          <Icon name="x" size={13} />
        </button>
      </div>

      {replaceMode && (
        <div className="fp-row">
          <span className="fp-caret-placeholder" />
          <input
            ref={replaceInputRef}
            className="fp-input"
            type="text"
            placeholder="替换为"
            value={replace}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={onFindKeyDown}
          />
          <div className="fp-toggles">
            <button
              type="button"
              className={preserveCase ? "fp-tg on" : "fp-tg"}
              title="替换时保留大小写"
              onClick={togglePreserveCase}
            >
              AB
            </button>
          </div>
          <button
            type="button"
            className="fp-rbtn"
            title="替换当前匹配"
            disabled={stats.count === 0}
            onClick={onReplaceCurrent}
          >
            替换
          </button>
          <button
            type="button"
            className="fp-rbtn"
            title="替换全部匹配"
            disabled={stats.count === 0}
            onClick={onReplaceAll}
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
}

export default FindReplacePanel;
