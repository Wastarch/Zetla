// M2·绘图模块：模块内 zustand 状态。
// F1-1 起持有 source / targetTex；F1-2 增三布局 layoutMode 与分屏比例 splitRatio；
// F1-4 增导出方式与 figure 包裹选项；F1-5 增精确预览通道偏好，并把这些轻量 UI 偏好
// 统一收敛到本模块的读写入口（设置页「绘图」分区直接调用，见 resetDiagramPreferences）；
// F2-2 把 F1-1 预留的 selectedId 接上画布点选，并新增 renderMeta（渲染派生的语句清单）；
// F2-3 给 renderMeta 加 compat（同源的能力矩阵锁定报告），画布与侧栏共用一份判定。
// F3-1 增 toolMode（基础图元工具），F3-2 增 handleSize（控制点视觉档位），
// 都沿用同一套轻量 localStorage 偏好机制。
// F3-3 增 selectedIds（多选）/ grouping（虚拟分组 + 主动隐藏 / 锁定）/ layersVisible；
// 分组是**编辑器侧元数据**，绝不写进 TikZ。持久化按当前语句 id 白名单裁剪，
// 源码改崩 / 换成另一张图时失效引用由 pruneGroupingTo 自动清掉。
//
// 存储口径：绘图布局/预览模式/当前工具/控制点大小是低风险 UI 状态，沿用 localStorage（键集中在此文件），
// 不扩全局 AppSettings schema（那需要同步改 Rust AppConfig + 归一化 + 迁移，收益不抵风险）。
// renderMeta / selectedId 是会话态，不持久化；renderMeta 自带 source 便于侧栏校验是否过期。
// 后续切片扩展：F6 组件库插入。
import { create } from "zustand";
import type { ExportMode, PreviewMode } from "@/types/diagram";
import type { TikzStatement } from "./optionsEdit.ts";
import type { CompatReport } from "./tikzEditor/compat.ts";
import { DEFAULT_TOOL_MODE, isToolMode, type ToolMode } from "./shapeTools.ts";
import {
  DEFAULT_HANDLE_SIZE,
  isHandleSize,
  type HandleSize,
} from "./handleVisual.ts";
import {
  EMPTY_GROUPING,
  groupingStorageKey,
  normalizeGrouping,
  pruneGrouping,
  type GroupingState,
} from "./grouping.ts";
import type { GuideLine } from "./guides.ts";

export type { HandleSize } from "./handleVisual.ts";

/** Tab 内三种布局：仅画布 / 仅源码 / 左右分屏（都是同一个 diagram://editor Tab 内的视图状态） */
export type LayoutMode = "canvas" | "code" | "split";

const LAYOUT_KEY = "zetla.diagram.layoutMode";
const RATIO_KEY = "zetla.diagram.splitRatio";
const PREVIEW_KEY = "zetla.diagram.previewMode";
const TOOL_KEY = "zetla.diagram.toolMode";
const HANDLE_SIZE_KEY = "zetla.diagram.handleSize";
const LAYERS_KEY = "zetla.diagram.layersVisible";
const SNAP_KEY = "zetla.diagram.snapEnabled";
const GROUPING_KEY = "zetla.diagram.grouping.v1";

export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

/** F1-5：设置页「恢复默认」用的集中默认值 */
export const DIAGRAM_DEFAULTS = {
  layoutMode: "split" as LayoutMode,
  splitRatio: 0.5,
  previewMode: "local" as PreviewMode,
  toolMode: DEFAULT_TOOL_MODE,
  handleSize: DEFAULT_HANDLE_SIZE,
  layersVisible: true,
  snapEnabled: true,
};

function clampRatio(n: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, n));
}

function readLayout(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === "canvas" || v === "code" || v === "split" ? v : DIAGRAM_DEFAULTS.layoutMode;
  } catch {
    return DIAGRAM_DEFAULTS.layoutMode;
  }
}

