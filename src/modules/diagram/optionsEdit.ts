// M2·F2-2：图元属性编辑的纯逻辑（不依赖 DOM / React，Node 侧可直接回归）。
//
// 数据来源：`renderTikzToSvg()` 返回的 `parse.figure.body`。上游每个语句带
// `id`（与 SVG 的 `data-source-id` 一致）、`span`、`options.span / entries`；
// `\node` 的选项在 `items[].kind === "Node"` 上，`\draw` / `Scope` 在语句顶层。
// 本模块只做「读 + 生成最小 span 补丁」，真正写入由 `sourceBridge` dispatch 到
// CM6（与键盘直编、F2-1 拖拽共用同一条撤销栈），绝不整篇替换源码。
//
// 设计约束：
//   ① 每次只改一个选项 —— replace / delete / insert 各是**单个** span 补丁，
//      其余缩进、换行、注释、未知选项一字不动；
//   ② 同类选项出现多个（如同时写了 thick 与 line width=1pt）不猜用户意图，
//      报错让用户先在源码里整理，避免静默改语义；
//   ③ \foreach 展开 / 非标准选项写法一律锁定，交给源码栏；
//   ④ 自定义值先过白名单校验，禁止把 `]` / `,` / `%` / `\` / 换行注入源码。
import type { SourceSpanPatch } from "./dragEdit.ts";

export interface SourceSpan {
  from: number;
  to: number;
}

export interface TikzOptionEntry {
  /** 上游归一化后的 key（flag 时就是 `->` / `blue!20` / `thick`） */
  key: string;
  /** 精确源码切片，用于写回前校验语句未过期 */
  raw: string;
  span: SourceSpan;
  /** kv 形式（如 `fill=red!20`）的字符串值；flag 为 null */
  value: string | null;
}

export interface TikzStatement {
  /** 与 SVG `data-source-id` 一致，例如 `path:0` / `scope:0` / `foreach:2` */
  id: string;
  kind: string;
  /** draw / node / fill / path / filldraw…；Scope / Foreach 为空 */
  command: string;
  span: SourceSpan;
  /** 含 `[` `]` 的整段选项范围；null = 该语句当前没有选项 */
  optionsSpan: SourceSpan | null;
  /** optionsSpan 对应的原文，用于校验是标准方括号写法 */
  optionsRaw: string | null;
  /** 按源码顺序排列的选项条目 */
  entries: TikzOptionEntry[];
  /** 无选项时插入 `[...]` 的位置（命令名 / `\begin{scope}` 之后）；-1 表示无法定位 */
  insertOffset: number;
}

export type PropertyKey = "stroke" | "lineWidth" | "arrow" | "dash" | "fill";

export const PROPERTY_LABELS: Record<PropertyKey, string> = {
  stroke: "线条 / 边框颜色",
  lineWidth: "线宽",
  arrow: "箭头",
  dash: "线型",
  fill: "填充",
};

export interface PropertyChoice {
  /** 传给 planPropertyPatch 的值；null 表示「默认 / 移除该选项」 */
  value: string | null;
  label: string;
}

const choice = (value: string | null, label?: string): PropertyChoice => ({
  value,
  label: label ?? value ?? "默认（移除）",
});

/** 侧栏下拉预设；自定义值走校验后的文本框，避免把任意 LaTeX 拼进选项。 */
export const PROPERTY_PRESETS: Record<PropertyKey, PropertyChoice[]> = {
  stroke: [
    choice(null),
    ...["black", "white", "red", "blue", "green", "orange", "violet", "teal", "magenta", "brown", "gray", "black!50", "red!60", "blue!30"].map((c) => choice(c)),
  ],
  lineWidth: [
    choice(null),
    ...["ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick", "line width=0.4pt", "line width=0.8pt", "line width=1.2pt", "line width=2pt"].map((c) => choice(c)),
  ],
  arrow: [
    choice(null, "无箭头（默认）"),
    ...["->", "<-", "<->", "->>", "<<-", "->|", "|->", "-latex", "latex-", "-stealth", "stealth-"].map((c) => choice(c)),
  ],
  dash: [
    choice(null, "实线（默认）"),
    ...["dashed", "dotted", "densely dashed", "loosely dashed", "densely dotted", "dashdotted"].map((c) => choice(c)),
  ],
  fill: [
    choice(null, "无填充（默认）"),
    ...["red!20", "blue!20", "green!20", "gray!20", "yellow!20", "orange!20", "black!10", "white"].map((c) => choice(c)),
  ],
};

const ALL_KEYS: PropertyKey[] = ["stroke", "lineWidth", "arrow", "dash", "fill"];
const EDITABLE_COMMANDS = new Set(["draw", "node", "path", "fill", "filldraw", "shade", "clip"]);

