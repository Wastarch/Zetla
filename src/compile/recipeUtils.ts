// M2 · Tool / Recipe 前端辅助（纯函数，不依赖 React / IPC，便于逻辑校验）
// 协议类型见 src/types/settings.ts / compile.ts；设计见 docs/dev/compile-recipe-system.md
import type {
  AppSettings,
  BuildCondition,
  CompileStepProgress,
  RecipeDef,
  RecipeInfo,
  RecipeStep,
  RecipeStepDetailed,
  RepeatConfig,
  ToolDef,
} from "@/types";

/** 与 Rust MAX_TOOLS / MAX_RECIPES / MAX_RECIPE_STEPS 对齐 */
export const MAX_TOOLS = 32;
export const MAX_RECIPES = 32;
export const MAX_RECIPE_STEPS = 32;

/** 真实编译引擎名（内置 token；与 Rust resolve_command 的引擎分支一一对应，选中即固定该引擎） */
export const ENGINE_TOOL_NAMES = ["xelatex", "pdflatex", "lualatex"] as const;
/** 辅助工具 token（本来就是真实命令名，保持不变） */
export const AUX_TOOL_NAMES = ["latexmk", "biber", "bibtex"] as const;
/** 兼容别名：老配置 / 旧 JSON 里可能仍有 "latex"，后端仍支持（跟随当前引擎），UI 不再列出 */
export const LEGACY_ENGINE_ALIAS = "latex";