function readRatio(): number {
  try {
    const raw = localStorage.getItem(RATIO_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampRatio(n) : DIAGRAM_DEFAULTS.splitRatio;
  } catch {
    return DIAGRAM_DEFAULTS.splitRatio;
  }
}

function readPreviewMode(): PreviewMode {
  try {
    const v = localStorage.getItem(PREVIEW_KEY);
    return v === "local" || v === "precise" ? v : DIAGRAM_DEFAULTS.previewMode;
  } catch {
    return DIAGRAM_DEFAULTS.previewMode;
  }
}

/** F3-1：上次用过的形状工具（白名单校验，防止旧值 / 手改 localStorage 造成崩溃）。 */
function readToolMode(): ToolMode {
  try {
    const v = localStorage.getItem(TOOL_KEY);
    return isToolMode(v) ? v : DIAGRAM_DEFAULTS.toolMode;
  } catch {
    return DIAGRAM_DEFAULTS.toolMode;
  }
}

/** F3-2：控制点视觉档位（白名单校验，防止旧值 / 手改 localStorage 造成崩溃）。 */
function readHandleSize(): HandleSize {
  try {
    const v = localStorage.getItem(HANDLE_SIZE_KEY);
    return isHandleSize(v) ? v : DIAGRAM_DEFAULTS.handleSize;
  } catch {
    return DIAGRAM_DEFAULTS.handleSize;
  }
}

/** F3-3：图层面板显隐（轻量 UI 偏好，和五项偏好一起由设置页「恢复默认」复位）。 */
function readLayersVisible(): boolean {
  try {
    const v = localStorage.getItem(LAYERS_KEY);
    return v === null ? DIAGRAM_DEFAULTS.layersVisible : v === "1";
  } catch {
    return DIAGRAM_DEFAULTS.layersVisible;
  }
}

/** F3-4：拖拽时是否启用智能参考线吸附（第七项持久化偏好）。 */
function readSnapEnabled(): boolean {
  try {
    const v = localStorage.getItem(SNAP_KEY);
    return v === null ? DIAGRAM_DEFAULTS.snapEnabled : v === "1";
  } catch {
    return DIAGRAM_DEFAULTS.snapEnabled;
  }
}

/**
 * F3-3：分组元数据的持久化。存 `{ ids, state }`：ids 是保存那一刻的语句 id 白名单，
 * 加载时先按它归一化，运行时再由 pruneGroupingTo 按当前渲染的 statements 裁剪。
 * 这样「编辑过源码再刷新」不会留下悬空组，也不会把上一张图的分组串到新图上。
 */
function readGrouping(): GroupingState {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPING_KEY) ?? "null") as {
      ids?: unknown;
      state?: unknown;
      /** 保存时的源码指纹；仅作诊断 / 未来按图迁移用，不作为恢复门槛 */
      signature?: unknown;
    } | null;
    const ids = Array.isArray(raw?.ids)
      ? raw.ids.filter((v): v is string => typeof v === "string")
      : [];
    return normalizeGrouping(raw?.state, ids);
  } catch {
    return { ...EMPTY_GROUPING };
  }
}

function writeGrouping(
  state: GroupingState,
  ids: readonly string[],
  source: string,
): void {
  try {
    // signature 记录保存时的源码指纹：便于将来按图迁移 / 排查串味；
    // 恢复门槛故意靠 ids 白名单 + 运行时 prune，这样「改过源码再刷新」不丢分组。
    localStorage.setItem(
      GROUPING_KEY,
      JSON.stringify({ signature: groupingStorageKey(source), ids, state }),
    );
  } catch {
    // 隐私模式 / 配额：忽略，分组仅本次会话有效。
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 隐私模式 / 无 storage：忽略，偏好仅本次会话有效，不影响编辑。
  }
}

/** F2-3：一次本地渲染的派生元数据（会话态，不持久化）。 */
export interface DiagramRenderMeta {
  source: string;
  statements: TikzStatement[];
  compat: CompatReport;
}

