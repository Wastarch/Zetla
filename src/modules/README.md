# modules/ —— 功能模块层（M1 起填充）

按 ModuleRegistry 挂载的功能模块（见 docs/开发文档.md §4.2）：

- `symbol/` `table/` `image/` — P0（M1）
- `preview/` — PDF 预览（M1）
- `diagram/` — 绘图组件（M2）

约定：模块间不直接调用，一律走 `core/bus`；模块懒加载（`React.lazy`）。
M0-1 仅占位，不放业务代码。
