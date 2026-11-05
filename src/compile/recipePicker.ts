// M2 · 状态栏 Recipe 选择菜单的状态与数据加载
// lastUsed 存 localStorage，不进 AppSettings —— 避免污染 Rust 配置协议（仅全局配置为准）。
// 每次打开菜单都重新查 list_recipes，保证设置页新增/删除流程后立即反映（无缓存 stale）。
import { compileApi } from "@/ipc/invoke";
import type { RecipeInfo } from "@/types";
import { BUILTIN_FALLBACK } from "@/compile/recipeUtils";

const LAST_USED_KEY = "zetla.build.lastUsedRecipe";

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
  } catch {
    // 隐私模式 / 存储被禁用时静默降级为「本次会话不记忆」
  }
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
