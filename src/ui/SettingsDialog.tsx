// M0-14a · 偏好设置页（对齐 docs/UI/code.html 679–769 偏好设置模态）
// 页签：编译设置 / 编辑器 / PDF 预览 / 外观与保存 / 关于 Zetla
// 交互：改动即时预览（setSettings → 运行时立即生效），「保存设置」落盘并关闭，「取消」回滚快照
// 未接通项按硬约定置灰 + tooltip 标注接通切片（小地图/折叠 M1、Synctex M3；
// 暗色主题 M1-2 已接：外观页「主题」下拉 + 菜单「切换明暗主题」；
// 多编译引擎 M1-3 已接：编译页「默认编译引擎」；M2 起编译流程统一由 Tool / Recipe 面板编排；
// 界面密度经用户确认取消，不占位）
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import { APP_VERSION } from "@/version";
import { useAppStore, type SettingsPane } from "@/core/store";
import { cloneSettings, useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import { useModuleList } from "@/modules/useModuleList";
import { openEnvGuide } from "@/env/useEnvCheck";
import { useUpdateStore } from "@/modules/updater/updateStore";
import { countNoteLines, parseNotes } from "@/modules/updater/notes";
import type { UpdateProgress } from "@/modules/updater/types";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Icon } from "@/ui/Icon";
import { SyntaxHighlightDialog } from "@/ui/SyntaxHighlightDialog";
import { RecipePane } from "@/ui/RecipePane";
import { SnippetsPane, resetSnippetsDraft } from "@/ui/SnippetsPane";
import { flushSnippets, hasDirtySnippets } from "@/ui/snippetsPaneBridge";
import { configApi } from "@/ipc/invoke";
import {
  DEFAULT_AUX_EXTENSIONS,
  LIVE_PREVIEW_DELAY_PRESETS,
  SUGGESTED_FONTS,
  TERMINAL_SCROLLBACK_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
} from "@/types/settings";
import type { AppSettings, AppTheme, CompileEngine, PdfDefaultZoom } from "@/types/settings";
import {
  useDiagramStore,
  type HandleSize,
  type LayoutMode,
} from "@/modules/diagram/store";
import { HANDLE_SIZE_LABELS, handleSizeSummary } from "@/modules/diagram/handleVisual";
import {
  CANVAS_PRESET_LABELS,
  canvasSizeForPreset,
  presetMaxHeightCm,
  type CanvasPreset,
} from "@/modules/diagram/canvasSize";
import type { PreviewMode } from "@/types/diagram";

const PANES: { id: SettingsPane; icon: string; label: string }[] = [
  { id: "general", icon: "layout", label: "通用" },
  { id: "build", icon: "play", label: "编译设置" },
  { id: "editor", icon: "edit", label: "编辑器" },
  { id: "pdf", icon: "pdf", label: "PDF 预览" },
  { id: "look", icon: "sun", label: "外观与保存" },
  { id: "snippets", icon: "list", label: "代码片段" },
  { id: "modules", icon: "wand", label: "模块" },
  { id: "diagram", icon: "image", label: "绘图" },
  { id: "about", icon: "book", label: "关于 Zetla" },
];

/** 字体建议列表（M1-22 起字体族为任意字符串，datalist 供快捷选择亦可自由输入） */
const FONT_OPTIONS = SUGGESTED_FONTS;
/** 字号可选值 8–32（M0-14a 用户追加：Ctrl+滚轮缩放后为连续范围） */
const FONT_SIZE_OPTIONS = Array.from({ length: 25 }, (_, i) => i + 8);
const INTERVAL_OPTIONS = [5, 15, 30, 60];
const ZOOM_OPTIONS: { value: PdfDefaultZoom; label: string }[] = [
  { value: "fit-width", label: "适合宽度" },
  { value: "100", label: "100%" },
  { value: "125", label: "125%" },
  { value: "150", label: "150%" },
];

/** 路径过长时保留末尾目录和文件名；完整值仍放在 title 中。 */
function compactPath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path;
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return path;

  let suffix = parts.pop()!;
  if (suffix.length + 1 >= maxLength) {
    return `…${suffix.slice(-(maxLength - 1))}`;
  }
  while (parts.length > 0) {
    const candidate = `${parts[parts.length - 1]}${separator}${suffix}`;
    if (candidate.length + 2 > maxLength) break;
    suffix = candidate;
    parts.pop();
  }
  return `…${separator}${suffix}`;
}

/** 设置行：左侧标题+说明（tooltip 可标注置灰原因），右侧控件 */
function Fld({
  label,
  hint,
  tip,
  children,
}: {
  label: string;
  hint: string;
  tip?: string;
  children: ReactNode;
}) {
  return (
    <div className="fld" title={tip}>
      <div className="lbl">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      {children}
    </div>
  );
}

/** 拨杆开关（disabled 时仍可看到当前态；置灰原因走行级 tooltip） */
function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={checked ? "switch on" : "switch"}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={disabled ? undefined : () => onChange?.(!checked)}
    >
      <i />
    </button>
  );
}

/** M1-1：blockedReason → 人类可读的置灰原因（dep:<id> / cap:<名>） */
function blockedTip(reason: string | null, names: Record<string, string>): string | undefined {
  if (!reason) return undefined;
  if (reason.startsWith("dep:")) {
    const dep = reason.slice(4);
    return `依赖模块「${names[dep] ?? dep}」未启用`;
  }
  if (reason.startsWith("cap:")) return `内核能力「${reason.slice(4)}」不可用`;
  return reason;
}