const BASE_COLORS = new Set([
  "black", "white", "red", "green", "blue", "cyan", "magenta", "yellow",
  "gray", "grey", "darkgray", "lightgray", "brown", "lime", "olive",
  "orange", "pink", "purple", "teal", "violet",
]);
const WIDTH_FLAGS = new Set([
  "ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick",
]);
const ARROW_FLAGS = new Set([
  "-", "->", "<-", "<->", "->>", "<<-", "->|", "|->", "<->>", ">>-",
  "-latex", "latex-", "-stealth", "stealth-", "-to", "to-", "-|", "|-",
]);
const DASH_FLAGS = new Set([
  "solid", "dashed", "dotted", "dashdotted", "densely dashed", "loosely dashed",
  "densely dotted", "loosely dotted", "densely dashdotted",
]);

/** `blue!20` / `red!50!white` 这类 xcolor 混色写法。 */
export function isColorFlag(key: string): boolean {
  const parts = key.split("!");
  if (!BASE_COLORS.has(parts[0].toLowerCase())) return false;
  for (let i = 1; i < parts.length; i += 1) {
    const p = parts[i];
    if (!p || (!/^\d{1,3}$/.test(p) && !BASE_COLORS.has(p.toLowerCase()))) return false;
  }
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readSpan(v: unknown, length: number): SourceSpan | null {
  if (!isRecord(v)) return null;
  const { from, to } = v;
  if (typeof from !== "number" || typeof to !== "number") return null;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || to < from || to > length) return null;
  return { from, to };
}

interface OptionBlock {
  span: SourceSpan;
  raw: string;
  entries: TikzOptionEntry[];
}

/**
 * 找语句的选项块：\draw / Scope 在顶层 `options`，\node 在 `items[].Node.options`。
 * 上游 entries 已带精确 span，直接沿用，避免自己再写一遍方括号 / 嵌套 brace 扫描。
 */
function pickOptions(item: Record<string, unknown>, source: string): OptionBlock | null {
  const candidates: unknown[] = [item.options];
  if (Array.isArray(item.items)) {
    for (const sub of item.items) {
      if (!isRecord(sub)) continue;
      if (sub.kind === "PathOption" || sub.kind === "Node") candidates.push(sub.options);
    }
  }
  for (const c of candidates) {
    if (!isRecord(c)) continue;
    const span = readSpan(c.span, source.length);
    if (!span) continue;
    const entries: TikzOptionEntry[] = [];
    if (Array.isArray(c.entries)) {
      for (const e of c.entries) {
        if (!isRecord(e)) continue;
        const es = readSpan(e.span, source.length);
        const key = typeof e.key === "string" ? e.key.trim() : "";
        if (!es || !key) continue;
        entries.push({
          key,
          raw: source.slice(es.from, es.to),
          span: es,
          value: typeof e.valueRaw === "string" ? e.valueRaw : null,
        });
      }
    }
    entries.sort((a, b) => a.span.from - b.span.from);
    return { span, raw: source.slice(span.from, span.to), entries };
  }
  return null;
}

function computeInsertOffset(source: string, from: number, kind: string): number {
  const tail = source.slice(from, from + 80);
  if (kind === "Scope") {
    const m = /^\\begin\{[^}]+\}/.exec(tail);
    if (m) return from + m[0].length;
  }
  const m = /^\\([a-zA-Z]+)\*?/.exec(tail);
  return m ? from + m[0].length : -1;
}

/** 把上游 `parse.figure` 归一化成侧栏可用的语句清单；递归进 Scope.body。 */
export function collectStatements(figure: unknown, source: string): TikzStatement[] {
  const out: TikzStatement[] = [];
  if (!isRecord(figure)) return out;
  const walk = (body: unknown, depth: number): void => {
    if (!Array.isArray(body) || depth > 4) return;
    for (const item of body) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id : "";
      const span = readSpan(item.span, source.length);
      if (!id || !span) continue;
      const kind = typeof item.kind === "string" ? item.kind : "";
      const command = typeof item.command === "string" ? item.command : "";
      const block = pickOptions(item, source);
      out.push({
        id,
        kind,
        command,
        span,
        optionsSpan: block?.span ?? null,
        optionsRaw: block?.raw ?? null,
        entries: block?.entries ?? [],
        insertOffset: computeInsertOffset(source, span.from, kind),
      });
      if (Array.isArray(item.body)) walk(item.body, depth + 1);
    }
  };
  walk(figure.body, 0);
  return out;
}

export interface StatementEditability {
  editable: boolean;
  reason: string;
  keys: PropertyKey[];
}

