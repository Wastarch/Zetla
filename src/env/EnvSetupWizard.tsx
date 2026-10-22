// M0-15b/c · TeX Live 自动安装向导（检测 → 选择目录/方案 → 安装进度 → 完成）
// 后端 install_tex 立即返回，进度/结果通过 tex_install_progress / tex_install_finished 事件回传。
import { useEffect, useState } from "react";
import { open as pickDialog } from "@tauri-apps/plugin-dialog";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { useSettingsStore } from "@/core/settings";
import { onKernelEvent, RustEvents } from "@/ipc/events";
import { compileApi } from "@/ipc/invoke";
import { runEnvCheck } from "@/env/useEnvCheck";
import { notify } from "@/project/useProject";
import { startCompile } from "@/compile/useCompile";
import type { TexInstallProgress, TexInstallResult } from "@/types";

type Step = 1 | 2 | 3 | 4;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "检测" },
  { n: 2, label: "选择" },
  { n: 3, label: "安装" },
  { n: 4, label: "完成" },
];

const STAGE_LABELS: Record<string, string> = {
  prepare: "准备安装",
  download: "下载安装包",
  install: "安装 TeX Live",
  verify: "校验环境",
  done: "安装完成",
};

/** 下载速度：优先 MB/s，低于 0.1 MB/s 显示 KB/s */
function fmtSpeed(bps: number): string {
  if (!bps) return "";
  const mb = bps / 1_048_576;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bps / 1024))} KB/s`;
}

export function EnvSetupWizard() {
  const open = useAppStore((s) => s.envSetupOpen);
  const env = useAppStore((s) => s.env);
  const project = useAppStore((s) => s.project);

  const [step, setStep] = useState<Step>(1);
  const [installDir, setInstallDir] = useState("");
  const [scheme, setScheme] = useState<"basic" | "full">("basic");
  const [checking, setChecking] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<TexInstallProgress | null>(null);
  const [result, setResult] = useState<TexInstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const installing = step === 3 && !result;
  const found = env?.found === true;

  // 每次打开重置；订阅安装事件（关闭时清理）
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setInstallDir("");
    setScheme("basic");
    setChecking(false);
    setAdopting(false);
    setCancelling(false);
    setProgress(null);
    setResult(null);
    setError(null);

    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    void (async () => {
      const uProgress = await onKernelEvent<TexInstallProgress>(
        RustEvents.texInstallProgress,
        (p) => {
          if (!alive) return;
          setProgress(p);
        },
      );
      if (!alive) {
        uProgress();
        return;
      }
      unlisteners.push(uProgress);
      const uFinished = await onKernelEvent<TexInstallResult>(
        RustEvents.texInstallFinished,
        (r) => {
          if (!alive) return;
          setCancelling(false);
          setResult(r);
          setStep(4);
          if (r.ok) {
            // 真实安装成功后解除 dev 模拟，避免「装好了却仍显示未检测」
            if (import.meta.env.DEV && useAppStore.getState().envDebugMock) {
              useAppStore.getState().setEnvDebugMock(false);
            }
            void (async () => {
              await runEnvCheck();
              try {
                await useSettingsStore.getState().load();
              } catch (e) {
                console.warn("[env] 重新加载配置失败", e);
              }
            })();
          }
        },
      );
      if (!alive) {
        uFinished();
        return;
      }
      unlisteners.push(uFinished);
    })();

    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, [open]);

  if (!open) return null;

  const requestClose = () => {
    if (installing) {
      if (window.confirm("安装正在进行，确定取消安装吗？")) {
        void cancelInstall();
      }
      return;
    }
    useAppStore.getState().setEnvSetupOpen(false);
  };

  const recheck = async () => {
    setChecking(true);
    setError(null);
    await runEnvCheck();
    setChecking(false);
  };

  const pickInstallDir = async () => {
    const picked = await pickDialog({
      multiple: false,
      directory: true,
      title: "选择 TeX Live 安装目录",
    });
    if (typeof picked === "string") setInstallDir(picked);
  };

  const startInstall = async () => {
    setError(null);
    setResult(null);
    setProgress({
      stage: "prepare",
      percent: 0,
      speedBps: 0,
      message: "准备安装 TeX Live…",
    });
    setStep(3);
    try {
      await compileApi.installTex("texlive", installDir.trim() || null, scheme);
    } catch (e) {
      setStep(2);
      setError(String(e));
    }
  };

  const adoptExisting = async () => {
    const picked = await pickDialog({
      multiple: false,
      directory: true,
      title: "选择已有 TeX Live 安装根目录（或 bin 目录）",
    });
    if (typeof picked !== "string") return;
    setError(null);
    setAdopting(true);
    try {
      const adopted = await compileApi.adoptTexInstall(picked);
      setResult(adopted);
      setStep(4);
      await runEnvCheck();
      try {
        await useSettingsStore.getState().load();
      } catch (e) {
        console.warn("[env] 重新加载配置失败", e);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAdopting(false);
    }
  };

  const cancelInstall = async () => {
    setCancelling(true);
    try {
      await compileApi.cancelTexInstall();
    } catch (e) {
      setCancelling(false);
      notify(String(e), "err");
    }
  };

  const closeAndCompile = () => {
    useAppStore.getState().setEnvSetupOpen(false);
    void startCompile();
  };

  const backToGuide = () => {
    useAppStore.getState().setEnvSetupOpen(false);
    useAppStore.getState().setEnvGuideOpen(true);
  };

  const pct = progress?.percent ?? 0;
  const stageLabel = progress ? (STAGE_LABELS[progress.stage] ?? "正在安装") : "准备安装";
  const speed = fmtSpeed(progress?.speedBps ?? 0);

  const resultTone = !result
    ? "warn"
    : !result.ok
      ? result.cancelled
        ? "warn"
        : "err"
      : "ok";
  const resultTitle = !result
    ? ""
    : !result.ok
      ? result.cancelled
        ? "已取消安装"
        : "安装失败"
      : result.message.includes("接管")
        ? "已有环境已接管"
        : "TeX Live 安装完成";

  return (
    <div
      className="modal-layer"
      role="dialog"
      aria-label="安装 TeX 环境"
      onMouseDown={requestClose}
    >
      <div className="modal env-setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="tex" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>安装 TeX 环境</h2>
            <div className="sub">TeX Setup</div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={requestClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          <div className="setup-steps" aria-label="安装步骤">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className={`setup-step${step === s.n ? " on" : ""}${step > s.n ? " done" : ""}`}
              >
                <span className="setup-step-dot">
                  {step > s.n ? <Icon name="check" size={10} /> : s.n}
                </span>
                <span className="setup-step-label">{s.label}</span>
              </div>
            ))}
          </div>

          {step === 1 && (
            <div className="setup-panel">
              <div
                className={`env-status ${checking ? "checking" : found ? "ok" : "warn"}`}
              >
                <Icon
                  name={checking ? "refresh" : found ? "check" : "alert"}
                  size={17}
                  className={checking ? "env-status-icon spin" : "env-status-icon"}
                />
                <div className="env-status-body">
                  {checking ? (
                    <>
                      <b>正在检测本机 TeX 发行版…</b>
                      <span>检查 Zetla 独立目录、系统 PATH 与常见安装位置。</span>
                    </>
                  ) : env === null ? (
                    <>
                      <b>尚未完成检测</b>
                      <span>
                        检测命令没有返回结果，仍可继续自动安装；安装完成后会重新检测。
                      </span>
                    </>
                  ) : found ? (
                    <>
                      <b>
                        已检测到 {env?.distribution ?? "TeX"}
                        {env?.version ? ` · ${env.version}` : ""}
                      </b>
                      <span>
                        TeX 环境可用，无需自动安装。可以直接关闭向导开始编译。
                      </span>
                    </>
                  ) : (
                    <>
                      <b>未检测到 TeX 发行版</b>
                      <span>
                        下一步将下载并安装 TeX Live（自带 Perl，无需额外安装）。
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="setup-note">
                <Icon name="sliders" size={13} />
                <span>
                  自动安装仅在 Zetla 独立目录内进行，不修改系统 PATH，也不影响已有的 TeX 环境。
                </span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="setup-panel">
              <div className="setup-section-label">安装方案</div>
              <div className="setup-distros">
                <button
                  type="button"
                  className={`setup-distro${scheme === "basic" ? " on" : ""}`}
                  aria-pressed={scheme === "basic"}
                  onClick={() => setScheme("basic")}
                >
                  <span className="setup-distro-head">
                    <b>基础方案</b>
                    <span className="env-badge">推荐</span>
                  </span>
                  <span className="setup-distro-desc">
                    约 1.5 GB，含 XeLaTeX 与中文支持（ctex/fandol）。适合大多数文档。
                  </span>
                  <span className="setup-distro-meta">
                    后续可用 tlmgr 补包
                  </span>
                </button>
                <button
                  type="button"
                  className={`setup-distro${scheme === "full" ? " on" : ""}`}
                  aria-pressed={scheme === "full"}
                  onClick={() => setScheme("full")}
                >
                  <span className="setup-distro-head">
                    <b>完整方案</b>
                  </span>
                  <span className="setup-distro-desc">
                    约 5 GB，全部宏包、文档、源码。一劳永逸，不会缺包。
                  </span>
                  <span className="setup-distro-meta">
                    安装时间较长
                  </span>
                </button>
              </div>

              <div className="setup-section-label">安装目录</div>
              <div className="setup-dir">
                <input
                  className="entry-input"
                  value={installDir}
                  spellCheck={false}
                  placeholder="%LOCALAPPDATA%\Zetla\tex\texlive（留空使用默认）"
                  onChange={(e) => setInstallDir(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => void pickInstallDir()}>
                  <Icon name="folder" size={13} />
                  选择…
                </button>
              </div>
              <div className="setup-help">
                留空安装到 <code>%LOCALAPPDATA%\Zetla\tex\texlive</code>；
                也可选择其他盘符。目录需可写，且不能已包含 TeX。
                TeX Live 自带 Perl，无需单独安装。
              </div>

              {error && (
                <div className="setup-error" role="alert">
                  <Icon name="alert" size={13} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="setup-panel">
              <div className="setup-progress-head">
                <div className="setup-progress-text">
                  <b>{stageLabel}</b>
                  <span>{progress?.message ?? "正在启动安装…"}</span>
                </div>
                <div className="setup-pct">
                  {pct}
                  <small>%</small>
                </div>
              </div>
              <div
                className={`setup-track${pct === 0 ? " indet" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <i style={pct > 0 ? { width: `${pct}%` } : undefined} />
              </div>
              <div className="setup-progress-meta">
                <span>{speed || "正在准备…"}</span>
                <span>安装期间请保持网络连接</span>
              </div>
              <div className="setup-note">
                <Icon name="alert" size={13} />
                <span>
                  TeX Live 安装需要 10–60 分钟（取决于方案和网络）。请勿关闭 Zetla；如需中止可点击下方「取消安装」。
                </span>
              </div>
            </div>
          )}

          {step === 4 && result && (
            <div className="setup-panel">
              <div className={`setup-result ${resultTone}`}>
                <Icon
                  name={resultTone === "ok" ? "check" : "alert"}
                  size={26}
                  className="setup-result-icon"
                />
                <b>{resultTitle}</b>
                <span>{result.message}</span>
                {result.ok && (
                  <div className="setup-kv">
                    {result.version && (
                      <div>
                        <em>版本</em>
                        <code>{result.version}</code>
                      </div>
                    )}
                    {result.engineBinDir && (
                      <div>
                        <em>引擎目录</em>
                        <code title={result.engineBinDir}>{result.engineBinDir}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {result.warning && (
                <div className="setup-warning" role="status">
                  <Icon name="alert" size={13} />
                  <span>{result.warning}</span>
                </div>
              )}
              {result.ok && (
                <div className="setup-note">
                  <Icon name="check" size={13} />
                  <span>环境已写入 Zetla 配置，现在可以直接编译中文 PDF。</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div className="setup-foot-hint">
            {step === 2 && "TeX Live 自带 Perl · 不改系统 PATH"}
            {step === 3 && "可随时取消，取消后会清理本次新建的目录"}
            {step === 4 && result?.ok && "完成后可直接编译当前项目"}
            {step === 1 && "检测结果仅用于选择安装方式"}
          </div>
          <div className="env-foot-actions">
            {step === 1 && (
              <>
                <button type="button" className="btn" onClick={() => void recheck()} disabled={checking}>
                  <Icon name="refresh" size={13} />
                  重新检测
                </button>
                {!found ? (
                  <button type="button" className="btn primary" onClick={() => setStep(2)}>
                    下一步
                    <Icon name="chev" size={13} />
                  </button>
                ) : (
                  <button type="button" className="btn primary" onClick={requestClose}>
                    完成
                  </button>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <button type="button" className="btn" onClick={() => setStep(1)}>
                  <Icon name="chev" size={13} style={{ transform: "rotate(180deg)" }} />
                  上一步
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={adopting}
                  onClick={() => void adoptExisting()}
                >
                  <Icon name="folder" size={13} />
                  {adopting ? "正在校验…" : "使用已有安装…"}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void startInstall()}
                >
                  <Icon name="sync" size={13} />
                  开始安装
                </button>
              </>
            )}

            {step === 3 && (
              <button
                type="button"
                className="btn"
                disabled={cancelling}
                onClick={() => void cancelInstall()}
              >
                <Icon name="stop" size={13} />
                {cancelling ? "正在取消…" : "取消安装"}
              </button>
            )}

            {step === 4 && (
              <>
                {result?.ok && project && (
                  <button type="button" className="btn" onClick={closeAndCompile}>
                    <Icon name="play" size={13} />
                    编译当前项目
                  </button>
                )}
                {!result?.ok && !result?.cancelled && (
                  <button type="button" className="btn" onClick={backToGuide}>
                    手动安装
                  </button>
                )}
                {!result?.ok && (
                  <button type="button" className="btn" onClick={() => setStep(2)}>
                    重新选择
                  </button>
                )}
                <button
                  type="button"
                  className="btn primary"
                  onClick={() =>
                    result?.ok ? requestClose() : useAppStore.getState().setEnvSetupOpen(false)
                  }
                >
                  完成
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EnvSetupWizard;
