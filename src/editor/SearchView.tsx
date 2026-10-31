// 全局搜索侧栏（参考全局搜索图1 / VS Code 搜索视图）。
// 范围：项目树内纯文本文件（.tex/.bib/.log 等），排除二进制与构建产物目录；已打开缓冲用内存内容。
// 异步并发扫描、边扫边出结果；点击命中跳转到文件行并唤起单文件查找高亮。
// 跨文件替换：与单文件共用 applyReplacement 语义，替换前弹确认并提示受影响文件数。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import replaceAllIcon from "@/assets/icon/全部替换.svg";
import { confirm } from "@tauri-apps/plugin-dialog";
import { projectApi } from "@/ipc/invoke";
import { useProjectStore } from "@/project/useProject";
import { useBuffersStore } from "./useBuffers";
import { useFindStore } from "./findStore";
import { jumpToFile } from "./jump";
import { buildQuery, collectMatches, applyReplacement, pool, type MatchRange } from "./searchUtil";
import { Text } from "@codemirror/state";
import type { ProjectNode } from "@/types";

interface SResult {
  /** 1-based 行 */
  line: number;
  /** 1-based 列（首个命中的列，仅供展示） */
  col: number;
  /** 行文本 */
  text: string;
  /** 行内命中区间（相对行首的 [start,end) 列表） */
  hl: [number, number][];
}

interface SGroup {
  path: string;
  name: string;
  /** 该文件命中总数 */
  count: number;
  /** 命中所在行（去重） */
  lines: SResult[];
}

const TEXT_EXT = new Set([
  "tex", "ltx", "cls", "sty", "bst", "bib", "dtx", "ins", "ctx", "log", "txt", "md", "def", "ist",
]);
const BINARY_EXT = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "eps", "tif", "tiff", "avif", "zip",
]);
const EXCLUDE_DIRS = new Set(["build", "out", ".ltex", ".aux", ".git", "node_modules", "target"]);

function baseName(p: string): string {
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] || p;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 收集项目树内可搜索的纯文本文件路径（排除二进制与构建产物目录）。 */
function collectFiles(nodes: ProjectNode[] | undefined, root: string): string[] {
  const out: string[] = [];
  if (!nodes) return out;
  const walk = (ns: ProjectNode[]) => {
    for (const n of ns) {
      if (n.type === "dir") {
        if (EXCLUDE_DIRS.has(baseName(n.path).toLowerCase())) continue;
        if (n.children) walk(n.children);
      } else {
        const ext = extOf(n.path);
        if (BINARY_EXT.has(ext) || !TEXT_EXT.has(ext)) continue;
        out.push(n.path);
      }
    }
  };
  walk(nodes);
  void root;
  return out;
}

