# tikz-editor 引擎（vendored）

Zetla 绘图模块的 TikZ → SVG 预览引擎，来自上游 [`DominikPeters/tikz-editor`](https://github.com/DominikPeters/tikz-editor)。

| 项 | 值 |
|---|---|
| 上游包 | `@tikz-editor/core` **v1.1.0** |
| 上游 commit | `2800c2563bfcdaa38be88527d92b8d87e0f2fb38` |
| 许可 | **MIT**（见同目录 `LICENSE`，Copyright (c) 2026 Dominik Peters） |
| 形态 | `engine.bundle.js` = 预编译自包含 ESM（esbuild bundle, `minify`, `treeShaking`） |
| 体积 | ~3.39 MB（动态 `import()` 加载，不进主 bundle；F2-1 编辑 API 增约 75 KB） |
| 导出 | `renderTikzToSvg` / `applyEditIntent` / `applyEdit` / `capabilityMatrix` / `FEATURE_IDS` |
| 类型 | `engine.bundle.d.ts`（手写，只描述画布实际读取的返回结构） |

## 为什么是预编译 bundle，而不是源码拷贝

S0 计划里写的是「vendoring 源码」，F1-3 落地时改为「vendoring 预编译产物」，原因：

1. 上游 `packages/core/src` 有 655 个 TS 文件，若直接放进 `src/`，会被 Zetla 的
   `tsc --strict --noUnusedLocals` 全量检查（上游 tsconfig 更宽松），产生大量与本项目无关的类型错误；
   `tsconfig.exclude` 对「被 import 到的文件」无效，无法规避。
2. bundle 已把 `@lezer/common` / `@lezer/lr` / `lezer-tex` / `lezer-tikz` 一起打进去，
   **Zetla 不需要新增任何 npm 依赖**，也不必把上游 monorepo 的 workspace 配置搬过来。
3. 只导出同步渲染 + 纯语义编辑入口，天然把字符排版引擎和 20MB 字形数据裁掉（见下）。
4. 上游 `@tikz-editor/core` 未发布到 npm，仍需本地检出源码重新生成，所以本质仍是 vendoring，
   只是交付物是编译后的 JS；`scripts/build-tikz-vendor.mjs` 保证可复现。

## 刻意排除：Computer Modern 字形轮廓数据

上游 `core/src/text/` 下有 213 个文件 / 约 20.46 MB 的字形轮廓数据，由
`createTexNodeTextEngine()` / `renderTikzToSvgAsync()` 动态加载。用户 2026-11-07 决策 **v1 先不带**。

- 本 bundle 只深导入 `render/index.js` 的**同步** `renderTikzToSvg` 与 `edit/apply.js` 的纯语义编辑，
  上述两个文字 API 被 tree-shaking 掉，字形文件在 bundle 中贡献 **0 字节**（生成脚本会断言）。
- 不传 `textEngine` 时，引擎把节点文字输出为原生 SVG `<text>`，字体链
  `Latin Modern Roman, CMU Serif, Times New Roman, serif`，由系统字体渲染。
  **代价**：文字度量与真实 XeLaTeX 输出略有差异（间距/换行），v1 可接受；
  导出仍走 Rust `tikz_export`（XeLaTeX），是权威结果。
- 后续若要恢复精确排版，在生成脚本的入口加导出并重跑即可（体积 +20MB，建议放 Worker + 懒加载）。

## 其它裁剪

| 项 | 处理 |
|---|---|
| `xml-formatter` | 仅 `serializeSvgModelAsync(pretty)` 动态 import 用到，同步路径不触发；生成脚本用虚拟 stub 解析，不引入该 npm 依赖 |
| `renderTikzToSvgAsync` / `createTexNodeTextEngine` | 不导出（避免拉入字形数据） |
| `applyEditIntent` / `applyEdit` / `capabilityMatrix` / `FEATURE_IDS` | **F2-1 已追加导出**：走同一份 parse/semantic 闭包，增量约 75 KB；`capabilityMatrix` 供 F2-3 锁定提示用。仍**不导出** `parseTikz` / `createTexNodeTextEngine`（避免拉入文字引擎）与 `EditorSession`（自带源码的状态化会话，会和 Zetla 的 CM6 受控 source 形成双真源，且会话指纹与画布句柄不同源；直接用无状态 `applyEditIntent`）。`SourcePatch` 在上游是 `export type`，没有运行时值 |
| `node:fs` / `node:path` | 不在同步渲染闭包内，bundle 中零命中（浏览器安全） |

## 重新生成

```bash
git clone https://github.com/DominikPeters/tikz-editor.git
cd tikz-editor && git checkout 2800c25 && npm install
cd /path/to/Zetla
TIKZ_EDITOR_SRC=/path/to/tikz-editor node scripts/build-tikz-vendor.mjs
npm run build
```

脚本会打印 bundle 体积、输入文件数，并断言「字形数据 0 字节」与「无未解析的外部 import」。

## 集成位置

- `../engine.ts`：动态 `import()` 加载 + 源码内容键 LRU 缓存 + 诊断归一化 + `applyDragEdit()` 写回。
- `../svg.ts`：SVG 消毒与 DOM 注入（防 `<script>` / 事件属性 / 外部 `href`）。
- `../../DiagramCanvas.tsx`：debounce 重渲染、空/错/渲染中态、缩放、控制点拖拽层。
- `../../dragEdit.ts`：拖拽坐标换算与最小源码补丁（纯函数，Node 侧可回归）。
