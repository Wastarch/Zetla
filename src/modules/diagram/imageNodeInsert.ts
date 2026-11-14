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
