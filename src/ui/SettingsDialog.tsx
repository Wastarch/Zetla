// M0-14a · 偏好设置页（对齐 docs/UI/code.html 679–769 偏好设置模态）
// 页签：编译设置 / 编辑器 / PDF 预览 / 外观与保存 / 关于 Zetla
// 交互：改动即时预览（setSettings → 运行时立即生效），「保存设置」落盘并关闭，「取消」回滚快照
// 未接通项按硬约定置灰 + tooltip 标注接通切片（小地图/折叠 M1、Synctex M3；
// 暗色主题 M1-2 已接：外观页「主题」下拉 + 菜单「切换明暗主题」；
// 多编译引擎 / 自定义编译流程 M1-3 已接：编译页「默认编译引擎」「编译流程」（预设 + 步骤编辑器）；
// 界面密度经用户确认取消，不占位）
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { APP_VERSION } from "@/version";
import { useAppStore, type SettingsPane } from "@/core/store";
import { cloneSettings, useSettingsStore } from "@/core/settings";
import { notify } from "@/project/useProject";
import { useModuleList } from "@/modules/useModuleList";
import { openEnvGuide } from "@/env/useEnvCheck";
import { useUpdateStore } from "@/modules/updater/updateStore";
import type { UpdateProgress } from "@/modules/updater/types";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Icon } from "@/ui/Icon";
import { SyntaxHighlightDialog } from "@/ui/SyntaxHighlightDialog";
import { PIPELINE_PRESETS, matchPipelinePreset, stepsLabel, DEFAULT_AUX_EXTENSIONS, LIVE_PREVIEW_DELAY_PRESETS } from "@/types/settings";
import type {
  AppSettings,
  AppTheme,
  CompileEngine,
  CompileStep,
  EditorFontFamily,
  PdfDefaultZoom,
} from "@/types/settings";

const PANES: { id: SettingsPane; icon: string; label: string }[] = [
  { id: "general", icon: "layout", label: "通用" },
  { id: "build", icon: "play", label: "编译设置" },
  { id: "editor", icon: "edit", label: "编辑器" },
  { id: "pdf", icon: "pdf", label: "PDF 预览" },
  { id: "look", icon: "sun", label: "外观与保存" },
  { id: "modules", icon: "wand", label: "模块" },
  { id: "about", icon: "book", label: "关于 Zetla" },
];

