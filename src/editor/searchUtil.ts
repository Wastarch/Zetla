// 查找替换核心库 —— 基于 @codemirror/search 的 SearchQuery，统一单文件与全局（跨文件）的匹配/替换语义。
// 设计要点：
//  - 单文件：把查询经 setSearchQuery 注入活动编辑器，由 searchMatchHighlighter 高亮所有匹配，findNext/findPrevious 导航。
//  - 全局：对每个文件文本构建 CM Text，用同一套 SearchQuery 扫描，保证两处结果口径完全一致。
//  - 替换：复制 CM 的替换语义（字面量 \n 解引用、正则 $1/$& 捕获组），并额外支持「保留大小写」。
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
} from "@codemirror/search";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorSelection, Text } from "@codemirror/state";

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface MatchRange {
  from: number;
  to: number;
  /** 正则模式下的捕获组（字面量模式为 null） */
  match: RegExpExecArray | null;
}

/** 构造查询。注意：wholeWord 仅在非正则时生效（CM 对正则忽略此项）。 */
export function buildQuery(search: string, opts: FindOptions, replace = ""): SearchQuery {
  return new SearchQuery({
    search,
    caseSensitive: opts.caseSensitive,
    regexp: opts.regexp,
    wholeWord: !opts.regexp && opts.wholeWord,
    replace,
  });
}

/** 扫描文本全部匹配（含安全上限，避免超大文档卡顿）。 */
export function collectMatches(text: Text, query: SearchQuery): MatchRange[] {
  if (!query.valid || query.search === "") return [];
  const out: MatchRange[] = [];
  const it = query.getCursor(text);
  let r = it.next();
  while (!r.done) {
    const v = r.value as { from: number; to: number; match?: RegExpExecArray | null };
    out.push({ from: v.from, to: v.to, match: v.match ?? null });
    if (out.length >= 5000) break;
    r = it.next();
  }
  return out;
}

/** 由匹配列表与光标位置计算「总数 / 当前序号」。 */
export function matchStats(matches: MatchRange[], head: number): { count: number; index: number } {
  let before = 0;
  for (const m of matches) if (m.to <= head) before++;
  const index = matches.length === 0 ? 0 : Math.min(before + 1, matches.length);
  return { count: matches.length, index };
}

/**
 * 复制 @codemirror/search 的替换语义，保证跨文件替换与编辑器内完全一致：
 *  - 字面量：把替换串里的 \n \r \t 解引用为真实字符（literal 标志为 false 时）。
 *  - 正则：处理 $&（整匹配）、$$（字面 $）、$1..$99（捕获组）。
 *  - preserveCase：额外把替换结果的大小写形态对齐到被替换文本（仅字面量模式）。
 */
function unquote(s: string): string {
  return s.replace(/\\([nrt\\])/g, (_, c) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : "\\",
  );
}

export function applyReplacement(
  replaceSpec: string,
  isRegex: boolean,
  m: RegExpExecArray | null,
  opts?: { preserveCase?: boolean; matchText?: string },
): string {
  const base = unquote(replaceSpec);
  let out: string;
  if (!isRegex || !m) {
    out = base;
  } else {
    out = base.replace(/\$([$&]|\d+)/g, (sub, i) => {
      if (i === "&") return m[0];
      if (i === "$") return "$";
      for (let l = i.length; l > 0; l--) {
        const n = Number(i.slice(0, l));
        if (n > 0 && n < m.length) return m[n] + i.slice(l);
      }
      return sub;
    });
  }
  if (opts?.preserveCase && opts.matchText && !isRegex) {
    out = matchCase(out, opts.matchText);
  }
  return out;
}

/** 把 target 的大小写形态对齐到 ref（全大写/全小写/首字母大写/其余原样）。 */
function matchCase(target: string, ref: string): string {
  const isUpper = ref === ref.toUpperCase() && ref !== ref.toLowerCase();
  const isLower = ref === ref.toLowerCase() && ref !== ref.toUpperCase();
  const isTitle = ref.length > 0 && ref[0]! === ref[0]!.toUpperCase();
  if (isUpper) return target.toUpperCase();
  if (isLower) return target.toLowerCase();
  if (isTitle) return target.charAt(0).toUpperCase() + target.slice(1);
  return target;
}

/** 把查询注入视图（触发高亮），不改变选区。 */
export function applyQueryToView(view: EditorView, query: SearchQuery): void {
  view.dispatch({ effects: setSearchQuery.of(query) });
}

