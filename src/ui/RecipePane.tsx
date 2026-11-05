// M2 · 设置页「编译设置 → 编译流程（Tool / Recipe）」面板
// 独立组件：避免把 1100 行的 SettingsDialog 继续撑大；仅依赖 props（draft / update），
// 改动写入同一个 settings store，因此「即时预览 / 保存 / 取消回滚」语义与设置页一致。
// 内置流程由后端 list_recipes 提供（UI 与执行器单源），不可删、不可改；用户级流程可增删步骤。
import { useEffect, useState, type ReactNode } from "react";
import { compileApi } from "@/ipc/invoke";
import { notify } from "@/project/useProject";
import type { AppSettings, RecipeDef, RecipeInfo, RepeatConfig, ToolDef } from "@/types";
import {
  BUILTIN_FALLBACK,
  MAX_RECIPES,
  MAX_RECIPE_STEPS,
  MAX_TOOLS,
  bundleFromSettings,
  bundleToSettings,
  isBuiltinRecipe,
  parseRecipeBundle,
  recipeStepNames,
  recipeToolOptions,
  stepToolName,
} from "@/compile/recipeUtils";

interface Props {
  draft: AppSettings;
  update: (fn: (d: AppSettings) => AppSettings) => void;
}

/** 与设置页 .fld 同款行式布局（CSS 全局，不 import SettingsDialog 以免循环） */
function Row({
  label,
  hint,
  tip,
  children,
}: {
  label: string;
  hint: string;
  tip?: string;
  children: ReactNode;
}) {
  return (
    <div className="fld" title={tip}>
      <div className="lbl">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      {children}
    </div>
  );
}

