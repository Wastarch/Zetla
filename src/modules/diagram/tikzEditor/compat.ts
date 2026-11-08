// M2·F2-3：编辑能力兼容判定（纯逻辑，不依赖 DOM / React / vendor 运行时，Node 侧可直接回归）。
//
// 数据来源（都不需要再扩 vendor bundle）：
//   ① capabilityMatrix / FEATURE_IDS —— F2-1 已导出到 engine.bundle.js，每行有 edit 层评级
//      （stable / partial / none / not-applicable）。这是**上游语义层的权威结论**。
//   ② renderTikzToSvg().semantic.featureUsage —— 本图实际用到的 feature 及状态
//      （unused / used-supported / used-unsupported），118 键，随渲染结果返回。
//   ③ parse.figure.body 归一化出的 statements[] 与 semantic.editHandles[]（F2-1 / F2-2 已透出）。
//
// 为什么不能「edit=none 就全局锁」：实证默认示例图里 arrow_tips / named_coordinates /
// keyword_arc 的 edit 都是 none，但箭头线、命名坐标的 (0,0) 端点完全可写回（rewriteMode:
// direct / delta）。全按矩阵锁会把 F2-1 的正常拖拽一并废掉。因此本模块只挑一组**会静默
// 改变源码语义**的「展开 / 计算型构造」白名单，用扫描到的源码 span 精确归属到语句与控制点；
// capabilityMatrix 的 edit 评级只用于**修正严重级别**（stable 降级为提示、none 维持锁定）
// 并写进理由，绝不当成「edit=none 就锁」的二值开关。
//
// 真正要补的洞（2026-11-08 实证）：\foreach 展开出的 3 个控制点 rewriteMode 竟是 direct、
// 且共享同一份源码 (\x,0)。上游认为自己可拖，但拖一下会改写循环变量、三个实例一起变，
// 属静默破坏语义。F2-1 的 isDraggableHandle() 只看句柄自身，识别不出这层归属关系。
// F2-3 用 statement 归属把它锁掉并给出具体理由。

export type EditSupport = "stable" | "partial" | "none" | "not-applicable" | "unknown";

export interface CompatCapabilityRow {
  edit?: string;
  parser?: string;
  semantic?: string;
  svg?: string;
  notes?: string;
  [key: string]: unknown;
}

/** 最小结构：与 optionsEdit.TikzStatement / engine.TikzEditHandle 结构兼容，避免纯逻辑层耦合。 */
export interface CompatStatement {
  id: string;
  span: { from: number; to: number };
  kind?: string;
  command?: string;
}

export interface CompatHandle {
  id: string;
  sourceRef?: { sourceId?: string; sourceSpan?: { from: number; to: number } };
  [key: string]: unknown;
}

export interface CompatInput {
  source: string;
  statements: readonly CompatStatement[];
  handles: readonly CompatHandle[];
  featureUsage?: Readonly<Record<string, string>> | null;
  capabilityMatrix?: Readonly<Record<string, CompatCapabilityRow>> | null;
  featureIds?: readonly string[] | null;
}

export interface CompatIssue {
  /** 稳定 key（规则 + 命中偏移），供 React 列表使用 */
  id: string;
  ruleKey: string;
  label: string;
  featureIds: readonly string[];
  span: { from: number; to: number };
  /** 命中构造所在的最内层语句；null = 不在任何语句内（全局告警） */
  statementId: string | null;
  support: EditSupport;
  usage: string;
  severity: "lock" | "warn";
  /** 短理由：控制点 title / 点击提示 / 属性区 */
  reason: string;
  /** 长说明：锁定清单里展开显示，含上游评级与建议 */
  detail: string;
}

export interface CompatFeatureInfo {
  id: string;
  label: string;
  support: EditSupport;
  usage: string;
  notes?: string;
}

export interface CompatReport {
  issues: CompatIssue[];
  /** statementId → 短理由（属性区据此锁定整条语句） */
  lockReasons: Record<string, string>;
  /** handleId → 短理由（画布据此画锁图标、拒绝拖拽） */
  handleReasons: Record<string, string>;
  /** featureUsage 里 used-unsupported 的构造，即使源码正则没认出来也要提示 */
  unsupportedFeatures: CompatFeatureInfo[];
  lockedHandleCount: number;
  lockedStatementCount: number;
  /** 有上游明确不支持的构造 → 可导向 XeLaTeX 精确预览 */
  hasUnsupported: boolean;
  /** 画布常驻提示条的一行摘要；无缺口时为空串 */
  summary: string;
  /** 空报告（渲染失败 / 精确通道），调用方可据此跳过整块 UI */
  empty: boolean;
}

