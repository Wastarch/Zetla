// M0-15b/c · TeX Live 自动安装（Profile 静默安装）
// Windows   : 下载 install-tl.zip（内含专用 tlperl）→ 用自带 perl 跑 install-tl
// Unix/macOS: 下载官方 install-tl-unx.tar.gz（保留可执行位与软链）→ 直接执行 install-tl
// 事件：tex_install_progress（阶段/百分比/速度）/ tex_install_finished（最终结果）
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Notify};
use zip::ZipArchive;

use crate::commands::compile::kill_tree;

pub const EV_INSTALL_PROGRESS: &str = "tex_install_progress";
pub const EV_INSTALL_FINISHED: &str = "tex_install_finished";

/// TeX Live 镜像（完整 URL）。
/// Windows 用 install-tl.zip（内含 tlpkg/tlperl 专用 Perl）；Unix/macOS 用官方
/// install-tl-unx.tar.gz —— 归档里的 install-tl 是带 shebang 的 Perl 脚本，
/// tar 解压天然保留可执行位与软链，不需要 zip 解压后手工补 +x。
/// 注意：install-tl-windows.exe 是 GUI 包装器，不转发命令行参数，不能用于静默安装
#[cfg(windows)]
const TEXLIVE_INSTALLER_URLS: [&str; 3] = [
    "https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet/install-tl.zip",
    "https://mirrors.aliyun.com/CTAN/systems/texlive/tlnet/install-tl.zip",
    "https://mirror.ctan.org/systems/texlive/tlnet/install-tl.zip",
];
#[cfg(not(windows))]
const TEXLIVE_INSTALLER_URLS: [&str; 3] = [
    "https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet/install-tl-unx.tar.gz",
    "https://mirrors.aliyun.com/CTAN/systems/texlive/tlnet/install-tl-unx.tar.gz",
    "https://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz",
];

/// installer 文件名 + 从完整 URL 反推 tlnet 仓库地址用
#[cfg(windows)]
const INSTALLER_NAME: &str = "install-tl.zip";
#[cfg(not(windows))]
const INSTALLER_NAME: &str = "install-tl-unx.tar.gz";

/// 下载前 UI 显示的近似体积（MB）
#[cfg(windows)]
const INSTALLER_APPROX_MB: u32 = 25;
#[cfg(not(windows))]
const INSTALLER_APPROX_MB: u32 = 5;

/// 完整性下限：实测 zip ≈25 MB、tar.gz ≈5.03 MB（5,279,426 B）。
/// 截断成半包时不该过校验，否则要等解压才炸。
#[cfg(windows)]
const MIN_INSTALLER_BYTES: u64 = 15 * 1024 * 1024;
#[cfg(not(windows))]
const MIN_INSTALLER_BYTES: u64 = 4 * 1024 * 1024 + 512 * 1024; // 4.5 MB

/// 安装阶段总超时（安装器自身）
const INSTALL_TIMEOUT: Duration = Duration::from_secs(60 * 60); // 1 小时
/// 下载总超时
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// 安装器输出（stdout+stderr）保留条数：仅用于退出码非零/失败排查
const INSTALLER_OUTPUT_TAIL: usize = 4000;

/// 单个 chunk 无数据超时：TCP 还活着但服务端不吐字节时，不能干等总超时
const CHUNK_STALL_TIMEOUT: Duration = Duration::from_secs(15);
/// 镜像测速：只取前 1 MB，避免为了排序把整个安装包下三遍
const PROBE_BYTES: u64 = 1024 * 1024;
/// 单个镜像测速超时（含连接 + 读取）
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
/// 低速判定阈值（字节/秒）；低于它并持续一段时间才换源，避免慢启动误判
const SLOW_SPEED_BPS: u64 = 20 * 1024;
/// 连续低速多久触发换源
const SLOW_SPEED_SUSTAIN: Duration = Duration::from_secs(6);
/// 下载开始后的宽限期：TCP 慢启动阶段不参与低速判定
const SLOW_SPEED_GRACE: Duration = Duration::from_secs(5);
/// 速度平滑窗口：最近 N 个 1 秒采样的算术平均
const SPEED_WINDOW: usize = 5;

const CANCELLED: &str = "cancelled:用户取消";
/// 手动换源的 reason 文案（主循环据此允许绕回第一个镜像，避免文案改动导致逻辑失效）
const MANUAL_SWITCH_REASON: &str = "手动切换镜像";

/// 全局安装状态（P0 单并发，同一时刻只允许一个安装任务）
#[derive(Default)]
pub struct TexInstallState {
    busy: AtomicBool,
    cancelled: AtomicBool,
    /// 用户在下载阶段请求「换一个源」
    switch_requested: AtomicBool,
    /// 当前安装器 / 配置子进程（取消时取走并杀进程树）
    child: Mutex<Option<Child>>,
    /// 取消 / 换源时唤醒正在等待网络的下载任务
    cancel: Notify,
}

/// 安装进度负载（与 src/types/compile.ts TexInstallProgress 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexInstallProgress {
    /// prepare / download / install / verify / done
    pub stage: String,
    pub percent: u32,
    pub speed_bps: u64,
    pub message: String,
    /// 当前下载镜像 host；仅下载阶段有值，供 UI 常驻显示（不会被进度消息覆盖）
    pub mirror: Option<String>,
}

/// 安装结果（与 src/types/compile.ts TexInstallResult 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexInstallResult {
    pub ok: bool,
    pub cancelled: bool,
    pub distro: String,
    pub install_dir: Option<String>,
    pub engine_bin_dir: Option<String>,
    pub version: Option<String>,
    pub message: String,
    /// 非致命警告
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// 安装成功后的产物信息
struct Installed {
    bin_dir: PathBuf,
    version: String,
    warning: Option<String>,
}

/// 安装器进程的结果。
///
/// TeX Live 2026 的 install-tl 在收尾阶段可能把非致命警告计入 errcount，
/// 出现「包/格式都已装完，但进程退出码为 1」。因此非零退出不直接判失败，
/// 由后续引擎校验决定安装是否可用。
#[derive(Debug)]
enum InstallerOutcome {
    Success,
    NonZero(std::process::ExitStatus),
}

/// 安装方案
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TexLiveScheme {
    Basic,
    Full,
}

impl TexLiveScheme {
    /// 写进 profile 的 selected_scheme。
    ///
    /// basic 不能直接用 scheme-basic：它只含 collection-basic + collection-latex，
    /// 没有 xetex/ctex，装完会缺 xelatex.exe。这里用 scheme-custom 显式列集合，
    /// 不依赖 install-tl 对 scheme 的隐式展开。
    fn profile_scheme(&self) -> &'static str {
        match self {
            TexLiveScheme::Basic => "scheme-custom",
            TexLiveScheme::Full => "scheme-full",
        }
    }

    /// 给进度、台账和 UI 看的方案名（不暴露内部 scheme-custom）
    fn label(&self) -> &'static str {
        match self {
            TexLiveScheme::Basic => "basic",
            TexLiveScheme::Full => "full",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "basic" | "scheme-basic" | "scheme-custom" => Some(TexLiveScheme::Basic),
            "full" | "scheme-full" => Some(TexLiveScheme::Full),
            _ => None,
        }
    }
}

/// 安装失败分类：`cleanup` 只对「安装器启动前失败 / 用户取消」为 true。
/// 安装器成功后的校验/写配置失败必须保留安装目录，避免把上 GB 的成果删掉。
struct InstallFailure {
    message: String,
    cleanup: bool,
}

impl InstallFailure {
    fn post_install(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            cleanup: false,
        }
    }

    fn cancelled() -> Self {
        Self {
            message: CANCELLED.to_string(),
            cleanup: true,
        }
    }
}

impl From<String> for InstallFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            cleanup: true,
        }
    }
}

fn should_cleanup(cancelled: bool, failure: &InstallFailure) -> bool {
    cancelled || failure.cleanup
}

/// 自动安装 TeX（M0-15b/c）；立即返回，进度与结果通过事件回传。
#[tauri::command]
pub async fn install_tex(
    app: AppHandle,
    state: State<'_, Arc<TexInstallState>>,
    distro: String,
    install_dir: Option<String>,
    scheme: Option<String>,
) -> Result<(), String> {
    if distro != "texlive" {
        return Err(format!("不支持的发行版：{distro}，目前只支持 texlive"));
    }

    let scheme = scheme
        .as_deref()
        .and_then(TexLiveScheme::from_str)
        .unwrap_or(TexLiveScheme::Basic);

    // 路径与可写性先同步校验
    let target = resolve_install_dir(&app, install_dir)?;
    if let Some(engine) = find_install_engine(&target.path) {
        return Err(format!(
            "该目录下已存在 TeX 引擎（{}）：{}\n请直接使用现有环境，或选择其他目录",
            engine.name,
            target.path.display()
        ));
    }

    let st = state.inner().clone();
    // P0 单并发：抢不到锁说明已有安装任务
    if st.busy.swap(true, Ordering::SeqCst) {
        return Err("已有安装任务在进行中".to_string());
    }
    st.cancelled.store(false, Ordering::SeqCst);
    st.switch_requested.store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        let result = run_install(&app, &st, &target, scheme).await;
        // 清场：残留子进程一律杀掉
        if let Ok(mut guard) = st.child.lock() {
            if let Some(mut child) = guard.take() {
                kill_tree(&mut child);
            }
        }
        st.busy.store(false, Ordering::SeqCst);
        let _ = app.emit(EV_INSTALL_FINISHED, result);
    });
    Ok(())
}

