# editor/ —— 编辑壳

CodeMirror 6 封装与编辑器 UI 落位于此：

- `LaTeXEditor.tsx` — CM6 封装（**M0-4 已交付**：LaTeX 高亮、行号、括号配对、查找替换、Ctrl+S、`gotoLine`/`getCursorLine`/`focus` 命令式接口）
- `TabBar.tsx` — 多文件标签页（每文件独立 `EditorState`）→ **M0-5**
- `useBuffers.ts` — 缓冲区管理（脏状态、保存/关闭拦截）→ **M0-5**

## 约定

- `LaTeXEditor` 是**单文档受控组件**：`value` + `onChange` + `onSave`，不持有多标签状态。
- 跳行统一走 `ref.gotoLine(line, col?)`（1-based，滚动居中并聚焦），M0-11 错误定位直接复用，不要另造接口。
- 代码折叠 MVP 不做（`MVP.md` Phase 1-2），`foldGutter: false`。