export function SettingsDialog() {
  const pane = useAppStore((s) => s.settingsDialog);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const draft = useSettingsStore((s) => s.settings);
  const env = useAppStore((s) => s.env);

  // 打开时快照（条件渲染保证每次打开重建；「取消」回滚到此时）
  const snapshotRef = useRef<AppSettings>(cloneSettings(useSettingsStore.getState().settings));
  // 回退值取构建期生成的 APP_VERSION（与 package.json 唯一版本源联动）；
  // 正常情况下 getVersion() 会拿到 tauri.conf.json 的真实版本覆盖它。
  const [version, setVersion] = useState(APP_VERSION);
  const [configPath, setConfigPath] = useState("config.json");

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {}); // 权限受限时回退默认
    void configApi
      .getAppConfigPath()
      .then(setConfigPath)
      .catch(() => {}); // 非 Tauri 预览环境回退为通用文件名
  }, []);

  const update = useCallback(
    (fn: (d: AppSettings) => AppSettings) => {
      // draft 即 store.settings（单一数据源）：预览改动直接写运行时 store
      const next = fn(cloneSettings(useSettingsStore.getState().settings));
      setSettings(next);
    },
    [setSettings],
  );

  // M1-9c：自定义清理辅助文件的后缀编辑
  const [auxInput, setAuxInput] = useState("");
  // M1-17：语法高亮配色对话框开关（设置页「外观与保存 → 语法高亮」打开）
  const [showHighlight, setShowHighlight] = useState(false);
  // 受保护后缀：即便被加入自定义列表也不删（防误删源/产物/资源），Rust 侧同步兜底
  const PROTECTED_AUX = new Set([
    ".tex", ".bib", ".cls", ".sty", ".bst", ".pdf", ".png", ".jpg", ".jpeg", ".gif",
    ".tif", ".tiff", ".bmp", ".eps", ".svg", ".md", ".txt", ".json", ".yaml", ".yml",
    ".toml", ".cfg", ".def", ".dtx", ".ins", ".ltx",
  ]);
  const normalizeAuxExt = (raw: string): string | null => {
    const s = raw.trim().toLowerCase().replace(/^\.+/, "");
    return s ? "." + s : null;
  };
  const addAuxExt = () => {
    const norm = normalizeAuxExt(auxInput);
    setAuxInput("");
    if (!norm) return;
    if (PROTECTED_AUX.has(norm)) {
      notify(`「${norm}」受保护，不会删除源/产物文件`, "err");
      return;
    }
    update((d) => {
      if (d.build.cleanAuxExtensions.some((e) => e.toLowerCase() === norm)) return d; // 去重
      return {
        ...d,
        build: { ...d.build, cleanAuxExtensions: [...d.build.cleanAuxExtensions, norm] },
      };
    });
  };
  const removeAuxExt = (i: number) =>
    update((d) => ({
      ...d,
      build: {
        ...d.build,
        cleanAuxExtensions: d.build.cleanAuxExtensions.filter((_, j) => j !== i),
      },
    }));
  const resetAuxDefaults = () =>
    update((d) => ({
      ...d,
      build: { ...d.build, cleanAuxExtensions: [...DEFAULT_AUX_EXTENSIONS] },
    }));

  const cancel = useCallback(() => {
    // M2-5c：「代码片段」页有未保存草稿时先确认（片段独立落盘，不受下面的回滚影响）
    if (hasDirtySnippets()) {
      void confirm("「代码片段」有未保存的改动，确定放弃并关闭？", {
        title: "放弃片段改动",
      }).then((ok) => {
        if (!ok) return;
        resetSnippetsDraft();
        setSettings(cloneSettings(snapshotRef.current));
        closeSettings();
      });
      return;
    }
    // 未保存的预览改动回滚到打开时快照
    resetSnippetsDraft();
    setSettings(cloneSettings(snapshotRef.current));
    closeSettings();
  }, [setSettings, closeSettings]);

  // M1-1：模块开关（写设置页草稿；经 useModuleRuntime 订阅即时启停，保存后落盘）
  const modules = useModuleList();
  // M2 · 绘图模块 F1-5：轻量 UI 偏好走 diagram store（localStorage），不进 AppSettings draft
  const diagramLayout = useDiagramStore((s) => s.layoutMode);
  const setDiagramLayout = useDiagramStore((s) => s.setLayoutMode);
  const diagramRatio = useDiagramStore((s) => s.splitRatio);
  const setDiagramRatio = useDiagramStore((s) => s.setSplitRatio);
  const diagramPreview = useDiagramStore((s) => s.previewMode);
  const setDiagramPreview = useDiagramStore((s) => s.setPreviewMode);
  const diagramHandleSize = useDiagramStore((s) => s.handleSize);
  const setDiagramHandleSize = useDiagramStore((s) => s.setHandleSize);
  // F3-3：图层面板显隐也是轻量 UI 偏好，纳入「恢复默认」
  const diagramLayersVisible = useDiagramStore((s) => s.layersVisible);
  const setDiagramLayersVisible = useDiagramStore((s) => s.setLayersVisible);
  const diagramSnapEnabled = useDiagramStore((s) => s.snapEnabled);
  const setDiagramSnapEnabled = useDiagramStore((s) => s.setSnapEnabled);
  const diagramGridEnabled = useDiagramStore((s) => s.gridEnabled);
  const setDiagramGridEnabled = useDiagramStore((s) => s.setGridEnabled);
  const diagramSnapGrid = useDiagramStore((s) => s.snapGridEnabled);
  const setDiagramSnapGrid = useDiagramStore((s) => s.setSnapGridEnabled);
  const diagramCanvasSize = useDiagramStore((s) => s.canvasSize);
  const setDiagramCanvasSize = useDiagramStore((s) => s.setCanvasSize);
  const diagramCanvasAuto = useDiagramStore((s) => s.canvasSizeAuto);
  const setDiagramCanvasAuto = useDiagramStore((s) => s.setCanvasSizeAuto);
  const resetDiagramPreferences = useDiagramStore((s) => s.resetDiagramPreferences);
  const moduleNames: Record<string, string> = {};
  for (const m of modules) moduleNames[m.id] = m.name;
  const toggleModule = useCallback(
    (id: string, on: boolean) => {
      update((d) => ({ ...d, modules: { ...d.modules, [id]: on } }));
    },
    [update],
  );

  const save = useCallback(async () => {
    try {
      // M2-5c：片段页草稿先落盘（独立 snippets.json），再保存 AppSettings
      await flushSnippets();
      await useSettingsStore.getState().save(useSettingsStore.getState().settings);
      closeSettings();
    } catch (e) {
      notify(String(e), "err");
    }
  }, [closeSettings]);

  // Esc / 点遮罩 = 取消（环境引导面板打开时只由它自己接管 Esc）
  useEffect(() => {
    if (pane === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useAppStore.getState().envGuideOpen) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pane, cancel]);

  if (pane === null) return null;

  return (
    <>
      <div
        className="modal-layer"
        role="dialog"
        aria-label="偏好设置"
        onMouseDown={cancel}
      >
      <div
        className="modal settings"
        style={{ width: "min(820px, 92vw)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <Icon name="sliders" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>偏好设置</h2>
            <div className="sub">Zetla Preferences</div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={cancel}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          {/* M1-22：字体族建议列表（编辑器/终端两处 input 复用；仍可自由输入任意字体名） */}
          <datalist id="zetla-font-options">
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <div className="set-nav" role="tablist">
            {PANES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                className={pane === p.id ? "on" : ""}
                onClick={() => useAppStore.getState().openSettings(p.id)}
              >
                <Icon name={p.icon} />
                {p.label}
              </button>
            ))}
          </div>
          <div className="set-panes">
            {pane === "general" && (
              <div className="set-pane" role="tabpanel">
                <h4>启动与布局</h4>
                <Fld label="启动时恢复上次项目" hint="打开软件自动载入上一次的项目">
                  <Switch
                    checked={draft.general.restoreLastProject}
                    onChange={(v) =>
                      update((d) => ({
                        ...d,
                        general: { ...d.general, restoreLastProject: v },
                      }))
                    }
                  />
                </Fld>
                <Fld label="记住窗口大小与位置" hint="重启后还原窗口几何与最大化状态">
                  <Switch
                    checked={draft.general.rememberWindow}
                    onChange={(v) =>
                      update((d) => ({ ...d, general: { ...d.general, rememberWindow: v } }))
                    }
                  />
                </Fld>
                <Fld label="恢复布局" hint="侧栏/预览的宽度与显隐">
                  <Switch
                    checked={draft.general.restoreLayout}
                    onChange={(v) =>
                      update((d) => ({ ...d, general: { ...d.general, restoreLayout: v } }))
                    }
                  />
                </Fld>
              </div>
            )}

            {pane === "build" && (
              <div className="set-pane" role="tabpanel">
                <h4>TeX 环境</h4>
                <Fld
                  label="TeX 发行版"
                  hint={
                    env === null
                      ? "尚未检测"
                      : env.found
                        ? `${env.distribution ?? "TeX"}${env.version ? ` · ${env.version}` : ""}`
                        : "未检测到 TeX，无法编译"
                  }
                  tip="检测结果：Zetla 独立目录 → 系统 PATH → 常见安装位置；自动安装 M0-15b 接通"
                >
                  <span style={{ display: "flex", gap: 9, alignItems: "center" }}>
                    <select disabled value={env?.found ? "ok" : "none"} onChange={() => {}}>
                      <option value="none">
                        {env === null ? "未检测" : "未检测到 TeX"}
                      </option>
                      <option value="ok">
                        {env?.distribution ?? "TeX"}
                        {env?.version ? ` · ${env.version}` : ""}
                      </option>
                    </select>
                    <button type="button" className="btn" onClick={() => void openEnvGuide()}>
                      检测 / 引导…
                    </button>
                  </span>
                </Fld>
                <h4 style={{ marginTop: 18 }}>编译流水线</h4>
                <Fld
                  label="默认编译引擎"
                  hint={
                    draft.build.engine === "auto"
                      ? "跟随项目 .ltex/config.json（缺省 XeLaTeX）"
                      : "全局覆盖各项目的 .ltex/config.json"
                  }
                  tip={
                    draft.build.engine === "auto"
                      ? "选择具体引擎后，对所有项目全局生效（不再读项目配置）"
                      : "当前全局覆盖中；选「跟随项目（自动）」恢复按项目决定"
                  }
                >
                  <select
                    value={draft.build.engine}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        build: { ...d.build, engine: e.target.value as CompileEngine },
                      }))
                    }
                  >
                    <option value="auto">跟随项目（自动）</option>
                    <option value="xelatex">XeLaTeX</option>
                    <option value="pdflatex">pdfLaTeX</option>
                    <option value="lualatex">LuaLaTeX</option>
                  </select>
                </Fld>
                {/* M2：数据驱动的 Tool / Recipe 编排（主入口） */}
                <RecipePane draft={draft} update={update} />
                <Fld
                  label="latexmk 路径"
                  hint="当前使用 PATH 中的版本"
                  tip="M2 起可在上方「自定义工具（Tool）」新建工具并填 command 指定路径，再把它排进流程"
                >
                  <input className="txt-in" disabled placeholder="使用 PATH 中的 latexmk" />
                </Fld>
                <Fld label="编译前自动保存" hint="避免编译到旧内容">
                  <Switch
                    checked={draft.build.saveBeforeCompile}
                    onChange={(v) =>
                      update((d) => ({ ...d, build: { ...d.build, saveBeforeCompile: v } }))
                    }
                  />
                </Fld>
                <Fld
                  label="保存时自动编译"
                  hint="手动保存（Ctrl+S / 保存）.tex 后自动触发编译；自动保存不触发"
                >
                  <Switch
                    checked={draft.build.compileOnSave}
                    onChange={(v) =>
                      update((d) => ({ ...d, build: { ...d.build, compileOnSave: v } }))
                    }
                  />
                </Fld>
                <Fld
                  label="实时预览"
                  hint="编辑停止后自动编译并刷新 PDF（打字停顿即渲染）"
                  tip="M1-18a：先做前端防抖触发；重叠编译暂由单并发丢弃，M1-18b 改 latest-wins"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Switch
                      checked={draft.build.livePreview}
                      onChange={(v) =>
                        update((d) => ({ ...d, build: { ...d.build, livePreview: v } }))
                      }
                    />
                    <select
                      disabled={!draft.build.livePreview}
                      value={String(draft.build.livePreviewDelayMs)}
                      title="停止输入后等待多久触发编译"
                      onChange={(e) =>
                        update((d) => ({
                          ...d,
                          build: { ...d.build, livePreviewDelayMs: Number(e.target.value) },
                        }))
                      }
                    >
                      {(LIVE_PREVIEW_DELAY_PRESETS as readonly number[]).includes(
                        draft.build.livePreviewDelayMs,
                      ) ? null : (
                        <option value={String(draft.build.livePreviewDelayMs)}>
                          {draft.build.livePreviewDelayMs} ms
                        </option>
                      )}
                      {LIVE_PREVIEW_DELAY_PRESETS.map((ms) => (
                        <option key={ms} value={String(ms)}>
                          {ms} ms
                        </option>
                      ))}
                    </select>
                  </div>
                </Fld>
                <Fld
                  label="编译完成后清理辅助文件"
                  hint={
                    draft.build.livePreview
                      ? ".aux / .log / .out 等；实时预览开启时自动保留 .fdb_latexmk / .fls（增量缓存）与 .synctex.gz（跳转与锚定）"
                      : ".aux / .log / .out 等"
                  }
                >
                  <Switch
                    checked={!!draft.build.cleanAuxAfterCompile}
                    onChange={(v) =>
                      update((d) => ({ ...d, build: { ...d.build, cleanAuxAfterCompile: v } }))
                    }
                  />
                </Fld>
                <Fld
                  label="自定义清理的辅助文件"
                  hint="按此后缀白名单删除；空 = 内置默认清单"
                >
                  <div className="aux-editor">
                    {draft.build.cleanAuxExtensions.length === 0 && (
                      <div className="set-note" style={{ margin: "0 0 6px" }}>
                        （空）将使用内置默认清单：{DEFAULT_AUX_EXTENSIONS.join(" ")}
                      </div>
                    )}
                    <div className="aux-chips">
                      {draft.build.cleanAuxExtensions.map((ext, i) => (
                        <span className="aux-chip" key={`${ext}-${i}`}>
                          {ext}
                          <button
                            type="button"
                            className="aux-x"
                            title="移除"
                            onClick={() => removeAuxExt(i)}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="aux-add-row">
                      <input
                        className="txt-in aux-input"
                        placeholder="如 .nav 或 .synctex.gz"
                        value={auxInput}
                        onChange={(e) => setAuxInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addAuxExt();
                          }
                        }}
                      />
                      <button type="button" className="btn" onClick={addAuxExt}>
                        添加
                      </button>
                      <button type="button" className="btn" onClick={resetAuxDefaults}>
                        恢复默认
                      </button>
                    </div>
                  </div>
                </Fld>
              </div>
            )}

            {pane === "editor" && (
              <div className="set-pane" role="tabpanel">
                <h4>代码编辑器</h4>
                <Fld label="编辑器字体" hint="影响代码区等宽字体；可输入系统内任意字体名">
                  <input
                    className="txt-in"
                    list="zetla-font-options"
                    value={draft.editor.fontFamily}
                    placeholder="IBM Plex Mono"
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        editor: { ...d.editor, fontFamily: e.target.value },
                      }))
                    }
                  />
                </Fld>
                <Fld label="字体大小" hint="代码区字号">
                  <select
                    value={draft.editor.fontSize}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        editor: { ...d.editor, fontSize: Number(e.target.value) },
                      }))
                    }
                  >
                    {FONT_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}px
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld label="自动换行" hint="超出行宽时软换行">
                  <Switch
                    checked={draft.editor.lineWrapping}
                    onChange={(v) =>
                      update((d) => ({ ...d, editor: { ...d.editor, lineWrapping: v } }))
                    }
                  />
                </Fld>
                <Fld label="Ctrl + 滚轮缩放字体" hint="按住 Ctrl 并滚动鼠标滚轮时缩放编辑器字体">
                  <Switch
                    checked={draft.editor.mouseWheelZoom}
                    onChange={(v) =>
                      update((d) => ({ ...d, editor: { ...d.editor, mouseWheelZoom: v } }))
                    }
                  />
                </Fld>
                <Fld label="显示小地图" hint="编辑器右侧缩略图" tip="小地图 M1 接通">
                  <Switch
                    checked={draft.editor.minimap ?? true}
                    onChange={(v) =>
                      update((d) => ({ ...d, editor: { ...d.editor, minimap: v } }))
                    }
                  />
                </Fld>
                <Fld
                  label="括号匹配 / 代码折叠"
                  hint="CodeMirror 6 语法特性"
                  tip="括号匹配固定开启；代码折叠"
                >
                  <Switch checked disabled />
                </Fld>

                <h4 style={{ marginTop: 18 }}>终端</h4>
                <Fld label="终端字体" hint="留空 = 跟随编辑器字体；可输入系统内任意字体名">
                  <input
                    className="txt-in"
                    list="zetla-font-options"
                    value={draft.terminal.fontFamily}
                    placeholder="跟随编辑器字体"
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        terminal: { ...d.terminal, fontFamily: e.target.value },
                      }))
                    }
                  />
                </Fld>
                <Fld label="终端字号" hint="终端区字号（8–24）">
                  <select
                    value={draft.terminal.fontSize}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        terminal: { ...d.terminal, fontSize: Number(e.target.value) },
                      }))
                    }
                  >
                    {TERMINAL_FONT_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}px
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld label="光标样式" hint="终端光标形状">
                  <select
                    value={draft.terminal.cursorStyle}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        terminal: {
                          ...d.terminal,
                          cursorStyle: e.target.value as "block" | "bar" | "underline",
                        },
                      }))
                    }
                  >
                    <option value="block">方块</option>
                    <option value="bar">竖线</option>
                    <option value="underline">下划线</option>
                  </select>
                </Fld>
                <Fld label="光标闪烁" hint="终端光标是否闪烁">
                  <Switch
                    checked={draft.terminal.cursorBlink}
                    onChange={(v) =>
                      update((d) => ({ ...d, terminal: { ...d.terminal, cursorBlink: v } }))
                    }
                  />
                </Fld>
                <Fld label="回滚行数" hint="可向上翻看的输出行数；修改后重开终端生效">
                  <select
                    value={draft.terminal.scrollback}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        terminal: { ...d.terminal, scrollback: Number(e.target.value) },
                      }))
                    }
                  >
                    {TERMINAL_SCROLLBACK_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} 行
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld label="选中文本自动复制" hint="鼠标选中终端文本即复制到剪贴板">
                  <Switch
                    checked={draft.terminal.copyOnSelect}
                    onChange={(v) =>
                      update((d) => ({ ...d, terminal: { ...d.terminal, copyOnSelect: v } }))
                    }
                  />
                </Fld>
                <Fld label="右键粘贴" hint="在终端区点击右键直接粘贴剪贴板内容">
                  <Switch
                    checked={draft.terminal.rightClickPaste}
                    onChange={(v) =>
                      update((d) => ({ ...d, terminal: { ...d.terminal, rightClickPaste: v } }))
                    }
                  />
                </Fld>
                <Fld label="默认工作目录" hint="新会话起始目录">
                  <select
                    value={draft.terminal.defaultCwd}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        terminal: {
                          ...d.terminal,
                          defaultCwd: e.target.value as "project" | "home",
                        },
                      }))
                    }
                  >
                    <option value="project">当前项目根</option>
                    <option value="home">用户主目录</option>
                  </select>
                </Fld>
              </div>
            )}

            {pane === "pdf" && (
              <div className="set-pane" role="tabpanel">
                <h4>PDF 预览</h4>
                <Fld label="默认缩放" hint="打开 PDF 时的显示比例">
                  <select
                    value={draft.pdf.defaultZoom}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        pdf: { ...d.pdf, defaultZoom: e.target.value as PdfDefaultZoom },
                      }))
                    }
                  >
                    {ZOOM_OPTIONS.map((z) => (
                      <option key={z.value} value={z.value}>
                        {z.label}
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld
                  label="Synctex 双向同步"
                  hint="源码与 PDF 位置互相跳转"
                  tip="Synctex 双向跳转 M3 接通"
                >
                  <Switch checked={false} disabled />
                </Fld>
                <Fld
                  label="编译后自动刷新预览"
                  hint="保留当前滚动位置"
                  tip="MVP 固定开启"
                >
                  <Switch checked disabled />
                </Fld>
                <Fld label="渲染引擎" hint="基于 pdf.js，纯本地渲染">
                  <select disabled value="" onChange={() => {}}>
                    <option value="">pdf.js（WebView2）</option>
                  </select>
                </Fld>
              </div>
            )}

            {pane === "look" && (
              <div className="set-pane" role="tabpanel">
                <h4>外观与自动保存</h4>
                <Fld label="主题" hint="亮色 / 暗色 / 跟随系统，即时预览，保存后生效">
                  <select
                    value={draft.general.theme}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        general: { ...d.general, theme: e.target.value as AppTheme },
                      }))
                    }
                  >
                    <option value="light">亮色</option>
                    <option value="dark">暗色</option>
                    <option value="auto">跟随系统</option>
                  </select>
                </Fld>
                <Fld
                  label="LaTeX 语法高亮"
                  hint="自定义控制序列 / 环境名 / 章节 / 数学符号等语义分组的配色（亮暗双份）"
                  tip="与编辑器语法着色同源；改动即时预览，保存后写入本地配置"
                >
                  <button type="button" className="btn" onClick={() => setShowHighlight(true)}>
                    自定义配色…
                  </button>
                </Fld>
                <Fld label="自动保存" hint="定时把未保存的修改写回磁盘">
                  <Switch
                    checked={draft.autosave.enabled}
                    onChange={(v) => {
                      update((d) => ({
                        ...d,
                        autosave: { ...d.autosave, enabled: v },
                      }));
                    }}
                  />
                </Fld>
                <Fld
                  label="自动保存间隔"
                  hint="仅在自动保存开启时生效"
                  tip={draft.autosave.enabled ? undefined : "先打开自动保存"}
                >
                  <select
                    disabled={!draft.autosave.enabled}
                    value={draft.autosave.intervalSeconds}
                    onChange={(e) => {
                      update((d) => ({
                        ...d,
                        autosave: { ...d.autosave, intervalSeconds: Number(e.target.value) },
                      }));
                    }}
                  >
                    {INTERVAL_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} 秒
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld
                  label="编译期间暂停自动保存"
                  hint="避免 latexmk 运行中文件被改动"
                  tip={draft.autosave.enabled ? undefined : "先打开自动保存"}
                >
                  <Switch
                    disabled={!draft.autosave.enabled}
                    checked={draft.autosave.pauseWhileCompiling}
                    onChange={(v) => {
                      update((d) => ({
                        ...d,
                        autosave: { ...d.autosave, pauseWhileCompiling: v },
                      }));
                    }}
                  />
                </Fld>
              </div>
            )}

            {/* M2-5c：代码片段双栏管理（独立 snippets.json，页内自带保存） */}
            {/* M2 · F1-5：绘图偏好（即时生效、本机保存，不随底部保存/取消回滚） */}
            {pane === "diagram" && (
              <div className="set-pane" role="tabpanel">
                <h4>绘图 · TikZ</h4>
                <p className="set-note">
                  此页改动<strong>即时生效并保存在本机</strong>，不受底部「保存设置 / 取消」影响。
                  XeLaTeX 精确预览需要本机安装 TeX 发行版与 pdftocairo。
                </p>
                <Fld label="Tab 内默认布局" hint="仅画布 / 仅源码 / 左右分屏，重启后保留">
                  <select
                    value={diagramLayout}
                    onChange={(e) => setDiagramLayout(e.target.value as LayoutMode)}
                  >
                    <option value="split">左右分屏</option>
                    <option value="canvas">仅画布</option>
                    <option value="code">仅源码</option>
                  </select>
                </Fld>
                <Fld label="分屏比例" hint="左右分屏时画布栏占比（20%–80%）">
                  <select
                    value={
                      [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].includes(diagramRatio)
                        ? String(diagramRatio)
                        : "custom"
                    }
                    onChange={(e) => {
                      if (e.target.value !== "custom") setDiagramRatio(Number(e.target.value));
                    }}
                  >
                    {![0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].includes(diagramRatio) && (
                      <option value="custom">
                        {Math.round(diagramRatio * 100)}%（自定义）
                      </option>
                    )}
                    {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((v) => (
                      <option key={v} value={String(v)}>
                        {Math.round(v * 100)}%
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld
                  label="默认预览通道"
                  hint="本地即时（毫秒级，覆盖集有限）/ XeLaTeX 精确（秒级，100% 还原）"
                >
                  <select
                    value={diagramPreview}
                    onChange={(e) => setDiagramPreview(e.target.value as PreviewMode)}
                  >
                    <option value="local">本地即时</option>
                    <option value="precise">XeLaTeX 精确</option>
                  </select>
                </Fld>
                <Fld
                  label="控制点大小"
                  hint={`只改视觉半径，命中范围始终更大 · 当前${handleSizeSummary(diagramHandleSize)}`}
                >
                  <select
                    value={diagramHandleSize}
                    onChange={(e) => setDiagramHandleSize(e.target.value as HandleSize)}
                  >
                    {(Object.keys(HANDLE_SIZE_LABELS) as HandleSize[]).map((s) => (
                      <option key={s} value={s}>
                        {HANDLE_SIZE_LABELS[s]} · {handleSizeSummary(s)}
                      </option>
                    ))}
                  </select>
                </Fld>
                <Fld
                  label="图层面板"
                  hint="侧栏「图层管理」区默认展开；点标题行三角可随时开合，分组 / 隐藏 / 锁定数据不受影响"
                >
                  <Switch
                    checked={diagramLayersVisible}
                    onChange={(next) => setDiagramLayersVisible(next)}
                  />
                </Fld>
                <Fld
                  label="智能参考线吸附"
                  hint="拖图元时与其他图元的边 / 中心或画布中心对齐，显示临时参考线并吸附"
                >
                  <Switch
                    checked={diagramSnapEnabled}
                    onChange={(next) => setDiagramSnapEnabled(next)}
                  />
                </Fld>
                <Fld
                  label="画布网格 + 标尺"
                  hint="画布叠加 1cm 网格与顶部标尺（仅辅助显示，不写进源码）"
                >
                  <Switch
                    checked={diagramGridEnabled}
                    onChange={(next) => setDiagramGridEnabled(next)}
                  />
                </Fld>
                <Fld
                  label="吸附网格"
                  hint="拖图元时落点自动对齐到最近网格交点（优先级高于智能参考线）"
                >
                  <Switch
                    checked={diagramSnapGrid}
                    onChange={(next) => setDiagramSnapGrid(next)}
                  />
                </Fld>
                <Fld
                  label="画布尺寸"
                  hint="宽取主文档正文宽（A4 约 15cm），高默认 10cm 且不超过该纸张正文高；纸张框只是编辑参考，绝不写进 TikZ 源码"
                >
                  <div className="set-inline">
                    <select
                      value={diagramCanvasSize.preset}
                      onChange={(e) =>
                        setDiagramCanvasSize(
                          canvasSizeForPreset(e.target.value as CanvasPreset, diagramCanvasSize),
                        )
                      }
                    >
                      {(Object.keys(CANVAS_PRESET_LABELS) as CanvasPreset[]).map((key) => (
                        <option key={key} value={key}>
                          {CANVAS_PRESET_LABELS[key]}
                        </option>
                      ))}
                    </select>
                    {diagramCanvasSize.preset === "custom" && (
                      <>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          step={0.5}
                          value={diagramCanvasSize.widthCm}
                          title="正文宽 cm"
                          onChange={(e) =>
                            setDiagramCanvasSize({
                              ...diagramCanvasSize,
                              widthCm: Number(e.target.value),
                            })
                          }
                        />
                        <input
                          type="number"
                          min={1}
                          max={presetMaxHeightCm("custom")}
                          step={0.5}
                          value={diagramCanvasSize.heightCm}
                          title="正文高 cm"
                          onChange={(e) =>
                            setDiagramCanvasSize({
                              ...diagramCanvasSize,
                              heightCm: Number(e.target.value),
                            })
                          }
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={diagramCanvasAuto}
                      title="重新按主文档 \textwidth 推断默认尺寸"
                      onClick={() => {
                        setDiagramCanvasAuto(true);
                        notify("画布尺寸已切回按主文档推断", "ok");
                      }}
                    >
                      按文档宽度
                    </button>
                  </div>
                </Fld>
                <Fld label="恢复默认" hint="布局 / 分屏比例 / 预览通道 / 默认工具 / 控制点大小 / 图层面板 / 智能参考线 / 网格 / 吸附网格 / 画布尺寸 / 按画布导出一次性重置">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      resetDiagramPreferences();
                      notify("绘图偏好已恢复默认", "ok");
                    }}
                  >
                    重置
                  </button>
                </Fld>
              </div>
            )}

            {pane === "snippets" && <SnippetsPane />}

            {pane === "modules" && (
              <div className="set-pane" role="tabpanel">
                <h4>功能模块</h4>
                {modules.length === 0 ? (
                  <p className="set-note">暂无已注册模块。</p>
                ) : (
                  modules.map((m) => (
                    <Fld
                      key={m.id}
                      label={m.name}
                      hint={m.description ?? `版本 ${m.version}`}
                      tip={blockedTip(m.blockedReason, moduleNames)}
                    >
                      <Switch
                        checked={m.enabled}
                        disabled={!m.enabled && !!m.blockedReason}
                        onChange={(v) => toggleModule(m.id, v)}
                      />
                    </Fld>
                  ))
                )}
                <p className="set-note">
                  开关即时启停（保存后写入配置文件）；被其他模块依赖的模块无法停用。
                </p>

                <h4>表格</h4>
                <Fld label="默认线型" hint="新建表格时的表格线风格">
                  <select
                    value={draft.table.style}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        table: {
                          ...d.table,
                          style: e.target.value as typeof d.table.style,
                        },
                      }))
                    }
                  >
                    <option value="booktabs">三线表（booktabs）</option>
                    <option value="grid">全框线</option>
                    <option value="plain">无线</option>
                  </select>
                </Fld>
                <Fld label="默认转义" hint="智能：保留 $..$ 与命令，仅转义 & % # _">
                  <select
                    value={draft.table.escape}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        table: {
                          ...d.table,
                          escape: e.target.value as typeof d.table.escape,
                        },
                      }))
                    }
                  >
                    <option value="smart">智能转义</option>
                    <option value="full">全转义</option>
                    <option value="off">不转义</option>
                  </select>
                </Fld>
                <Fld label="默认带表头" hint="首行加粗并在其后插入 \midrule">
                  <Switch
                    checked={draft.table.headerRow}
                    onChange={(v) =>
                      update((d) => ({ ...d, table: { ...d.table, headerRow: v } }))
                    }
                  />
                </Fld>
                <Fld label="带编号" hint="关闭后用 table*（不进入表格目录）">
                  <Switch
                    checked={draft.table.numbered}
                    onChange={(v) => update((d) => ({ ...d, table: { ...d.table, numbered: v } }))}
                  />
                </Fld>
                <Fld label="浮动位置" hint="如 htbp / H / !htbp（字母与 ! 组成）">
                  <input
                    className="txt-in"
                    value={draft.table.placement}
                    onChange={(e) =>
                      update((d) => ({ ...d, table: { ...d.table, placement: e.target.value } }))
                    }
                  />
                </Fld>
                <Fld label="标签前缀" hint="标签留空时按「前缀 + 标题 slug」生成">
                  <input
                    className="txt-in"
                    value={draft.table.labelPrefix}
                    onChange={(e) =>
                      update((d) => ({ ...d, table: { ...d.table, labelPrefix: e.target.value } }))
                    }
                  />
                </Fld>
                <p className="set-note">
                  新建表格按上述默认值初始化；已插入的表格不受影响。行列上限（100×20）为模型硬上限。
                </p>
              </div>
            )}

            {pane === "about" && (
              <div className="set-pane about-pane" role="tabpanel">
                <section className="about-hero">
                  <img
                    className="about-mark"
                    src="/logo.svg"
                    alt="Zetla"
                    draggable={false}
                  />
                  <div className="about-id">
                    <h3>Zetla</h3>
                    <p className="about-tagline">桌面 LaTeX 工作台</p>
                  </div>
                  <span className="about-ver">版本 {version}</span>
                </section>
                <p className="about-desc">
                  项目树管理 · 多标签编辑 · 一键 XeLaTeX 编译 · PDF 预览 · 内置终端与绘图。
                  所有文件读写与编译均在本机完成，不上传云端。
                </p>
                <div className="about-meta">
                  <span className="about-chip">AGPLv3</span>
                  <span className="about-chip">{platformLabel()}</span>
                </div>
                <UpdateRegion version={version} />
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <div className="hint">
            设置即时生效（存于
            <span
              className="settings-config-path"
              title={configPath}
            >
              {compactPath(configPath)}
            </span>
            ）
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
            <button type="button" className="btn" onClick={cancel}>
              取消
            </button>
            <button type="button" className="btn primary" onClick={() => void save()}>
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
    {showHighlight && <SyntaxHighlightDialog onClose={() => setShowHighlight(false)} />}
    </>
  );
}

