# Zetla

面向 Windows 的桌面 LaTeX 工作台，把项目管理、代码编辑、编译日志和 PDF 预览放进同一个应用里。

> 当前版本 `0.1.1`，处于 **M0 / MVP 开发阶段**。核心链路已经打通：打开项目 → 编辑 `.tex` → 一键 XeLaTeX 编译 → 查看 PDF。

## 功能

- **项目与文件**：打开/新建项目、项目树、右键文件操作、多标签编辑、自动保存
- **LaTeX 编辑**：CodeMirror 6、LaTeX 语法高亮、查找替换、编辑器字体缩放
- **一键编译**：优先使用 `latexmk -xelatex`，缺少 Perl 时回退到多遍 `xelatex`
- **日志与报错**：实时编译日志、结构化错误解析、点击错误跳转到对应行列
- **PDF 预览**：基于 PDF.js，支持缩放、翻页、页内查找和侧栏导航
- **环境引导**：检测已安装的 TeX；未安装时可自动下载并静默安装 TeX Live
- **TeX Live 自动安装**：basic / full 方案可选，国内镜像，自定义安装目录，取消后清理本次新建内容
- **已有安装接管**：支持接管已安装的 TeX Live 根目录、`bin` 或 `bin\windows`
- **桌面体验**：窗口几何、布局和上次打开项目记忆

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 / Rust |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 编辑器 | CodeMirror 6 |
| 状态管理 | zustand |
| PDF 预览 | PDF.js |
| 打包 | Windows NSIS（currentUser） |

## 环境要求

- **Windows 10/11**（当前主要开发与验收平台）
- **Node.js 20+**（Vite 8 要求）
- **Rust stable** 与 Cargo
- **Visual Studio 2022 Build Tools**，包含 MSVC 和 Windows SDK
- **WebView2 Runtime**（Windows 10/11 通常已内置）
- **TeX Live**（可选）：Zetla 可以自动安装；手动安装时建议包含 XeLaTeX、`ctex` 和 Fandol 字体

> 如果 `cargo` 找不到 `link.exe`，请在 “Developer PowerShell for VS 2022” 中运行构建命令。

## 快速开始

```powershell
git clone https://github.com/Wastarch/Zetla.git
cd Zetla
npm install
npm run tauri dev
```

首次启动需要编译 Rust 后端，耗时会比后续启动长。

## 构建

```powershell
npm run build
npm run tauri build
```

Windows 安装包默认输出到：

```text
src-tauri/target/release/bundle/nsis/
```

## 测试与检查

```powershell
# 前端类型检查
npx tsc --noEmit

# 前端生产构建
npm run build

# Rust 单元测试
cd src-tauri
cargo test
```

## 目录结构

```text
Zetla/
├─ src/                 # React 前端：编辑器、预览、项目树、环境引导等
├─ src-tauri/           # Rust/Tauri 后端：编译、文件、配置、安装器等
│  ├─ src/commands/     # Tauri commands
│  └─ templates/        # 内置 LaTeX 模板
├─ docs/                # 开发文档与开发计划
├─ public/              # 静态资源
└─ build/               # 打包脚本与打包文档
```

## 文档

- [开发文档](docs/开发文档.md)：架构、IPC 协议、数据模型和模块设计
- [开发计划](docs/开发计划.md)：M0 切片、看板与验收记录

## 贡献

欢迎通过 [GitHub Issues](https://github.com/Wastarch/Zetla/issues) 反馈问题或提出建议。提交代码前请先确认改动符合项目当前阶段的范围。

## 许可证

本项目采用 **PolyForm Noncommercial License 1.0.0**。

- 允许个人学习、研究、实验、爱好项目等非商业用途
- 商业使用需要获得版权持有人的单独书面授权
- 商业授权暂通过 [GitHub Issues](https://github.com/Wastarch/Zetla/issues) 联系
- 完整许可证文本见 [LICENSE](LICENSE)
- 官方许可证地址：<https://polyformproject.org/licenses/noncommercial/1.0.0>

> PolyForm Noncommercial 1.0.0 是 source-available 许可证，不是 OSI 认可的开源许可证。

Copyright (c) 2026 Zetla contributors