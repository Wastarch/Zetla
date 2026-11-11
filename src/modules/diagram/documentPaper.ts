// F3-7：从主文档推断绘图画布默认尺寸的纯逻辑（Node 侧可直接回归）。
//
// 口径（决策 34 暂定 a）：取**正文宽 \textwidth**，而不是纸张物理宽——
// 图最终要插进正文，按正文宽画纸张框才贴合实际排版；预设名仍显示 A4 / A5 等。
// 解析失败 / 当前是片段 / 多值冲突都兜底 A4，并给出可读的来源说明。
// 这里只读主文档文本，绝不写回任何 .tex 或 TikZ 源码。
import {
  CANVAS_PRESETS,
  DEFAULT_CANVAS_HEIGHT_CM,
  DEFAULT_CANVAS_SIZE,
  type CanvasPreset,
} from "./canvasSize.ts";

export type PaperPreset = Exclude<CanvasPreset, "auto" | "custom">;

export interface DocumentPaper {
  preset: PaperPreset;
  widthCm: number;
  heightCm: number;
  /** 该纸张正文区的最大高度（cm），设置页用它钳制用户手改的高度 */
  maxHeightCm: number;
  source: "document" | "fallback";
  /** 用于 UI 提示，例如「主文档 \documentclass[a4paper]」 */
  detail: string;
}

const PAPER_OPTIONS: { token: string; preset: PaperPreset }[] = [
  { token: "a4paper", preset: "a4" },
  { token: "a5paper", preset: "a5" },
  { token: "letterpaper", preset: "letter" },
  { token: "b5paper", preset: "b5" },
];

/** LaTeX 常见长度单位 → cm。无单位数字按 pt 处理（TeX 默认）。 */
export function lengthToCm(raw: string): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(cm|mm|pt|in|bp)?\s*$/i.exec(raw);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch ((m[2] ?? "pt").toLowerCase()) {
    case "cm": return value;
    case "mm": return value / 10;
    case "in": return value * 2.54;
    case "bp": return value * 2.54 / 72;
    default: return value * 2.54 / 72; // pt
  }
}

function optionNames(block: string | undefined): string[] {
  if (!block) return [];
  return block.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** 收集 \documentclass[...] / geometry[...] / \geometry{...} 的选项块。 */
function collectOptionBlocks(doc: string): string[] {
  const blocks: string[] = [];
  const classRe = /\\documentclass(?:\[([^\]]*)\])?\s*\{/g;
  const geometryPkgRe = /\\usepackage(?:\[([^\]]*)\])?\s*\{geometry\}/g;
  const geometryCmdRe = /\\geometry\s*\{([^}]*)\}/g;
  for (const re of [classRe, geometryPkgRe, geometryCmdRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc)) !== null) {
      if (m[1] != null) blocks.push(m[1]);
    }
  }
  return blocks;
}

function findLength(blocks: string[], key: "textwidth" | "paperwidth"): string | null {
  for (const block of blocks) {
    for (const part of optionNames(block)) {
      const m = new RegExp(`^${key}\\s*=\\s*(.+)$`, "i").exec(part);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}

/** \setlength{\textwidth}{15cm} / \def\textwidth{15cm} 兜底解析。 */
function findSetLength(doc: string): string | null {
  const setlength = /\\setlength\s*\{\s*\\textwidth\s*\}\s*\{([^}]*)\}/g;
  const def = /\\def\s*\\textwidth\s*\{([^}]*)\}/g;
  for (const re of [setlength, def]) {
    const m = re.exec(doc);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * 推断默认画布尺寸。返回 preset 恒为具体纸张（不会是 auto / custom）；
 * 调用方把它写进 canvasSize 前仍可让用户覆盖。
 */
export function inferDocumentPaper(doc: string): DocumentPaper {
  const blocks = collectOptionBlocks(doc);

  let preset: PaperPreset | null = null;
  let detail = "";
  for (const block of blocks) {
    const names = optionNames(block);
    const hit = PAPER_OPTIONS.find((p) => names.includes(p.token));
    if (hit) {
      preset = hit.preset;
      detail = `主文档 \\documentclass / geometry：${hit.token}`;
      break;
    }
  }

  const rawTextWidth = findLength(blocks, "textwidth") ?? findSetLength(doc);
  const textWidthCm = rawTextWidth ? lengthToCm(rawTextWidth) : null;
  const rawPaperWidth = findLength(blocks, "paperwidth");
  const paperWidthCm = rawPaperWidth ? lengthToCm(rawPaperWidth) : null;

  if (!preset && paperWidthCm) {
    // 只有 paperwidth 时按物理宽就近映射预设，宽度仍用预设正文宽（口径 a）。
    const candidates = (Object.keys(CANVAS_PRESETS) as PaperPreset[]).map((key) => ({
      key,
      width: CANVAS_PRESETS[key].widthCm,
    }));
    candidates.sort((a, b) => Math.abs(a.width - paperWidthCm) - Math.abs(b.width - paperWidthCm));
    preset = candidates[0]?.key ?? "a4";
    detail = `主文档 geometry：paperwidth=${rawPaperWidth}`;
  }

  if (!preset) {
    // 没有纸张声明但有显式 textwidth：宽度以正文宽为准，纸张预设仍取 A4 兜底。
    if (textWidthCm) {
      return {
        preset: "a4",
        widthCm: Math.min(200, textWidthCm),
        heightCm: Math.min(DEFAULT_CANVAS_HEIGHT_CM, CANVAS_PRESETS.a4.maxHeightCm),
        maxHeightCm: CANVAS_PRESETS.a4.maxHeightCm,
        source: "document",
        detail: `主文档 textwidth=${rawTextWidth}`,
      };
    }
    return {
      ...DEFAULT_CANVAS_SIZE,
      preset: "a4",
      maxHeightCm: CANVAS_PRESETS.a4.maxHeightCm,
      source: "fallback",
      detail: "未检测到纸张声明，已用 A4 正文宽",
    };
  }

  const base = CANVAS_PRESETS[preset];
  const widthCm = textWidthCm ?? base.widthCm;
  if (textWidthCm) detail = detail ? `${detail} · textwidth=${rawTextWidth}` : `主文档 textwidth=${rawTextWidth}`;
  return {
    preset,
    widthCm: Math.min(200, widthCm),
    // 高度只给默认工作区，且不超过该纸张正文高（真机反馈：不要一打开就塞整张 A4）
    heightCm: Math.min(DEFAULT_CANVAS_HEIGHT_CM, base.maxHeightCm),
    maxHeightCm: base.maxHeightCm,
    source: "document",
    detail,
  };
}