/** 清空视图内的搜索查询（移除高亮）。 */
export function clearQueryInView(view: EditorView | null): void {
  if (!view) return;
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
}

/** 选中首个匹配（从文档顶部）；无匹配返回 false。 */
export function selectFirstMatch(view: EditorView, query: SearchQuery): boolean {
  if (!query.valid || query.search === "") return false;
  const r = query.getCursor(view.state.doc).next();
  if (r.done) return false;
  const { from, to } = r.value;
  view.dispatch({
    selection: EditorSelection.single(from, to),
    effects: EditorView.scrollIntoView(to, { y: "center" }),
    userEvent: "select.search",
  });
  return true;
}

/** 跳到下一个匹配（findNext 命令）。 */
export function goNext(view: EditorView): boolean {
  return findNext(view);
}

/** 跳到上一个匹配（findPrevious 命令）。 */
export function goPrev(view: EditorView): boolean {
  return findPrevious(view);
}

/**
 * 替换当前选区处的匹配（手动实现以支持「保留大小写」）。
 * 返回是否真的替换了；替换后选区落在替换文本之后。
 */
export function replaceRangeInView(
  view: EditorView,
  query: SearchQuery,
  preserveCase: boolean,
): boolean {
  const sel = view.state.selection.main;
  const matches = collectMatches(view.state.doc, query);
  const m =
    matches.find((mm) => mm.from === sel.from && mm.to === sel.to) ??
    matches.find((mm) => mm.from <= sel.head && sel.head <= mm.to) ??
    matches.find((mm) => mm.to > sel.from);
  if (!m) return false;
  const repl = applyReplacement(query.replace, query.regexp, m.match, {
    preserveCase,
    matchText: view.state.doc.sliceString(m.from, m.to),
  });
  view.dispatch({
    changes: { from: m.from, to: m.to, insert: repl },
    selection: EditorSelection.single(m.from, m.from + repl.length),
    userEvent: "input.replace",
  });
  // 替换后顺势跳到下一个匹配（从新选区之后扫描）
  goNext(view);
  return true;
}

/** 替换视图内全部匹配（手动实现以支持「保留大小写」），返回替换处数。 */
export function replaceAllInView(
  view: EditorView,
  query: SearchQuery,
  preserveCase: boolean,
): number {
  const matches = collectMatches(view.state.doc, query);
  if (matches.length === 0) return 0;
  const changes = matches
    .slice()
    .reverse()
    .map((m) => ({
      from: m.from,
      to: m.to,
      insert: applyReplacement(query.replace, query.regexp, m.match, {
        preserveCase,
        matchText: view.state.doc.sliceString(m.from, m.to),
      }),
    }));
  view.dispatch({ changes, userEvent: "input.replace.all" });
  return matches.length;
}

/**
 * 全文档匹配高亮（VS Code 风格）：读取当前编辑器内搜索状态，标记所有匹配，
 * 命中选区的那一项用更强样式（复用 zetla.css 的 .cm-searchMatch / .cm-searchMatch-selected）。
 * 必须在编辑器挂载 search() 扩展后才生效（setSearchQuery 依赖该状态字段）。
 */
export function searchMatchHighlighter() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))
        ) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const query = getSearchQuery(view.state);
        if (!query.valid || query.search === "") return Decoration.none;
        const sel = view.state.selection.main;
        const ranges: { from: number; to: number; cls: string }[] = [];
        const it = query.getCursor(view.state.doc);
        let r = it.next();
        let count = 0;
        while (!r.done) {
          const v = r.value as { from: number; to: number };
          const isCurrent =
            (v.from === sel.from && v.to === sel.to) ||
            (v.from <= sel.head && sel.head <= v.to);
          ranges.push({
            from: v.from,
            to: v.to,
            cls: isCurrent ? "cm-searchMatch cm-searchMatch-selected" : "cm-searchMatch",
          });
          count++;
          if (count >= 1000) break;
          r = it.next();
        }
        return Decoration.set(
          ranges.map((rg) => Decoration.mark({ class: rg.cls }).range(rg.from, rg.to)),
          true,
        );
      }
    },
    { decorations: (v: { decorations: DecorationSet }) => v.decorations },
  );
}

/** 简单并发池：以 limit 并发执行 tasks，全部完成后 resolve。 */
export async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]!);
    }
  });
  await Promise.all(runners);
}
