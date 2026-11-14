// M2·F3-5：语句整段 span 重排 + 副本插入的纯逻辑（无 DOM / React / vendor 依赖）。
//
// 唯一真源仍是 TikZ 源码；本模块只做「整段 block 平铺 → 重排 / 插入」的源码字符串变换，
// 不引入第二份图元模型、不碰嵌套内容、不改注释 / 缩进。z-order 与复制粘贴都复用同一套 block 切片：
//   · 顶层语句按其 span 无缝平铺成 block，覆盖 [首段.from, source.length)；
//   · block 文本 = 语句本体 + 尾随空白（到下一个顶层语句开始之前），保证重排 / 插入后
//     段落分隔与缩进原样保留；
//   · 嵌套在 scope / foreach 内的语句不是顶层，被整体包在所属 block 里一起移动，不会被单独搬动。
import type { TikzStatement } from "./optionsEdit.ts";
import type { SourceSpanPatch } from "./dragEdit.ts";

/** 一段顶层语句（含尾随分隔空白），是 z-order / 复制的最小搬运单位。 */
export interface StatementBlock {
  id: string;
  /** 语句 span.from */
  from: number;
  /** 到下一段开始的偏移；最后一段 = source.length */
  to: number;
  /** source.slice(from, to)，含尾随空白 */
  text: string;
}

/** z-order 四种操作：front=置顶（移到最后绘制）、back=置底（移到最前）、forward/backward=相邻交换。 */
export type ZOrderOp = "front" | "back" | "forward" | "backward";

/**
 * 把顶层语句切成整段 block。仅取 topLevel === true 的语句，按 span.from 升序。
 * 每块覆盖 [from, 下一段.from)；最后一段覆盖 [from, 本段.span.to)——
 * 即**不含**它之后到 `\end{tikzpicture}` 的尾随空白/环境收尾（那是固定 tail，见 applyBlockOrder）。
 * 块文本 = 语句本体 + 其后的段间空白（到下一段开始前），重排时随语句一起搬动；
 * 非顶层内容（在 scope/foreach 内部）随所属块一起被搬运。
 */
export function topLevelBlocks(source: string, statements: readonly TikzStatement[]): StatementBlock[] {
  const tops = statements
    .filter((s) => s.topLevel)
    .slice()
    .sort((a, b) => a.span.from - b.span.from);
  const blocks: StatementBlock[] = [];
  for (let i = 0; i < tops.length; i += 1) {
    const from = tops[i].span.from;
    const to = i + 1 < tops.length ? tops[i + 1].span.from : tops[i].span.to;
    blocks.push({ id: tops[i].id, from, to, text: source.slice(from, to) });
  }
  return blocks;
}

/** 返回重排后的完整 id 顺序；非法 / 无变化返回 null（调用方据此提示「已在顶/底」而不报错）。 */
export function planZOrder(blocks: readonly StatementBlock[], id: string, op: ZOrderOp): string[] | null {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0 || blocks.length < 1) return null;
  // 单条语句时只有 front/back 有意义（等于「不动」）
  if (blocks.length < 2 && op !== "front" && op !== "back") return null;
  const order = blocks.map((b) => b.id);
  const [item] = order.splice(idx, 1);
  let target = idx;
  switch (op) {
    case "front":
      target = order.length;
      break;
    case "back":
      target = 0;
      break;
    case "forward":
      target = Math.min(order.length, idx + 1);
      break;
    case "backward":
      target = Math.max(0, idx - 1);
      break;
  }
  order.splice(target, 0, item);
  if (order.length === blocks.length && order.every((v, i) => v === blocks[i].id)) return null;
  return order;
}

/**
 * 按完整 id 顺序重排整段 block（order 必须覆盖全部 block）。
 * 仅重排，零改动嵌套 / 注释 / 缩进：首段之前的 preamble（head）与末段之后的尾随
 * 空白 + 环境收尾（tail，含 `\end{tikzpicture}`）都固定不动，只有中段语句顺序变化。
 */
export function applyBlockOrder(
  source: string,
  blocks: readonly StatementBlock[],
  order: readonly string[],
): string {
  const head = source.slice(0, blocks[0].from);
  const tail = source.slice(blocks[blocks.length - 1].to);
  const map = new Map(blocks.map((b) => [b.id, b]));
  const joined = order.map((id) => map.get(id)?.text ?? "").join("");
  return head + joined + tail;
}

/**
 * 在每段选中 block 之后插入其副本文本，返回新源码与每段副本在 newSource 中的 [from,to)。
 * 未选中任何顶层块时返回 null。
 */