/// 取消安装（杀安装器进程树 + 中断下载；没有任务时报错）
#[tauri::command]
pub fn cancel_tex_install(state: State<'_, Arc<TexInstallState>>) -> Result<(), String> {
    let st = state.inner();
    if !st.busy.load(Ordering::SeqCst) {
        return Err("当前没有安装任务".to_string());
    }
    st.cancelled.store(true, Ordering::SeqCst);
    st.cancel.notify_waiters();
    if let Ok(mut guard) = st.child.lock() {
        if let Some(mut child) = guard.take() {
            kill_tree(&mut child);
        }
    }
    Ok(())
}

/// 手动切换下载镜像（仅下载阶段有效）：置标志并唤醒等待 chunk 的下载任务，
/// 让它按「换源」分支重进主循环；安装器已启动后不再响应。
#[tauri::command]
pub fn switch_tex_mirror(state: State<'_, Arc<TexInstallState>>) -> Result<(), String> {
    let st = state.inner();
    if !st.busy.load(Ordering::SeqCst) {
        return Err("当前没有安装任务".to_string());
    }
    st.switch_requested.store(true, Ordering::SeqCst);
    st.cancel.notify_waiters();
    Ok(())
}

/// 返回当前平台「安装目录留空」时实际使用的默认路径。
/// 供向导显示，避免在 UI 里写死 `%LOCALAPPDATA%`（macOS/Linux 上是错的）。
#[tauri::command]
pub fn get_default_tex_install_dir(app: AppHandle) -> Result<String, String> {
    Ok(default_tex_install_dir(&app)?
        .to_string_lossy()
        .into_owned())
}

/// 接管已有 TeX Live：校验引擎 → 写 config / 卸载台账 / `.zetla-tex`。
///
/// 用于两种情况：
/// - install-tl 已装完但进程非零退出，Zetla 未走到写配置；
/// - 用户此前手动安装/迁移了 TeX Live，希望交给 Zetla 管理。
#[tauri::command]
pub async fn adopt_tex_install(
    app: AppHandle,
    state: State<'_, Arc<TexInstallState>>,
    root: String,
) -> Result<TexInstallResult, String> {
    let st = state.inner();
    if st.busy.load(Ordering::SeqCst) {
        return Err("已有安装任务在进行中".to_string());
    }

    let input = PathBuf::from(root.trim());
    if !input.is_absolute() {
        return Err("请选择 TeX Live 安装根目录（绝对路径）".to_string());
    }
    if !input.is_dir() {
        return Err(format!("目录不存在：{}", input.display()));
    }

    let engine = find_install_engine(&input).ok_or_else(|| {
        format!(
            "该目录及其 bin 子目录下未找到可用引擎（xelatex / pdflatex / lualatex）：{}",
            input.display()
        )
    })?;
    let install_root = infer_texlive_root(&input, &engine.bin_dir);
    if !install_root.join("tlpkg").is_dir() || !install_root.join("texmf-dist").is_dir() {
        return Err(format!(
            "不是完整的 TeX Live 安装目录：{}\n请选择包含 bin、tlpkg、texmf-dist 的 TeX Live 根目录",
            install_root.display()
        ));
    }

    let version = verify_engine(&engine.path, &engine.bin_dir, engine.name).await?;
    write_install_records(&app, &install_root, &engine.bin_dir, "existing")?;

    let warning = if engine.name != "xelatex" {
        Some(format!(
            "未找到 XeLaTeX，当前可用引擎为 {}；中文模板可能无法编译",
            engine.name
        ))
    } else {
        None
    };

    Ok(TexInstallResult {
        ok: true,
        cancelled: false,
        distro: "texlive".to_string(),
        install_dir: Some(install_root.to_string_lossy().to_string()),
        engine_bin_dir: Some(engine.bin_dir.to_string_lossy().to_string()),
        version: Some(version.clone()),
        message: format!("已接管已有 TeX Live（{version}）"),
        warning,
    })
}

fn probe_writable(dir: &Path) -> std::io::Result<()> {
    let probe = dir.join(".zetla-write-test");
    std::fs::write(&probe, b"zetla")?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// 安装目标目录 + 清理所需信息
struct InstallTarget {
    path: PathBuf,
    /// 目录由本次安装新建
    created: bool,
    /// 安装前目录为空（新建或用户选的空目录）→ 取消时可安全清空内容
    was_empty: bool,
}

/// 默认安装目录 = 平台本地数据目录 / Zetla / tex / texlive。
/// Windows：`%LOCALAPPDATA%\Zetla\tex\texlive`；
/// macOS：`~/Library/Application Support/Zetla/tex/texlive`；
/// Linux：`~/.local/share/Zetla/tex/texlive`。
/// 抽成单一真源，供 resolve_install_dir 与 UI 查询命令共用。
fn default_tex_install_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .local_data_dir()
        .map_err(|e| format!("解析本地数据目录失败：{e}"))?
        .join("Zetla")
        .join("tex")
        .join("texlive"))
}

/// 解析并校验安装目录：留空时使用当前平台的本地数据目录。
fn resolve_install_dir(app: &AppHandle, input: Option<String>) -> Result<InstallTarget, String> {
    let path = match input
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(s) => PathBuf::from(s),
        None => default_tex_install_dir(app)?,
    };
    if !path.is_absolute() {
        return Err("安装目录必须是绝对路径".to_string());
    }
    #[cfg(windows)]
    {
        if path.parent().is_none() {
            return Err("不能直接安装到盘符根目录，请选择子目录".to_string());
        }
        if let Ok(windir) = std::env::var("WINDIR") {
            if path.starts_with(Path::new(&windir)) {
                return Err("不能安装到 Windows 系统目录".to_string());
            }
        }
    }

    let created = !path.exists();
    let was_empty = created || is_empty_dir(&path);
    std::fs::create_dir_all(&path).map_err(|e| format!("创建安装目录失败：{e}"))?;
    if let Err(e) = probe_writable(&path) {
        if created {
            let _ = std::fs::remove_dir_all(&path);
        }
        return Err(format!(
            "安装目录不可写：{e}\n请换一个位置（例如 D:\\Zetla\\tex）"
        ));
    }

    Ok(InstallTarget {
        path,
        created,
        was_empty,
    })
}

/// 删除目录（取消安装时子进程刚被杀，文件句柄可能还没释放，重试几次）
fn remove_dir_all_retry(path: &Path) {
    for attempt in 0..3 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) if attempt < 2 => std::thread::sleep(Duration::from_millis(400)),
            Err(_) => return,
        }
    }
}

/// 取消/失败清理：本次新建的目录整个删；用户原有的空目录只清内容；非空目录不动
fn cleanup_install_target(t: &InstallTarget) {
    if t.created {
        remove_dir_all_retry(&t.path);
    } else if t.was_empty {
        if let Ok(entries) = std::fs::read_dir(&t.path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    remove_dir_all_retry(&p);
                } else {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
    }
}

/// 后台安装流程；任何错误都收敛成结果事件，不让前端悬挂
async fn run_install(
    app: &AppHandle,
    st: &Arc<TexInstallState>,
    target: &InstallTarget,
    scheme: TexLiveScheme,
) -> TexInstallResult {
    let started = Instant::now();
    let path = target.path.clone();
    match install_inner(app, st, &path, scheme).await {
        Ok(installed) => TexInstallResult {
            ok: true,
            cancelled: false,
            distro: "texlive".to_string(),
            install_dir: Some(path.to_string_lossy().to_string()),
            engine_bin_dir: Some(installed.bin_dir.to_string_lossy().to_string()),
            version: Some(installed.version.clone()),
            message: format!(
                "TeX Live 安装完成（{}），用时 {}s",
                installed.version,
                started.elapsed().as_secs()
            ),
            warning: installed.warning,
        },
        Err(failure) => {
            let cancelled = st.cancelled.load(Ordering::SeqCst) || failure.message == CANCELLED;
            if should_cleanup(cancelled, &failure) {
                cleanup_install_target(target);
            }
            let cleaned = cancelled && (target.created || target.was_empty);
            let log_hint = if !cancelled && !failure.cleanup {
                let mut hints = Vec::new();
                if let Some(p) = stable_install_log(app).filter(|p| p.is_file()) {
                    hints.push(format!("安装日志：{}", p.display()));
                }
                if let Some(p) = stable_install_output_log(app).filter(|p| p.is_file()) {
                    hints.push(format!("安装器输出：{}", p.display()));
                }
                if hints.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", hints.join("\n"))
                }
            } else {
                String::new()
            };
            TexInstallResult {
                ok: false,
                cancelled,
                distro: "texlive".to_string(),
                install_dir: Some(path.to_string_lossy().to_string()),
                engine_bin_dir: None,
                version: None,
                message: if cancelled {
                    if cleaned {
                        "已取消安装，本次安装产生的文件已清理".to_string()
                    } else {
                        "已取消安装（目录中已有其他文件，未清理）".to_string()
                    }
                } else {
                    format!("{}{}", failure.message, log_hint)
                },
                warning: None,
            }
        }
    }
}