export interface DiagramState {
  /** 当前绘图源码（完整 tikzpicture 环境；由 Tab 内 LaTeXEditor 受控驱动） */
  source: string;
  setSource: (s: string) => void;
  /**
   * F2-2：主选中项（属性面板按它定位语句）。F3-3 起与 selectedIds 保持同步：
   * 始终等于 selectedIds[0] ?? null —— 既有的属性区 / 自动选中链路零改动。
   */
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** F3-3：多选集合（框选 / Shift 加选 / 拖组 / 编组都基于它），会话态不持久化 */
  selectedIds: string[];
  setSelectedIds: (ids: readonly string[]) => void;
  /**
   * F2-2 / F2-3：最近一次本地渲染派生的语句清单 + 兼容报告。带上 source 让侧栏在
   * debounce 期间能识别「源码已改但还没重渲染」，避免把补丁打到过期的选项 span 上，
   * 或拿上一张图的锁定理由标到新图上。
   */
  renderMeta: DiagramRenderMeta | null;
  setRenderMeta: (m: DiagramRenderMeta | null) => void;
  /**
   * 编辑完成后代码要插入的目标 .tex 绝对路径（F1-1 打开绘图 Tab 时锁定）。
   * 伪 buffer Tab 活动时 getActiveView() 会失效，F1-4 必须靠此路径取 getEditorView(targetTex)。
   */
  targetTex: string | null;
  setTargetTex: (p: string | null) => void;
  /** F1-2：Tab 内布局（仅画布 / 仅源码 / 分屏），开关在 Tab 内部 */
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  /** F1-2：分屏时左栏（画布）占容器宽度的比例，钳在 0.2–0.8 */
  splitRatio: number;
  setSplitRatio: (r: number) => void;
  /** F1-5：画布预览通道（local = tikz-editor / precise = XeLaTeX） */
  previewMode: PreviewMode;
  setPreviewMode: (m: PreviewMode) => void;
  /** F3-1：当前工具；select 保留 F2-1 拖拽控制点，其余为形状绘制工具 */
  toolMode: ToolMode;
  setToolMode: (m: ToolMode) => void;
  /** F3-2：控制点视觉半径档位（命中半径独立且更大，见 handleVisual.ts） */
  handleSize: HandleSize;
  setHandleSize: (s: HandleSize) => void;
  /** F3-3：图层面板显隐（轻量 UI 偏好） */
  layersVisible: boolean;
  setLayersVisible: (v: boolean) => void;
  /** F3-4：拖拽智能参考线吸附（第七项持久化偏好） */
  snapEnabled: boolean;
  setSnapEnabled: (v: boolean) => void;
  /**
   * F3-4：对齐操作后短暂显示的参考线（会话态，不持久化）。
   * guideSeq 每次自增，保证「连续两次对齐到同一条线」也能触发画布重画。
   */
  guides: GuideLine[];
  guideSeq: number;
  setGuides: (lines: readonly GuideLine[]) => void;
  /** F3-3：虚拟分组 / 主动隐藏 / 主动锁定。只存编辑器侧，TikZ 源码零污染 */
  grouping: GroupingState;
  /** 分组写入口：所有变更都经它，顺带持久化到 localStorage */
  setGrouping: (g: GroupingState) => void;
  /** 画布每次重渲染后按当前语句 id 裁剪失效分组 / 选中，防悬空引用 */
  pruneGroupingTo: (ids: readonly string[]) => void;
  /** F1-4：侧栏导出方式；image / file 由 F4 落盘链路接入 */
  exportMode: ExportMode;
  setExportMode: (m: ExportMode) => void;
  /** F1-4：插入时是否套 figure 环境 + caption/label */
  wrapFigure: boolean;
  setWrapFigure: (v: boolean) => void;
  caption: string;
  setCaption: (v: string) => void;
  label: string;
  setLabel: (v: string) => void;
  /** F1-5 / F3-1 / F3-2 / F3-3 / F3-4：设置页「恢复默认」——把七项持久化偏好写回默认值 */
  resetDiagramPreferences: () => void;
}

/** 默认示例源码：标准 TikZ，含矩形/圆节点/箭头，供后续切片渲染与拖拽演示 */
export const DEFAULT_DIAGRAM_SOURCE = `\\begin{tikzpicture}
  \\draw[thick, rounded corners] (0,0) rectangle (3,2);
  \\node[draw, circle, fill=blue!20] (a) at (1,1) {A};
  \\node[draw, circle, fill=red!20]  (b) at (2.5,1) {B};
  \\draw[->, thick] (a) -- (b);
\\end{tikzpicture}`;

