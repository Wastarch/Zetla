// M1-12a · 公式模块（合并原 M1-6 符号面板 + M1-10 公式库）：侧栏「公式」单视图的统一入口。
// 经 ModuleRegistry 注册，设置页一个开关控制整块「公式」视图（输入/输出双区 +
// 快捷工具 / 公式模板 两页签，见 src/project/MathView.tsx）。默认启用。
// M1-19/M1-20：模块启停联动注册/注销「公式」环境编辑器（环境开头常驻 ✎ 标记 → 反向编辑）。
import { lazy } from "react";
import { moduleRegistry } from "@/core/moduleRegistry";
import { registerEnvEditor, unregisterEnvEditor, type EnvEditor } from "@/editor/envEdit";
import { scanFormulas, type FormulaHit } from "./formulaLocate";
import { useComposeStore, type ComposeEditTarget } from "./composeStore";

/** 常驻标记悬停展示名 */
function formulaLabel(f: FormulaHit): string {
  if (f.wrapKind === "env") return `公式（\\begin{${f.envName}}）`;
  return f.wrapKind === "display" ? "公式（$$…$$）" : "公式（$…$）";
}

/** 公式环境编辑器：全文扫描命中 → body 载入编写区并绑定编辑目标（指纹校验原地替换） */
const formulaEnvEditor: EnvEditor = {
  id: "formula",
  viewId: "math",
  scan: (doc) =>
    scanFormulas(doc).map((f) => ({
      id: "formula",
      from: f.from,
      to: f.to,
      markAt: f.markAt,
      label: formulaLabel(f),
      data: f,
    })),
  load: (hit) => {
    const f = hit.data as FormulaHit;
    const st = useComposeStore.getState();
    st.setTab("tools"); // 保证下方编写区可见（页签已提升进 store）
    st.edit(f.body, 0, 0);
    const t: ComposeEditTarget = {
      from: f.from,
      to: f.to,
      fingerprint: f.fingerprint,
      wrapKind: f.wrapKind,
      envName: f.envName,
      loadedBody: f.body,
      sourceText: f.sourceText,
    };
    st.setEditTarget(t);
  },
};

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerMathModule(): void {
  if (moduleRegistry.get("formula")) return;
  moduleRegistry.register({
    id: "formula",
    name: "公式",
    version: "1.0.0",
    description: "符号库与公式库浏览 + 搜索 + 一键插入（快捷工具 / 公式模板）",
    requires: ["editor"],
    defaultEnabled: true,
    hooks: {
      onModuleEnabled: () => {
        registerEnvEditor(formulaEnvEditor);
        console.info("[formula] 公式模块已启用");
      },
      onModuleDisabled: () => {
        unregisterEnvEditor("formula");
        console.info("[formula] 公式模块已停用");
      },
    },
    component: lazy(() => import("./FormulaPanel")),
    slot: "sidebar",
  });
}
