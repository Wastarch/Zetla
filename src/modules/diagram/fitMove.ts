// F6 补强 · fit 节点「移动位置」的语义解析。
//
// fit 节点的坐标由被引用节点推导，直接改写它的 node-position 会破坏引用（F2-3 依然锁）。
// 因此拖动 fit 本体 / 选中框时，改为整体平移它引用的节点：fit 框随子节点一起走，
// 既保住源码语义，也复用 F3-3 的多点补丁 + 一次撤销。
//
// 纯逻辑：不碰 DOM、不写 source，只从上游 statements 的 optionsSpan / span 读取原文。

import type { TikzStatement } from "./optionsEdit.ts";

/** 从 `fit=(a)(b.north)` 中取节点名 `a` / `b`（忽略锚点与当前包围盒等伪节点）。 */
export function fitReferenceNames(value: string): string[] {
  const names: string[] = [];
  const re = /\(\s*([A-Za-z@][\w@]*)(?:\.[^)\s]+)?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const name = m[1];
    if (name && name !== "current" && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 该语句是否带 fit 选项（返回选项值原文，未带返回 null）。 */
export function fitOptionValue(stmt: TikzStatement, source: string): string | null {
  const entry = stmt.entries.find((e) => e.key === "fit");
  if (entry?.value) return entry.value;
  if (stmt.optionsRaw) {
    const m = /\bfit\s*=\s*([^\],]+)/.exec(stmt.optionsRaw);
    if (m?.[1]) return m[1];
  }
  const text = source.slice(stmt.span.from, stmt.span.to);
  const m = /\bfit\s*=\s*([^\],]+)/.exec(text);
  return m?.[1] ?? null;
}

/** 从语句源码里识别 `\node[...] (name)` / `\coordinate (name)` 声明的名字。 */
function declaredNodeName(stmt: TikzStatement, source: string): string | null {
  const text = source.slice(stmt.span.from, stmt.span.to);
  const re = /\\(?:node|coordinate)\b(?:\[[^\]]*\])?(?:\s+at\s+\([^)]*\))?\s*\(\s*([A-Za-z@][\w@]*)\s*\)/g;
  const m = re.exec(text);
  return m?.[1] ?? null;
}

/**
 * 解析一个 fit 节点实际要跟着移动哪些语句。
 * - 直接引用普通节点 → 返回这些节点；
 * - 引用另一个 fit 节点 → 递归展开（带 seen 防环，最多 8 层）；
 * - 引用名找不到对应语句 / 指向自身 → 跳过，不让整次移动落空。
 */
export function resolveFitMoveTargets(args: {
  source: string;
  statements: readonly TikzStatement[];
  fitId: string;
}): string[] {
  const { source, statements } = args;
  const byId = new Map(statements.map((s) => [s.id, s]));
  const byName = new Map<string, string>();
  for (const s of statements) {
    const name = declaredNodeName(s, source);
    if (name && !byName.has(name)) byName.set(name, s.id);
  }

  const out: string[] = [];
  const seen = new Set<string>([args.fitId]);
  const visit = (id: string, depth: number): void => {
    if (depth > 8 || seen.has(id)) return;
    seen.add(id);
    const stmt = byId.get(id);
    if (!stmt) return;
    const value = fitOptionValue(stmt, source);
    if (value) {
      for (const name of fitReferenceNames(value)) {
        const target = byName.get(name);
        if (target) visit(target, depth + 1);
      }
      return;
    }
    out.push(id);
  };

  const root = byId.get(args.fitId);
  const value = root ? fitOptionValue(root, source) : null;
  if (value) {
    for (const name of fitReferenceNames(value)) {
      const target = byName.get(name);
      if (target) visit(target, 1);
    }
  }
  return out.filter((id) => id !== args.fitId);
}