/** 把行文本按命中区间切片，命中片段用高亮标记。 */
function renderLine(text: string, hl: [number, number][]): ReactNode[] {
  const parts: ReactNode[] = [];
  let i = 0;
  const sorted = [...hl].sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (s > i) parts.push(text.slice(i, s));
    parts.push(
      <mark className="sv-hl" key={`${i}`}>
        {text.slice(s, e)}
      </mark>,
    );
    i = e;
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

export function SearchView() {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [groups, setGroups] = useState<SGroup[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const totalMatches = groups.reduce((s, g) => s + g.count, 0);

  const runSearch = useCallback(async () => {
    setError(null);
    const q = buildQuery(query, { caseSensitive, wholeWord, regexp });
    if (!q.valid || q.search === "") {
      setGroups([]);
      setStatus("idle");
      return;
    }
    const tree = useProjectStore.getState().tree;
    const root = useProjectStore.getState().root;
    if (!tree || !root) {
      setError("未打开项目，无法全局搜索");
      setStatus("idle");
      return;
    }
    const files = collectFiles(tree.nodes, root);
    if (files.length === 0) {
      setGroups([]);
      setStatus("done");
      return;
    }
    setStatus("searching");
    const resultGroups: SGroup[] = [];
    const bs = useBuffersStore.getState();
    await pool(files, 8, async (path) => {
      let content: string | undefined = bs.buffers.find((b) => b.path === path)?.content;
      if (content === undefined) {
        try {
          const d = await projectApi.readFile(path);
          content = d.content;
        } catch {
          return;
        }
      }
      const norm = content.replace(/\r\n/g, "\n");
      const cmText = Text.of(norm.split("\n"));
      const matches = collectMatches(cmText, q);
      if (matches.length === 0) return;
      const lines: SResult[] = [];
      let curLine = -1;
      let cur: SResult | null = null;
      for (const m of matches) {
        const lineObj = cmText.lineAt(m.from);
        if (lineObj.number !== curLine) {
          cur = {
            line: lineObj.number,
            col: m.from - lineObj.from + 1,
            text: lineObj.text,
            hl: [],
          };
          lines.push(cur);
          curLine = lineObj.number;
        }
        cur!.hl.push([m.from - lineObj.from, m.to - lineObj.from]);
      }
      resultGroups.push({ path, name: baseName(path), count: matches.length, lines });
    });
    resultGroups.sort((a, b) => a.path.localeCompare(b.path));
    setGroups(resultGroups);
    setStatus("done");
  }, [query, caseSensitive, wholeWord, regexp]);

  // 输入即搜（防抖 350ms）；清空时复位
  useEffect(() => {
    if (!query) {
      setGroups([]);
      setStatus("idle");
      setError(null);
      return;
    }
    const id = window.setTimeout(() => {
      void runSearch();
    }, 350);
    return () => window.clearTimeout(id);
  }, [query, caseSensitive, wholeWord, regexp, runSearch]);

  // 视图打开时聚焦搜索框
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const runReplaceAll = useCallback(async () => {
    if (!query) return;
    const q = buildQuery(query, { caseSensitive, wholeWord, regexp });
    if (!q.valid) return;
    const tree = useProjectStore.getState().tree;
    const root = useProjectStore.getState().root;
    if (!tree || !root) {
      setError("未打开项目，无法替换");
      return;
    }
    const files = collectFiles(tree.nodes, root);
    const targets: { path: string; content: string; matches: MatchRange[] }[] = [];
    const bs = useBuffersStore.getState();
    for (const path of files) {
      let content: string | undefined = bs.buffers.find((b) => b.path === path)?.content;
      if (content === undefined) {
        try {
          const d = await projectApi.readFile(path);
          content = d.content;
        } catch {
          continue;
        }
      }
      const norm = content.replace(/\r\n/g, "\n");
      const cmText = Text.of(norm.split("\n"));
      const matches = collectMatches(cmText, q);
      if (matches.length) targets.push({ path, content: norm, matches });
    }
    const total = targets.reduce((s, t) => s + t.matches.length, 0);
    if (total === 0) return;
    const ok = await confirm(
      `将替换 ${targets.length} 个文件中的 ${total} 处匹配，并写入磁盘 / 保存缓冲。是否继续？`,
      { title: "跨文件替换", kind: "warning", okLabel: "替换", cancelLabel: "取消" },
    );
    if (!ok) return;
    let replacedFiles = 0;
    for (const t of targets) {
      let out = "";
      let last = 0;
      for (const m of t.matches) {
        out += t.content.slice(last, m.from);
        out += applyReplacement(q.replace, q.regexp, m.match, {
          preserveCase,
          matchText: t.content.slice(m.from, m.to),
        });
        last = m.to;
      }
      out += t.content.slice(last);
      const buf = useBuffersStore.getState().buffers.find((b) => b.path === t.path);
      if (buf) {
        useBuffersStore.getState().updateContent(t.path, out);
        await useBuffersStore.getState().saveBuffer(t.path);
      } else {
        await projectApi.writeFile(t.path, out);
      }
      replacedFiles++;
    }
    useBuffersStore.setState({
      notice: { text: `已替换 ${replacedFiles} 个文件 / ${total} 处`, kind: "ok" },
    });
    await runSearch();
  }, [query, caseSensitive, wholeWord, regexp, preserveCase, runSearch]);

  const onMatchClick = (r: SResult, path: string) => {
    jumpToFile(path, r.line, r.col);
    useFindStore.getState().openFind({ query, caseSensitive, wholeWord, regexp, replaceMode: false });
  };

  /** 在编辑器中打开第一个命中（对应 VS Code 搜索结果的「在编辑器中打开」）。 */
  const onOpenFirst = () => {
    const g = groups[0];
    if (!g || g.lines.length === 0) return;
    onMatchClick(g.lines[0], g.path);
  };

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  };

  const hasQuery = query.trim() !== "";

  return (
    <div className="side-view search-view">
      <div className="side-head">
        <div className="side-title">搜索</div>
        <div className="sv-head-tools">
          <button
            type="button"
            className="ibtn"
            title="刷新（重新搜索）"
            disabled={!hasQuery}
            onClick={() => void runSearch()}
          >
            <Icon name="refresh" size={14} />
          </button>
          <button
            type="button"
            className="ibtn"
            title="清除"
            onClick={() => {
              setQuery("");
              setReplace("");
              setGroups([]);
              setStatus("idle");
              setError(null);
              inputRef.current?.focus();
            }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      <div className="sv-body">
        <div className="sv-input-row">
          <button
            type="button"
            className="sv-caret"
            title={showReplace ? "折叠替换" : "展开替换"}
            onClick={() => setShowReplace((v) => !v)}
          >
            <Icon
              name="chev"
              size={12}
              style={{ transform: showReplace ? "rotate(0deg)" : "rotate(-90deg)" }}
            />
          </button>
          <div className="sv-field">
            <input
              ref={inputRef}
              className="sv-input"
              type="text"
              placeholder="搜索"
              value={query}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            <div className="sv-toggles">
              <button
                type="button"
                className={caseSensitive ? "fp-tg on" : "fp-tg"}
                title="区分大小写"
                onClick={() => setCaseSensitive((v) => !v)}
              >
                Aa
              </button>
              <button
                type="button"
                className={wholeWord ? "fp-tg on" : "fp-tg"}
                title="整词匹配"
                onClick={() => setWholeWord((v) => !v)}
              >
                ab
              </button>
              <button
                type="button"
                className={regexp ? "fp-tg on" : "fp-tg"}
                title="正则表达式"
                onClick={() => setRegexp((v) => !v)}
              >
                .*
              </button>
            </div>
          </div>
        </div>

        {showReplace && (
          <div className="sv-input-row sv-input-row--replace">
            <span className="sv-caret-placeholder" />
            <div className="sv-field">
              <input
                className="sv-input"
                type="text"
                placeholder="替换为"
                value={replace}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setReplace(e.target.value)}
              />
              <div className="sv-toggles">
                <button
                  type="button"
                  className={preserveCase ? "fp-tg on" : "fp-tg"}
                  title="替换时保留大小写"
                  onClick={() => setPreserveCase((v) => !v)}
                >
                  AB
                </button>
              </div>
            </div>
            <button
              type="button"
              className="sv-replace-all"
              title="在所有文件中替换"
              aria-label="在所有文件中替换"
              disabled={!hasQuery}
              onClick={() => void runReplaceAll()}
            >
              <span
                className="ra-icon"
                style={{
                  WebkitMaskImage: `url("${replaceAllIcon}")`,
                  maskImage: `url("${replaceAllIcon}")`,
                }}
              />
            </button>
          </div>
        )}

        <div className="sv-summary">
          {error ? (
            <span className="sv-error">{error}</span>
          ) : status === "searching" ? (
            <span>搜索中…</span>
          ) : hasQuery ? (
            totalMatches === 0 ? (
              <span>无结果</span>
            ) : (
              <span className="sv-summary-row">
                <span>
                  {totalMatches} 个结果 · {groups.length} 个文件
                </span>
                <button
                  type="button"
                  className="sv-open-link"
                  title="在编辑器中打开第一个命中"
                  onClick={onOpenFirst}
                >
                  在编辑器中打开
                </button>
              </span>
            )
          ) : (
            <span className="sv-hint">输入关键字开始搜索</span>
          )}
        </div>

        <div className="sv-results">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.path);
            return (
              <div className="sv-group" key={g.path}>
                <button
                  type="button"
                  className="sv-file"
                  onClick={() => toggleCollapse(g.path)}
                  title={g.path}
                >
                  <Icon
                    name="chev"
                    size={11}
                    style={{
                      transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                      flex: "none",
                    }}
                  />
                  <span className="sv-file-name">{g.name}</span>
                  <span className="sv-file-count">{g.count}</span>
                </button>
                {!isCollapsed &&
                  g.lines.map((r) => (
                    <button
                      type="button"
                      className="sv-match"
                      key={r.line}
                      onClick={() => onMatchClick(r, g.path)}
                    >
                      <span className="sv-line-no">{r.line}</span>
                      <span className="sv-match-text">{renderLine(r.text, r.hl)}</span>
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SearchView;
