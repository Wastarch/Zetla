// M0-15a · TeX 环境引导面板（初次使用未检测到 TeX 时自动弹出；帮助菜单 / 状态栏可手动打开）
// 本切片提供：检测结果展示 + 手动下载引导（打开官网）+ 手动指定引擎目录；
// 「自动安装」M0-15b 接通（先按硬约定置灰 + tooltip 标注接通切片）
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "@/ui/Icon";
import { useAppStore } from "@/core/store";
import { pickEngineDir, runEnvCheck } from "@/env/useEnvCheck";
import { notify } from "@/project/useProject";

/** 手动下载入口（M0-15b 起由「自动安装」替代，但保留作为兜底） */
const MANUAL_LINKS: { label: string; url: string; desc: string }[] = [
  {
    label: "MiKTeX",
    url: "https://miktex.org/download",
    desc: "轻量（~250MB），缺宏包时自动下载，推荐新手",
  },
  {
    label: "TeX Live",
    url: "https://tug.org/texlive/",
    desc: "完整发行版（2–4GB），一次装齐无后续下载",
  },
];

export function EnvGuideDialog() {
  const open = useAppStore((s) => s.envGuideOpen);
  const close = () => useAppStore.getState().setEnvGuideOpen(false);
  const env = useAppStore((s) => s.env);
  const debugMock = useAppStore((s) => s.envDebugMock);
  const [checking, setChecking] = useState(false);

  if (!open) return null;

  const recheck = async () => {
    setChecking(true);
    await runEnvCheck();
    setChecking(false);
  };

  /** dev-only：切换「模拟未检测到 TeX」并立即重检 */
  const toggleDebugMock = async () => {
    useAppStore.getState().setEnvDebugMock(!debugMock);
    await recheck();
  };

  const found = env?.found === true;
  const tone = checking ? "checking" : found ? "ok" : "warn";

  return (
    <div className="modal-layer" role="dialog" aria-label="TeX 环境" onMouseDown={close}>
      <div className="modal env-guide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="tex" size={18} style={{ color: "var(--accent)" }} />
          <div>
            <h2>TeX 环境</h2>
            <div className="sub">TeX Distribution</div>
          </div>
          <button type="button" className="ibtn x" title="关闭" onClick={close}>
            <Icon name="x" />
          </button>
        </div>

        <div className="modal-body">
          {/* 检测状态卡 */}
          <div className={`env-status ${tone}`}>
            <Icon
              name={checking ? "refresh" : found ? "check" : "alert"}
              size={17}
              className={checking ? "env-status-icon spin" : "env-status-icon"}
            />
            <div className="env-status-body">
              {checking ? (
                <>
                  <b>正在检测本机 TeX 发行版…</b>
                  <span>依次检查 Zetla 独立目录、注册表 / 系统 PATH 与常见安装位置。</span>
                </>
              ) : env === null ? (
                <>
                  <b>尚未检测 TeX 环境</b>
                  <span>检测命令未返回结果，点击下方「重新检测」再试一次。</span>
                </>
              ) : found ? (
                <>
                  <b>
                    已检测到 {env.distribution ?? "TeX"}
                    {env.version ? ` · ${env.version}` : ""}
                  </b>
                  <span>TeX 环境可用，可以正常编译 PDF。</span>
                  {env.engines.length > 0 && (
                    <div className="env-engines">
                      <span className="env-engines-label">可用引擎</span>
                      {env.engines.map((engine) => (
                        <code className="env-chip" key={engine}>
                          {engine}
                        </code>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <b>
                    未检测到 TeX 发行版
                    {debugMock && <span className="env-debug-tag">DEBUG 模拟</span>}
                  </b>
                  <span>
                    Zetla 需要 TeX（xelatex / latexmk）才能编译 PDF。可自动安装，
                    或按下方指引手动安装后重新检测。
                  </span>
                </>
              )}
            </div>
          </div>

          {!found && !checking && (
            <>
              {/* 自动安装：M0-15b 接通，当前按约定置灰 */}
              <section className="env-section">
                <div className="env-section-head">
                  <h4>自动安装</h4>
                  <span className="env-badge">M0-15b 接通</span>
                </div>
                <div className="env-auto" title="自动安装 M0-15b 接通">
                  <div className="env-auto-text">
                    <b>Zetla 自动安装 MiKTeX</b>
                    <span>下载并安装到 Zetla 独立目录，不污染系统 PATH。</span>
                  </div>
                  <button type="button" className="btn primary env-auto-btn" disabled>
                    安装…
                  </button>
                </div>
              </section>

              {/* 手动安装：两个发行版并排 */}
              <section className="env-section">
                <div className="env-section-head">
                  <h4>手动安装</h4>
                  <span className="env-section-note">安装完成后回到此面板重新检测</span>
                </div>
                <div className="env-cards">
                  {MANUAL_LINKS.map((l) => (
                    <div className="env-card" key={l.label}>
                      <div className="env-card-text">
                        <b>{l.label}</b>
                        <span>{l.desc}</span>
                      </div>
                      <button
                        type="button"
                        className="btn env-card-btn"
                        onClick={() => {
                          openUrl(l.url).catch((e) => notify(String(e), "err"));
                        }}
                      >
                        <Icon name="external" size={13} />
                        打开官网
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* 已安装但未被识别 */}
              <div className="env-hint-row">
                <div className="env-hint-text">
                  <b>已装好但未被识别？</b>
                  <span>手动指定 xelatex.exe 所在目录（写入 Zetla 配置，不改系统 PATH）。</span>
                </div>
                <button type="button" className="btn" onClick={() => void pickEngineDir()}>
                  指定引擎目录…
                </button>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <div className="env-foot-hint">
            检测顺序：Zetla 独立目录 → 注册表/系统 PATH → 常见安装位置
          </div>
          <div className="env-foot-actions">
            {import.meta.env.DEV && (
              <button
                type="button"
                className={`btn env-debug-btn${debugMock ? " on" : ""}`}
                aria-pressed={debugMock}
                title="调试功能（仅 dev 构建）：模拟未检测到 TeX；再次点击恢复真实检测"
                disabled={checking}
                onClick={() => void toggleDebugMock()}
              >
                <Icon name="alert" size={13} />
                {debugMock ? "恢复检测" : "模拟未检测"}
              </button>
            )}
            <button type="button" className="btn" disabled={checking} onClick={() => void recheck()}>
              <Icon name="refresh" size={13} />
              重新检测
            </button>
            <button type="button" className="btn primary" onClick={close}>
              {found ? "完成" : "知道了"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EnvGuideDialog;
