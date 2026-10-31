// M2-5c · 代码片段模块（纯钩子模块，无 UI 槽位）。
// 开关语义：停用后片段补全源不再返回结果、Tab 直展失效（回落到缩进）；
// 因补全源与 keymap 是静态挂载的编辑器扩展，此处只翻转 snippetsSupport 内的
// enabled 闸门，不做扩展重建（重建会丢展开中的占位符会话）。
import { moduleRegistry } from "@/core/moduleRegistry";
import { setSnippetsEnabled } from "@/editor/snippetsSupport";

/** 幂等：重复调用不产生重复注册（热更新/重复挂载保护） */
export function registerSnippetsModule(): void {
  if (moduleRegistry.get("snippets")) return;
  moduleRegistry.register({
    id: "snippets",
    name: "代码片段",
    version: "0.1.0",
    description: "触发词 + Tab 展开 LaTeX 模板（内置 18 条 + 用户自定义，支持选中包裹）",
    requires: ["editor"],
    defaultEnabled: true,
    hooks: {
      onModuleEnabled: () => setSnippetsEnabled(true),
      onModuleDisabled: () => setSnippetsEnabled(false),
    },
  });
}
