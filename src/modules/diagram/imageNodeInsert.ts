// M2 · 图片插入 TikZ · P3：「暂存图 → 标准 node 语句」的纯逻辑。
//
// P0 实测定稿形态（勿改成 \pgfimage）：
//   \node at (x,y) {\includegraphics[width=3cm]{figure/x.png}};
// 上游 tikz-editor 把它当**标准 node** 解析，带 node-position 句柄、无 used-unsupported
// 诊断，因此 P5 的拖拽定位可以直接复用 F2-1 的既有链路。
//
// 两条硬约束：
//  · 坐标用 world pt、Y 向上（与 F3-1 pointerWorld / editHandle 同口径），写进 TikZ
//    前必须经 fmtCoord 换算成 cm —— 源码里不带单位的 (1,1) 是 cm，不是 pt。
//  · 路径形态必须过 P1 `resolveImagePath` 的同一套白名单，否则生成的语句在精确预览 /
//    导出时会被 token 映射保守跳过，XeLaTeX 直接报 File not found。含空格 / TeX 特殊
//    字符的文件名在落盘前就被拒绝进入「等待落点」状态（P2 已有边界）。
//
// 无 DOM / Tauri / React / store 依赖；相对 import 带 .ts，Node --experimental-strip-types 可直测。
import type { SourceSpanPatch } from "./dragEdit.ts";
import type { TikzStatement } from "./optionsEdit.ts";
import { mergeSourcePatches } from "./grouping.ts";
import { ASSET_EXTS, SAFE_PATH_RE } from "./imageRefs.ts";
import { fmtCoord, fmtTikzNumber } from "./shapeInsert.ts";

/** 默认图片宽度：P5 接 8 点柄缩放前唯一可调的是源码里的 [width=…] */
export const DEFAULT_IMAGE_WIDTH_CM = 3;
const MAX_IMAGE_WIDTH_CM = 200;

export interface ImageNodeInput {
  /** 相对 targetTex 目录的 \includegraphics 路径，正斜杠 */
  relPath: string;
  /** 落点 world pt（Y 向上） */
  x: number;
  y: number;
  /** 可选宽度（cm）；缺省 3cm */
  widthCm?: number;
}

export type ImageNodePlan =
  | { ok: true; statement: string; relPath: string }
  | { ok: false; reason: string };

/**
 * 校验写进 TikZ 的图片路径。口径与 P1 `resolveImagePath` 一致（同一套正则 / 白名单），
 * 但这里不需要 texDir / root：P2 已用 relativePath 折算好相对路径，只验「形态」。
 * 注意 `../figure/x.png` 必须放行 —— 主 .tex 在子目录时这是合法且必需的上跳。
 */
export function validateImageRelPath(
  raw: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, reason: "图片路径为空" };
  }
  // 与 P1 同坑：换行检查必须在 trim 之前，否则首尾换行会被吃掉
  if (raw.includes("\n") || raw.includes("\r")) {
    return { ok: false, reason: "图片路径跨行（会改变源码行数）" };
  }
  const p = raw.trim();
  if (p.includes("\\")) {
    return { ok: false, reason: "路径含反斜杠，请改用正斜杠" };
  }
  if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) {
    return { ok: false, reason: "只接受相对主文档目录的路径" };
  }
  if (!SAFE_PATH_RE.test(p)) {
    return { ok: false, reason: "文件名含空格或 TeX 特殊字符，请改成字母 / 数字 / 中文 / ._- 组合" };
  }
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  if (!ASSET_EXTS.has(ext)) {
    return { ok: false, reason: `不支持的图片格式 .${ext || "?"}（仅 PNG / JPG / PDF）` };
  }
  return { ok: true, path: p };
}

/** 生成一条可写回 CM6 的图片 node 语句；失败时给可直接展示给用户的原因。 */
export function buildImageNodeStatement(input: ImageNodeInput): ImageNodePlan {
  const v = validateImageRelPath(input.relPath);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    return { ok: false, reason: "落点坐标无效（画布矩阵未就绪）" };
  }
  const w = input.widthCm ?? DEFAULT_IMAGE_WIDTH_CM;
  if (!Number.isFinite(w) || w <= 0 || w > MAX_IMAGE_WIDTH_CM) {
    return { ok: false, reason: `图片宽度需在 0–${MAX_IMAGE_WIDTH_CM}cm 之间` };
  }
  return {
    ok: true,
    relPath: v.path,
    statement: `\\node at ${fmtCoord({ x: input.x, y: input.y })} {\\includegraphics[width=${fmtTikzNumber(w)}cm]{${v.path}}};`,
  };
}

/** 插入主文档时是否需要补 graphicx 导言区（P0：非必需，但显式写更稳妥）。 */
export function sourceNeedsGraphicx(source: string): boolean {
  return /\\includegraphics\b/.test(source);
}

/**
 * 图片节点判定：节点内容里是否含 `\includegraphics`。优先看上游解析出的 nodeTexts
 * （其 .text 已是去花括号的纯内容），兜底再扫语句原文。
 */
export function nodeHasIncludeGraphics(stmt: TikzStatement, source: string): boolean {
  const texts = stmt.nodeTexts ?? [];
  for (const nt of texts) {
    if (nt.text.includes("\\includegraphics")) return true;
  }
  return source.slice(stmt.span.from, stmt.span.to).includes("\\includegraphics");
}

