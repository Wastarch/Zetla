<div align="center">

# 📝 Zetla

### 面向 Windows 的桌面 LaTeX 工作台

> 把项目管理、代码编辑、编译日志与 PDF 预览，收进同一个窗口。

[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](https://github.com/Wastarch/Zetla/releases/latest)
[![Version](https://img.shields.io/badge/Version-v0.2.7-FF6B6B)](https://github.com/Wastarch/Zetla/releases/latest)
[![License](https://img.shields.io/badge/License-Noncommercial-9F7AE0)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)
[![Language](https://img.shields.io/badge/Language-Rust%20%2F%20TS-DEA584)](https://www.rust-lang.org)
[![Made for LaTeX](https://img.shields.io/badge/Made%20for-LaTeX-2CA5E0?logo=latex&logoColor=white)](https://www.latex-project.org)

[🚀 快速上手](#快速上手) · [✨ 功能](#功能) · [📚 详细文档](#详细文档) · [🤝 贡献](#贡献) · [📄 许可证](#许可证)

⭐ 如果这个项目对你有帮助，欢迎 [Star 支持](https://github.com/Wastarch/Zetla)！

</div>

---

📸 应用预览

![Zetla 预览](docs/image/image.png)

## 快速上手 🚀

只需 6 步，立刻开始写 LaTeX：

1. **安装 Zetla** 💾：从 [Releases](https://github.com/Wastarch/Zetla/releases/latest) 下载安装包（详见[使用指南 · 安装](docs/使用指南.md#安装)）。
2. **准备 TeX 环境** 🧰：首次启动自动检测；未安装可在引导面板一键安装 TeX Live，或接管已有安装（见[使用指南 · 首次启动](docs/使用指南.md#首次启动准备-tex-环境)）。
3. **新建或打开项目** 📂：`Ctrl+Shift+N` 从模板新建，或 `Ctrl+Shift+O` 打开项目文件夹。
4. **编写文档** ✍️：在 `.tex` 中用模板、代码片段、公式 / 符号面板高效写作。
5. **一键编译** ⚡：`Ctrl+B` 或点 ▶ 编译，内置 `latexmk` / `engine-direct`。
6. **查看 PDF** 👁️：编译后右侧自动预览，支持源码 ↔ PDF 双向跳转。

## 功能 ✨

Zetla 覆盖项目管理、编辑器、可编排编译、公式 / 表格 / 图片 / 拼图、参考文献与 PDF 预览等完整能力。

| 🗂️ 项目管理 | ✍️ 编辑器 | ⚙️ 可编排编译 |
| :---: | :---: | :---: |
| 模板库 · 多标签 · 自动保存 · GBK 不乱码 | 语法高亮 · 代码片段 · 公式/符号面板 | Tool/Recipe · 实时预览 · 双向跳转 |

| 🧮 公式表格 | 🖼️ 图片拼图 | 📚 参考文献 |
| :---: | :---: | :---: |
| 公式/符号面板 · 表格编辑 | 图片附件 · 拼图布局 | BibTeX 引用管理 |

| 🔄 自动更新 | 🎨 主题外观 | 🪟 桌面体验 |
| :---: | :---: | :---: |
| 自动更新 · 环境引导 | 亮暗主题 · 自定义标题栏 | 原生窗口 · 全局快捷键 |

> [!NOTE]
> 完整功能逐项说明见 [功能介绍](docs/功能介绍.md)。

## 详细文档 📚

完整的功能介绍与使用细节已移至 `docs/` 目录：

| 文档 | 内容 |
| :--- | :--- |
| [功能介绍（完整）](docs/功能介绍.md) | 全部功能逐项说明 |
| [使用指南（完整）](docs/使用指南.md) | 安装、环境准备、编辑、编译、公式、表格、拼图、PDF 等全部用法与快捷键 |
| [常见问题](docs/常见问题.md) | 安装、编译、模板、拼图等高频疑问 |
| [从源码运行](docs/从源码运行.md) | 构建环境、打包、版本号与测试、目录结构 |

> [!TIP]
> 想快速上手直接看上方 **快速上手 🚀**；想深入研究某功能，按需打开上面的文档链接即可。

## 贡献 🤝

欢迎通过 [GitHub Issues](https://github.com/Wastarch/Zetla/issues) 反馈问题或提出建议。提交代码前请先确认改动符合项目当前阶段的范围。

## 许可证 📄

本项目采用 **PolyForm Noncommercial License 1.0.0**。

- 允许个人学习、研究、实验、爱好项目等非商业用途
- 商业使用需要获得版权持有人的单独书面授权
- 商业授权暂通过 [GitHub Issues](https://github.com/Wastarch/Zetla/issues) 联系
- 完整许可证文本见 [LICENSE](LICENSE)
- 官方许可证地址：<https://polyformproject.org/licenses/noncommercial/1.0.0>

Copyright (c) 2026 Zetla contributors