fn is_empty_dir(path: &Path) -> bool {
    std::fs::read_dir(path)
        .map(|mut it| it.next().is_none())
        .unwrap_or(false)
}

async fn install_inner(
    app: &AppHandle,
    st: &Arc<TexInstallState>,
    target: &Path,
    scheme: TexLiveScheme,
) -> Result<Installed, InstallFailure> {
    emit(app, "prepare", 1, 0, "准备安装 TeX Live…");

    // 前置检查：macOS/Linux 需系统 Perl（Windows 自带，跳过）
    if let Err(e) = check_install_prerequisites() {
        return Err(InstallFailure::from(e));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| format!("初始化下载客户端失败：{e}"))?;

    // 1) 镜像测速：并发各取前 1 MB，按速度排序；不做 HEAD 预检（部分镜像站对 HEAD 返回 403）
    emit(app, "prepare", 2, 0, "正在测速下载镜像…");
    let urls = TEXLIVE_INSTALLER_URLS;
    let probes = async {
        tokio::join!(
            probe_mirror(&client, urls[0]),
            probe_mirror(&client, urls[1]),
            probe_mirror(&client, urls[2]),
        )
    };
    tokio::pin!(probes);
    let speeds = loop {
        tokio::select! {
            r = &mut probes => break Some(r),
            _ = st.cancel.notified() => {
                // 只有真正取消才中断；换源唤醒在测速阶段忽略，等测速出结果
                if st.cancelled.load(Ordering::SeqCst) {
                    break None;
                }
            }
        }
    };
    let Some((s0, s1, s2)) = speeds else {
        return Err(InstallFailure::cancelled());
    };
    if st.cancelled.load(Ordering::SeqCst) {
        return Err(InstallFailure::cancelled());
    }
    let order = rank_mirrors(&[s0, s1, s2]);
    let best = order[0];
    let best_speed = [s0, s1, s2][best];
    emit_mirror(
        app,
        "prepare",
        3,
        0,
        match best_speed {
            Some(bps) => format!(
                "已选用 {}（测速 {}）",
                host_of(urls[best]),
                fmt_bps(bps)
            ),
            None => "镜像测速不可用，按默认顺序尝试…".to_string(),
        },
        best_speed.map(|_| host_of(urls[best])),
    );

    // 2) 下载当前平台的安装器：按测速顺序尝试；stall 可在同镜像续传，慢/断则换源
    let temp_dir = std::env::temp_dir().join("zetla-texlive-download");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let archive_path = temp_dir.join(INSTALLER_NAME);
    let extract_dir = temp_dir.join("installer");
    // 清掉上一次的残留
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&extract_dir);

    let mut last_err = String::new();
    let mut repo_base: Option<String> = None;
    let mut mirror_pos = 0usize;
    let mut resume_offset: u64 = 0;
    let mut resume_validator: Option<String> = None;
    let mut same_mirror_retries = 0u32;
    let mut attempts = 0u32;
    // 3 个镜像各一次 + 手动换源/stall 续传的余量，防止无限循环
    let max_attempts = (order.len() * 3) as u32;

    while mirror_pos < order.len() && attempts < max_attempts {
        attempts += 1;
        if st.cancelled.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&archive_path);
            return Err(InstallFailure::cancelled());
        }
        let idx = order[mirror_pos];
        let url = urls[idx];
        emit_mirror(
            app,
            "download",
            8,
            0,
            format!(
                "正在从 {} 下载 {}（约 {} MB）…",
                host_of(url),
                INSTALLER_NAME,
                INSTALLER_APPROX_MB
            ),
            Some(host_of(url)),
        );
        // 已是最后一个镜像时不再因低速放弃（没有更优的源可换）
        let allow_slow_switch = mirror_pos + 1 < order.len();
        match download_installer(
            &client,
            app,
            st,
            url,
            &archive_path,
            resume_offset,
            resume_validator.as_deref(),
            allow_slow_switch,
        )
        .await
        {
            Ok(DownloadOutcome::Complete) => {
                // 仓库地址 = URL 去掉 installer 文件名（同一镜像的 tlnet 目录）
                repo_base = Some(repo_base_from(url));
                break;
            }
            Ok(DownloadOutcome::Retry {
                downloaded,
                validator,
                reason,
                same_mirror,
            }) => {
                last_err = reason.clone();
                emit_mirror(
                    app,
                    "download",
                    8,
                    0,
                    format!("{reason}，正在调整下载源…"),
                    Some(host_of(url)),
                );
                // 同镜像最多续传一次，避免 stall 死循环
                if same_mirror && downloaded > 0 && same_mirror_retries < 1 {
                    same_mirror_retries += 1;
                    resume_offset = downloaded;
                    resume_validator = validator;
                } else {
                    // 手动换源时绕回第一个镜像，让用户可以重新挑一个源
                    if reason == MANUAL_SWITCH_REASON && mirror_pos + 1 >= order.len() {
                        mirror_pos = 0;
                    } else {
                        mirror_pos += 1;
                    }
                    same_mirror_retries = 0;
                    resume_offset = 0;
                    resume_validator = None;
                    let _ = std::fs::remove_file(&archive_path);
                }
            }
            Err(e) if e == CANCELLED => {
                let _ = std::fs::remove_file(&archive_path);
                return Err(InstallFailure::cancelled());
            }
            Err(e) => {
                last_err = e;
                mirror_pos += 1;
                same_mirror_retries = 0;
                resume_offset = 0;
                resume_validator = None;
                let _ = std::fs::remove_file(&archive_path);
            }
        }
    }
    let repo_base = match repo_base {
        Some(r) => r,
        None => {
            return Err(
                format!("下载 {INSTALLER_NAME} 失败：{last_err}\n可尝试切换网络后重试").into(),
            );
        }
    };

    if st.cancelled.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&archive_path);
        return Err(InstallFailure::cancelled());
    }

    // 3) 解压：Windows 走 zip（内含专用 tlperl），Unix 走官方 tar.gz（保留可执行位）
    emit(app, "download", 15, 0, "正在解压安装器…");
    extract_installer_archive(&archive_path, &extract_dir)?;
    let _ = std::fs::remove_file(&archive_path);

    if st.cancelled.load(Ordering::SeqCst) {
        remove_dir_all_retry(&extract_dir);
        return Err(InstallFailure::cancelled());
    }

    let installer = match locate_installer(&extract_dir) {
        Ok(i) => i,
        Err(e) => {
            remove_dir_all_retry(&extract_dir);
            return Err(e.into());
        }
    };

    // 4) 生成 profile 文件
    emit(app, "install", 20, 0, "正在生成安装配置…");
    let profile_path = temp_dir.join("texlive.profile");
    if let Err(e) = generate_profile(&profile_path, target, scheme) {
        remove_dir_all_retry(&extract_dir);
        return Err(e.into());
    }

    // 5) 静默安装：Windows 用自带 perl 解释脚本；Unix 直接执行 install-tl（shebang → 系统 perl）
    //    -no-gui 控制台模式 / -no-interaction 不等待输入 / -repository 用国内镜像拉宏包
    emit(
        app,
        "install",
        25,
        0,
        format!(
            "正在安装 TeX Live（{}，约 10–60 分钟，请勿关闭窗口）…",
            scheme.label()
        ),
    );
    let run =
        run_installer_tracked(app, st, &installer, &profile_path, &repo_base, &extract_dir).await;
    // install-tl 默认把日志写到 TEXDIR/install-tl.log；复制一份到固定位置，
    // 避免解压目录被删后日志一起丢失。
    preserve_install_log(app, target, &extract_dir);
    remove_dir_all_retry(&extract_dir);
    let _ = std::fs::remove_file(&profile_path);

    let installer_warning = match run {
        Ok(InstallerOutcome::Success) => None,
        Ok(InstallerOutcome::NonZero(status)) => Some(format!(
            "安装器退出码：{status}；已继续校验引擎，安装内容完整时不影响使用"
        )),
        Err(e) if e == CANCELLED => return Err(InstallFailure::cancelled()),
        Err(e) => {
            // 安装器已经跑过：保留目录，别把可能完整的安装删掉
            return Err(InstallFailure::post_install(e));
        }
    };

    if st.cancelled.load(Ordering::SeqCst) {
        return Err(InstallFailure::cancelled());
    }

    // 6) 校验安装：优先 xelatex，缺失时退 pdflatex/lualatex，不再硬绑 xelatex
    emit(app, "verify", 90, 0, "正在校验 TeX 引擎…");
    let engine = find_install_engine(target).ok_or_else(|| {
        InstallFailure::post_install(format!(
            "安装结束但未找到可用 TeX 引擎（xelatex / pdflatex / lualatex）。\n安装目录：{}\n请保留该目录并检查安装日志，或换一个安装目录重试",
            target.display()
        ))
    })?;
    let version = verify_engine(&engine.path, &engine.bin_dir, engine.name)
        .await
        .map_err(InstallFailure::post_install)?;

    if st.cancelled.load(Ordering::SeqCst) {
        return Err(InstallFailure::cancelled());
    }

    // 7) 写配置 / 台账 / 标记
    emit(app, "verify", 98, 0, "正在写入环境配置…");
    write_install_records(app, target, &engine.bin_dir, scheme.label())
        .map_err(InstallFailure::post_install)?;

    let mut warnings = Vec::new();
    if let Some(w) = installer_warning {
        if let Some(log) = stable_install_output_log(app) {
            warnings.push(format!("{w}（安装器输出：{}）", log.display()));
        } else {
            warnings.push(w);
        }
    }
    if engine.name != "xelatex" {
        warnings.push(format!(
            "未找到 XeLaTeX，当前可用引擎为 {}；中文模板可能无法编译。安装目录已保留：{}",
            engine.name,
            target.display()
        ));
    }
    let warning = if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("；"))
    };

    emit(app, "done", 100, 0, "TeX Live 安装完成");
    Ok(Installed {
        bin_dir: engine.bin_dir,
        version,
        warning,
    })
}