/** 属性面板能不能改这个语句；不可改时给出具体理由（不是笼统的「不支持」）。 */
export function statementEditability(stmt: TikzStatement): StatementEditability {
  const locked = (reason: string): StatementEditability => ({ editable: false, reason, keys: [] });
  if (stmt.kind === "Foreach") {
    return locked("\\foreach 展开的图元没有独立选项行，请在源码栏直接编辑循环体。");
  }
  if (stmt.kind !== "Path" && stmt.kind !== "Scope") {
    return locked(`暂不支持编辑 ${stmt.kind || "该语句"} 的选项，请在源码栏修改。`);
  }
  if (stmt.kind === "Path" && !EDITABLE_COMMANDS.has(stmt.command)) {
    return locked(`\\${stmt.command || "?"} 语句的选项超出 v1 属性范围，请在源码栏修改。`);
  }
  if (stmt.optionsSpan && stmt.optionsRaw && !/^\[[\s\S]*\]$/.test(stmt.optionsRaw.trim())) {
    return locked("该语句的选项不是标准方括号写法，为避免破坏结构已锁定。");
  }
  if (!stmt.optionsSpan && stmt.insertOffset < 0) {
    return locked("无法定位选项插入位置，请在源码栏直接修改。");
  }
  const keys = stmt.command === "node" ? ALL_KEYS.filter((k) => k !== "arrow") : ALL_KEYS;
  return { editable: true, reason: "", keys };
}

function matchesProperty(entry: TikzOptionEntry, key: PropertyKey, command: string): boolean {
  const k = entry.key.toLowerCase();
  const isKv = entry.value !== null;
  switch (key) {
    case "stroke":
      // `\fill[green!30]` 里的裸颜色是填充色，不是描边色
      return isKv ? k === "draw" || k === "color" : command !== "fill" && isColorFlag(entry.key);
    case "lineWidth":
      return isKv ? k === "line width" : WIDTH_FLAGS.has(k);
    case "arrow":
      return !isKv && ARROW_FLAGS.has(entry.key);
    case "dash":
      return !isKv && DASH_FLAGS.has(k);
    case "fill":
      return isKv ? k === "fill" : command === "fill" && isColorFlag(entry.key);
  }
}

/** 当前属性值（与预设 value 同口径）；null = 未显式设置。 */
export function readProperty(stmt: TikzStatement, key: PropertyKey): string | null {
  const hits = stmt.entries.filter((e) => matchesProperty(e, key, stmt.command));
  const hit = hits[hits.length - 1];
  if (!hit) return null;
  if (key === "stroke" || key === "fill") return hit.value ?? hit.key;
  if (key === "lineWidth") return hit.value !== null ? `line width=${hit.value}` : hit.key;
  return hit.key;
}

function optionRawFor(
  key: PropertyKey,
  value: string,
  stmt: TikzStatement,
  hit: TikzOptionEntry | null,
): string {
  if (key === "stroke") {
    return stmt.command === "fill" || (hit?.value ?? null) !== null ? `draw=${value}` : value;
  }
  if (key === "fill") {
    return stmt.command !== "fill" || (hit?.value ?? null) !== null ? `fill=${value}` : value;
  }
  return value;
}