const FONT_OPTIONS: EditorFontFamily[] = ["IBM Plex Mono", "Consolas", "Cascadia Mono"];
/** 字号可选值 8–32（M0-14a 用户追加：Ctrl+滚轮缩放后为连续范围） */
const FONT_SIZE_OPTIONS = Array.from({ length: 25 }, (_, i) => i + 8);
const INTERVAL_OPTIONS = [5, 15, 30, 60];
/** M1-3：编译流程步骤可选项（设置页步骤编辑器） */
const STEP_OPTIONS: { value: CompileStep; label: string }[] = [
  { value: "latex", label: "LaTeX（跑一次引擎）" },
  { value: "bibtex", label: "BibTeX（传统参考文献）" },
  { value: "biber", label: "Biber（biblatex 参考文献）" },
];
const ZOOM_OPTIONS: { value: PdfDefaultZoom; label: string }[] = [
  { value: "fit-width", label: "适合宽度" },
  { value: "100", label: "100%" },
  { value: "125", label: "125%" },
  { value: "150", label: "150%" },
];

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

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {}); // 权限受限时回退默认
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
    // 未保存的预览改动回滚到打开时快照
    setSettings(cloneSettings(snapshotRef.current));
    closeSettings();
  }, [setSettings, closeSettings]);

  // M1-1：模块开关（写设置页草稿；经 useModuleRuntime 订阅即时启停，保存后落盘）
  const modules = useModuleList();
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
                <Fld
                  label="编译流程"
                  hint={
                    draft.build.steps.length === 0
                      ? "latexmk 自动循环直到收敛"
                      : stepsLabel(draft.build.steps)
                  }
                  tip="自动：latexmk 自行判定遍数与参考文献工具；固定流程：按步骤序列直跑（绕过 latexmk），可用预设或自定义增删调整"
                >
                  <select
                    value={matchPipelinePreset(draft.build.steps)}
                    onChange={(e) => {
                      const preset = PIPELINE_PRESETS.find((p) => p.id === e.target.value);
                      // 「自定义」：从当前序列出发；自动（空序列）时给一个常见起点再增删
                      const seed: CompileStep[] = preset
                        ? [...preset.steps]
                        : draft.build.steps.length > 0
                          ? draft.build.steps
                          : ["latex", "bibtex", "latex", "latex"];
                      update((d) => ({ ...d, build: { ...d.build, steps: seed } }));
                    }}
                  >
                    {PIPELINE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value="custom">自定义…</option>
                  </select>
                </Fld>
                {draft.build.steps.length > 0 && (
                  <div className="steps-editor">
                    {draft.build.steps.map((s, i) => (
                      <div className="step-row" key={i}>
                        <span className="step-pos">{i + 1}</span>
                        <select
                          className="step-sel"
                          value={s}
                          onChange={(e) =>
                            update((d) => {
                              const steps = [...d.build.steps];
                              steps[i] = e.target.value as CompileStep;
                              return { ...d, build: { ...d.build, steps } };
                            })
                          }
                        >
                          {STEP_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn step-btn"
                          disabled={i === 0}
                          title="上移"
                          onClick={() =>
                            update((d) => {
                              const steps = [...d.build.steps];
                              [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                              return { ...d, build: { ...d.build, steps } };
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn step-btn"
                          disabled={i === draft.build.steps.length - 1}
                          title="下移"
                          onClick={() =>
                            update((d) => {
                              const steps = [...d.build.steps];
                              [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                              return { ...d, build: { ...d.build, steps } };
                            })
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn step-btn"
                          title="删除该步骤"
                          onClick={() =>
                            update((d) => ({
                              ...d,
                              build: {
                                ...d.build,
                                steps: d.build.steps.filter((_, j) => j !== i),
                              },
                            }))
                          }
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="step-row">
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          update((d) => ({
                            ...d,
                            build: { ...d.build, steps: [...d.build.steps, "latex" as CompileStep] },
                          }))
                        }
                      >
                        + 添加步骤
                      </button>
                      <span className="set-note" style={{ margin: 0 }}>
                        预览：{stepsLabel(draft.build.steps)}
                      </span>
                    </div>
                  </div>
                )}
                <Fld
                  label="latexmk 路径"
                  hint="当前使用 PATH 中的版本"
                  tip="自定义 latexmk 路径 M1 接通"
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
                      ? ".aux / .log / .out 等（与实时预览冲突：会删 latexmk 缓存，建议关闭）"
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
                <Fld label="编辑器字体" hint="影响代码区等宽字体">
                  <select
                    value={draft.editor.fontFamily}
                    onChange={(e) =>
                      update((d) => ({
                        ...d,
                        editor: { ...d.editor, fontFamily: e.target.value as EditorFontFamily },
                      }))
                    }
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
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
                <div className="about-hero">
                  <img
                    className="about-mark"
                    src="/logo.svg"
                    alt="Zetla"
                    draggable={false}
                  />
                  <div>
                    <h3>Zetla</h3>
                    <p className="about-ver">版本 {version}</p>
                  </div>
                </div>
                <p className="about-desc">
                  桌面 LaTeX 工作台：项目树管理 · 多标签编辑 · 一键 XeLaTeX 编译 ·
                  PDF 预览。所有文件读写与编译均在本机完成，不上传云端。
                </p>
                <UpdateRegion />
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <div className="hint">
            设置即时生效（保存后写入本地配置文件
            <span
              style={{ fontFamily: "var(--font-mono)", color: "var(--txt-2)" }}
            >
              %APPDATA%\Zetla\config.json
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

/** 关于页更新区：检测中 / 已是最新 / 发现新版本 / 下载进度 / 已下载 / 失败 五态 */
function UpdateRegion() {
  const status = useUpdateStore((s) => s.status);
  const latest = useUpdateStore((s) => s.latest);
  const mandatory = useUpdateStore((s) => s.mandatory);
  const error = useUpdateStore((s) => s.error);
  const progress = useUpdateStore((s) => s.progress);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const confirmInstall = useUpdateStore((s) => s.confirmInstall);
  const openRelease = useUpdateStore((s) => s.openRelease);
  const retry = useUpdateStore((s) => s.retry);

  const onInstallClick = async () => {
    const ok = await confirm(
      "将关闭 Zetla 并启动安装程序，是否继续？\n若 Windows 弹出安全拦截提示，点击「仍要运行」即可（安装包未做代码签名）。",
      { title: "安装更新", kind: "warning" },
    );
    if (ok) void confirmInstall();
  };

  return (
    <div className="update-region">
      <div className="update-head">
        <span className="update-title">软件更新</span>
        {status === "update" && (
          <span className={`update-badge${mandatory ? " req" : ""}`}>
            {mandatory ? "必须更新" : "有新版本"}
          </span>
        )}
      </div>

      {status === "checking" && <p className="update-line">正在检查更新…</p>}
      {status === "uptodate" && <p className="update-line ok">已是最新版本。</p>}

      {status === "update" && latest && (
        <div className="update-found">
          <p className="update-line">
            发现新版本 <b>v{latest.version}</b>
            {latest.pubDate ? `（发布于 ${fmtDate(latest.pubDate)}）` : ""}
          </p>
          {latest.notes && <p className="update-notes">{latest.notes}</p>}
          <div className="update-acts">
            <button type="button" className="btn primary" onClick={() => void download()}>
              下载并安装
            </button>
            {latest.releaseUrl && (
              <button type="button" className="btn" onClick={openRelease}>
                查看发布说明
              </button>
            )}
          </div>
        </div>
      )}

      {status === "downloading" && (
        <div className="update-progress">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct(progress)}%` }} />
          </div>
          <p className="update-line">
            {progress?.source ? `${progress.source} · ` : ""}
            下载中 {fmtBytes(progress?.downloaded)} / {fmtBytes(progress?.total)}
          </p>
        </div>
      )}

      {status === "downloaded" && (
        <div className="update-found">
          <p className="update-line">更新已下载完成，点击安装将关闭 Zetla 并启动安装程序。</p>
          <div className="update-acts">
            <button type="button" className="btn primary" onClick={() => void onInstallClick()}>
              立即安装
            </button>
            {latest?.releaseUrl && (
              <button type="button" className="btn" onClick={openRelease}>
                查看发布说明
              </button>
            )}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="update-err">
          <p className="update-line err">更新失败：{error}</p>
          <div className="update-acts">
            <button type="button" className="btn" onClick={() => void retry()}>
              重试
            </button>
            {latest?.releaseUrl && (
              <button type="button" className="btn" onClick={openRelease}>
                去发布页手动下载
              </button>
            )}
          </div>
        </div>
      )}

      <div className="update-actions-bottom">
        <button
          type="button"
          className="btn"
          disabled={status === "checking" || status === "downloading"}
          onClick={() => void check()}
        >
          {status === "checking" ? "检查中…" : "检查更新"}
        </button>
      </div>
    </div>
  );
}
