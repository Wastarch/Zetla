// 手写声明：vendor/engine.bundle.js 是预编译产物，Zetla 的 tsc 不检查其内部实现，
// 这里只描述 F1-3 画布实际会读到的那部分返回结构（引擎类型以 TS 源码为准，宽松声明避免误用）。
// 新增导出（F2 的 applyEdit / EditorSession / capabilityMatrix 等）时，
// 需同步在 scripts/build-tikz-vendor.mjs 的 stdin 入口里加导出并重新生成 bundle。

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

export interface VendorRenderResult {
  parse?: { diagnostics?: VendorDiagnostic[] };
  semantic?: { diagnostics?: VendorDiagnostic[] };
  svg: VendorSvgResult;
  renderDiagnostics?: VendorDiagnostic[];
}

/** 同步渲染；不传 textEngine 时文字走 SVG <text> + 浏览器字体回退链。 */
export declare function renderTikzToSvg(
  source: string,
  opts?: Record<string, unknown>
): VendorRenderResult;