const DANGEROUS = /[\\{}\[\],;%"'\r\n]/;

/** 自定义输入校验：拒绝会把源码结构写坏的字符，并把线宽简写补成合法 TikZ。 */
export function normalizeCustomValue(
  key: PropertyKey,
  text: string,
): { value: string } | { error: string } {
  const t = text.trim();
  if (!t) return { error: "请输入值，或选择「默认 / 移除」。" };
  if (t.length > 64 || DANGEROUS.test(t)) {
    return { error: "不能包含 \\ { } [ ] , ; % 引号或换行，避免破坏 TikZ 选项结构。" };
  }
  switch (key) {
    case "stroke":
    case "fill":
      if (!/^[A-Za-z][A-Za-z0-9!.]*$/.test(t)) {
        return { error: "颜色请用 black / blue!30 / red!50!white 这类写法。" };
      }
      return { value: t };
    case "lineWidth":
      if (WIDTH_FLAGS.has(t.toLowerCase())) return { value: t };
      if (/^line width=[0-9.]+(pt|cm|mm|in|em|ex)$/.test(t)) return { value: t };
      if (/^[0-9.]+(pt|cm|mm|in|em|ex)$/.test(t)) return { value: `line width=${t}` };
      return { error: "线宽请填 thick 等预设，或 1.2pt / line width=1.2pt。" };
    case "arrow":
      return ARROW_FLAGS.has(t) ? { value: t } : { error: "箭头样式请从预设里选择。" };
    case "dash":
      return DASH_FLAGS.has(t.toLowerCase()) ? { value: t } : { error: "线型样式请从预设里选择。" };
  }
}

export type PropertyPatchPlan =
  | { status: "ok"; patch: SourceSpanPatch; label: string }
  | { status: "noop" }
  | { status: "error"; reason: string };

function removalPatch(stmt: TikzStatement, hit: TikzOptionEntry, source: string): SourceSpanPatch {
  const idx = stmt.entries.indexOf(hit);
  const isLast = idx === stmt.entries.length - 1;
  if (!isLast) {
    // 删掉「本条目 + 它后面的逗号与空格」，保留前一条目的分隔符
    const next = stmt.entries[idx + 1];
    return { from: hit.span.from, to: next.span.from, insert: "" };
  }
  const prevTo = idx > 0
    ? stmt.entries[idx - 1].span.to
    : (stmt.optionsSpan?.from ?? hit.span.from) + 1;
  const between = source.slice(prevTo, hit.span.from);
  const comma = between.lastIndexOf(",");
  const from = comma >= 0 ? prevTo + comma : hit.span.from;
  return { from, to: hit.span.to, insert: "" };
}

function insertionPatch(
  source: string,
  stmt: TikzStatement,
  raw: string,
): SourceSpanPatch | null {
  if (!stmt.optionsSpan) {
    const at = stmt.insertOffset;
    return at >= 0 && at <= source.length ? { from: at, to: at, insert: `[${raw}]` } : null;
  }
  const bracket = stmt.optionsSpan;
  if (source[bracket.from] !== "[" || source[bracket.to - 1] !== "]") return null;
  const innerFrom = bracket.from + 1;
  const innerTo = bracket.to - 1;
  if (stmt.entries.length === 0) {
    let at = innerFrom;
    while (at < innerTo && /\s/.test(source[at])) at += 1;
    return { from: at, to: at, insert: raw };
  }
  const last = stmt.entries[stmt.entries.length - 1];
  const at = Math.min(Math.max(last.span.to, innerFrom), innerTo);
  return { from: at, to: at, insert: `, ${raw}` };
}

/**
 * 生成「一次属性改动」的最小源码补丁。
 * 返回 noop 表示当前已是该值；error 表示锁定 / 歧义 / 源码已变，不写任何东西。
 */
export function planPropertyPatch(
  source: string,
  stmt: TikzStatement,
  key: PropertyKey,
  value: string | null,
): PropertyPatchPlan {
  const edit = statementEditability(stmt);
  if (!edit.editable) return { status: "error", reason: edit.reason };
  if (!edit.keys.includes(key)) return { status: "error", reason: "该类型图元不支持此属性。" };
  if (value !== null) {
    const normalized = normalizeCustomValue(key, value);
    if ("error" in normalized) return { status: "error", reason: normalized.error };
    value = normalized.value;
  }
  const hits = stmt.entries.filter((e) => matchesProperty(e, key, stmt.command));
  if (hits.length > 1) {
    return {
      status: "error",
      reason: `检测到 ${hits.length} 个同类选项（${hits.map((h) => h.raw).join(" / ")}），请先在源码里整理。`,
    };
  }
  const hit = hits[0] ?? null;
  const current = readProperty(stmt, key);
  if (value === null && !hit) return { status: "noop" };
  if (value !== null && current === value) return { status: "noop" };
  if (hit && source.slice(hit.span.from, hit.span.to) !== hit.raw) {
    return { status: "error", reason: "源码在选择期间已变化，请重新点击图元。" };
  }

  let patch: SourceSpanPatch | null;
  if (hit && value !== null) {
    patch = { from: hit.span.from, to: hit.span.to, insert: optionRawFor(key, value, stmt, hit) };
  } else if (hit) {
    patch = removalPatch(stmt, hit, source);
  } else {
    patch = insertionPatch(source, stmt, optionRawFor(key, value ?? "", stmt, null));
  }
  if (!patch || patch.from < 0 || patch.to < patch.from || patch.to > source.length) {
    return { status: "error", reason: "选项范围已失效，请重新点击图元。" };
  }
  const label = `${PROPERTY_LABELS[key]}：${current ?? "默认"} → ${value ?? "默认"}`;
  return { status: "ok", patch, label };
}

/** 纯函数：把补丁应用到源码（bridge 不可用时的降级路径，也可用于回归断言）。 */
export function applyPatchToSource(source: string, patch: SourceSpanPatch): string {
  return source.slice(0, patch.from) + patch.insert + source.slice(patch.to);
}

/** 侧栏图元列表用的短标签。 */
export function statementLabel(stmt: TikzStatement, source: string): string {
  const raw = source.slice(stmt.span.from, Math.min(stmt.span.to, stmt.span.from + 64));
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length >= 64 ? `${flat.slice(0, 61)}…` : flat;
}
