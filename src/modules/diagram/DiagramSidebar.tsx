// M2 · 绘图模块左侧「工具箱」侧栏视图。
// 形态：活动栏「绘图」→ 侧栏显示基础元素 / 组件库 / 图层管理 / 插入选项；画布与源码放在
// 主编辑区的独立 Tab（diagram://editor 伪 buffer），两者并存、互不遮挡。
//
// F3-9（参考 docs/dev/UI/tikz编辑器.html 的布局重排）：
//   · 组件库 / 图层管理 / 导出与插入统一为原生 <details> 手风琴
//     （零新增 state，键盘可用，折叠不丢面板内部状态）；
//   · 代码区（DiagramCodePane / LaTeXEditor）完全不碰。
// 2026-11-12：基础元素按钮从侧栏搬回画布顶部工具条；侧栏不再放「图元与属性」——
//   单个图元的属性 / 尺寸 / 对齐变换在绘图 Tab 的画布左侧（DiagramInspector.tsx），
//   侧栏只保留唯一一份图元清单（LayersPanel）用于点选 / 编组。
// 切到本侧栏即自动打开 / 聚焦绘图 Tab 并锁定 targetTex（F1-1），
// 故侧栏不再放「画布与布局」说明与「切换到绘图 Tab」按钮；布局/通道开关本就在 Tab 顶部。
// F1-4 导出方式单选与「插入到文档」主操作。
import { useEffect, useState, type ReactNode } from "react";
import { useBuffersStore } from "@/editor/useBuffers";
import { useDiagramStore } from "./store";
import { LayersPanel } from "./LayersPanel";
import { insertDiagramCode, insertFigureForImage } from "./insert";
import { exportDiagram, type ExportFormat } from "./export";
import {
  inspectStagingTarget,
  pickImageFile,
  placeStagedImage,
  type StagingContext,
  type StagingPolicy,
} from "./imageStaging";
import { ImageConflictDialog } from "./ImageConflictDialog";
// P3：落盘后先校验路径形态，再进入「等待画布落点」；路径不合法不生成必编译失败的源码
import { validateImageRelPath } from "./imageNodeInsert.ts";
import { notify } from "@/project/useProject";
import type { ExportMode } from "@/types/diagram";
import "./diagram.css";

const DIAGRAM_TAB_PATH = "diagram://editor";

/**
 * 打开 / 聚焦绘图 Tab，并把当前活动的 .tex 锁定为插入目标。
 * 伪 buffer Tab 激活时 getActiveView() 会失效，F1-4 插入必须靠
 * targetTex 取 getEditorView(targetTex)（同 figureImport.ts:30）。
 * openDiagram() 自身幂等；这里额外跳过「已打开且已激活」，避免重复 set 触发重渲染。
 */
function openDiagramTab(): void {
  const buffers = useBuffersStore.getState();
  const activePath = buffers.activePath;
  if (activePath && /\.tex$/i.test(activePath)) {
    useDiagramStore.getState().setTargetTex(activePath);
  }
  if (activePath === DIAGRAM_TAB_PATH && buffers.buffers.some((b) => b.kind === "diagram")) {
    return;
  }
  buffers.openDiagram();
}

/** image / file 由 F5-1 的 tikz_export 落盘链路接入；image 模式在 F5-2 起「落盘 + 插入 figure」。 */
const EXPORT_MODES: { id: ExportMode; label: string; hint: string; ready: boolean }[] = [
  { id: "source", label: "TikZ 源码", hint: "插入完整 tikzpicture 环境", ready: true },
  {
    id: "image",
    label: "导出并插入",
    hint: "PNG / PDF → 项目图片目录，并在光标处插入 figure 环境",
    ready: true,
  },
  { id: "file", label: "仅保存文件", hint: "导出到指定路径，不改主文档", ready: true },
];

/**
 * 可插入主文档的格式。`\includegraphics` 直接吃 PNG / PDF（XeLaTeX 原生支持 PDF），
 * 但 **SVG 不行** —— 需要 `svg` 宏包 + shell-escape，而本项目编译走 `-no-shell-escape`。
 * 所以「导出并插入」只给 PNG / PDF；想留 SVG 矢量源文件请走「仅保存文件」。
 */
const IMAGE_INSERT_FORMATS: ExportFormat[] = ["png", "pdf"];
const ALL_FORMATS: ExportFormat[] = ["png", "svg", "pdf"];

