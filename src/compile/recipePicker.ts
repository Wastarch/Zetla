// M2 · 编译流程选择的状态与数据加载
// 当前流程（lastUsed）存 localStorage，不进 AppSettings —— 避免污染 Rust 配置协议（仅全局配置为准）。
// 每次打开菜单都重新查 list_recipes，保证设置页新增/删除流程后立即反映（无缓存 stale）。
import { useEffect, useState } from "react";
import { compileApi } from "@/ipc/invoke";
import type { RecipeInfo } from "@/types";
import { BUILTIN_FALLBACK } from "@/compile/recipeUtils";

const LAST_USED_KEY = "zetla.build.lastUsedRecipe";
/** 当前流程变化时广播，供两个入口的 tooltip / 高亮同步刷新 */
export const RECIPE_CHANGED_EVENT = "zetla:recipe-changed";

export function getLastUsedRecipe(): string | null {
  try {
    return window.localStorage.getItem(LAST_USED_KEY);
  } catch {
    return null;
  }
}

export function setLastUsedRecipe(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(LAST_USED_KEY, name);
    else window.localStorage.removeItem(LAST_USED_KEY);
    window.dispatchEvent(new Event(RECIPE_CHANGED_EVENT));
  } catch {
    // 隐私模式 / 存储被禁用时静默降级为「本次会话不记忆」
  }
}

/**
 * 流程选择的单一口径（供 startCompile 调用）：
 * 显式指定（字符串 / null）> 当前流程（localStorage）> 设置页默认 > null（后端兜底内置 latexmk）。
 * explicit === null 表示「强制按默认」，用于菜单里的「按默认流程编译」。
 */
export function resolveRecipeSelection(
  explicit: string | null | undefined,
  defaultRecipe: string | null | undefined,
): string | null {
  return explicit !== undefined ? explicit : (getLastUsedRecipe() ?? defaultRecipe ?? null);
}

/** 响应式读取当前流程（标签栏 / 状态栏 tooltip 共用） */
export function useCurrentRecipe(): string | null {
  const [name, setName] = useState<string | null>(getLastUsedRecipe);
  useEffect(() => {
    const sync = () => setName(getLastUsedRecipe());
    window.addEventListener(RECIPE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(RECIPE_CHANGED_EVENT, sync);
  }, []);
  return name;
}

/** 拉取可用流程；IPC 失败时回退内置清单，菜单始终可用 */
export async function loadRecipes(engine = "auto"): Promise<RecipeInfo[]> {
  try {
    const list = await compileApi.listRecipes(engine);
    return list.length > 0 ? list : BUILTIN_FALLBACK;
  } catch (e) {
    console.warn("[recipe] list_recipes 失败，使用内置流程清单", e);
    return BUILTIN_FALLBACK;
  }
}
