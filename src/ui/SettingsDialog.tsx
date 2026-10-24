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
import { Icon } from "@/ui/Icon";
import { PIPELINE_PRESETS, matchPipelinePreset, stepsLabel } from "@/types/settings";
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
                  label="编译完成后清理辅助文件"
                  hint=".aux / .log / .out 等"
                  tip="清理辅助文件 M1 接通"
                >
                  <Switch checked={false} disabled />
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
                  <Switch checked={false} disabled />
                </Fld>
                <Fld
                  label="括号匹配 / 代码折叠"
                  hint="CodeMirror 6 语法特性"
                  tip="括号匹配固定开启；代码折叠 MVP 不做（M1）"
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
              </div>
            )}

            {pane === "about" && (
              <div className="set-pane" role="tabpanel">
                <div className="about-hero">
                  <div className="mark">Z</div>
                  <div>
                    <h3>Zetla</h3>
                    <p>
                      版本 {version} · Tauri 2 · React 19 · WebView2
                    </p>
                  </div>
                </div>
                <p className="about-desc">
                  桌面 LaTeX 工作台：项目树 · 多标签编辑 · 一键 XeLaTeX 编译 · PDF 预览。
                  所有文件读写与编译均在本机完成，不上传云端。
                </p>
                <dl className="spec">
                  <dt>运行环境</dt>
                  <dd>Windows 10 / 11 · WebView2 Runtime</dd>
                  <dt>编译依赖</dt>
                  <dd>TeX Live（自带 Perl）· latexmk · xelatex</dd>
                  <dt>渲染引擎</dt>
                  <dd>pdf.js · CodeMirror 6 (stex)</dd>
                  <dt>配置文件</dt>
                  <dd>%APPDATA%\Zetla\config.json</dd>
                  <dt>数据存储</dt>
                  <dd>纯本地目录，无云端同步</dd>
                  <dt>许可证</dt>
                  <dd>MIT License</dd>
                </dl>
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
  );
}

export default SettingsDialog;
