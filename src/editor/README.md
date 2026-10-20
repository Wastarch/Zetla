# editor/ —— 编辑壳（M0-6 填充）

CodeMirror 6 封装与编辑器 UI 落位于此（见 docs/开发计划.md M0-6）：

- `LaTeXEditor.tsx` — CM6 封装（高亮/行号/括号配对/查找替换/折叠/`gotoLine`）
- `TabBar.tsx` — 多文件标签页（每文件独立 `EditorState`）
- `useBuffers.ts` — 缓冲区管理（脏状态、保存/另存为）

M0-1 仅占位，不放业务代码。