/// 单次下载结果
enum DownloadOutcome {
    Complete,
    Retry {
        downloaded: u64,
        validator: Option<String>,
        reason: String,
        /// true = 同一镜像用 Range 续传重试（stall / 中途断流）；
        /// false = 换下一个镜像并从头下载（跨镜像快照可能不同版，不能拼接字节）
        same_mirror: bool,
    },
}

/// 镜像测速：只取前 PROBE_BYTES 字节并计时，不为排序把整个安装包下三遍。
/// 超时 / 连接失败 / HTTP 错误一律返回 None，由 rank_mirrors 排到末尾。
async fn probe_mirror(client: &reqwest::Client, url: &str) -> Option<u64> {
    let started = Instant::now();
    let fut = async {
        let mut resp = client
            .get(url)
            .header(
                reqwest::header::RANGE,
                format!("bytes=0-{}", PROBE_BYTES - 1),
            )
            .send()
            .await
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let mut got = 0u64;
        while got < PROBE_BYTES {
            let chunk = resp.chunk().await.ok()??;
            if chunk.is_empty() {
                break;
            }
            got += chunk.len() as u64;
        }
        Some(got)
    };
    let bytes = tokio::time::timeout(PROBE_TIMEOUT, fut).await.ok()??;
    if bytes == 0 {
        return None;
    }
    let secs = started.elapsed().as_secs_f64();
    if secs <= 0.0 {
        return None;
    }
    Some((bytes as f64 / secs) as u64)
}

/// 强校验器（非 weak 的 ETag，或 Last-Modified），用于 If-Range：
/// 只有新镜像的资源与已下载部分一致时，服务器才会返回 206 允许续传。
fn response_validator(resp: &reqwest::Response) -> Option<String> {
    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.starts_with("W/"));
    if etag.is_some() {
        return etag.map(str::to_string);
    }
    resp.headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// `Content-Range: bytes 123-456/789` → 起始偏移 123
fn content_range_start(resp: &reqwest::Response) -> Option<u64> {
    let raw = resp
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?;
    raw.split_whitespace()
        .nth(1)?
        .split('/')
        .next()?
        .split('-')
        .next()?
        .parse()
        .ok()
}

/// 下载 install-tl.zip。
/// - 平滑速度：最近 SPEED_WINDOW 个 1 秒采样的均值，不再被单秒抖动带偏；
/// - stall 超时：单个 chunk 超过 CHUNK_STALL_TIMEOUT 未到达即换源；
/// - 低速换源：宽限期后持续低于 SLOW_SPEED_BPS 达 SLOW_SPEED_SUSTAIN 即换源；
/// - 换源续传：带 Range + If-Range，仅 206 且 Content-Range 起点吻合才追加，
///   否则截断重下，避免把不同镜像/版本的内容拼成损坏的 zip。
async fn download_installer(
    client: &reqwest::Client,
    app: &AppHandle,
    st: &Arc<TexInstallState>,
    url: &str,
    dest: &Path,
    resume_offset: u64,
    resume_validator: Option<&str>,
    allow_slow_switch: bool,
) -> Result<DownloadOutcome, String> {
    if st.cancelled.load(Ordering::SeqCst) {
        return Err(CANCELLED.to_string());
    }
    let mirror = host_of(url);

    let mut req = client.get(url);
    if resume_offset > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={resume_offset}-"));
        if let Some(v) = resume_validator {
            req = req.header(reqwest::header::IF_RANGE, v);
        }
    }
    let mut resp = tokio::select! {
        r = req.send() => match r {
            Ok(x) => x,
            Err(e) => return Ok(DownloadOutcome::Retry {
                downloaded: resume_offset,
                validator: resume_validator.map(str::to_string),
                reason: format!("连接失败：{e}"),
                same_mirror: false,
            }),
        },
        _ = st.cancel.notified() => {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(CANCELLED.to_string());
        }
    };

    let validator = response_validator(&resp);
    let status = resp.status();
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        let _ = tokio::fs::remove_file(dest).await;
        return Ok(DownloadOutcome::Retry {
            downloaded: 0,
            validator: None,
            reason: "服务器拒绝续传，改为重新下载".to_string(),
            same_mirror: false,
        });
    }
    if !status.is_success() {
        return Ok(DownloadOutcome::Retry {
            downloaded: resume_offset,
            validator,
            reason: format!("镜像返回 HTTP {status}"),
            same_mirror: false,
        });
    }

    // 206 但起点无法确认时不能继续：响应体只是「剩余段」，
    // 当成完整文件写入会产出缺头的损坏 zip。放弃本次响应、换源重下。
    let partial = status == reqwest::StatusCode::PARTIAL_CONTENT;
    if resume_offset > 0 && partial && content_range_start(&resp) != Some(resume_offset) {
        return Ok(DownloadOutcome::Retry {
            downloaded: 0,
            validator: None,
            reason: "续传响应缺少有效 Content-Range，改为重新下载".to_string(),
            same_mirror: false,
        });
    }
    // 只有明确的 206 + 起点吻合才追加；200（服务器忽略 Range）一律截断从头写
    let append = resume_offset > 0 && partial;
    let base = if append { resume_offset } else { 0 };
    let total = resp.content_length().map(|n| base + n);

    let mut file = if append {
        tokio::fs::OpenOptions::new().append(true).open(dest).await
    } else {
        tokio::fs::File::create(dest).await
    }
    .map_err(|e| format!("创建安装包文件失败：{e}"))?;

    let mut downloaded = base;
    let mut window_bytes: u64 = 0;
    let mut window_start = Instant::now();
    let mut samples: VecDeque<u64> = VecDeque::new();
    let mut speed: u64 = 0;
    let mut slow_for = Duration::ZERO;
    let started = Instant::now();
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    loop {
        if st.cancelled.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(CANCELLED.to_string());
        }
        if st.switch_requested.swap(false, Ordering::SeqCst) {
            let _ = file.flush().await;
            return Ok(DownloadOutcome::Retry {
                downloaded: 0,
                validator: None,
                reason: MANUAL_SWITCH_REASON.to_string(),
                same_mirror: false,
            });
        }
        let chunk = tokio::select! {
            r = tokio::time::timeout(CHUNK_STALL_TIMEOUT, resp.chunk()) => match r {
                Ok(Ok(c)) => c,
                Ok(Err(e)) => {
                    // 续传/重下前必须 flush，否则已写入字节可能还在缓冲区
                    let _ = file.flush().await;
                    return Ok(DownloadOutcome::Retry {
                        downloaded,
                        validator: validator.clone(),
                        reason: format!("下载中断：{e}"),
                        same_mirror: downloaded > 0 && validator.is_some(),
                    });
                }
                Err(_) => {
                    let _ = file.flush().await;
                    return Ok(DownloadOutcome::Retry {
                        downloaded,
                        validator: validator.clone(),
                        reason: format!("{mirror} 超过 {} 秒无数据", CHUNK_STALL_TIMEOUT.as_secs()),
                        same_mirror: downloaded > 0 && validator.is_some(),
                    });
                }
            },
            _ = st.cancel.notified() => {
                if st.cancelled.load(Ordering::SeqCst) {
                    let _ = tokio::fs::remove_file(dest).await;
                    return Err(CANCELLED.to_string());
                }
                // 手动换源：notify_waiters 只唤醒已注册的等待者，标志位由循环顶部兜底
                continue;
            }
        };
        let Some(bytes) = chunk else { break };
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("写入安装包失败：{e}"))?;
        downloaded += bytes.len() as u64;
        window_bytes += bytes.len() as u64;

        let now = Instant::now();
        if window_start.elapsed() >= Duration::from_secs(1) {
            let secs = window_start.elapsed().as_secs_f64();
            let instant = (window_bytes as f64 / secs) as u64;
            speed = smooth_speed(&mut samples, instant);
            let slow = advance_slow(
                &mut slow_for,
                Duration::from_secs(1),
                started.elapsed(),
                speed,
                true,
            );
            window_bytes = 0;
            window_start = now;
            let near_complete = total.map_or(false, |t| t > 0 && downloaded * 10 >= t * 9);
            if slow && allow_slow_switch && !near_complete {
                let _ = file.flush().await;
                return Ok(DownloadOutcome::Retry {
                    downloaded: 0,
                    validator: validator.clone(),
                    reason: format!("{mirror} 持续低速（{}）", fmt_bps(speed)),
                    same_mirror: false,
                });
            }
        }
        if last_emit.elapsed() >= Duration::from_millis(300) {
            last_emit = now;
            let pct = total
                .filter(|t| *t > 0)
                .map(|t| 8 + ((downloaded.min(t) * 6) / t) as u32)
                .unwrap_or(0);
            emit_mirror(
                app,
                "download",
                pct.min(14),
                speed,
                format!(
                    "正在下载 {INSTALLER_NAME} · {:.1} MB{}",
                    downloaded as f64 / 1_048_576.0,
                    total
                        .map(|t| format!(" / {:.1} MB", t as f64 / 1_048_576.0))
                        .unwrap_or_default()
                ),
                Some(mirror),
            );
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("保存安装包失败：{e}"))?;

    if downloaded < MIN_INSTALLER_BYTES {
        let _ = tokio::fs::remove_file(dest).await;
        return Ok(DownloadOutcome::Retry {
            downloaded: 0,
            validator: None,
            reason: format!("安装包不完整（仅 {downloaded} 字节）"),
            same_mirror: false,
        });
    }
    emit_mirror(
        app,
        "download",
        15,
        speed,
        format!("下载完成 · {:.1} MB", downloaded as f64 / 1_048_576.0),
        Some(mirror),
    );
    Ok(DownloadOutcome::Complete)
}