export const useDiagramStore = create<DiagramState>((set, get) => ({
  source: DEFAULT_DIAGRAM_SOURCE,
  setSource: (s) => set({ source: s }),
  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id, selectedIds: id ? [id] : [] }),
  selectedIds: [],
  setSelectedIds: (ids) => {
    const clean = Array.from(new Set(ids.filter((x) => typeof x === "string" && !!x)));
    set({ selectedIds: clean, selectedId: clean[0] ?? null });
  },
  renderMeta: null,
  setRenderMeta: (m) => set({ renderMeta: m }),
  grouping: readGrouping(),
  setGrouping: (g) => {
    const state = get();
    const ids = state.renderMeta?.statements.map((s) => s.id) ?? [];
    writeGrouping(g, ids, state.source);
    set({ grouping: g });
  },
  pruneGroupingTo: (ids) => {
    const available = new Set(ids);
    const next = pruneGrouping(get().grouping, ids);
    const cur = get();
    const sel = cur.selectedIds.filter((id) => available.has(id));
    const changed =
      JSON.stringify(next) !== JSON.stringify(cur.grouping) ||
      sel.length !== cur.selectedIds.length;
    if (!changed) return;
    set({
      grouping: next,
      selectedIds: sel,
      selectedId: sel[0] ?? null,
    });
  },
  targetTex: null,
  setTargetTex: (p) => set({ targetTex: p }),
  layoutMode: readLayout(),
  setLayoutMode: (m) => {
    writeSetting(LAYOUT_KEY, m);
    set({ layoutMode: m });
  },
  splitRatio: readRatio(),
  setSplitRatio: (r) => {
    const v = clampRatio(r);
    writeSetting(RATIO_KEY, String(v));
    set({ splitRatio: v });
  },
  previewMode: readPreviewMode(),
  setPreviewMode: (m) => {
    writeSetting(PREVIEW_KEY, m);
    set({ previewMode: m });
  },
  toolMode: readToolMode(),
  setToolMode: (m) => {
    writeSetting(TOOL_KEY, m);
    set({ toolMode: m });
  },
  handleSize: readHandleSize(),
  setHandleSize: (s) => {
    writeSetting(HANDLE_SIZE_KEY, s);
    set({ handleSize: s });
  },
  layersVisible: readLayersVisible(),
  setLayersVisible: (v) => {
    writeSetting(LAYERS_KEY, v ? "1" : "0");
    set({ layersVisible: v });
  },
  snapEnabled: readSnapEnabled(),
  setSnapEnabled: (v) => {
    writeSetting(SNAP_KEY, v ? "1" : "0");
    set({ snapEnabled: v });
  },
  guides: [],
  guideSeq: 0,
  setGuides: (lines) => {
    const clean = lines.filter(
      (l) => l && (l.axis === "x" || l.axis === "y") && Number.isFinite(l.at),
    );
    set((state) => ({ guides: clean, guideSeq: state.guideSeq + 1 }));
  },
  exportMode: "source",
  setExportMode: (m) => set({ exportMode: m }),
  wrapFigure: false,
  setWrapFigure: (v) => set({ wrapFigure: v }),
  caption: "",
  setCaption: (v) => set({ caption: v }),
  label: "fig:diagram",
  setLabel: (v) => set({ label: v }),
  resetDiagramPreferences: () => {
    writeSetting(LAYOUT_KEY, DIAGRAM_DEFAULTS.layoutMode);
    writeSetting(RATIO_KEY, String(DIAGRAM_DEFAULTS.splitRatio));
    writeSetting(PREVIEW_KEY, DIAGRAM_DEFAULTS.previewMode);
    writeSetting(TOOL_KEY, DIAGRAM_DEFAULTS.toolMode);
    writeSetting(HANDLE_SIZE_KEY, DIAGRAM_DEFAULTS.handleSize);
    writeSetting(LAYERS_KEY, DIAGRAM_DEFAULTS.layersVisible ? "1" : "0");
    writeSetting(SNAP_KEY, DIAGRAM_DEFAULTS.snapEnabled ? "1" : "0");
    set({
      layoutMode: DIAGRAM_DEFAULTS.layoutMode,
      splitRatio: DIAGRAM_DEFAULTS.splitRatio,
      previewMode: DIAGRAM_DEFAULTS.previewMode,
      toolMode: DIAGRAM_DEFAULTS.toolMode,
      handleSize: DIAGRAM_DEFAULTS.handleSize,
      layersVisible: DIAGRAM_DEFAULTS.layersVisible,
      snapEnabled: DIAGRAM_DEFAULTS.snapEnabled,
    });
  },
}));