export default SettingsDialog;

// ── M1-13 · 关于页「软件更新」区 ───────────────────────────────
function fmtBytes(n?: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("zh-CN");
}

function pct(p?: UpdateProgress | null): number {
  if (!p || !p.total) return 0;
  return Math.min(100, Math.round((p.downloaded / p.total) * 100));
}

/** 更新说明折叠阈值（估算行数）：超过则出现「展开全部」 */
const NOTE_LINE_LIMIT = 6;

/** 平台显示名（关于页副信息 chip） */
function platformLabel(): string {
  const raw = (
    document.documentElement.dataset.platform ||
    __TAURI_PLATFORM__ ||
    ""
  ).toLowerCase();
  if (raw.includes("darwin") || raw.includes("mac")) return "macOS";
  if (raw.includes("win")) return "Windows";
  if (raw.includes("linux")) return "Linux";
  return "桌面端";
}

/** 行内格式：**粗体** 与 `代码`（不做完整 Markdown，只认这两种最常见写法） */
function renderInline(text: string): ReactNode[] {
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith("**") ? (
        <b key={m.index}>{tok.slice(2, -2)}</b>
      ) : (
        <code key={m.index}>{tok.slice(1, -1)}</code>
      ),
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * 更新说明面板：把 latest.json 的 notes 渲染成「标题 / 列表 / 段落」结构化内容。
 * 超过 NOTE_LINE_LIMIT 行时折叠，底部渐隐 + 「展开全部」。
 */
function ReleaseNotes({ notes }: { notes?: string | string[] }) {
  const [expanded, setExpanded] = useState(false);
  const blocks = useMemo(() => parseNotes(notes), [notes]);
  const lines = useMemo(() => countNoteLines(blocks), [blocks]);

  if (blocks.length === 0) {
    return <p className="update-notes-empty">本次更新未提供详细说明。</p>;
  }

  const clipped = lines > NOTE_LINE_LIMIT && !expanded;

  return (
    <div className="update-notes">
      <div className={`update-notes-body${clipped ? " clipped" : ""}`}>
        {blocks.map((b, i) => {
          if (b.type === "heading") {
            return (
              <p key={i} className="note-h">
                {renderInline(b.text)}
              </p>
            );
          }
          if (b.type === "list") {
            const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
            return b.ordered ? (
              <ol key={i} className="note-list is-ordered">
                {items}
              </ol>
            ) : (
              <ul key={i} className="note-list">
                {items}
              </ul>
            );
          }
          return (
            <p key={i} className="note-p">
              {renderInline(b.text)}
            </p>
          );
        })}
      </div>
      {lines > NOTE_LINE_LIMIT && (
        <button
          type="button"
          className="update-notes-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : `展开全部（约 ${lines} 行）`}
        </button>
      )}
    </div>
  );
}

/**
 * 关于页「软件更新」卡片。
 * 状态：checking / uptodate / update / downloading / downloaded / error；
 * 有新版本时展示「当前版本 → 新版本 + 发布日期 + 更新说明」，检查更新常驻卡片右上角。
 */
function UpdateRegion({ version }: { version: string }) {
  const status = useUpdateStore((s) => s.status);
  const latest = useUpdateStore((s) => s.latest);
  const env = useUpdateStore((s) => s.env);
  const entry = useUpdateStore((s) => s.entry);
  const mandatory = useUpdateStore((s) => s.mandatory);
  const error = useUpdateStore((s) => s.error);
  const progress = useUpdateStore((s) => s.progress);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const confirmInstall = useUpdateStore((s) => s.confirmInstall);
  const openRelease = useUpdateStore((s) => s.openRelease);
  const retry = useUpdateStore((s) => s.retry);
  // U4：deb/rpm 引导通道
  const manualInstall = useUpdateStore((s) => s.manualInstall);
  const openError = useUpdateStore((s) => s.openError);
  const downloadPackage = useUpdateStore((s) => s.downloadPackage);
  const openPackage = useUpdateStore((s) => s.openPackage);
  const downloadedPath = useUpdateStore((s) => s.downloadedPath);
  const [copied, setCopied] = useState(false);
  // macOS 要先把上百 MB 的 .app 解压出来（1~3s）才退出，给个「正在准备」的即时反馈
  const [preparing, setPreparing] = useState(false);

  const busy = status === "checking" || status === "downloading";
  const hasNew = status === "update" || status === "downloading" || status === "downloaded";
  // U1：能否在应用内换包由 Rust 判定（env 取不到时按旧逻辑乐观处理）
  const canApply = env ? env.canSelfUpdate : true;
  // 该平台是否真的挑到了可下载的包（v2 清单可能不给某个平台）
  const entryUsable = !!entry && entry.kind !== "none" && entry.installers.length > 0;
  // U4：deb/rpm 只能「下载 + 交系统安装器」（清单里给了 packages 才有这条路）
  const hasPackages = (entry?.packages?.length ?? 0) > 0;
  const canDownloadPkg = !canApply && hasPackages;
  // 不能自更新时的原因文案
  const blockReason = !canApply
    ? canDownloadPkg
      ? "下载后由系统安装器接管（需要你授权），Zetla 不会被自动替换。"
      : (env?.reason ?? "当前平台的应用内更新尚未开放，请前往发布页下载安装包。")
    : !entryUsable
      ? "本次更新暂未提供当前平台的安装包，请前往发布页手动下载。"
      : "";

  const copyPkgPath = () => {
    if (!downloadedPath) return;
    void navigator.clipboard
      .writeText(downloadedPath)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  // 换包失败时 store 会落到 error 态，按钮要恢复可点（否则一直显示「正在准备…」）
  useEffect(() => {
    if (status === "error") setPreparing(false);
  }, [status]);

  const isWindows = (env?.os ?? "windows") === "windows";
  const onInstallClick = async () => {
    // U3：Windows 仍是「拉起安装向导」，Linux/macOS 是「替换自身后重启」，文案分开
    const ok = await confirm(
      isWindows
        ? "将关闭 Zetla 并启动安装程序，是否继续？\n若系统弹出安全拦截提示，点击「仍要运行 / 仍要打开」即可（安装包未做代码签名）。"
        : "将关闭 Zetla，替换为新版本后自动重启，是否继续？",
      { title: "安装更新", kind: "warning" },
    );
    if (!ok) return;
    setPreparing(true);
    void confirmInstall();
  };

  return (
    <section className={`update-card${hasNew ? " has-new" : ""}`}>
      <header className="update-head">
        <span className="update-title">软件更新</span>
        {status === "update" && (
          <span className={`update-badge${mandatory ? " req" : ""}`}>
            {mandatory ? "必须更新" : "有新版本"}
          </span>
        )}
        {status === "downloaded" && <span className="update-badge done">待安装</span>}
        {status === "error" && <span className="update-badge err">更新失败</span>}
        {/* 主操作常驻头部：更新说明再长也不会把「安装」挤到滚动区外 */}
        <div className="update-head-acts">
          {status === "update" && canApply && entryUsable && (
            <button type="button" className="btn primary sm" onClick={() => void download()}>
              下载并安装
            </button>
          )}
          {/* U4：deb/rpm —— 下载系统安装包，交给系统安装器（不替换自身） */}
          {status === "update" && canDownloadPkg && (
            <button
              type="button"
              className="btn primary sm"
              onClick={() => void downloadPackage()}
            >
              下载安装包
            </button>
          )}
          {status === "update" && !canDownloadPkg && (!canApply || !entryUsable) && latest?.releaseUrl && (
            <button type="button" className="btn primary sm" onClick={openRelease}>
              去发布页下载
            </button>
          )}
          {status === "downloaded" && !manualInstall && (
            <button
              type="button"
              className="btn primary sm"
              disabled={preparing}
              onClick={() => void onInstallClick()}
            >
              {preparing ? "正在准备…" : "立即安装并重启"}
            </button>
          )}
          {status === "downloaded" && manualInstall && (
            <button type="button" className="btn primary sm" onClick={() => void openPackage()}>
              打开安装包
            </button>
          )}
          {status === "error" && (hasPackages || (canApply && entryUsable)) && (
            <button type="button" className="btn primary sm" onClick={() => void retry()}>
              重试
            </button>
          )}
          <button
            type="button"
            className="update-check"
            disabled={busy}
            onClick={() => void check()}
          >
            <Icon name="refresh" size={11} />
            {status === "checking" ? "检查中…" : "检查更新"}
          </button>
        </div>
      </header>

      {status === "checking" && <p className="update-line">正在检查更新…</p>}

      {status === "uptodate" && (
        <>
          <p className="update-line ok">
            <Icon name="check" size={12} />
            已是最新版本（v{version}）
          </p>
          <p className="update-hint">
            发现新版本时，这里会显示版本对比、更新说明与安装入口。
          </p>
        </>
      )}

      {(hasNew || status === "error") && latest && (
        <div className="update-ver">
          <span className="update-ver-old">v{version}</span>
          <span className="update-ver-arrow" aria-hidden="true">
            →
          </span>
          <span className="update-ver-new">v{latest.version}</span>
          <span className="update-ver-right">
            {latest.pubDate && (
              <span className="update-ver-date">{fmtDate(latest.pubDate)} 发布</span>
            )}
            {latest.releaseUrl && status !== "error" && (
              <button type="button" className="update-link" onClick={openRelease}>
                发布说明
              </button>
            )}
          </span>
        </div>
      )}

      {hasNew && latest && <ReleaseNotes notes={latest.notes} />}

      {hasNew && blockReason && <p className="update-hint">{blockReason}</p>}

      {status === "downloading" && (
        <div className="update-progress">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct(progress)}%` }} />
          </div>
          <div className="update-progress-meta">
            <b>{pct(progress)}%</b>
            <span>
              {fmtBytes(progress?.downloaded)} / {fmtBytes(progress?.total)}
            </span>
            {progress?.source && <span className="src">{progress.source}</span>}
          </div>
        </div>
      )}

      {status === "downloaded" && !manualInstall && (
        <p className="update-line">
          {isWindows
            ? "更新已下载完成，点击安装将关闭 Zetla 并启动安装程序。"
            : "更新已下载完成，点击安装将替换当前版本并自动重启。"}
        </p>
      )}

      {status === "downloaded" && preparing && !manualInstall && (
        <p className="update-hint">
          {isWindows
            ? "正在启动安装程序…"
            : "正在解压更新包，完成后 Zetla 会自动重启（期间请勿强制退出）。"}
        </p>
      )}

      {/* U4：deb/rpm —— 已交给系统安装器；打不开时降级为手动安装 */}
      {status === "downloaded" && manualInstall && (
        <div className="update-pkg">
          {openError ? (
            <>
              <p className="update-line err">
                <Icon name="alert" size={12} />
                {openError}
              </p>
              <p className="update-line">安装包已下载，可手动双击安装：</p>
            </>
          ) : (
            <p className="update-line">
              安装包已下载并交给系统安装器，按提示授权即可完成安装。Zetla 会保持当前版本运行，
              安装完成后重新打开即为新版。
            </p>
          )}
          {downloadedPath && (
            <p className="update-path" title={downloadedPath}>
              {downloadedPath}
            </p>
          )}
          <div className="update-pkg-acts">
            <button type="button" className="update-link" onClick={() => void openPackage()}>
              重新打开
            </button>
            {downloadedPath && (
              <button type="button" className="update-link" onClick={copyPkgPath}>
                {copied ? "已复制" : "复制路径"}
              </button>
            )}
            {latest?.releaseUrl && (
              <button type="button" className="update-link" onClick={openRelease}>
                发布说明
              </button>
            )}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="update-err">
          <p className="update-line err">
            <Icon name="alert" size={12} />
            {error}
          </p>
          {latest?.releaseUrl && (
            <button type="button" className="update-link" onClick={openRelease}>
              去发布页手动下载
            </button>
          )}
        </div>
      )}
    </section>
  );
}
