// M2·F5-2 · 绘图导出 → figure 片段插入的纯逻辑回归
// 跑法：node --experimental-strip-types scripts/diagram-figure-insert.test.ts
// 只测纯字符串逻辑（相对路径折算 / label slug / caption 落点 / 宽度），
// 不依赖 DOM、Tauri 运行时或编辑器实例。
import { buildDiagramFigureSnippet } from "../src/modules/diagram/figureInsert.ts";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

// ── 相对路径折算：\includegraphics 相对目标 .tex 所在目录解析 ──────────────
{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/Project/demo",
    imageAbsPath: "E:/Project/demo/figure/fig-loss.png",
  });
  check(
    snippet.includes("\\includegraphics[width=0.8\\linewidth]{figure/fig-loss.png}"),
    "同项目根：相对路径为 figure/xxx.png",
  );
}

{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/Project/demo/chapters",
    imageAbsPath: "E:/Project/demo/figure/fig-loss.png",
  });
  check(
    snippet.includes("{../figure/fig-loss.png}"),
    "章节子目录：向上回退到项目图片目录（../figure/…）",
  );
}

{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/Project/demo/chapters/sub",
    imageAbsPath: "E:/Project/demo/figure/a.png",
  });
  check(snippet.includes("{../../figure/a.png}"), "多层子目录：逐级回退（../../…）");
}

{
  // Windows 反斜杠必须折算成正斜杠：LaTeX 里 `\f` 会被当转义。
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:\\Project\\demo",
    imageAbsPath: "E:\\Project\\demo\\figure\\a.png",
  });
  check(snippet.includes("{figure/a.png}"), "反斜杠输入 → 正斜杠输出（LaTeX 路径要求）");
  check(!snippet.includes("figure\\a.png"), "产物不含反斜杠路径");
}

// ── 宽度口径：按画布导出时传 cm，否则回落 0.8\linewidth ──────────────────
{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/p",
    imageAbsPath: "E:/p/figure/a.png",
    width: "8.5cm",
  });
  check(snippet.includes("width=8.5cm"), "固定画布：用画布物理宽度（cm）而非 \\linewidth");
}

{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/p",
    imageAbsPath: "E:/p/figure/a.png",
  });
  check(snippet.includes("width=0.8\\linewidth"), "未指定宽度：回落 0.8\\linewidth 默认值");
}

// ── label slug：由文件名生成稳定 fig: 标签 ────────────────────────────────
{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/p",
    imageAbsPath: "E:/p/figure/Fig Loss.PNG",
  });
  check(snippet.includes("\\label{fig:fig-loss}"), "label 由文件名 slug 生成（fig:fig-loss）");
}

{
  // 中文文件名保留非 ASCII，只归一空格/点/下划线
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/p",
    imageAbsPath: "E:/p/figure/损失曲线.png",
  });
  check(snippet.includes("\\label{fig:损失曲线}"), "中文文件名保留非 ASCII 字符");
}

// ── caption 落点：光标落在空的 \caption{ } 内 ─────────────────────────────
{
  const { snippet, captionOffset } = buildDiagramFigureSnippet({
    texDir: "E:/p",
    imageAbsPath: "E:/p/figure/a.png",
  });
  check(snippet.includes("\\caption{}"), "caption 留空（由用户填图题）");
  check(
    snippet.slice(captionOffset - "\\caption{".length, captionOffset) === "\\caption{",
    "captionOffset 精确落在 \\caption{ 之后",
  );
  check(
    snippet.slice(captionOffset, captionOffset + 1) === "}",
    "光标处紧邻右花括号（可直接输入图题）",
  );
}

// ── figure 环境完整性 ────────────────────────────────────────────────────
{
  const { snippet } = buildDiagramFigureSnippet({
    texDir: "E:/p",
    imageAbsPath: "E:/p/figure/a.png",
  });
  check(
    snippet.startsWith("\\begin{figure}[htbp]") && snippet.endsWith("\\end{figure}"),
    "figure 环境成对出现且默认 htbp",
  );
  check(snippet.includes("\\centering"), "含 \\centering（与 R5 导入版式一致）");
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