/// 解压 install-tl.zip（Windows：内含 tlpkg/tlperl 专用 Perl）
fn extract_install_tl_zip(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| format!("打开安装包失败：{e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取安装包失败：{e}"))?;
    archive
        .extract(dest)
        .map_err(|e| format!("解压安装包失败：{e}"))
}

/// 解压官方 install-tl-unx.tar.gz（Unix/macOS）。
/// tar 归档保留文件 mode 与软链，install-tl 的 shebang 因此可直接执行；
/// tar-rs 的 unpack 默认拒绝 `..` / 绝对路径与软链逃逸，无需额外防越界。
fn extract_install_tl_tar_gz(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| format!("打开安装包失败：{e}"))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    archive
        .unpack(dest)
        .map_err(|e| format!("解压安装包失败：{e}"))
}

/// 按平台选择归档格式。两侧都参与编译，便于在 Windows 上单测 Unix 解压路径。
fn extract_installer_archive(archive_path: &Path, dest: &Path) -> Result<(), String> {
    if cfg!(windows) {
        extract_install_tl_zip(archive_path, dest)
    } else {
        extract_install_tl_tar_gz(archive_path, dest)
    }
}

/// 安装器入口
struct Installer {
    /// Windows：自带 tlperl，作为解释器启动脚本；
    /// Unix/macOS：系统 perl（用于前置校验与 PATH 注入），脚本靠 shebang 直接执行。
    perl: PathBuf,
    /// <root>/install-tl（Unix 归档保留可执行位）
    script: PathBuf,
    /// <root>
    root: PathBuf,
}

/// 在解压目录中定位 install-tl（两种归档顶层都带版本号目录，需递归找）
fn locate_installer(extract_dir: &Path) -> Result<Installer, String> {
    let mut root: Option<PathBuf> = None;
    for entry in walkdir::WalkDir::new(extract_dir)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if entry.file_type().is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("install-tl")
        {
            if let Some(parent) = entry.path().parent() {
                root = Some(parent.to_path_buf());
                break;
            }
        }
    }
    let root = root.ok_or_else(|| {
        format!(
            "安装包不完整：未找到 install-tl 脚本（解压目录：{}）",
            extract_dir.display()
        )
    })?;

    // tar 归档已保留可执行位；这里再做一次兜底（临时目录若落在 DrvFS 等不保留
    // Unix 权限的文件系统上，install-tl 后期调用 tlmgr/fmtutil 仍会失败）。
    #[cfg(not(windows))]
    {
        ensure_unix_exec(&root)?;
    }

    // 定位 perl：Windows 用自带 tlperl；Unix/macOS 用系统 perl（官方要求，
    // 用于前置校验与 GUI 进程 PATH 注入）
    let perl = resolve_installer_perl(&root)?;

    let script = root.join("install-tl");
    if !script.is_file() {
        return Err(format!("安装包不完整：未找到 {}", script.display()));
    }
    Ok(Installer { perl, script, root })
}

/// 解析运行 install-tl 所需的 perl。
///
/// - Windows：用 TeX Live 自带的 tlperl（tlpkg/tlperl/bin/perl.exe），并作为脚本解释器。
/// - Linux/macOS：官方 Unix 归档里的 install-tl 是带 shebang 的 Perl 脚本，直接执行；
///   这些平台**不自带 Perl**（TUG 文档："Except on Windows, your system must provide
///   a standard Perl installation"），这里解析系统 perl 用于前置校验与 PATH 注入。
///   缺失时给出可操作的安装提示，而不是误报「安装包不完整」。
fn resolve_installer_perl(root: &Path) -> Result<PathBuf, String> {
    if cfg!(windows) {
        let perl = root
            .join("tlpkg")
            .join("tlperl")
            .join("bin")
            .join("perl.exe");
        if !perl.is_file() {
            return Err(format!(
                "安装包不完整：未找到 TeX Live 自带 Perl（{}）",
                perl.display()
            ));
        }
        return Ok(perl);
    }
    match which::which("perl") {
        Ok(perl) => Ok(perl),
        Err(_) => Err(
            "系统未检测到 Perl。macOS/Linux 版的 TeX Live 安装器需要系统自带 Perl（及 LWP 模块），\
             请先安装后再试：\n\
             • Debian/Ubuntu：sudo apt install perl liblwp-protocol-https-perl\n\
             • macOS（Homebrew）：brew install perl\n\
             • 或安装 MacTeX 后由系统 Perl 接管"
                .to_string(),
        ),
    }
}

