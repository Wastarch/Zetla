# editor/ —— 编辑壳

CodeMirror 6 封装与编辑器 UI 落位于此：

- `LaTeXEditor.tsx` — CM6 单文档受控封装（**M0-4**：LaTeX 高亮、行号、括号配对、查找替换、Ctrl+S、
  `gotoLine`/`getCursorPos`/`getCursorLine`/`openFind`/`refresh`/`focus`；**M0-5** 加 `onCursorChange`）
- `useBuffers.ts` — 缓冲区 store（**M0-5**：打开/切换/关闭、脏状态、保存写盘+回读校验、原生确认关闭拦截）
- `TabBar.tsx` — 多文件标签条（**M0-5**：活动 accent 顶条、脏点 `.tdot` 替代关闭按钮、`.tab-tools` 入口）
- `EditorWorkspace.tsx` — 编辑工作区（**M0-5**：TabBar + 多实例编辑区 + `.editor-status` 状态条 + toast）

## 约定

- **`LaTeXEditor` 是单文档受控组件**：`value` + `onChange` + `onSave` + `onCursorChange`，不持有多标签状态。
- **多标签实例策略（方案 A）**：每个缓冲区首次激活后创建一个 CM 实例并常驻，切走仅 `hidden` 隐藏 ——
  撤销栈 / 光标 / 滚动由 `EditorState` 原生隔离，不做状态序列化搬运；`refresh()` 在隐藏→显示后重新测量。
- **跳行统一走 `ref.gotoLine(line, col?)`**（1-based，滚动居中并聚焦），M0-11 错误定位直接复用，不要另造接口。
- 查找替换用 CM 内置面板（`openFind()` / Ctrl+F），不另做 findbar（设计稿 findbar 样式已备，M1 视需要再接）。
- 代码折叠 MVP 不做（`MVP.md` Phase 1-2），`foldGutter: false`。
- UI tokens 与样式在 `src/styles/zetla.css`（来源 `docs/UI/code.html`，亮色主题；dark 块保留待 M3）。