/** F6 组件库的 5 类模板：占位列表，不用按钮避免「死点击」（F3-8 口径）。 */
const LIBRARY_ITEMS: { label: string; hint: string }[] = [
  { label: "神经网络拓扑图", hint: "层 / 节点 / 连接权重" },
  { label: "概率图 · 贝叶斯网", hint: "随机变量 / 条件依赖" },
  { label: "流程图 · 结构图", hint: "判定 / 分支 / 汇聚" },
  { label: "张量 · 矩阵", hint: "网格 / 高亮 / 维度标注" },
  { label: "受力分析", hint: "力矢量 / 角度 / 标注" },
];

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** 手风琴标题：原生 summary + 纯 CSS 箭头，不引入组件 state。 */
function Accordion({
  title,
  meta,
  open = true,
  flush = false,
  children,
}: {
  title: string;
  meta?: string;
  open?: boolean;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="dg-accordion" open={open}>
      <summary className="dg-accordion-head">
        <span className="dg-accordion-title">{title}</span>
        {meta && <span className="dg-accordion-meta">{meta}</span>}
        <span className="dg-accordion-arrow" aria-hidden="true">▾</span>
      </summary>
      <div className={`dg-accordion-body${flush ? " is-flush" : ""}`}>{children}</div>
    </details>
  );
}