/// Unix 可执行位兜底：tar 解压通常已保留 0755，只在权限丢失时补齐执行位。
/// 不覆盖原有 mode，避免把 0750 之类改成 0755。
#[cfg(not(windows))]
fn ensure_unix_exec(root: &Path) -> Result<(), String> {
    set_exec(&root.join("install-tl"));
    if let Ok(entries) = std::fs::read_dir(root.join("tlpkg").join("bin")) {
        for e in entries.flatten() {
            set_exec(&e.path());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_exec(path: &Path) {
    if !path.is_file() {
        return;
    }
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        use std::os::unix::fs::PermissionsExt;
        let mode = perms.mode();
        if mode & 0o111 == 0 {
            perms.set_mode(mode | 0o111);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

/// 安装前置检查：macOS/Linux 需要系统 perl（install-tl 的 shebang 依赖；Windows 自带，跳过）。
/// 在下载安装器之前执行，避免无 perl 时白下整个归档。
fn check_install_prerequisites() -> Result<(), String> {
    if cfg!(not(windows)) && which::which("perl").is_err() {
        return Err(
            "系统未检测到 Perl，无法自动安装 TeX Live。\n\
             Linux：sudo apt install perl liblwp-protocol-https-perl\n\
             macOS：brew install perl（或安装 MacTeX）"
                .to_string(),
        );
    }
    Ok(())
}

/// 生成 TeX Live profile 文件
/// 路径用正斜杠（TeX Live 在 Windows 上同样接受，反斜杠可能被当作转义）；
/// 不写 binary_* 键，让 install-tl 按当前机器自动选择平台（Windows 平台名现为 `windows`）。
///
/// basic 用 scheme-custom + 显式集合：scheme-basic 只有 collection-basic +
/// collection-latex，连 xetex 都没有。collection-xetex 提供 xetex / xeCJK /
/// fontspec，但 **ctex 与 fandol 中文字体属于 collection-langchinese**
/// （Debian 的 texlive-lang-chinese），不会随 collection-xetex 带出。
///
/// 缺了中文集合时，Linux/macOS 上 ctexart 会退化成「没有 CJK 字体」：
/// XeTeX 只打 `Missing character` warning，latexmk 仍判编译成功，但 PDF 里
/// 中文全部空白、英文和数字照常显示——Windows 因系统自带中文字体而不暴露。
fn generate_profile(path: &Path, target: &Path, scheme: TexLiveScheme) -> Result<(), String> {
    let texdir = target.to_string_lossy().replace('\\', "/");
    let collections = match scheme {
        TexLiveScheme::Basic => "collection-basic 1\ncollection-latex 1\ncollection-xetex 1\ncollection-langchinese 1\n",
        TexLiveScheme::Full => "",
    };
    let content = format!(
        r#"selected_scheme {scheme}
{collections}TEXDIR {texdir}
TEXMFSYSCONFIG {texdir}/texmf-config
TEXMFSYSVAR {texdir}/texmf-var
TEXMFLOCAL {texdir}/texmf-local
TEXMFHOME ~/texmf
instopt_adjustpath 0
instopt_adjustrepo 0
instopt_letter 0
instopt_portable 0
instopt_write18_restricted 1
tlpdbopt_autobackup 1
tlpdbopt_backupdir tlpkg/backups
tlpdbopt_create_formats 1
tlpdbopt_desktop_integration 0
tlpdbopt_file_assocs 0
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_post_code 1
tlpdbopt_w32_multi_user 0
"#,
        scheme = scheme.profile_scheme(),
        collections = collections,
        texdir = texdir
    );
    std::fs::write(path, content).map_err(|e| format!("写入 profile 失败：{e}"))
}

/// 跑安装器：转发输出、心跳进度、可取消、超时兜底
async fn run_installer_tracked(
    app: &AppHandle,
    st: &Arc<TexInstallState>,
    installer: &Installer,
    profile: &Path,
    repo: &str,
    cwd: &Path,
) -> Result<InstallerOutcome, String> {
    let profile_arg = profile.to_string_lossy().to_string();
    // Windows：zip 解出的 install-tl 没有 shebang，用自带 tlperl 显式解释；
    // Unix：tar 归档保留可执行位与 shebang，直接执行脚本，由 env 从 PATH 找系统 perl。
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new(&installer.perl);
        c.arg(&installer.script);
        c
    } else {
        Command::new(&installer.script)
    };
    cmd.arg("-no-gui")
        .arg("-no-interaction")
        .arg("-profile")
        .arg(&profile_arg)
        .arg("-repository")
        .arg(repo)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Windows：自带 Perl 依赖 PERL5LIB 定位模块；Unix：把系统 perl 目录置于 PATH 首位，
    // 并补齐 GUI 启动（Finder / WSLg）时缺失的常见工具目录 —— install-tl 后续要调
    // curl / tlmgr / fmtutil / texhash，GUI 进程默认 PATH 常只有 /usr/bin:/bin。
    #[cfg(windows)]
    let perl_lib = installer.root.join("tlpkg").join("tlperl").join("lib");
    let perl_bin: PathBuf = if cfg!(windows) {
        installer.root.join("tlpkg").join("tlperl").join("bin")
    } else {
        installer
            .perl
            .parent()
            .unwrap_or(&installer.root)
            .to_path_buf()
    };
    let mut path_dirs = vec![perl_bin.clone()];
    if let Some(old) = std::env::var_os("PATH") {
        path_dirs.extend(std::env::split_paths(&old));
    }
    if !cfg!(windows) {
        for extra in [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            let p = PathBuf::from(extra);
            if p.is_dir() && !path_dirs.contains(&p) {
                path_dirs.push(p);
            }
        }
    }
    match std::env::join_paths(&path_dirs) {
        Ok(path) => {
            cmd.env("PATH", path);
        }
        Err(_) => {
            // PATH 里有非法字符（个别机器带引号）：至少保证 perl 可见
            cmd.env("PATH", &perl_bin);
        }
    }
    #[cfg(windows)]
    cmd.env("PERL5LIB", &perl_lib);
    // Unix 不设 PERL5LIB：让系统 perl 用自己的模块路径，避免全局值串进安装器
    #[cfg(not(windows))]
    cmd.env_remove("PERL5LIB");
    cmd.env_remove("PERL5OPT")
        .env_remove("PERLLIB")
        .env_remove("PERLIO");
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 TeX Live 安装器：{e}"))?;

    // 合并 stdout / stderr 为一条行流
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if let Some(out) = child.stdout.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);

    if let Ok(mut guard) = st.child.lock() {
        *guard = Some(child);
    } else {
        return Err("安装状态锁定失败".to_string());
    }

    let started = Instant::now();
    let mut last_tick = Instant::now();
    let mut output_tail: VecDeque<String> = VecDeque::new();
    loop {
        let pct = install_percent(started.elapsed());
        while let Ok(line) = rx.try_recv() {
            if !line.trim().is_empty() {
                push_installer_output(&mut output_tail, &line);
                emit(app, "install", pct, 0, line);
            }
        }
        if last_tick.elapsed() >= Duration::from_secs(5) {
            last_tick = Instant::now();
            emit(
                app,
                "install",
                pct,
                0,
                format!(
                    "正在安装 TeX Live（已用 {}s，请勿关闭窗口）…",
                    started.elapsed().as_secs()
                ),
            );
        }
        if st.cancelled.load(Ordering::SeqCst) {
            take_and_kill(st);
            return Err(CANCELLED.to_string());
        }
        if started.elapsed() > INSTALL_TIMEOUT {
            take_and_kill(st);
            return Err("TeX Live 安装超时（1 小时），请检查网络或改用离线安装包".to_string());
        }

        let mut finished: Option<std::process::ExitStatus> = None;
        {
            let Ok(mut guard) = st.child.lock() else {
                return Err("安装状态锁定失败".to_string());
            };
            match guard.as_mut() {
                Some(c) => match c.try_wait() {
                    Ok(Some(status)) => {
                        finished = Some(status);
                        guard.take();
                    }
                    Ok(None) => {}
                    Err(e) => {
                        guard.take();
                        return Err(format!("等待安装器失败：{e}"));
                    }
                },
                // 被 cancel 取走
                None => return Err(CANCELLED.to_string()),
            }
        }
        if let Some(status) = finished {
            while let Ok(line) = rx.try_recv() {
                if !line.trim().is_empty() {
                    push_installer_output(&mut output_tail, &line);
                    emit(app, "install", install_percent(started.elapsed()), 0, line);
                }
            }
            preserve_installer_output(app, &output_tail, &status);
            return if status.success() {
                Ok(InstallerOutcome::Success)
            } else {
                Ok(InstallerOutcome::NonZero(status))
            };
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn push_installer_output(tail: &mut VecDeque<String>, line: &str) {
    if tail.len() >= INSTALLER_OUTPUT_TAIL {
        tail.pop_front();
    }
    tail.push_back(line.to_string());
}

/// 安装阶段的平滑百分比：25 → 89（按 30 分钟估算，封顶不虚报 100）
fn install_percent(elapsed: Duration) -> u32 {
    let secs = elapsed.as_secs().min(1800); // 30 分钟
    (25 + (secs * 64 / 1800) as u32).min(89)
}

fn take_and_kill(st: &Arc<TexInstallState>) {
    if let Ok(mut guard) = st.child.lock() {
        if let Some(mut child) = guard.take() {
            kill_tree(&mut child);
        }
    }
}

/// 安装校验时认可的引擎（按优先级）
const INSTALL_ENGINES: [&str; 3] = ["xelatex", "pdflatex", "lualatex"];

struct InstallEngine {
    name: &'static str,
    path: PathBuf,
    bin_dir: PathBuf,
}

/// 从用户选择的目录 / 引擎 bin 目录推断 TeX Live 根目录。
/// 支持选择 `<root>`、`<root>\bin`、`<root>\bin\windows` 三种入口。
fn infer_texlive_root(input: &Path, bin_dir: &Path) -> PathBuf {
    if input.join("tlpkg").is_dir() || input.join("texmf-dist").is_dir() {
        return input.to_path_buf();
    }
    for ancestor in bin_dir.ancestors() {
        if ancestor
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("bin"))
        {
            if let Some(root) = ancestor.parent() {
                return root.to_path_buf();
            }
        }
    }
    input.to_path_buf()
}

/// 找安装目录里的引擎：TeX Live 标准布局为 <TEXDIR>/bin/<arch>
///（Windows: bin/windows；Linux: bin/x86_64-linux；macOS: bin/universal-darwin / arm64-darwin）。
/// 优先 xelatex；缺失时退 pdflatex/lualatex，避免把「安装成功但没 xelatex」误判成失败。
fn find_install_engine(root: &Path) -> Option<InstallEngine> {
    let mut dirs: Vec<PathBuf> = vec![
        root.join("bin").join("windows"),
        root.join("bin").join("x64"),
        root.join("bin"),
    ];
    // 把 <root>/bin/<arch> 架构子目录一并加入首选，覆盖 Linux/macOS
    if let Ok(entries) = std::fs::read_dir(root.join("bin")) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                dirs.push(p);
            }
        }
    }
    dirs.push(root.to_path_buf());
    for dir in &dirs {
        for name in INSTALL_ENGINES {
            let exe = dir.join(exe_name(name));
            if exe.is_file() {
                return Some(InstallEngine {
                    name,
                    path: exe,
                    bin_dir: dir.clone(),
                });
            }
        }
    }
    // 兜底：浅层遍历（兼容非标准目录布局）
    for entry in walkdir::WalkDir::new(root)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy();
        for name in INSTALL_ENGINES {
            if file_name.eq_ignore_ascii_case(&exe_name(name)) {
                let path = entry.path().to_path_buf();
                let bin_dir = path.parent()?.to_path_buf();
                return Some(InstallEngine {
                    name,
                    path,
                    bin_dir,
                });
            }
        }
    }
    None
}

async fn verify_engine(exe: &Path, bin_dir: &Path, name: &str) -> Result<String, String> {
    if !exe.is_file() {
        return Err(format!("未找到可执行文件：{}", exe.display()));
    }
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--version")
        .current_dir(bin_dir)
        .stdin(Stdio::null());
    hide_console_cmd(&mut cmd);
    let out = match tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::from(cmd).output(),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(format!("无法启动 {}：{e}", exe.display())),
        Err(_) => return Err(format!("{} 执行超时", exe.display())),
    };
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "{name} --version 校验失败（退出码 {}）：{}",
            out.status,
            stderr.trim()
        ));
    }
    let text = if String::from_utf8_lossy(&out.stdout).trim().is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        String::from_utf8_lossy(&out.stdout).to_string()
    };
    let first = text.lines().next().unwrap_or("").trim();
    if first.is_empty() {
        return Err(format!("{name} --version 无输出，安装可能不完整"));
    }
    Ok(crate::commands::compile::parse_version_line(first).unwrap_or_else(|| first.to_string()))
}

