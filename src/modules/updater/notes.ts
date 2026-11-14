// M1-13 · 更新说明（latest.json 的 notes）解析
// 纯逻辑、零依赖：Node 可直接 `node --experimental-strip-types` 单测。
// 支持的行形态（够用就好，不做完整 Markdown）：
//   `## 标题` / `# 标题`            → heading
//   `- xxx` `* xxx` `• xxx` `+ xxx` → 无序列表（连续行并入同一列表）
//   `1. xxx` / `1) xxx` / `1、xxx`  → 有序列表
//   其余非空行                       → 段落（连续行按换行保留，交给 CSS pre-wrap）
// 行内格式（**粗体** / `代码`）在组件层渲染，解析层只负责切块。

export type NoteBlock =
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "para"; text: string };

const RE_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const RE_BULLET = /^\s*[-*•·+]\s+(.+?)\s*$/;
// `1.` / `1)` 必须跟空格（否则 `0.5 倍` 之类会被误判）；`1、` 中文顿号可无空格
const RE_ORDERED = /^\s*(\d{1,2})(?:[.)]\s+|、\s*)(.+?)\s*$/;

/**
 * 把 notes 文本切成结构化块。
 * 入参允许字符串或字符串数组（清单里两种写法都能读，数组视作逐行）。
 * 空串 / null / 全空白 → 空数组（调用方显示「暂无详细说明」）。
 */
export function parseNotes(raw?: string | string[] | null): NoteBlock[] {
  if (!raw) return [];
  const text = Array.isArray(raw) ? raw.join("\n") : String(raw);
  if (!text.trim()) return [];

  const blocks: NoteBlock[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "para", text: para.join("\n") });
      para = [];
    }
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ type: "heading", text: heading[1].trim() });
      continue;
    }

    const bullet = RE_BULLET.exec(line);
    const ordered = bullet ? null : RE_ORDERED.exec(line);
    if (bullet || ordered) {
      flushPara();
      const item = (bullet ? bullet[1] : ordered![2]).trim();
      const isOrdered = !bullet;
      const last = blocks[blocks.length - 1];
      if (last && last.type === "list" && last.ordered === isOrdered) {
        last.items.push(item);
      } else {
        blocks.push({ type: "list", ordered: isOrdered, items: [item] });
      }
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/** 估算渲染后的视觉行数（用于决定「展开全部」是否出现） */
export function countNoteLines(blocks: NoteBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === "list") n += b.items.length;
    else if (b.type === "heading") n += 1.5; // 标题自带上下留白，按 1.5 行算
    else n += Math.max(1, Math.ceil(b.text.length / 46)); // 约 46 全角字/行
  }
  return Math.ceil(n);
}