export function RecipePane({ draft, update }: Props) {
  // 内置流程清单：以 list_recipes 为单源；IPC 不可用时用 BUILTIN_FALLBACK 兜底
  const [builtins, setBuiltins] = useState<RecipeInfo[]>(BUILTIN_FALLBACK);
  useEffect(() => {
    let alive = true;
    void compileApi
      .listRecipes(draft.build.engine)
      .then((list) => {
        if (alive && list.length > 0) setBuiltins(list.filter((r) => r.builtin));
      })
      .catch((e) => console.warn("[recipe] list_recipes 失败，使用内置流程清单", e));
    return () => {
      alive = false;
    };
    // 只在面板挂载（设置页打开）时拉一次；用户级流程以 draft 为准，草稿即时可见
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [editingRecipe, setEditingRecipe] = useState<string | null>(null);
  const [newRecipeName, setNewRecipeName] = useState("");
  const [newToolName, setNewToolName] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [jsonOk, setJsonOk] = useState("");

  const toolOptions = recipeToolOptions(draft);
  const allNames = [
    ...builtins.map((r) => r.name),
    ...draft.build.recipes.map((r) => r.name),
  ];

  const updateRecipe = (name: string, fn: (r: RecipeDef) => RecipeDef) =>
    update((d) => ({
      ...d,
      build: {
        ...d.build,
        recipes: d.build.recipes.map((r) => (r.name === name ? fn(r) : r)),
      },
    }));

  const setDefault = (name: string | null) =>
    update((d) => ({ ...d, build: { ...d.build, defaultRecipe: name } }));

  const removeRecipe = (name: string) => {
    update((d) => ({
      ...d,
      build: {
        ...d.build,
        recipes: d.build.recipes.filter((r) => r.name !== name),
        defaultRecipe: d.build.defaultRecipe === name ? null : d.build.defaultRecipe,
      },
    }));
    if (editingRecipe === name) setEditingRecipe(null);
  };

  const addRecipe = () => {
    const name = newRecipeName.trim();
    if (!name) return notify("请输入流程名", "err");
    if (isBuiltinRecipe(name) || draft.build.recipes.some((r) => r.name === name)) {
      return notify("流程名已存在，或属于内置保留名", "err");
    }
    if (draft.build.recipes.length >= MAX_RECIPES) {
      return notify(`自定义流程最多 ${MAX_RECIPES} 个`, "err");
    }
    const recipe: RecipeDef = { name, tools: ["latex"], repeat: null, fallback: null };
    update((d) => ({
      ...d,
      build: { ...d.build, recipes: [...d.build.recipes, recipe] },
    }));
    setNewRecipeName("");
    setEditingRecipe(name);
  };

  const removeTool = (name: string) =>
    update((d) => ({
      ...d,
      build: { ...d.build, tools: d.build.tools.filter((t) => t.name !== name) },
    }));

  const addTool = () => {
    const name = newToolName.trim();
    if (!name) return notify("请输入工具名", "err");
    if (toolOptions.includes(name) || draft.build.tools.some((t) => t.name === name)) {
      return notify("工具名已存在，或与内置 token 冲突", "err");
    }
    if (draft.build.tools.length >= MAX_TOOLS) {
      return notify(`自定义工具最多 ${MAX_TOOLS} 个`, "err");
    }
    const tool: ToolDef = {
      name,
      command: "latex",
      args: [],
      cwd: null,
      env: {},
      ignoreErrors: false,
    };
    update((d) => ({
      ...d,
      build: { ...d.build, tools: [...d.build.tools, tool] },
    }));
    setNewToolName("");
    notify("已新建工具，完整参数请在下方「JSON 编辑」中填写", "ok");
  };

  const openJson = () => {
    if (!jsonOpen) {
      setJsonText(JSON.stringify(bundleFromSettings(draft), null, 2));
      setJsonError("");
      setJsonOk("");
    }
    setJsonOpen(!jsonOpen);
  };
  const reloadJson = () => {
    setJsonText(JSON.stringify(bundleFromSettings(draft), null, 2));
    setJsonError("");
    setJsonOk("已载入当前草稿");
  };
  const applyJson = () => {
    const parsed = parseRecipeBundle(jsonText);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      setJsonOk("");
      return;
    }
    update((d) => bundleToSettings(d, parsed.value));
    setJsonError("");
    setJsonOk("已应用到设置草稿（关闭设置页前请点「保存设置」）");
    setEditingRecipe(null);
  };

  // ── 步骤编辑器（单个用户级 Recipe）─────────────────────────────
  const renderStepEditor = (r: RecipeDef) => {
    const setStepTool = (i: number, tool: string) =>
      updateRecipe(r.name, (cur) => ({
        ...cur,
        tools: cur.tools.map((s, j) =>
          j !== i ? s : typeof s === "string" ? tool : { ...s, tool },
        ),
      }));
    const moveStep = (i: number, delta: number) =>
      updateRecipe(r.name, (cur) => {
        const tools = [...cur.tools];
        const j = i + delta;
        if (j < 0 || j >= tools.length) return cur;
        [tools[i], tools[j]] = [tools[j], tools[i]];
        return { ...cur, tools };
      });
    const setRepeat = (next: RepeatConfig | null) =>
      updateRecipe(r.name, (cur) => ({ ...cur, repeat: next }));
    const repeat = r.repeat;

    return (
      <div className="recipe-detail">
        <div className="steps-editor">
          {r.tools.map((s, i) => {
            const tool = stepToolName(s);
            return (
              <div className="step-row" key={i}>
                <span className="step-pos">{i + 1}</span>
                <select
                  className="step-sel"
                  value={tool}
                  onChange={(e) => setStepTool(i, e.target.value)}
                >
                  {!toolOptions.includes(tool) && <option value={tool}>{tool}</option>}
                  {toolOptions.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {typeof s !== "string" && (
                  <span className="recipe-tag" title="该步带 when 条件；条件请用下方 JSON 编辑">
                    when
                  </span>
                )}
                <button
                  type="button"
                  className="btn step-btn"
                  disabled={i === 0}
                  title="上移"
                  onClick={() => moveStep(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn step-btn"
                  disabled={i === r.tools.length - 1}
                  title="下移"
                  onClick={() => moveStep(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn step-btn"
                  title="删除该步骤"
                  onClick={() =>
                    updateRecipe(r.name, (cur) => ({
                      ...cur,
                      tools: cur.tools.filter((_, j) => j !== i),
                    }))
                  }
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div className="step-row">
            <button
              type="button"
              className="btn"
              disabled={r.tools.length >= MAX_RECIPE_STEPS}
              onClick={() =>
                updateRecipe(r.name, (cur) => ({
                  ...cur,
                  tools: [...cur.tools, "latex"],
                }))
              }
            >
              + 添加步骤
            </button>
            <span className="set-note" style={{ margin: 0 }}>
              预览：{recipeStepNames(r).join(" → ") || "（空流程）"}
            </span>
          </div>
        </div>
        <div className="recipe-opts">
          <label title="解析 .log 的 Rerun 警告，仅重跑引擎步骤直到稳定（带次数上限）">
            <input
              type="checkbox"
              checked={!!repeat?.untilStable}
              onChange={(e) =>
                setRepeat(
                  e.target.checked
                    ? { untilStable: true, max: repeat?.max ?? 10 }
                    : repeat
                      ? { ...repeat, untilStable: false }
                      : null,
                )
              }
            />
            Rerun 时自动重跑
          </label>
          <label>
            最多
            <input
              className="txt-in recipe-max"
              type="number"
              min={1}
              max={100}
              disabled={!repeat?.untilStable}
              value={repeat?.max ?? 10}
              onChange={(e) =>
                setRepeat({
                  untilStable: !!repeat?.untilStable,
                  max: Math.max(1, Math.min(100, Number(e.target.value) || 10)),
                })
              }
            />
            遍
          </label>
          <label>
            失败回退
            <select
              value={r.fallback ?? ""}
              onChange={(e) =>
                updateRecipe(r.name, (cur) => ({ ...cur, fallback: e.target.value || null }))
              }
            >
              <option value="">（无）</option>
              {allNames
                .filter((n) => n !== r.name)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
    );
  };

  return (
    <div className="recipe-pane">
      <div className="recipe-title">编译流程（Tool / Recipe）</div>
      <div className="set-note">
        流程 = 有序的工具步骤；工具 = 命令 + 参数 + 环境变量。仅保存在全局配置，
        <b>不做项目级配置</b>。内置流程不可删；状态栏编译按钮右键 / 长按可临时指定本次流程。
      </div>

      <Row
        label="默认编译流程"
        hint={draft.build.defaultRecipe ? `当前：${draft.build.defaultRecipe}` : "当前：内置 latexmk（默认）"}
        tip="留空 = 后端按内置 latexmk 解析（latexmk 不可用时自动回退 engine-direct）；也可用状态栏临时指定"
      >
        <select
          value={draft.build.defaultRecipe ?? ""}
          onChange={(e) => setDefault(e.target.value || null)}
        >
          <option value="">内置 latexmk（默认）</option>
          {builtins.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}（内置）
            </option>
          ))}
          {draft.build.recipes.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </Row>

      {/* 内置流程（不可删、不可改） */}
      <div className="recipe-list">
        {builtins.map((r) => (
          <div className="recipe-item" key={r.name}>
            <span className="recipe-name">{r.name}</span>
            <span className="recipe-tag">内置 · 不可删</span>
            <span className="recipe-steps">{r.tools.join(" → ")}</span>
            <button type="button" className="btn" onClick={() => setDefault(r.name)}>
              设为默认
            </button>
          </div>
        ))}
        {/* 用户级流程（可编辑步骤 / 删除） */}
        {draft.build.recipes.map((r) => (
          <div className="recipe-block" key={r.name}>
            <div className="recipe-item">
              <span className="recipe-name">{r.name}</span>
              {draft.build.defaultRecipe === r.name && (
                <span className="recipe-tag on">默认</span>
              )}
              <span className="recipe-steps">{recipeStepNames(r).join(" → ")}</span>
              <button
                type="button"
                className="btn"
                onClick={() => setEditingRecipe(editingRecipe === r.name ? null : r.name)}
              >
                {editingRecipe === r.name ? "收起" : "编辑步骤"}
              </button>
              <button type="button" className="btn" onClick={() => setDefault(r.name)}>
                设为默认
              </button>
              <button type="button" className="btn danger" onClick={() => removeRecipe(r.name)}>
                删除
              </button>
            </div>
            {editingRecipe === r.name && renderStepEditor(r)}
          </div>
        ))}
      </div>

      <div className="recipe-add-row">
        <input
          className="txt-in"
          placeholder="新流程名，如 my-pipeline"
          value={newRecipeName}
          onChange={(e) => setNewRecipeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRecipe();
            }
          }}
        />
        <button type="button" className="btn" onClick={addRecipe}>
          + 新建流程
        </button>
      </div>

      <h5>自定义工具（Tool）</h5>
      <div className="set-note">
        步骤下拉里的 <code>latex / latexmk / biber / bibtex</code> 是内置 token；
        自定义工具的 <code>command / args / cwd / env / ignoreErrors</code> 在下方 JSON 编辑器里填写。
      </div>
      <div className="recipe-list">
        {draft.build.tools.length === 0 && (
          <div className="set-note">（暂无自定义工具；可直接用内置 token 编排流程）</div>
        )}
        {draft.build.tools.map((t) => (
          <div className="recipe-item" key={t.name}>
            <span className="recipe-name">{t.name}</span>
            <span className="recipe-steps">
              {t.command} {t.args.join(" ")}
            </span>
            {t.ignoreErrors && <span className="recipe-tag">忽略错误</span>}
            <button type="button" className="btn danger" onClick={() => removeTool(t.name)}>
              删除
            </button>
          </div>
        ))}
      </div>
      <div className="recipe-add-row">
        <input
          className="txt-in"
          placeholder="新工具名，如 makeglossaries"
          value={newToolName}
          onChange={(e) => setNewToolName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTool();
            }
          }}
        />
        <button type="button" className="btn" onClick={addTool}>
          + 新建工具
        </button>
      </div>

      {/* JSON 高级编辑：when 条件 / env / repeat.max / 占位符等完整字段 */}
      <div className="recipe-json-head">
        <button type="button" className="btn" onClick={openJson}>
          {jsonOpen ? "收起 JSON 编辑" : "高级：JSON 编辑（完整字段）"}
        </button>
        <span className="set-note" style={{ margin: 0 }}>
          支持 %DOC% / %DOCFILE% / %DIR% / %OUTDIR% 等占位符与 when 条件
        </span>
      </div>
      {jsonOpen && (
        <div className="recipe-json">
          <textarea
            className="recipe-json-area"
            spellCheck={false}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError("");
              setJsonOk("");
            }}
          />
          <div className="recipe-json-actions">
            <button type="button" className="btn" onClick={reloadJson}>
              载入当前草稿
            </button>
            <button type="button" className="btn" onClick={applyJson}>
              应用 JSON
            </button>
            <span className="set-note" style={{ margin: 0 }}>
              应用会整束覆盖 tools / recipes / defaultRecipe
            </span>
          </div>
          {jsonError && <div className="recipe-err">JSON 无效：{jsonError}</div>}
          {jsonOk && <div className="recipe-ok">{jsonOk}</div>}
        </div>
      )}
    </div>
  );
}

export default RecipePane;