/// 固定安装日志路径（便于失败后排查；解压目录会被删除）
fn stable_install_log(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .local_data_dir()
        .ok()
        .map(|d| d.join("Zetla").join("tex-install.log"))
}

/// 安装器 stdout+stderr 固定日志（只保留最后若干行）
fn stable_install_output_log(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .local_data_dir()
        .ok()
        .map(|d| d.join("Zetla").join("tex-install-output.log"))
}

/// 持久化安装器输出，便于定位 install-tl 非零退出但 install-tl.log 无错误的情况。
fn preserve_installer_output(
    app: &AppHandle,
    lines: &VecDeque<String>,
    status: &std::process::ExitStatus,
) {
    let Some(dest) = stable_install_output_log(app) else {
        return;
    };
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut text = format!(
        "TeX Live installer output (stdout + stderr)\r\nexit: {status}\r\nlines: {}\r\n\r\n",
        lines.len()
    );
    for line in lines {
        text.push_str(line);
        text.push_str("\r\n");
    }
    let _ = std::fs::write(dest, text);
}

/// 把 install-tl 日志复制到固定位置。
/// install-tl 正常会把日志写到 TEXDIR/install-tl.log；早期失败可能只写在解压目录。
fn preserve_install_log(app: &AppHandle, target: &Path, extract_dir: &Path) {
    let Some(dest) = stable_install_log(app) else {
        return;
    };
    let mut candidates = vec![
        target.join("install-tl.log"),
        extract_dir.join("install-tl.log"),
    ];
    for entry in walkdir::WalkDir::new(extract_dir)
        .max_depth(3)
        .follow_links(false)
        .into_iter()
        .flatten()
    {
        if entry.file_type().is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("install-tl.log")
        {
            candidates.push(entry.path().to_path_buf());
        }
    }
    let Some(src) = candidates.into_iter().find(|p| p.is_file()) else {
        return;
    };
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::copy(&src, &dest);
}

/// 写 config.tex + 卸载台账 + 目录标记
fn write_install_records(
    app: &AppHandle,
    target: &Path,
    bin_dir: &Path,
    scheme_label: &str,
) -> Result<(), String> {
    // 1) 应用配置
    let cfg_path = crate::commands::config::config_path(app)?;
    let mut cfg = crate::commands::config::read_config(&cfg_path);
    cfg.tex.distro = Some("texlive".to_string());
    cfg.tex.install_dir = Some(target.to_string_lossy().to_string());
    cfg.tex.engine_bin_dir = Some(bin_dir.to_string_lossy().to_string());
    crate::commands::config::write_config(&cfg_path, &cfg)
        .map_err(|e| format!("写入应用配置失败：{e}"))?;

    // 2) 卸载台账
    let local = app
        .path()
        .local_data_dir()
        .map_err(|e| format!("解析本地数据目录失败：{e}"))?;
    let ledger_dir = local.join("Zetla");
    std::fs::create_dir_all(&ledger_dir).map_err(|e| format!("创建台账目录失败：{e}"))?;
    let ledger = ledger_dir.join("tex-install.txt");
    let content = format!(
        "texdir={}\r\ndistro=texlive\r\nscheme={}\r\nengineBinDir={}\r\n",
        target.display(),
        scheme_label,
        bin_dir.display()
    );
    std::fs::write(&ledger, content).map_err(|e| format!("写入安装台账失败：{e}"))?;

    // 3) 目录标记
    std::fs::write(
        target.join(".zetla-tex"),
        format!(
            "distro=texlive\nscheme={}\ninstalledAt={}\n",
            scheme_label,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ),
    )
    .map_err(|e| format!("写入安装标记失败：{e}"))?;
    Ok(())
}

fn emit(app: &AppHandle, stage: &str, percent: u32, speed_bps: u64, message: impl Into<String>) {
    emit_mirror(app, stage, percent, speed_bps, message, None);
}

fn emit_mirror(
    app: &AppHandle,
    stage: &str,
    percent: u32,
    speed_bps: u64,
    message: impl Into<String>,
    mirror: Option<&str>,
) {
    let _ = app.emit(
        EV_INSTALL_PROGRESS,
        TexInstallProgress {
            stage: stage.to_string(),
            percent,
            speed_bps,
            message: message.into(),
            mirror: mirror.map(str::to_string),
        },
    );
}

/// 最近 SPEED_WINDOW 个 1 秒采样的算术平均，避免单秒抖动把读数砸到个位数
fn smooth_speed(samples: &mut VecDeque<u64>, instant: u64) -> u64 {
    samples.push_back(instant);
    while samples.len() > SPEED_WINDOW {
        samples.pop_front();
    }
    let sum: u64 = samples.iter().sum();
    sum / samples.len().max(1) as u64
}

/// 推进「连续低速」计时，返回是否已达到换源阈值。
/// 宽限期内（TCP 慢启动）不累计；速度恢复即清零。
fn advance_slow(
    slow_for: &mut Duration,
    tick: Duration,
    elapsed: Duration,
    speed: u64,
    sampled: bool,
) -> bool {
    if sampled && elapsed >= SLOW_SPEED_GRACE && speed < SLOW_SPEED_BPS {
        *slow_for += tick;
    } else {
        *slow_for = Duration::ZERO;
    }
    *slow_for >= SLOW_SPEED_SUSTAIN
}

/// 按测速结果给镜像排序：有速度的按降序，测速失败的保持原始顺序排在后面
fn rank_mirrors(speeds: &[Option<u64>]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..speeds.len()).collect();
    // 避免与 std::sync::atomic::Ordering 冲突，用 sort_by_key 表达「降序」
    order.sort_by_key(|&i| (speeds[i].is_none(), u64::MAX - speeds[i].unwrap_or(0), i));
    order
}

fn fmt_bps(bps: u64) -> String {
    if bps >= 1024 * 1024 {
        format!("{:.1} MB/s", bps as f64 / 1_048_576.0)
    } else {
        format!("{} KB/s", bps / 1024)
    }
}

fn exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.as_std_mut().creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