export function planDuplicate(
  source: string,
  blocks: readonly StatementBlock[],
  ids: readonly string[],
): { source: string; clones: { id: string; from: number; to: number }[] } | null {
  const want = new Set(ids);
  if (blocks.filter((b) => want.has(b.id)).length === 0) return null;
  let out = "";
  let cursor = 0;
  const clones: { id: string; from: number; to: number }[] = [];
  for (const b of blocks) {
    out += source.slice(cursor, b.from); // 块前空白
    out += b.text; // 原块
    if (want.has(b.id)) {
      const cf = out.length;
      out += b.text; // 克隆块（紧接原块之后）
      clones.push({ id: b.id, from: cf, to: cf + b.text.length });
    }
    cursor = b.to;
  }
  out += source.slice(cursor);
  if (out === source) return null;
  return { source: out, clones };
}

/**
 * F3-5 补强：删除选中图元 = 整段删掉对应顶层 block（含段间空白）。
 * 与复制 / 粘贴同一套 block 粒度：嵌套在 scope / foreach 内的语句不单独抠出，
 * 随所属顶层块一起删除；选中的嵌套 id 在这里落空，由调用方提示去源码栏删。
 *
 * 每组补丁互不重叠，可直接交给 commitDiagramPatches 一次 dispatch = 一条 Ctrl+Z；
 * 末块到 `\end{tikzpicture}` 之间若只有空白，也一并吃掉，避免删完留下空行。
 * 无任何顶层块命中时返回 null（调用方据此提示「没有可删除的顶层图元」）。
 */
export function planDeleteEdit(
  source: string,
  statements: readonly TikzStatement[],
  ids: readonly string[],
): { patches: SourceSpanPatch[]; nextSource: string; deletedIds: string[] } | null {
  const blocks = topLevelBlocks(source, statements);
  const want = new Set(ids);
  const hit = blocks.filter((b) => want.has(b.id));
  if (hit.length === 0) return null;
  const lastBlock = blocks[blocks.length - 1];
  const patches = hit.map((b) => {
    let to = b.to;
    if (b.id === lastBlock.id) {
      const tail = source.slice(b.to);
      const end = tail.indexOf("\\end{tikzpicture}");
      if (end >= 0 && /^\s*$/.test(tail.slice(0, end))) to = b.to + end;
    }
    return { from: b.from, to, insert: "" };
  });
  let nextSource = source;
  for (const p of [...patches].sort((a, b) => b.from - a.from)) {
    nextSource = nextSource.slice(0, p.from) + nextSource.slice(p.to);
  }
  return { patches, nextSource, deletedIds: hit.map((b) => b.id) };
}

/**
 * 复制后把「原块 id」映射到「克隆块 id」：克隆文本与原块相同，且偏移更大；
 * 取每个原块之后、文本相等的首个块作为它的克隆。用于粘贴后立即选中新副本。
 */
export function matchClones(
  before: readonly StatementBlock[],
  after: readonly StatementBlock[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of before) {
    const cands = after
      .filter((a) => a.text === b.text && a.from > b.from)
      .sort((x, y) => x.from - y.from);
    if (cands.length > 0) out.set(b.id, cands[0].id);
  }
  return out;
}

// ── 上次位移记录（会话级单例，供 Ctrl+D 重复上一次变换） ────────────────────────
// 与 diagramHistory 的合并会话同为「模块级单例」：nudge 与拖拽写回成功时写入，
// Ctrl+D 读取并清空语义由调用方决定。这里只负责存取，避免把交互状态塞进 store。
let lastMoveDelta: { x: number; y: number } | null = null;

export function setLastMoveDelta(dx: number, dy: number): void {
  if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
    lastMoveDelta = { x: dx, y: dy };
  }
}

export function getLastMoveDelta(): { x: number; y: number } | null {
  return lastMoveDelta;
}

export function clearLastMoveDelta(): void {
  lastMoveDelta = null;
}

/**
 * 求 source → next 的最小单段补丁（最长公共前后缀），用于把「整段重排 / 整段插入」
 * 落成一个 span，交给 commitDiagramPatches 一次 dispatch（一条 Ctrl+Z）。
 * 相等时返回 null（调用方据此视为 noop 不提交）。纯字符串运算，无渲染依赖。
 */
export function minimalSourcePatch(source: string, next: string): SourceSpanPatch | null {
  if (source === next) return null;
  const max = Math.min(source.length, next.length);
  let p = 0;
  while (p < max && source[p] === next[p]) p += 1;
  let s = 0;
  while (s < max - p && source[source.length - 1 - s] === next[next.length - 1 - s]) s += 1;
  return { from: p, to: source.length - s, insert: next.slice(p, next.length - s) };
}