export function DiagramSidebar() {
  const source = useDiagramStore((s) => s.source);
  const targetTex = useDiagramStore((s) => s.targetTex);
  const exportMode = useDiagramStore((s) => s.exportMode);
  const setExportMode = useDiagramStore((s) => s.setExportMode);
  const wrapFigure = useDiagramStore((s) => s.wrapFigure);
  const setWrapFigure = useDiagramStore((s) => s.setWrapFigure);
  // F3-7：按画布尺寸导出开关（默认关）；只影响派生导出片段，绝不改 CM6 source。
  const exportUseCanvas = useDiagramStore((s) => s.exportUseCanvas);
  const setExportUseCanvas = useDiagramStore((s) => s.setExportUseCanvas);
  const canvasSize = useDiagramStore((s) => s.canvasSize);
  const caption = useDiagramStore((s) => s.caption);
  const setCaption = useDiagramStore((s) => s.setCaption);
  const label = useDiagramStore((s) => s.label);
  const setLabel = useDiagramStore((s) => s.setLabel);
  // 图层面板默认展开状态（设置里的「图层面板」开关）：只作为手风琴的初始 open，
  // 之后的开合完全交给标题行三角，不再有第二个「收起 / 展开」按钮。
  const layersVisible = useDiagramStore((s) => s.layersVisible);

  const lineCount = source.split("\n").length;

  // F5-1：导出格式（PNG / SVG / PDF），仅在 image / file 模式出现
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exporting, setExporting] = useState(false);
  // F5-2：image 模式落盘的文件名（不含扩展名）。刻意不持久化 —— 换图就该换名，
  // 固定 "diagram" 会让不同图互相覆盖。默认按 label 派生，便于与文档里的图对应。
  const [imageName, setImageName] = useState("diagram");
  // P2：选图 → 暂存到 figure/；同名冲突时弹窗，确认后才真正落盘
  const [staging, setStaging] = useState(false);
  const [conflict, setConflict] = useState<StagingContext | null>(null);
  // P3：已暂存、等待用户在画布上单击落点的图片（store 会话态，与 DiagramCanvas 共享）
  const pendingImage = useDiagramStore((s) => s.pendingImage);
  const setPendingImage = useDiagramStore((s) => s.setPendingImage);

  const formatChoices = exportMode === "image" ? IMAGE_INSERT_FORMATS : ALL_FORMATS;

  // 切到 image 模式时若当前是 SVG，回落到 PNG：SVG 无法直接 includegraphics 插入
  useEffect(() => {
    if (exportMode === "image" && !IMAGE_INSERT_FORMATS.includes(exportFormat)) {
      setExportFormat("png");
    }
  }, [exportMode, exportFormat]);

  // 切到 image 模式时用 label（去 fig: 前缀）作默认文件名，用户仍可改
  useEffect(() => {
    if (exportMode !== "image") return;
    const base = label.replace(/^fig:/, "").trim();
    if (base) setImageName(base.replace(/[\\/:*?"<>|]/g, "_"));
  }, [exportMode, label]);

  // 切到绘图侧栏时自动打开 / 聚焦绘图 Tab：Sidebar 按 view 条件渲染、折叠时整体卸载，
  // 因此「本组件挂载」正好对应「用户点开绘图侧栏」；不再需要手动点按钮。
  useEffect(() => {
    openDiagramTab();
  }, []);

  /**
   * P3：落盘 + 登记 manifest → 进入「等待画布落点」。
   * 路径过不了 P1 白名单（空格 / TeX 特殊字符 / 非法扩展名）时**不进入**等待态，
   * 否则生成的 \includegraphics 会被 token 映射保守跳过、XeLaTeX 必然报 File not found。
   * 该文件仍在 P2 manifest 里，未引用会在关 Tab / 换项目 / 启动时安静清理。
   */
  async function finalizeStaging(ctx: StagingContext, policy: StagingPolicy): Promise<void> {
    const out = await placeStagedImage(ctx, policy);
    if (out.status !== "ok") return;
    const fileName = out.fileName ?? ctx.fileName;
    const checked = validateImageRelPath(out.relPath ?? "");
    if (!checked.ok) {
      notify(
        `已暂存 ${ctx.imageDir}/${fileName}，但${checked.reason}；请改名后重新选择（未引用会在关 Tab 时清理）`,
        "err",
      );
      return;
    }
    // 保证「点得到画布」：仅源码布局切回分屏，精确预览（只读）切回本地即时。
    const s = useDiagramStore.getState();
    if (s.layoutMode === "code") s.setLayoutMode("split");
    if (s.previewMode !== "local") s.setPreviewMode("local");
    const prev = s.pendingImage;
    if (prev) {
      notify(`上一张待放置图片 ${prev.fileName} 已取消（未引用会在关 Tab 时清理）`, "ok");
    }
    s.setPendingImage({
      relPath: checked.path,
      fileName,
      absPath: out.absPath ?? "",
    });
    notify(`已暂存 ${ctx.imageDir}/${fileName} · 请在画布上单击放置（Esc 取消）`, "ok");
  }

  async function handleStagePick(): Promise<void> {
    const srcPath = await pickImageFile();
    if (!srcPath) return;
    setStaging(true);
    try {
      const ctx = await inspectStagingTarget(srcPath);
      if (!ctx) return;
      if (ctx.exists) {
        setConflict(ctx);
        return;
      }
      await finalizeStaging(ctx, "rename");
    } finally {
      setStaging(false);
    }
  }

  async function handleConflictChoose(policy: StagingPolicy): Promise<void> {
    const ctx = conflict;
    setConflict(null);
    if (!ctx) return;
    setStaging(true);
    try {
      await finalizeStaging(ctx, policy);
    } finally {
      setStaging(false);
    }
  }

  const canInsert = exportMode === "source" && !!targetTex && source.trim().length > 0;
  // image 模式要插进主文档，必须已锁定 targetTex；file 模式只落盘，不要求。
  const canExport =
    source.trim().length > 0 && (exportMode === "file" || !!targetTex);
  const canAct = exportMode === "source" ? canInsert : canExport;

  async function handlePrimary(): Promise<void> {
    if (exportMode === "source") {
      insertDiagramCode();
      return;
    }
    const imageMode = exportMode === "image";
    setExporting(true);
    try {
      const out = await exportDiagram({
        mode: exportMode,
        format: exportFormat,
        fileName: imageMode ? imageName.trim() || "diagram" : undefined,
      });
      if (out.status === "ok" && out.outPath) {
        if (imageMode) {
          // F5-2：落盘成功后立刻插入 figure 环境（失败时函数内部已提示「已保存、未插入」）
          if (insertFigureForImage(out.outPath)) {
            notify(`已导出并插入：${basename(out.outPath)}`, "ok");
          }
        } else {
          notify(`已导出到 ${out.outPath}`, "ok");
        }
      } else if (out.status === "error" && out.message) {
        notify(out.message, "err");
      }
      // cancel：用户主动放弃，无需提示
    } catch (e) {
      notify(`导出出错：${String(e)}`, "err");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="dg-side">
      <div className="dg-side-head">
        <span className="dg-side-title">绘图 · 工具箱</span>
        <span className="dg-side-meta">{lineCount} 行源码</span>
      </div>

      <Accordion title="组件库" meta="5 类模板">
        <ul className="dg-library-list">
          {LIBRARY_ITEMS.map((it) => (
            <li key={it.label} className="dg-library-item" title={`${it.hint} · 即将支持`}>
              <span>{it.label}</span>
              <em>即将</em>
            </li>
          ))}
        </ul>
      </Accordion>

      {/* 唯一一份图元清单：点选 / 编组 / 显隐 / 锁定 / 层级都在这里；
          选中项的属性编辑在绘图 Tab 画布左侧，不堆进全局侧栏。
          flush：面板内容直接铺在 body 里，不再套一层卡片。
          开合只靠标题行的三角（原生 details），不再额外挂「收起 / 展开」按钮；
          设置里的「图层面板」开关只决定它的默认展开状态。 */}
      <Accordion title="图层管理" flush open={layersVisible}>
        <LayersPanel />
      </Accordion>

      {/* P2 暂存 + P3 写回：选图 → 冲突 → 落盘 manifest → 画布点选落点 →
          \node{\includegraphics{…}} 写进 CM6 源码。未插入主文档的会在关 Tab 后清理。 */}
      <Accordion title="图片素材" meta="figure/">
        <button
          type="button"
          className="btn dg-stage-btn"
          disabled={staging}
          onClick={() => void handleStagePick()}
          title="选一张 PNG / JPG / PDF 暂存到项目图片目录，再在画布上单击放置；未插入主文档的会在关闭绘图 Tab 后清理"
        >
          {staging ? "暂存中…" : "选择图片并放置"}
        </button>
        {pendingImage && (
          <p className="dg-side-warn">
            等待落点：{pendingImage.fileName} · 画布上单击放置
            <button
              type="button"
              className="btn dg-stage-cancel"
              onClick={() => setPendingImage(null)}
              title="放弃本次放置；图片仍在暂存区，未引用会在关闭绘图 Tab 后清理"
            >
              取消
            </button>
          </p>
        )}
      </Accordion>

      <Accordion title="导出与插入" meta="主 .tex 文档">
        <div className="dg-side-radios">
          {EXPORT_MODES.map((m) => (
            <label
              key={m.id}
              className={`dg-side-radio${exportMode === m.id ? " is-on" : ""}${m.ready ? "" : " is-off"}`}
              title={m.ready ? m.hint : `${m.hint}（即将支持）`}
            >
              <input
                type="radio"
                name="dg-export-mode"
                checked={exportMode === m.id}
                disabled={!m.ready}
                onChange={() => setExportMode(m.id)}
              />
              <span>{m.label}</span>
              {!m.ready && <em>即将</em>}
            </label>
          ))}
        </div>

        <label className="dg-side-check">
          <input
            type="checkbox"
            checked={wrapFigure}
            onChange={(e) => setWrapFigure(e.target.checked)}
          />
          套 figure 环境（caption / label）
        </label>
        <label
          className="dg-side-check"
          title="打开后，XeLaTeX 精确预览与导出按固定画布留白；只在派生片段加 bounding box，绘图源码一字不改"
        >
          <input
            type="checkbox"
            checked={exportUseCanvas}
            disabled={canvasSize.preset === "auto"}
            onChange={(e) => setExportUseCanvas(e.target.checked)}
          />
          按画布尺寸导出（{canvasSize.preset === "auto" ? "需先设置纸张" : `${canvasSize.widthCm.toFixed(1)}×${canvasSize.heightCm.toFixed(1)}cm`}）
        </label>
        {wrapFigure && (
          <div className="dg-side-fields">
            <input
              className="dg-side-input"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="图题（留空用占位文字）"
            />
            <input
              className="dg-side-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="标签，如 fig:diagram"
            />
          </div>
        )}

        {exportMode === "image" && (
          <div className="dg-side-fields">
            <input
              className="dg-side-input"
              value={imageName}
              onChange={(e) => setImageName(e.target.value)}
              placeholder="文件名（不含扩展名），如 fig-loss"
              title="落盘到项目图片目录的文件名；插入的 \\includegraphics 会引用它"
            />
          </div>
        )}

        {exportMode !== "source" && (
          <div className="dg-side-radios">
            {formatChoices.map((f) => (
              <label
                key={f}
                className={`dg-side-radio${exportFormat === f ? " is-on" : ""}`}
                title={f.toUpperCase()}
              >
                <input
                  type="radio"
                  name="dg-export-format"
                  checked={exportFormat === f}
                  onChange={() => setExportFormat(f)}
                />
                <span>{f.toUpperCase()}</span>
              </label>
            ))}
          </div>
        )}

        <button
          type="button"
          className="btn primary dg-side-primary"
          disabled={!canAct || exporting}
          onClick={() => void handlePrimary()}
        >
          {exporting
            ? "导出中…"
            : exportMode === "source"
              ? "插入到文档"
              : exportMode === "image"
                ? "导出并插入"
                : "仅保存文件"}
        </button>
        <p className="dg-side-card-sub">
          目标文档：{targetTex ? basename(targetTex) : "未锁定"}
        </p>
        {!targetTex && (
          <p className="dg-side-warn">先激活 .tex 文档以锁定插入目标</p>
        )}
        {exportMode === "image" && (
          <p className="dg-side-card-sub">仅 PNG / PDF 可插入</p>
        )}
      </Accordion>

      {conflict && (
        <ImageConflictDialog
          fileName={conflict.fileName}
          imageDir={conflict.imageDir}
          owned={conflict.owned}
          onCancel={() => setConflict(null)}
          onChoose={(policy) => void handleConflictChoose(policy)}
        />
      )}
    </div>
  );
}

export default DiagramSidebar;