function fmtResizeCm(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  const clamped = Number.isFinite(rounded) ? Math.max(0.05, rounded) : 0.05;
  return String(clamped);
}

/** 匹配 `\includegraphics[opt]{path}`；opt / path 均不含 `]` / `{}`，避免跨段误吞。 */
const IG_FULL_RE = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/;

/** 图片节点要剥离的文本框尺寸选项（框比图大、图不跟着缩放的根因）。 */
const SIZE_OPT_RE = /^(text width|minimum height)\s*=/i;

/**
 * 单一、不重叠的选项补丁：去掉 text width / minimum height（框比图大的元凶），并确保
 * inner sep=0（图片节点不要默认内边距，让框紧贴图片）；保留其它选项（如 fill / draw）。
 * 返回 null 表示无需改动选项（例如节点本就没有这些选项）。
 */
function stripImageNodeOptions(
  source: string,
  statement: TikzStatement,
): SourceSpanPatch | null {
  const os = statement.optionsSpan;
  let kept: string[];
  if (os) {
    const innerFrom = os.from + 1;
    const innerTo = os.to - 1;
    const inner = source.slice(innerFrom, innerTo);
    kept = inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !SIZE_OPT_RE.test(s));
    // 确保 inner sep=0：已存在则保留用户值，否则补上
    if (!kept.some((s) => /^inner sep\s*=/i.test(s))) kept.push("inner sep=0");
    return { from: innerFrom, to: innerTo, insert: kept.join(", ") };
  }
  // 无选项：在命令名之后插入 [inner sep=0]（insertOffset 由上游给出，指向 \node 之后）
  const at = statement.insertOffset;
  if (at == null || at < 0 || at > source.length) return null;
  return { from: at, to: at, insert: "[inner sep=0]" };
}

export type ImageResizePlan =
  | { status: "ok"; patches: SourceSpanPatch[]; nextSource: string; label: string }
  | { status: "rejected" | "noop"; reason: string; patches: SourceSpanPatch[]; nextSource: string };

/**
 * 图片节点尺寸编辑：把 8 点柄拖出的 newWidthCm / newHeightCm 写回 `\includegraphics` 的
 * [width=…, height=…]，并移除节点上的 `text width` / `minimum height`、补 `inner sep=0`
 * （图片节点不需要文本框尺寸，否则框会比图大、图永远填不满 —— 这正是「缩放只改 text width
 * 不改图」的根因）。保留除 width / height 外的其它 includegraphics 选项（如 angle / scale / trim）。
 * 纯逻辑：最小 span 补丁，options 与 includegraphics 各一处、互不重叠，调用方一次 dispatch = 一条 Ctrl+Z。
 */
export function planImageNodeResize(args: {
  source: string;
  statement: TikzStatement;
  newWidthCm: number;
  newHeightCm: number;
}): ImageResizePlan {
  const { source, statement, newWidthCm, newHeightCm } = args;
  if (statement.command !== "node") {
    return { status: "rejected", reason: "图片尺寸只适用于 \\node 图片节点。", patches: [], nextSource: source };
  }
  const nt = statement.nodeTexts?.find((n) => n.source === "group") ?? statement.nodeTexts?.[0];
  if (!nt) {
    return { status: "rejected", reason: "无法定位节点内容。", patches: [], nextSource: source };
  }
  const content = source.slice(nt.span.from, nt.span.to);
  const m = IG_FULL_RE.exec(content);
  if (!m) {
    return { status: "rejected", reason: "节点内未找到 \\includegraphics。", patches: [], nextSource: source };
  }
  const oldOpt = m[1] ?? "";
  const path = m[2] ?? "";
  if (!path.trim()) {
    return { status: "rejected", reason: "图片路径为空。", patches: [], nextSource: source };
  }
  // 保留除 width / height 之外的原有选项（如 angle / scale / trim），仅重写宽高。
  const rest = oldOpt
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(width|height)\s*=/i.test(s))
    .join(", ");
  const newOpt =
    `width=${fmtResizeCm(newWidthCm)}cm, height=${fmtResizeCm(newHeightCm)}cm` +
    (rest ? `, ${rest}` : "");
  const newInclude = `\\includegraphics[${newOpt}]{${path}}`;
  const absFrom = nt.span.from + m.index;
  const absTo = absFrom + m[0].length;
  const includePatch: SourceSpanPatch = { from: absFrom, to: absTo, insert: newInclude };

  // 单一补丁改写节点选项：去掉 text width / minimum height，确保 inner sep=0（见 stripImageNodeOptions）。
  const optionPatch = stripImageNodeOptions(source, statement);

  const patches: SourceSpanPatch[] = [includePatch];
  if (optionPatch) patches.push(optionPatch);

  const merged = mergeSourcePatches(source, patches);
  if (!merged) {
    return { status: "rejected", reason: "图片尺寸补丁区间重叠，已放弃写回。", patches: [], nextSource: source };
  }
  if (merged.nextSource === source) {
    return { status: "noop", reason: "尺寸未变化。", patches: [], nextSource: source };
  }
  return {
    status: "ok",
    patches: merged.patches,
    nextSource: merged.nextSource,
    label: `图片尺寸 ${fmtResizeCm(newWidthCm)}×${fmtResizeCm(newHeightCm)}cm`,
  };
}