/** planZOrder 的多选版本：把一组 id 整体重排（彼此相对顺序保持不变）。 */
export function planZOrderMany(
  blocks: readonly StatementBlock[],
  ids: readonly string[],
  op: ZOrderOp,
): string[] | null {
  const want = new Set(ids);
  if (want.size === 0) return null;
  const order = blocks.map((b) => b.id);
  // 抽出的选中项，保持原相对顺序
  const picked = order.filter((id) => want.has(id));
  if (picked.length === 0) return null;
  const rest = order.filter((id) => !want.has(id));
  let next: string[];
  switch (op) {
    case "front":
      next = [...rest, ...picked];
      break;
    case "back":
      next = [...picked, ...rest];
      break;
    case "forward": {
      // 自前向后：每个选中项与正上方一项互换，整体上行一格
      next = [...order];
      for (let i = 0; i < next.length; i += 1) {
        if (want.has(next[i]) && i > 0 && !want.has(next[i - 1])) {
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
        }
      }
      break;
    }
    case "backward": {
      // 自后向前：每个选中项与正下方一项互换，整体下行一格
      next = [...order];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (want.has(next[i]) && i < next.length - 1 && !want.has(next[i + 1])) {
          [next[i + 1], next[i]] = [next[i], next[i + 1]];
        }
      }
      break;
    }
  }
  if (next.every((v, i) => v === order[i])) return null;
  return next;
}

/** 顶层语句的整段重排写回：返回最小 span 补丁 + 新源码；非法 / 无变化返回 null。 */
export function planZOrderEdit(
  source: string,
  statements: readonly TikzStatement[],
  ids: readonly string[],
  op: ZOrderOp,
): { patches: SourceSpanPatch[]; nextSource: string } | null {
  const blocks = topLevelBlocks(source, statements);
  if (blocks.length < 2 && op !== "front" && op !== "back") return null;
  const order = planZOrderMany(blocks, ids, op);
  if (!order) return null;
  const nextSource = applyBlockOrder(source, blocks, order);
  const patch = minimalSourcePatch(source, nextSource);
  if (!patch) return null;
  return { patches: [patch], nextSource };
}

/** 复制插入写回：返回最小 span 补丁 + 新源码 + 克隆块在新源码中的区间；未选中顶层块返回 null。 */
export function planDuplicateEdit(
  source: string,
  statements: readonly TikzStatement[],
  ids: readonly string[],
): { patches: SourceSpanPatch[]; nextSource: string; clones: { from: number; to: number }[] } | null {
  const blocks = topLevelBlocks(source, statements);
  const dup = planDuplicate(source, blocks, ids);
  if (!dup) return null;
  const patch = minimalSourcePatch(source, dup.source);
  if (!patch) return null;
  return {
    patches: [patch],
    nextSource: dup.source,
    clones: dup.clones.map((c) => ({ from: c.from, to: c.to })),
  };
}

// ── 剪贴板（会话级单例，源码层复制 / 粘贴选中顶层块文本） ──────────────────────
// 只存被复制块的原文本（含尾随分隔空白），粘贴时原样插入，绝不重排 / 重写坐标。
let clipboard: string[] = [];

export function setClipboard(texts: readonly string[]): void {
  clipboard = texts.filter((t) => typeof t === "string" && t.length > 0);
}

export function getClipboard(): readonly string[] {
  return clipboard;
}

export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

/**
 * 粘贴写回：把剪贴板里的块文本插到「锚点块之后」（无锚点则插到最后一段之后，
 * 空图则插到 `\end{tikzpicture}` 之前）。返回最小 span 补丁 + 新源码 + 插入区间。
 * 锚点取 anchorIds 中在顶层块里最后出现的一个，避免粘贴到无关位置。
 */
export function planPaste(
  source: string,
  statements: readonly TikzStatement[],
  texts: readonly string[],
  anchorIds: readonly string[],
): { patches: SourceSpanPatch[]; nextSource: string; from: number; to: number } | null {
  if (texts.length === 0) return null;
  let payload = texts
    .map((t) => (/[\n\s]$/.test(t) ? t : `${t}\n  `))
    .join("");
  const blocks = topLevelBlocks(source, statements);
  let insertPos: number;
  if (blocks.length === 0) {
    const endIdx = source.lastIndexOf("\\end{tikzpicture}");
    insertPos = endIdx >= 0 ? endIdx : source.length;
    if (insertPos > 0 && source[insertPos - 1] !== "\n") payload = `\n  ${payload}`;
  } else {
    const want = new Set(anchorIds);
    const anchor =
      [...blocks].reverse().find((b) => want.has(b.id)) ?? blocks[blocks.length - 1];
    insertPos = anchor.to;
  }
  const nextSource = source.slice(0, insertPos) + payload + source.slice(insertPos);
  const patch = minimalSourcePatch(source, nextSource);
  if (!patch) return null;
  return { patches: [patch], nextSource, from: insertPos, to: insertPos + payload.length };
}