interface ConstructRule {
  key: string;
  label: string;
  featureIds: readonly string[];
  /** 源码里的触发写法；全局扫描，注释行会被剔除 */
  pattern: RegExp;
  /** 短理由里的因果说明 */
  reason: string;
  advice: string;
  severity: "lock" | "warn";
}

/**
 * 只列「写回坐标会静默改变语义」的构造。
 * 不收录 arrow_tips / shape_* / named_coordinates / to_operation / edge_operation：
 * 这些虽然 edit=none/partial，但坐标本身是普通可写回的点，F2-1 的 rewriteMode 已能判定。
 */
const CONSTRUCT_RULES: readonly ConstructRule[] = [
  {
    key: "foreach",
    label: "\\foreach 循环",
    featureIds: ["foreach_statement", "foreach_path_operation", "foreach_node_operation"],
    pattern: /\\foreach\b/g,
    reason: "循环展开的图元共享同一份源码坐标，拖拽会改写循环变量、让所有实例一起变化",
    advice: "请在「仅源码」里直接修改循环体；需要完整效果可切 XeLaTeX 精确预览。",
    severity: "lock",
  },
  {
    key: "let",
    label: "let … in 计算坐标",
    featureIds: ["let_operation"],
    pattern: /\blet\s+\\[a-zA-Z]/g,
    reason: "let 计算出的坐标上游语义层尚未实现，写回会破坏 \\p / \\x 表达式",
    advice: "请在源码里修改表达式，或切 XeLaTeX 精确预览查看真实结果。",
    severity: "lock",
  },
  {
    key: "pic",
    label: "\\pic 图元",
    featureIds: ["pic_operation"],
    pattern: /\\pic\b/g,
    reason: "内置 pic（如 angle）上游尚未实现，画布会静默丢弃该元素且没有可写回坐标",
    advice: "改用 \\draw … arc 基础写法，或切 XeLaTeX 精确预览原样还原。",
    severity: "lock",
  },
  {
    key: "plot",
    label: "plot 函数曲线",
    featureIds: ["plot_operation"],
    pattern: /\bplot\s*(?=[[(])/g,
    reason: "曲线由函数采样生成，没有独立可写回的坐标点",
    advice: "请修改函数表达式；需要精确曲线请切 XeLaTeX 精确预览。",
    severity: "lock",
  },
  {
    key: "pgfmath",
    label: "pgfmath 宏表达式",
    featureIds: ["pgfmath_expression", "pgfmath_seed_commands", "pgfmath_random_functions"],
    pattern: /\\pgfmath[A-Za-z]*\b/g,
    reason: "坐标由宏 / 随机数计算得到，源码里没有可反算的数值字面量",
    advice: "请在源码里调整宏定义，不要拖拽画布控制点。",
    severity: "lock",
  },
  {
    key: "graph",
    label: "graph 图布局",
    featureIds: ["graph_operation"],
    pattern: /\\graph\b/g,
    reason: "节点位置由布局引擎自动排布，不是源码里的显式坐标",
    advice: "请在源码里修改布局参数。",
    severity: "lock",
  },
  {
    key: "child",
    label: "child 树布局",
    featureIds: ["child_operation", "tree_layout_keys"],
    pattern: /\bchild\s*\{/g,
    reason: "树节点位置由 growth / level 规则推导，拖拽不会反映到源码",
    advice: "请在源码里修改树布局选项。",
    severity: "lock",
  },
  {
    key: "decorate",
    label: "decorate 装饰路径",
    featureIds: ["decorate_operation", "decorate_option", "decoration_pathmorphing", "decoration_pathreplacing"],
    pattern: /\bdecorate\b|\bdecoration\s*=/g,
    reason: "装饰会先形变路径再绘制，屏幕坐标与源码坐标不再一一对应",
    advice: "请在源码里修改 decoration 参数，或切 XeLaTeX 精确预览。",
    severity: "lock",
  },
  {
    key: "fit",
    label: "fit 节点",
    featureIds: ["fit_node"],
    pattern: /\bfit\s*=/g,
    reason: "节点尺寸由被引用的子节点推导，没有独立的位置 / 尺寸源码",
    advice: "请在源码里调整被 fit 的节点或 fit 选项。",
    severity: "lock",
  },
  {
    key: "calc",
    label: "calc 表达式坐标",
    featureIds: ["calc_coordinates"],
    pattern: /\$\(/g,
    reason: "calc 坐标上游只支持部分写回（编辑数值偏移或追加偏移），相对 / 共享写法会被降级",
    advice: "拖拽后请检查源码里的 calc 表达式是否仍符合预期。",
    severity: "warn",
  },
  {
    key: "clip",
    label: "clip 裁剪路径",
    featureIds: ["path_clipping"],
    pattern: /\bclip\b/g,
    reason: "裁剪路径不参与视觉输出，控制点位置不代表可见图元",
    advice: "请在源码里调整裁剪范围。",
    severity: "warn",
  },
];

const FEATURE_LABELS: Record<string, string> = {
  foreach_statement: "\\foreach 语句",
  foreach_path_operation: "\\foreach 路径",
  foreach_node_operation: "\\foreach 节点",
  let_operation: "let … in",
  pic_operation: "\\pic 图元",
  plot_operation: "plot 曲线",
  pgfmath_expression: "pgfmath 表达式",
  pgfmath_seed_commands: "pgfmath 随机种子",
  pgfmath_random_functions: "pgfmath 随机函数",
  graph_operation: "graph 布局",
  child_operation: "child 树节点",
  tree_layout_keys: "树布局选项",
  decorate_operation: "decorate 操作",
  decorate_option: "decorate 选项",
  decoration_pathmorphing: "路径形变装饰",
  decoration_pathreplacing: "路径替换装饰",
  fit_node: "fit 节点",
  calc_coordinates: "calc 坐标",
  path_clipping: "clip 裁剪",
  unknown_statement: "未知语句",
  path_shadows: "路径阴影",
  use_as_bounding_box: "use as bounding box",
  backgrounds_library: "backgrounds 库",
  arrow_tips: "箭头尖端",
  named_coordinates: "命名坐标",
  options_structured: "结构化选项",
  to_operation: "to 路径操作",
  edge_operation: "edge 路径操作",
  shape_circle: "圆形节点",
  shape_rectangle: "矩形节点",
  transform_cm: "仿射变换",
};

const SUPPORT_CN: Record<EditSupport, string> = {
  stable: "完整支持",
  partial: "部分支持",
  none: "不支持",
  "not-applicable": "不适用",
  unknown: "无评级",
};

const USAGE_CN: Record<string, string> = {
  "used-supported": "本图已使用且上游可渲染",
  "used-unsupported": "本图已使用但上游未完整支持",
  unused: "本图未使用",
  unknown: "使用状态未知",
};

export function featureLabel(id: string): string {
  return FEATURE_LABELS[id] ?? id;
}

export function readSupport(
  matrix: Readonly<Record<string, CompatCapabilityRow>> | null | undefined,
  featureIds: readonly string[],
): EditSupport {
  if (!matrix) return "unknown";
  // 一组规则里只要有一个 none 就按 none 计（最保守），否则取第一个能读到的评级
  let seen: EditSupport = "unknown";
  for (const id of featureIds) {
    const raw = matrix[id]?.edit;
    if (typeof raw !== "string") continue;
    const v = raw as EditSupport;
    if (v === "none") return "none";
    if (seen === "unknown") seen = v;
  }
  return seen;
}

export function readUsage(
  featureUsage: Readonly<Record<string, string>> | null | undefined,
  featureIds: readonly string[],
): string {
  if (!featureUsage) return "unknown";
  const vals = featureIds.map((id) => featureUsage[id]).filter((v): v is string => typeof v === "string");
  if (vals.includes("used-unsupported")) return "used-unsupported";
  if (vals.includes("used-supported")) return "used-supported";
  if (vals.length > 0) return vals[0];
  return "unknown";
}

/**
 * 把注释内容替换成等长空格，索引不变，避免 `% \foreach …` 误触发锁定。
 * `\%` 是转义的百分号，不当注释起点。
 */
export function maskComments(source: string): string {
  let out = "";
  let inComment = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\n" || ch === "\r") {
      out += ch;
      inComment = false;
      continue;
    }
    if (inComment) {
      out += " ";
      continue;
    }
    if (ch === "%" && source[i - 1] !== "\\") {
      out += " ";
      inComment = true;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 找包含某个偏移的最内层（跨度最小）语句；并列时取先出现的，保证结果稳定。 */
export function owningStatement(
  statements: readonly CompatStatement[],
  offset: number,
): CompatStatement | null {
  let best: CompatStatement | null = null;
  for (const s of statements) {
    if (!s || typeof s.id !== "string" || !s.span) continue;
    if (offset < s.span.from || offset >= s.span.to) continue;
    if (!best || s.span.to - s.span.from < best.span.to - best.span.from) best = s;
  }
  return best;
}

/** 构造命中是否落在某条已锁定语句内（用于给 handle 补锁，兼容 sourceRef 缺 sourceId 的情况）。 */
function insideLockedStatement(
  statements: readonly CompatStatement[],
  lockReasons: Record<string, string>,
  offset: number | null,
): string | null {
  if (offset === null || !Number.isFinite(offset)) return null;
  const owner = owningStatement(statements, offset);
  return owner ? (lockReasons[owner.id] ?? null) : null;
}

/**
 * 严重级别 = 规则基线 + 上游能力矩阵修正。
 *   · 上游明确 stable 且本图 used-supported → 降为 warn（不锁，避免误伤未来升级的上游）
 *   · 上游明确 used-unsupported → 一律升为 lock（哪怕规则本身只是 warn，如 calc）
 *   · 矩阵缺失 → 保留规则基线（保守）
 * 这样 capabilityMatrix 是真正的判定输入，而不是只用来拼提示文案。
 */
export function effectiveSeverity(
  base: "lock" | "warn",
  support: EditSupport,
  usage: string,
): "lock" | "warn" {
  if (usage === "used-unsupported") return "lock";
  if (support === "stable" && usage === "used-supported") return "warn";
  return base;
}

function detailOf(
  rule: ConstructRule,
  support: EditSupport,
  usage: string,
  matrix: Readonly<Record<string, CompatCapabilityRow>> | null,
): string {
  const ids = rule.featureIds
    .map((f) => `${f}.edit=${readSupport(matrix, [f])}`)
    .join(" / ");
  return `上游 capabilityMatrix：${ids}（${SUPPORT_CN[support]}）；${USAGE_CN[usage] ?? usage}。${rule.advice}`;
}

export function emptyCompatReport(): CompatReport {
  return {
    issues: [],
    lockReasons: {},
    handleReasons: {},
    unsupportedFeatures: [],
    lockedHandleCount: 0,
    lockedStatementCount: 0,
    hasUnsupported: false,
    summary: "",
    empty: true,
  };
}

/**
 * 生成本次渲染的兼容报告。纯函数：相同输入必得相同输出，Node 侧可直接回归。
 * 不抛异常 —— 上游字段缺失 / 结构变化时退化为「不锁定 + 全局告警」，绝不误锁正常图。
 */
export function buildCompatReport(input: CompatInput): CompatReport {
  const { source, statements, handles } = input;
  const matrix = input.capabilityMatrix ?? null;
  const usageMap = input.featureUsage ?? null;
  const masked = maskComments(String(source ?? ""));
  const issues: CompatIssue[] = [];
  const lockReasons: Record<string, string> = {};

  for (const rule of CONSTRUCT_RULES) {
    const support = readSupport(matrix, rule.featureIds);
    const usage = readUsage(usageMap, rule.featureIds);
    // 源码扫到但上游 featureUsage 说「本图未使用」：多半是节点文本里的字面量或
    // 上游尚未标记的写法。仍提示（不漏报），但降级为 warn 不锁（不误锁）。
    const severity = usage === "unused" ? "warn" : effectiveSeverity(rule.severity, support, usage);
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const from = m.index;
      const to = from + m[0].length;
      const owner = owningStatement(statements, from);
      const reason = `${rule.label}：${rule.reason}，${severity === "lock" ? "已锁定编辑" : "拖拽前请留意"}。`;
      const issue: CompatIssue = {
        id: `${rule.key}@${from}`,
        ruleKey: rule.key,
        label: rule.label,
        featureIds: rule.featureIds,
        span: { from, to },
        statementId: owner?.id ?? null,
        support,
        usage,
        severity,
        reason,
        detail: detailOf(rule, support, usage, matrix),
      };
      issues.push(issue);
      if (severity === "lock" && owner && !lockReasons[owner.id]) {
        lockReasons[owner.id] = reason;
      }
    }
  }

  issues.sort((a, b) => a.span.from - b.span.from || a.ruleKey.localeCompare(b.ruleKey));

  // 控制点归属：优先用 sourceRef.sourceId 精确匹配语句；退化时用 sourceSpan 落点补锁。
  const handleReasons: Record<string, string> = {};
  for (const h of handles) {
    if (!h || typeof h.id !== "string") continue;
    const sid = h.sourceRef?.sourceId;
    let reason = sid ? (lockReasons[sid] ?? null) : null;
    const spanFrom = h.sourceRef?.sourceSpan?.from;
    if (!reason) {
      reason = insideLockedStatement(statements, lockReasons, typeof spanFrom === "number" ? spanFrom : null);
    }
    if (!reason) {
      // 构造 span 恰好覆盖控制点坐标本身（如 \foreach 展开点共享 (\x,0)）
      const hit = issues.find(
        (it) =>
          it.severity === "lock" &&
          typeof spanFrom === "number" &&
          spanFrom >= it.span.from &&
          spanFrom < it.span.to,
      );
      if (hit) reason = hit.reason;
    }
    if (reason) handleReasons[h.id] = reason;
  }

  // featureUsage 里的 used-unsupported 兜底：正则没认出来的新构造也要能导向精确预览。
  const unsupportedFeatures: CompatFeatureInfo[] = [];
  if (usageMap) {
    const ids = input.featureIds && input.featureIds.length > 0 ? input.featureIds : Object.keys(usageMap);
    for (const id of ids) {
      if (usageMap[id] !== "used-unsupported") continue;
      const row = matrix?.[id];
      unsupportedFeatures.push({
        id,
        label: featureLabel(id),
        support: readSupport(matrix, [id]),
        usage: "used-unsupported",
        notes: typeof row?.notes === "string" ? row.notes : undefined,
      });
    }
  }

  const lockedHandleCount = Object.keys(handleReasons).length;
  const lockedStatementCount = Object.keys(lockReasons).length;
  const hasUnsupported = unsupportedFeatures.length > 0 || issues.some((it) => it.usage === "used-unsupported");
  const parts: string[] = [];
  if (lockedHandleCount > 0) parts.push(`${lockedHandleCount} 个控制点已锁定`);
  if (lockedStatementCount > 0) parts.push(`${lockedStatementCount} 条语句不可编辑属性`);
  if (hasUnsupported) parts.push(`${unsupportedFeatures.length || 1} 处构造本地引擎未完整支持`);
  const summary = parts.join(" · ");
  const empty =
    issues.length === 0 && unsupportedFeatures.length === 0 && lockedHandleCount === 0 && lockedStatementCount === 0;

  return {
    issues,
    lockReasons,
    handleReasons,
    unsupportedFeatures,
    lockedHandleCount,
    lockedStatementCount,
    hasUnsupported,
    summary,
    empty,
  };
}

/**
 * 控制点 / 属性区的锁定理由：优先用 capabilityMatrix 归因而来的具体理由，
 * 未命中时回落到 F2-1 的 lockedHandleReason()，保证任何锁定都有可读说明。
 */
export function compatHandleReason(
  report: CompatReport | null | undefined,
  handleId: string,
  fallback: string,
): string {
  return report?.handleReasons[handleId] ?? fallback;
}

/**
 * 组合两种锁定来源：F2-3 能力矩阵归因 > F2-1 句柄自身 rewriteMode 判定。
 * 返回 null 表示这个控制点可以拖。纯函数，Node 侧可回归。
 */
export function resolveHandleLock(
  report: CompatReport | null | undefined,
  handleId: string,
  draggable: boolean,
  fallbackReason: string,
): string | null {
  const fromMatrix = compatHandleReason(report, handleId, "");
  if (fromMatrix) return fromMatrix;
  return draggable ? null : fallbackReason;
}

/** 供回归断言使用：报告里的所有短理由都不应为空串。 */
export function allReasonsNonEmpty(report: CompatReport): boolean {
  return (
    Object.values(report.handleReasons).every((v) => typeof v === "string" && v.trim().length > 0) &&
    Object.values(report.lockReasons).every((v) => typeof v === "string" && v.trim().length > 0)
  );
}