/** 工具名 → 展示名（引擎用规范大小写，其余保持命令名） */
export const TOOL_LABELS: Record<string, string> = {
  xelatex: "XeLaTeX",
  pdflatex: "pdfLaTeX",
  lualatex: "LuaLaTeX",
  [LEGACY_ENGINE_ALIAS]: "latex（跟随当前引擎）",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

/** 状态栏流程步骤文案：XeLaTeX（1/4）；收敛重跑追加「· 重跑」 */
export function formatStepChip(
  tool: string,
  index: number,
  total: number,
  rerun: boolean,
): string {
  const n = Math.max(0, Math.trunc(index));
  const d = Math.max(0, Math.trunc(total));
  return `${toolLabel(tool)}（${n}/${d}）${rerun ? " · 重跑" : ""}`;
}

/** 状态栏流程步骤 tooltip：交代流程名、位置、跳号原因与重跑 */
export function stepChipTitle(s: CompileStepProgress): string {
  const parts = [`流程 ${s.recipe}`, `第 ${s.index}/${s.total} 步 · ${toolLabel(s.tool)}`];
  if (s.skipped > 0) {
    parts.push(`此前跳过 ${s.skipped} 个条件步骤（故序号会跳号）`);
  }
  if (s.rerun) {
    parts.push("repeat.untilStable 收敛重跑");
  }
  return parts.join(" · ");
}

/** 新建流程 / 新增步骤时的默认引擎步：跟随设置里的生效引擎（auto → xelatex） */
export function defaultEngineTool(d: AppSettings): string {
  return d.build.engine === "auto" ? "xelatex" : d.build.engine;
}

/**
 * list_recipes IPC 失败时的兜底（正常路径以 IPC 返回为单源，防 UI 与执行器漂移）。
 * 与 compile.rs::builtin_recipes 保持一致：latexmk（fallback→engine-direct）与 engine-direct；
 * 引擎步按 auto 的缺省值写成真实引擎名 xelatex。
 */
export const BUILTIN_FALLBACK: RecipeInfo[] = [
  { name: "latexmk", builtin: true, deletable: false, tools: ["latexmk"] },
  {
    name: "engine-direct",
    builtin: true,
    deletable: false,
    tools: ["xelatex", "biber", "xelatex", "xelatex"],
  },
];

/** 内置流程名集合（用于标「不可删」） */
export function isBuiltinRecipe(name: string): boolean {
  return BUILTIN_FALLBACK.some((r) => r.name === name);
}

/** RecipeStep 既可以是工具名字符串，也可以是 { tool, when? } */
export function stepToolName(s: RecipeStep): string {
  return typeof s === "string" ? s : s.tool;
}

/** 步骤序列的可读预览（设置页 / 状态栏菜单共用） */
export function recipeStepNames(r: RecipeDef): string[] {
  return r.tools.map(stepToolName);
}

export function recipeStepPreview(r: RecipeDef): string {
  const names = recipeStepNames(r).map(toolLabel);
  return names.length > 0 ? names.join(" → ") : "（空流程）";
}

/** 步骤下拉可选工具：真实引擎名 + 辅助工具 + 用户自定义 Tool 名（去重） */
export function recipeToolOptions(d: AppSettings): string[] {
  const names = new Set<string>([...ENGINE_TOOL_NAMES, ...AUX_TOOL_NAMES]);
  for (const t of d.build.tools) {
    if (t.name.trim()) names.add(t.name);
  }
  return [...names];
}

/** JSON 编辑器处理的完整配置束 */
export interface RecipeBundle {
  tools: ToolDef[];
  recipes: RecipeDef[];
  defaultRecipe: string | null;
}

export function bundleFromSettings(d: AppSettings): RecipeBundle {
  return {
    tools: d.build.tools,
    recipes: d.build.recipes,
    defaultRecipe: d.build.defaultRecipe,
  };
}

export function bundleToSettings(d: AppSettings, b: RecipeBundle): AppSettings {
  return {
    ...d,
    build: {
      ...d.build,
      tools: b.tools,
      recipes: b.recipes,
      defaultRecipe: b.defaultRecipe,
    },
  };
}

// ── JSON 校验/归一化（与 Rust serde 结构对齐，错误给出可定位信息）──────────
function fail(where: string, why: string): never {
  throw new Error(`${where}：${why}`);
}
function asRecord(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    fail(where, "应为对象");
  }
  return v as Record<string, unknown>;
}
function asStr(v: unknown, where: string, allowEmpty = false): string {
  if (typeof v !== "string") fail(where, "应为字符串");
  if (!allowEmpty && !(v as string).trim()) fail(where, "不能为空");
  return v as string;
}
function asStrArray(v: unknown, where: string): string[] {
  if (!Array.isArray(v)) fail(where, "应为字符串数组");
  return v.map((x, i) => asStr(x, `${where}[${i}]`, true));
}
function asBool(v: unknown, where: string, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "boolean") fail(where, "应为 true/false");
  return v;
}
function asNullableStr(v: unknown, where: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  return asStr(v, where);
}
function asCondition(v: unknown, where: string): BuildCondition | null {
  if (v === undefined || v === null) return null;
  const o = asRecord(v, where);
  const type = asStr(o.type, `${where}.type`);
  if (type === "fileExists") {
    return { type: "fileExists", path: asStr(o.path, `${where}.path`) };
  }
  if (type === "logRegex") {
    return { type: "logRegex", pattern: asStr(o.pattern, `${where}.pattern`) };
  }
  if (type === "env") {
    return {
      type: "env",
      name: asStr(o.name, `${where}.name`),
      value: asNullableStr(o.value, `${where}.value`) ?? undefined,
    };
  }
  return fail(`${where}.type`, `未知条件类型「${type}」（可选 fileExists / logRegex / env）`);
}
function asSteps(v: unknown, where: string): RecipeStep[] {
  if (!Array.isArray(v)) fail(where, "应为数组（元素为工具名字符串或 { tool, when? }）");
  if (v.length > MAX_RECIPE_STEPS) fail(where, `步骤数超过上限 ${MAX_RECIPE_STEPS}`);
  return v.map((raw, i) => {
    const w = `${where}[${i}]`;
    if (typeof raw === "string") return asStr(raw, w);
    const o = asRecord(raw, w);
    const step: RecipeStepDetailed = {
      tool: asStr(o.tool, `${w}.tool`),
      when: asCondition(o.when, `${w}.when`),
    };
    return step;
  });
}
function asRepeat(v: unknown, where: string): RepeatConfig | null {
  if (v === undefined || v === null) return null;
  const o = asRecord(v, where);
  const maxRaw = o.max ?? 10;
  if (typeof maxRaw !== "number" || !Number.isFinite(maxRaw) || maxRaw < 1) {
    fail(`${where}.max`, "应为 ≥1 的数字");
  }
  return {
    untilStable: asBool(o.untilStable, `${where}.untilStable`, false),
    max: Math.min(100, Math.floor(maxRaw)),
  };
}
function asTool(v: unknown, i: number): ToolDef {
  const where = `tools[${i}]`;
  const o = asRecord(v, where);
  const envRaw = o.env ?? {};
  const env = asRecord(envRaw, `${where}.env`);
  const envOut: Record<string, string> = {};
  for (const [k, val] of Object.entries(env)) {
    envOut[k] = asStr(val, `${where}.env.${k}`, true);
  }
  return {
    name: asStr(o.name, `${where}.name`),
    command: asStr(o.command, `${where}.command`),
    args: o.args === undefined ? [] : asStrArray(o.args, `${where}.args`),
    cwd: asNullableStr(o.cwd, `${where}.cwd`),
    env: envOut,
    ignoreErrors: asBool(o.ignoreErrors, `${where}.ignoreErrors`, false),
  };
}
function asRecipe(v: unknown, i: number): RecipeDef {
  const where = `recipes[${i}]`;
  const o = asRecord(v, where);
  return {
    name: asStr(o.name, `${where}.name`),
    tools: o.tools === undefined ? [] : asSteps(o.tools, `${where}.tools`),
    repeat: asRepeat(o.repeat, `${where}.repeat`),
    fallback: asNullableStr(o.fallback, `${where}.fallback`),
  };
}

/** 解析 JSON 高级编辑器内容；失败返回可展示的错误文案 */
export function parseRecipeBundle(
  text: string,
): { ok: true; value: RecipeBundle } | { ok: false; error: string } {
  try {
    const raw: unknown = JSON.parse(text);
    const o = asRecord(raw, "根节点");
    if (!Array.isArray(o.tools)) fail("tools", "应为数组");
    if (!Array.isArray(o.recipes)) fail("recipes", "应为数组");
    if (o.tools.length > MAX_TOOLS) fail("tools", `数量超过上限 ${MAX_TOOLS}`);
    if (o.recipes.length > MAX_RECIPES) fail("recipes", `数量超过上限 ${MAX_RECIPES}`);
    const tools = o.tools.map((t, i) => asTool(t, i));
    const recipes = o.recipes.map((r, i) => asRecipe(r, i));
    const seen = new Set<string>();
    for (const r of recipes) {
      if (seen.has(r.name)) fail("recipes", `流程名「${r.name}」重复（Rust 归一化会去重）`);
      seen.add(r.name);
    }
    const defaultRecipe = asNullableStr(o.defaultRecipe, "defaultRecipe");
    return { ok: true, value: { tools, recipes, defaultRecipe } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
