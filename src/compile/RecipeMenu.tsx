// M2 · 编译流程选择菜单（标签栏拆分按钮 ▾ / 状态栏右键·长按 共用）
// 单源：每次打开都重新查 list_recipes，选中即切换「当前流程」并立即编译一次。
// 当前流程存 localStorage（不进 AppSettings，避免污染 Rust 配置协议）。
import { useEffect, useState } from "react";
import { InsertCtxMenu, type CtxAction } from "@/ui/InsertCtxMenu";
import { getLastUsedRecipe, loadRecipes, setLastUsedRecipe } from "@/compile/recipePicker";
import { toolLabel } from "@/compile/recipeUtils";
import { startCompile } from "@/compile/useCompile";
import { useAppStore } from "@/core/store";
import type { RecipeInfo } from "@/types";

export interface RecipeMenuProps {
  x: number;
  y: number;
  /** 生效引擎（已按项目 config 解析），后端据此生成内置流程的真实引擎步名 */
  engine: string;
  onClose: () => void;
}

export function RecipeMenu({ x, y, engine, onClose }: RecipeMenuProps) {
  const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
  // 菜单每次打开都会重新挂载（条件渲染），初值取当前流程
  const [lastUsed, setLastUsed] = useState<string | null>(getLastUsedRecipe);

  useEffect(() => {
    let alive = true;
    void loadRecipes(engine).then((list) => {
      if (!alive) return;
      setRecipes(list);
      // 自愈：用户级流程在设置页被删掉后，清掉悬空的「当前流程」
      const cur = getLastUsedRecipe();
      if (cur && !list.some((r) => r.name === cur)) {
        setLastUsedRecipe(null);
        setLastUsed(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [engine]);

  const actions: CtxAction[] = [
    {
      label: "按默认流程编译",
      hint: lastUsed
        ? `清除当前流程「${lastUsed}」，后续编译都用设置 → 编译设置中的默认流程`
        : "使用设置 → 编译设置中的默认流程",
      primary: !lastUsed,
      onClick: () => {
        setLastUsedRecipe(null);
        // 显式传 null：本次就不受旧 lastUsed 影响
        void startCompile({ recipe: null });
      },
    },
    ...recipes.map<CtxAction>((r) => ({
      label: `${r.name}${r.builtin ? " · 内置" : " · 自定义"}`,
      hint: `切换为当前流程并立即编译 · 步骤：${r.tools.map(toolLabel).join(" → ") || "（空流程）"}${r.builtin ? " · 不可删" : ""}`,
      primary: r.name === lastUsed,
      onClick: () => {
        setLastUsedRecipe(r.name);
        void startCompile({ recipe: r.name });
      },
    })),
    {
      label: "管理编译流程…",
      hint: "打开 设置 → 编译设置，增删工具与流程、设定默认流程",
      onClick: () => useAppStore.getState().openSettings("build"),
    },
  ];

  return <InsertCtxMenu x={x} y={y} onClose={onClose} actions={actions} />;
}

export default RecipeMenu;