fn hide_console_cmd(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

fn host_of(url: &str) -> &str {
    url.split("//")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or(url)
}

/// 从安装器 URL 反推同一镜像的 tlnet 仓库地址（作为 install-tl 的 -repository）。
/// 平台归档文件名不同，统一走这里避免漏改。
fn repo_base_from(url: &str) -> String {
    url.trim_end_matches(INSTALLER_NAME)
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_scheme() {
        assert_eq!(TexLiveScheme::from_str("basic"), Some(TexLiveScheme::Basic));
        assert_eq!(
            TexLiveScheme::from_str("scheme-full"),
            Some(TexLiveScheme::Full)
        );
        assert_eq!(TexLiveScheme::from_str("invalid"), None);
    }

    #[test]
    fn generates_profile() {
        let path = std::env::temp_dir().join("zetla-test-profile.txt");
        let target = PathBuf::from(r"C:\Zetla\tex\texlive");
        generate_profile(&path, &target, TexLiveScheme::Basic).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        // basic 用 scheme-custom 显式集合：scheme-basic 不含 xetex，
        // 中文 ctex/fandol 在 collection-langchinese（不会随 collection-xetex 带出）
        assert!(content.contains("selected_scheme scheme-custom"));
        assert!(content.contains("collection-basic 1"));
        assert!(content.contains("collection-latex 1"));
        assert!(content.contains("collection-xetex 1"));
        assert!(content.contains("collection-langchinese 1"));
        // 路径统一为正斜杠，避免 TeX Live 把反斜杠当转义
        assert!(content.contains("TEXDIR C:/Zetla/tex/texlive"));
        // 不指定 binary_*，交给 install-tl 按当前机器选平台
        assert!(!content.contains("binary_"));
        // 不能修改系统 PATH / 仓库配置
        assert!(content.contains("instopt_adjustpath 0"));
        assert!(content.contains("instopt_adjustrepo 0"));
        // 不含已废弃/非法键
        assert!(!content.contains("tlpdbopt_generate_fmtfiles"));

        generate_profile(&path, &target, TexLiveScheme::Full).unwrap();
        let full = std::fs::read_to_string(&path).unwrap();
        assert!(full.contains("selected_scheme scheme-full"));
        assert!(!full.contains("collection-xetex"));
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(windows)]
    #[test]
    fn locates_windows_bundled_perl() {
        let base = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "installer-{}-{}",
            std::process::id(),
            unique()
        ));
        let root = base.join("install-tl-2026");
        let perl_bin = root.join("tlpkg").join("tlperl").join("bin");
        std::fs::create_dir_all(&perl_bin).unwrap();
        std::fs::write(root.join("install-tl"), b"").unwrap();
        std::fs::write(perl_bin.join(exe_name("perl")), b"").unwrap();

        let got = locate_installer(&base).unwrap();
        assert_eq!(got.root, root);
        assert!(got.perl.is_file());
        assert!(got.script.is_file());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(not(windows))]
    #[test]
    fn uses_system_perl_on_unix() {
        // Unix 不依赖 tlperl：install-tl 存在、tlperl 缺失时，应能回退到系统 perl
        let base = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "installer-{}-{}",
            std::process::id(),
            unique()
        ));
        let root = base.join("install-tl-2026");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("install-tl"), b"").unwrap();

        match locate_installer(&base) {
            Ok(got) => {
                // 系统 perl 存在：perl 路径指向系统 perl，而非 tlperl
                assert!(got.perl.is_file());
                assert!(!got.perl.to_string_lossy().contains("tlperl"));
            }
            Err(e) => {
                // 系统 perl 缺失：给出明确含 "Perl" 的提示
                assert!(e.contains("Perl"), "unexpected error: {e}");
            }
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn finds_texlive_bin_layout() {
        let root = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "bin-{}-{}",
            std::process::id(),
            unique()
        ));
        let bin = root.join("bin").join("windows");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(exe_name("xelatex")), b"").unwrap();
        let engine = find_install_engine(&root).unwrap();
        assert_eq!(engine.name, "xelatex");
        assert_eq!(engine.bin_dir, bin);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn finds_unix_arch_engine() {
        let root = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "arch-{}-{}",
            std::process::id(),
            unique()
        ));
        let bin = root.join("bin").join("x86_64-linux");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(exe_name("xelatex")), b"").unwrap();
        let engine = find_install_engine(&root).unwrap();
        assert_eq!(engine.name, "xelatex");
        assert_eq!(engine.bin_dir, bin);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn falls_back_to_pdflatex_when_xelatex_missing() {
        let root = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "bin-pdf-{}-{}",
            std::process::id(),
            unique()
        ));
        let bin = root.join("bin").join("windows");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(exe_name("pdflatex")), b"").unwrap();
        let engine = find_install_engine(&root).unwrap();
        assert_eq!(engine.name, "pdflatex");
        assert_eq!(engine.bin_dir, bin);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn infers_texlive_root_from_bin_dir() {
        let root = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "root-{}-{}",
            std::process::id(),
            unique()
        ));
        let bin_windows = root.join("bin").join("windows");
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin_windows).unwrap();
        std::fs::create_dir_all(root.join("tlpkg")).unwrap();
        std::fs::create_dir_all(root.join("texmf-dist")).unwrap();

        assert_eq!(infer_texlive_root(&root, &bin_windows), root);
        assert_eq!(infer_texlive_root(&bin_windows, &bin_windows), root);
        assert_eq!(infer_texlive_root(&bin, &bin), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_only_on_cancel_or_pre_install_failure() {
        assert!(should_cleanup(
            false,
            &InstallFailure::from("pre".to_string())
        ));
        assert!(!should_cleanup(
            false,
            &InstallFailure::post_install("post")
        ));
        assert!(should_cleanup(true, &InstallFailure::post_install("post")));
    }

    #[test]
    fn smooth_speed_averages_recent_samples() {
        let mut samples = VecDeque::new();
        assert_eq!(smooth_speed(&mut samples, 400_000), 400_000);
        // 单秒掉到 4 KB/s 不会把读数砸到个位数
        assert_eq!(smooth_speed(&mut samples, 4_096), 202_048);
        assert_eq!(smooth_speed(&mut samples, 400_000), 268_032);
        // 窗口只保留最近 SPEED_WINDOW 个采样
        for _ in 0..SPEED_WINDOW + 3 {
            smooth_speed(&mut samples, 100_000);
        }
        assert_eq!(samples.len(), SPEED_WINDOW);
        assert_eq!(smooth_speed(&mut samples, 100_000), 100_000);
    }

    #[test]
    fn slow_switch_needs_grace_and_sustained_low_speed() {
        let mut slow_for = Duration::ZERO;
        let tick = Duration::from_secs(1);
        // 宽限期内不累计（TCP 慢启动；第 GRACE 秒起才参与判定）
        for sec in 1..SLOW_SPEED_GRACE.as_secs() {
            assert!(!advance_slow(
                &mut slow_for,
                tick,
                Duration::from_secs(sec),
                4_096,
                true,
            ));
        }
        assert_eq!(slow_for, Duration::ZERO);
        // 宽限期后连续低速，累计到阈值才触发
        let mut triggered = false;
        for sec in SLOW_SPEED_GRACE.as_secs()..SLOW_SPEED_GRACE.as_secs() + 12 {
            triggered = advance_slow(
                &mut slow_for,
                tick,
                Duration::from_secs(sec),
                4_096,
                true,
            );
            if triggered {
                break;
            }
        }
        assert!(triggered);
        assert!(slow_for >= SLOW_SPEED_SUSTAIN);
        // 速度恢复即清零
        let mut recovered = Duration::from_secs(30);
        assert!(!advance_slow(
            &mut recovered,
            tick,
            Duration::from_secs(30),
            700_000,
            true,
        ));
        assert_eq!(recovered, Duration::ZERO);
    }

    #[test]
    fn rank_mirrors_puts_fastest_first_and_keeps_failed_last() {
        let order = rank_mirrors(&[Some(200_000), Some(700_000), Some(400_000)]);
        assert_eq!(order, vec![1, 2, 0]);
        // 测速失败的排末尾，且保持原始相对顺序
        let order = rank_mirrors(&[None, Some(100_000), None]);
        assert_eq!(order, vec![1, 0, 2]);
        // 全部失败时退回默认顺序
        assert_eq!(rank_mirrors(&[None, None, None]), vec![0, 1, 2]);
    }

    #[test]
    fn formats_download_speed() {
        assert_eq!(fmt_bps(0), "0 KB/s");
        assert_eq!(fmt_bps(4_096), "4 KB/s");
        assert_eq!(fmt_bps(726_953), "709 KB/s");
        assert_eq!(fmt_bps(1_572_864), "1.5 MB/s");
    }

    #[test]
    fn host_of_extracts_mirror_host() {
        assert_eq!(
            host_of(TEXLIVE_INSTALLER_URLS[0]),
            "mirrors.tuna.tsinghua.edu.cn"
        );
        assert_eq!(host_of(TEXLIVE_INSTALLER_URLS[2]), "mirror.ctan.org");
    }

    #[test]
    fn platform_installer_urls_match_archive_and_repo_base() {
        for url in TEXLIVE_INSTALLER_URLS {
            assert!(url.ends_with(INSTALLER_NAME), "URL 与归档名不一致：{url}");
            let repo = repo_base_from(url);
            assert!(repo.ends_with("/tlnet"), "仓库地址反推错误：{repo}");
            assert!(!repo.contains(INSTALLER_NAME));
        }
        // 完整性下限必须小于实测包体：zip ≈25 MB、tar.gz ≈5.03 MB（5,279,426 B）
        if cfg!(windows) {
            assert_eq!(INSTALLER_NAME, "install-tl.zip");
            assert!(MIN_INSTALLER_BYTES < 25 * 1024 * 1024);
        } else {
            assert_eq!(INSTALLER_NAME, "install-tl-unx.tar.gz");
            assert!(MIN_INSTALLER_BYTES < 5_279_426);
        }
    }

    /// 构造最小 install-tl-unx.tar.gz：顶层带版本号目录，内含 0755 的 install-tl 脚本
    fn write_test_tar_gz(path: &Path) {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        let file = std::fs::File::create(path).unwrap();
        let mut builder = tar::Builder::new(GzEncoder::new(file, Compression::default()));
        let body = b"#!/usr/bin/env perl\nprint \"install-tl\\n\";\n";
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, "install-tl-2026/install-tl", &body[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    fn extracts_unix_tar_gz_and_preserves_exec_bit() {
        let base = std::env::temp_dir().join("zetla-env-tests").join(format!(
            "targz-{}-{}",
            std::process::id(),
            unique()
        ));
        std::fs::create_dir_all(&base).unwrap();
        let archive = base.join("install-tl-unx.tar.gz");
        let dest = base.join("installer");
        write_test_tar_gz(&archive);

        extract_install_tl_tar_gz(&archive, &dest).unwrap();
        let script = dest.join("install-tl-2026").join("install-tl");
        assert!(script.is_file(), "tar.gz 解压后未找到 install-tl");
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&script).unwrap().permissions().mode();
            assert!(mode & 0o111 != 0, "可执行位丢失：{mode:o}");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    fn unique() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    }
}
