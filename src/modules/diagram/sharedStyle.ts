// M2 · F4-1：共享 .style 的**只读**轻量扫描器（纯逻辑，Node 可回归）。
//
// 边界（计划书 §4 硬约束）：collectStatements 只遍历 parse.figure.body，
// 读不到 \begin{tikzpicture}[...] 环境选项与 \tikzset 的 .style 定义，
// 因此这里只做源码文本扫描，**产出供 UI 提示与「应用范围」决策的信息**：
//   · 绝不把共享样式伪装成 TikzStatement；
//   · 绝不进 pickOptions / collectStatements / 上游语义层；
//   · 写回永远只针对单条 \node 的 options.span（具体化模式），
//     或经 planSizePatches 对多条 \node 一次批量写（同类模式），
//     **不改写 .style 定义处**，避免静默影响未选中的节点。
// 未命中时零开销、不抛异常。相对 import 带 .ts（Node strip-types 直跑）。
import type { SourceSpan, TikzStatement } from "./optionsEdit.ts";
import { SIZE_KEYS, type SizeKey } from "./sizeEdit.ts";

export type SharedStyleOrigin = "tikzpicture" | "tikzset" | "every-node";

export interface SharedStyleDef {
  /** 样式名，如 `box` / `every node` */
  name: string;
  /** 定义处整体范围（.style={...} 的花括号，或环境选项方括号） */
  definitionSpan: SourceSpan;
  /** 该定义里出现的尺寸键 */
  sizeKeys: SizeKey[];
  raw: string;
  origin: SharedStyleOrigin;
}

interface Span {
  from: number;
  to: number;
}

/** 从 open 起做花括号 / 方括号配对；返回匹配的闭括号之后一位，失败返回 -1。 */
function matchBracket(source: string, open: number, left: string, right: string): number {
  if (open < 0 || open >= source.length || source[open] !== left) return -1;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === left) depth += 1;
    else if (ch === right) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function keysIn(raw: string): SizeKey[] {
  return SIZE_KEYS.filter((k) => new RegExp(`(^|[,{=\\s])${k}\\s*=`, "i").test(raw));
}

/** 找 `name/.style={...}`，名字允许 `every node` 这类含空格写法。 */
function styleDefsIn(source: string, block: Span, origin: SharedStyleOrigin): SharedStyleDef[] {
  const out: SharedStyleDef[] = [];
  const text = source.slice(block.from, block.to);
  const re = /([A-Za-z][A-Za-z0-9 _/-]*?)\s*\/\s*\.style\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (!name) continue;
    const open = block.from + m.index + m[0].length - 1;
    const close = matchBracket(source, open, "{", "}");
    if (close < 0) continue;
    const raw = source.slice(open, close);
    out.push({
      name,
      definitionSpan: { from: open, to: close },
      sizeKeys: keysIn(raw),
      raw,
      origin,
    });
  }
  return out;
}

/**
 * 扫描三类共享样式定义：
 *  ① `\begin{tikzpicture}[box/.style={...}]` 环境选项
 *  ② `\tikzset{box/.style={...}}`
 *  ③ 环境选项 / tikzset 里直接写 `every node/.style={...}`（origin 标为 every-node）
 * 同时把「环境选项里直接写的尺寸键」视为隐式的 every node 定义，供 UI 提示。
 */
export function scanSharedStyles(source: string): SharedStyleDef[] {
  const text = String(source ?? "");
  const out: SharedStyleDef[] = [];
  const seen = new Set<string>();

  const envRe = /\\begin\{tikzpicture\}\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = envRe.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(text, open, "[", "]");
    if (close < 0) continue;
    const block = { from: open, to: close };
    for (const def of styleDefsIn(text, block, "tikzpicture")) {
      const key = `${def.name}@${def.definitionSpan.from}`;
      if (!seen.has(key)) { seen.add(key); out.push(def); }
    }
    // 环境选项里的裸尺寸键（如 [every node/.style={...}] 之外的 [text width=2cm]）
    const raw = text.slice(block.from, block.to);
    const bare = keysIn(raw);
    if (bare.length > 0) {
      const key = `every node@${block.from}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          name: "every node",
          definitionSpan: { from: block.from, to: block.to },
          sizeKeys: bare,
          raw,
          origin: "every-node",
        });
      }
    }
  }

  const setRe = /\\tikzset\s*\{/g;
  while ((m = setRe.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(text, open, "{", "}");
    if (close < 0) continue;
    const block = { from: open, to: close };
    for (const def of styleDefsIn(text, block, "tikzset")) {
      const key = `${def.name}@${def.definitionSpan.from}`;
      if (!seen.has(key)) { seen.add(key); out.push(def); }
    }
  }
  return out.map((d) =>
    d.name === "every node" ? { ...d, origin: "every-node" as const } : d,
  );
}

/** 语句的选项原文里是否把 styleName 当作一个独立词使用（`[box, draw]` 命中，`[boxed]` 不命中）。 */
function usesStyle(optionsRaw: string | null, name: string): boolean {
  if (!optionsRaw) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\[,\\s])${escaped}(?=[,\\]\\s]|$)`, "i").test(optionsRaw);
}

/** 某条语句继承了哪些尺寸相关的共享样式。 */
export function styleNamesForStatement(
  stmt: TikzStatement,
  defs: readonly SharedStyleDef[],
): string[] {
  const out: string[] = [];
  for (const def of defs) {
    if (def.sizeKeys.length === 0) continue;
    if (def.name === "every node" || usesStyle(stmt.optionsRaw, def.name)) out.push(def.name);
  }
  return Array.from(new Set(out));
}

/** 属性坞提示文案；无命中返回 null。 */
export function sharedStyleHint(defs: readonly SharedStyleDef[], names: readonly string[]): string | null {
  const hits = defs.filter((d) => names.includes(d.name) && d.sizeKeys.length > 0);
  if (hits.length === 0) return null;
  const keys = Array.from(new Set(hits.flatMap((d) => d.sizeKeys)));
  return `尺寸来自共享 .style：${hits.map((d) => d.name).join(" / ")}（${keys.join(" / ")}）。默认只改选中节点；勾选「应用到同类」会批量写局部选项，不修改 .style 定义。`;
}

/**
 * 「应用到同类」的元素集合：所有继承了同一批尺寸样式的 \node 语句 id。
 * 只读扫描，不写源码；找不到任何同类时返回空数组，由调用方回退到当前选中集合。
 */
export function findStyleUsers(
  defs: readonly SharedStyleDef[],
  statements: readonly TikzStatement[],
  names: readonly string[],
): string[] {
  if (names.length === 0) return [];
  const out: string[] = [];
  for (const stmt of statements) {
    if (stmt.command !== "node") continue;
    const used = styleNamesForStatement(stmt, defs);
    if (used.some((n) => names.includes(n))) out.push(stmt.id);
  }
  return Array.from(new Set(out));
}
