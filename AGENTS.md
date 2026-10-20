# AGENTS.md

## 项目

Zetla —— 桌面 LaTeX 工作台（Tauri 2 + React 19 + Vite 8 + CodeMirror 6 + zustand）。当前处于 **M0（MVP）迭代期**，切片定义见 `docs/开发计划.md`，技术方案见 `docs/开发文档.md`（口径不一致时以开发文档为准）。

## 长期分工（用户定，务必遵守）

- **agent 负责**：实现切片 → `npm run build`（tsc 严格；涉 Rust 时 `cargo test`）→ `npm run tauri dev` 启动**无报错**级自检 → 同步文档（`docs/开发计划.md` 看板与切片块、`docs/开发文档.md`）。
- **用户负责**：人工冒烟测试、git 提交。因此**看板行在用户提交前不写提交哈希**（用户已提交的旧切片保留历史哈希即可）。
- agent **不做** UI 自动化截图/点击驱动冒烟。

## 硬约定

- UI 唯一依据 `docs/UI/code.html`（mockup）；MVP 仅亮色主题（`data-theme="light"`），dark token 保留。
- `src/types/` 与 Rust struct 一一对应，manifest/协议 JSON 均 camelCase（Rust 侧 `#[serde(rename_all = "camelCase")]`），改一边必同步另一边。
- 新命令 = `src-tauri/src/commands/<域>.rs` + `lib.rs` 注册 + `src/ipc/invoke.ts` 补签名，三处齐全。
- 非核心功能后置清单见开发文档 §0.1；MVP 不做的能力在 UI 上**置灰 + tooltip 标注接通切片**，不做假入口。

## 环境坑（Windows）

- `cargo` 需先加载 VS 环境：`& "D:\Users\Burce\Software\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1" -SkipAutomaticLocation`
- PowerShell 5.1：JSON 不支持注释；`.ps1` 无 BOM 时中文按 GBK 误读；`cargo test 2>&1` 会触发 NativeCommandError 假 EXIT=1，用 `cargo test -q; "EXIT=$LASTEXITCODE"` 判定。
- tauri-build 的 `bundle.resources` 用**目录**形式（`"templates"`）；`templates/**` 尾缀 glob 会报「未匹配任何文件」。
