// 手写声明：vendor/engine.bundle.js 是预编译产物，Zetla 的 tsc 不检查其内部实现，
// 这里只描述 Zetla 实际会读到的那部分返回结构（引擎类型以 TS 源码为准，宽松声明避免误用）。
// F1-3 只导出 renderTikzToSvg；F2-1 / F2-3 追加 applyEditIntent / applyEdit /
// capabilityMatrix / FEATURE_IDS（纯语义层，不触发 20MB 文字引擎）。
// 新增导出时，需同步在 scripts/build-tikz-vendor.mjs 的 stdin 入口里加导出并重新生成 bundle。

export interface VendorSpan {
  from: number;
  to: number;
}

export interface VendorDiagnostic {
  severity?: "warning" | "error" | string;
  message?: string;
  code?: string;
  span?: VendorSpan;
}

export interface VendorViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VendorSvgResult {
  /** 完整 <svg>…</svg> 字符串 */
  svg?: string;
  viewBox?: VendorViewBox;
  diagnostics?: VendorDiagnostic[];
}

/** 语义层编辑句柄。上游字段很多，这里只列出 Zetla UI 会读的，其余透传给 applyEditIntent。 */
export interface VendorEditHandle {
  id: string;
  /** 世界坐标，单位是 pt（1cm = 28.4527…pt），Y 轴向上 */
  world: { x: number; y: number };
  handleType?: string;
  kind?: string;
  /** direct / delta / calc / positioning 可写回；unsupported 视为锁定 */
  rewriteMode?: string;
  coordinateForm?: string;
  sourceText?: string;
  sourceRef?: {
    sourceId?: string;
    sourceSpan?: VendorSpan;
    /** 由源码内容生成，applyEditIntent 会用它拒绝过期句柄 */
    sourceFingerprint?: string;
  };
  [key: string]: unknown;
}

export interface VendorRenderResult {
  parse?: { diagnostics?: VendorDiagnostic[] };
  semantic?: {
    diagnostics?: VendorDiagnostic[];
    /** 可拖拽控制点；与 svg 字符串来自同一次渲染 */
    editHandles?: VendorEditHandle[];
  };
  svg: VendorSvgResult;
  renderDiagnostics?: VendorDiagnostic[];
}

/** 同步渲染；不传 textEngine 时文字走 SVG <text> + 浏览器字体回退链。 */
export declare function renderTikzToSvg(
  source: string,
  opts?: Record<string, unknown>
): VendorRenderResult;

export interface VendorEditPatch {
  oldSpan: VendorSpan;
  newSpan: VendorSpan;
  /** TikzFragment 运行时就是 string */
  replacement: string;
}

export type VendorEditIntentResult =
  | {
      kind: "success";
      /** EditedSource 运行时就是 string */
      newSource: string;
      patches?: VendorEditPatch[];
      changedSourceIds?: string[];
    }
  | { kind: "unsupported"; reason: string; handleId: string }
  | { kind: "error"; message: string };

export interface VendorMoveIntent {
  kind: "move";
  handleId: string;
  /** 目标世界坐标（pt，Y 向上）；引擎负责反算成源码里的 (x,y) 写法 */
  newWorld: { x: number; y: number };
}

/** F2-1：把一次拖拽落到源码。句柄与 source 必须来自同一次渲染，否则返回 error（stale handle）。 */
export declare function applyEditIntent(
  source: string,
  editHandles: readonly VendorEditHandle[],
  intent: VendorMoveIntent,
  parseOptions?: Record<string, unknown>
): VendorEditIntentResult;

/** 低层 AST 编辑（F2-2 属性面板预留，Zetla v1 不直接调用）。 */
export declare function applyEdit(
  parseResult: unknown,
  edit: { kind: string; targetId: string; [key: string]: unknown }
): { source: string; changedSpans: VendorSpan[] };

/** F2-3：上游能力矩阵，用于给不可写回的构造显示锁定理由。 */
export declare const capabilityMatrix: Record<string, unknown>;
export declare const FEATURE_IDS: readonly string[];
