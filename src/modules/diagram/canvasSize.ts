// F3-7：固定画布尺寸的纯逻辑（不依赖 DOM / React，Node 侧可直接回归）。
//
// 边界（务必遵守）：
//   · 画布尺寸是**编辑器侧元数据**，绝不写进 TikZ / CM6 source；
//   · viewBox 始终是引擎按图元包围盒算出的几何真源，这里只读不覆盖，
//     否则 dragEdit 的 Y 翻转、grid 刻度、dragPreview 基准补偿、unitScale 全错位；
//   · 纸张框画在 SVG 用户坐标系里的辅助层（data-dg-paper），
//     按 world 0..W / 0..H 经 worldToSvgPoint 的同一公式换算。
import type { TikzViewBox } from "./tikzEditor/engine.ts";

/** 1cm = 28.45275590551181pt（与 F3-1 探针实测、上游 world 单位一致） */
export const CM_TO_PT = 28.45275590551181;

export type CanvasPreset = "auto" | "a4" | "a5" | "letter" | "b5" | "custom";

export interface CanvasSize {
  preset: CanvasPreset;
  /** 正文宽（暂定口径：取 \textwidth 而非纸张物理宽） */
  widthCm: number;
  heightCm: number;
}

export const CANVAS_PRESET_LABELS: Record<CanvasPreset, string> = {
  auto: "自适应（不显示纸张框）",
  a4: "A4 正文宽",
  a5: "A5 正文宽",
  letter: "Letter 正文宽",
  b5: "B5 正文宽",
  custom: "自定义",
};

/**
 * 默认画布高度（cm）。
 *
 * 口径（真机反馈）：**只让宽度等于正文宽，高度给一个够用的工作区**。
 * 早期版本直接把 \textheight 当高度（A4 约 24.7cm），打开时等于把整张 A4 正文
 * 竖条塞进视口：图只占左下角一小块，看着像「什么都没画」。
 * 高度始终钳制在所属纸张的正文高以内（见 preset.maxHeightCm）。
 */
export const DEFAULT_CANVAS_HEIGHT_CM = 10;

export interface CanvasPresetSize extends CanvasSize {
  /** 该纸张正文区最大高度（cm），默认高度不得超过它 */
  maxHeightCm: number;
}

/**
 * 预设正文尺寸（cm）：宽度取常见 LaTeX 正文宽，高度取默认工作区高度；
 * maxHeightCm 是该纸张的正文高（A4 24.7 / A5 17.5 / Letter 20 / B5 19），
 * 供设置页钳制自定义高度，避免「画布比纸还高」。
 */
export const CANVAS_PRESETS: Record<Exclude<CanvasPreset, "auto" | "custom">, CanvasPresetSize> = {
  a4: { preset: "a4", widthCm: 15, heightCm: DEFAULT_CANVAS_HEIGHT_CM, maxHeightCm: 24.7 },
  a5: { preset: "a5", widthCm: 10.5, heightCm: DEFAULT_CANVAS_HEIGHT_CM, maxHeightCm: 17.5 },
  letter: { preset: "letter", widthCm: 14.5, heightCm: DEFAULT_CANVAS_HEIGHT_CM, maxHeightCm: 20 },
  b5: { preset: "b5", widthCm: 12.5, heightCm: DEFAULT_CANVAS_HEIGHT_CM, maxHeightCm: 19 },
};

/** 兜底 A4：主文档没有纸张声明 / 当前是源码片段时使用。 */
export const DEFAULT_CANVAS_SIZE: CanvasSize = {
  preset: "a4",
  widthCm: CANVAS_PRESETS.a4.widthCm,
  heightCm: CANVAS_PRESETS.a4.heightCm,
};

/** 预设的正文最大高度（cm）；auto / custom 用 A4 上限兜底。 */
export function presetMaxHeightCm(preset: CanvasPreset): number {
  if (preset === "auto" || preset === "custom") return CANVAS_PRESETS.a4.maxHeightCm;
  return CANVAS_PRESETS[preset].maxHeightCm;
}

const PRESET_KEYS = new Set<CanvasPreset>(["auto", "a4", "a5", "letter", "b5", "custom"]);

function finitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * 白名单校验 + 数值钳制。手改 localStorage / 旧值都在这里收敛，
 * 保证下游拿到的尺寸永远是有限正数（否则纸张层会出现 Infinity / NaN 属性）。
 */
export function normalizeCanvasSize(input: unknown, fallback: CanvasSize = DEFAULT_CANVAS_SIZE): CanvasSize {
  if (!input || typeof input !== "object") return { ...fallback };
  const raw = input as { preset?: unknown; widthCm?: unknown; heightCm?: unknown };
  const preset =
    typeof raw.preset === "string" && PRESET_KEYS.has(raw.preset as CanvasPreset)
      ? (raw.preset as CanvasPreset)
      : fallback.preset;
  if (preset === "custom") {
    const widthCm = finitePositive(raw.widthCm) ? Math.min(200, raw.widthCm) : fallback.widthCm;
    const heightCm = finitePositive(raw.heightCm) ? Math.min(300, raw.heightCm) : fallback.heightCm;
    return { preset, widthCm, heightCm };
  }
  if (preset === "auto") return { preset, widthCm: 0, heightCm: 0 };
  const base = CANVAS_PRESETS[preset];
  const heightCm = finitePositive(raw.heightCm) ? raw.heightCm : base.heightCm;
  return {
    preset,
    widthCm: finitePositive(raw.widthCm) ? Math.min(200, raw.widthCm) : base.widthCm,
    // 高度不得超过该纸张正文高：手改 localStorage / 旧版 24.7 都会被收敛回来。
    heightCm: Math.min(base.maxHeightCm, heightCm),
  };
}

/** 预设名 → 尺寸（auto / custom 回退到传入的 size）。 */
export function canvasSizeForPreset(preset: CanvasPreset, size: CanvasSize): CanvasSize {
  if (preset === "auto") return { preset, widthCm: 0, heightCm: 0 };
  if (preset === "custom") return normalizeCanvasSize(size);
  const base = CANVAS_PRESETS[preset];
  return { preset, widthCm: base.widthCm, heightCm: base.heightCm };
}

/** cm → world pt；只在分发给纸张层 / 导出片段时换算一次。 */
export function canvasSizeToPt(size: CanvasSize): { widthPt: number; heightPt: number } {
  return {
    widthPt: size.widthCm * CM_TO_PT,
    heightPt: size.heightCm * CM_TO_PT,
  };
}

export interface PaperRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 纸张框在 SVG 用户坐标系的矩形：**以当前图形包围盒（引擎 viewBox）的中心为纸面中心**。
 *
 * 口径（2026-11-11 真机反馈）：纸张框只是「正文区多大」的参考尺，锚在 world (0,0)
 * 会让图形永远贴在纸的左下角、上方留一整片空纸，看着像画错了。改为相对图形居中后，
 * 不管图元怎么移动都保持「图在纸中央」，只用于观察 15cm 正文宽下的占比。
 *
 * 换算仍然直接落在 SVG 用户坐标（viewBox 同一坐标系），不另立 Y 翻转：
 * viewBox 中心是 (vb.x + vb.w/2, vb.y + vb.h/2)，纸面再按宽高各减半。
 * auto 或零尺寸返回 null（不画纸张层）。
 */
export function canvasPaperRect(size: CanvasSize, viewBox: TikzViewBox): PaperRect | null {
  if (size.preset === "auto") return null;
  const { widthPt, heightPt } = canvasSizeToPt(size);
  if (!finitePositive(widthPt) || !finitePositive(heightPt)) return null;
  return {
    x: viewBox.x + viewBox.width / 2 - widthPt / 2,
    y: viewBox.y + viewBox.height / 2 - heightPt / 2,
    width: widthPt,
    height: heightPt,
  };
}

/** 设置页 / 状态栏用的简短说明。 */
export function canvasSizeLabel(size: CanvasSize): string {
  if (size.preset === "auto") return "自适应内容";
  return `${CANVAS_PRESET_LABELS[size.preset]} · ${size.widthCm.toFixed(1)}×${size.heightCm.toFixed(1)} cm`;
}
