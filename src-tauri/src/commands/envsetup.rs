// M0-15b/c · TeX Live 自动安装（Profile 静默安装）
// 下载 install-tl.zip（自带 tlpkg/tlperl）→ 解压 → 用自带 perl 跑 install-tl -no-gui -no-interaction -profile
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

/// TeX Live 镜像（install-tl.zip 完整 URL；zip 内自带 tlpkg/tlperl，无需系统 Perl）
/// 注意：install-tl-windows.exe 是 GUI 包装器，不转发命令行参数，不能用于静默安装
const TEXLIVE_INSTALLER_URLS: [&str; 3] = [
    "https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet/install-tl.zip",
    "https://mirrors.aliyun.com/CTAN/systems/texlive/tlnet/install-tl.zip",
    "https://mirror.ctan.org/systems/texlive/tlnet/install-tl.zip",
];

/// installer 文件名 + 从完整 URL 反推 tlnet 仓库地址用
const INSTALLER_NAME: &str = "install-tl.zip";

/// 安装阶段总超时（安装器自身）
const INSTALL_TIMEOUT: Duration = Duration::from_secs(60 * 60); // 1 小时
/// 下载总超时
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// 安装器输出（stdout+stderr）保留条数：仅用于退出码非零/失败排查
const INSTALLER_OUTPUT_TAIL: usize = 4000;

const CANCELLED: &str = "cancelled:用户取消";

/// 全局安装状态（P0 单并发，同一时刻只允许一个安装任务）
#[derive(Default)]
pub struct TexInstallState {
    busy: AtomicBool,
    cancelled: AtomicBool,
    /// 当前安装器 / 配置子进程（取消时取走并杀进程树）
    child: Mutex<Option<Child>>,
    /// 取消时唤醒正在等待网络的下载任务
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

/// 解析并校验安装目录：空=默认 %LOCALAPPDATA%\Zetla\tex\texlive
fn resolve_install_dir(app: &AppHandle, input: Option<String>) -> Result<InstallTarget, String> {
    let path = match input
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(s) => PathBuf::from(s),
        None => app
            .path()
            .local_data_dir()
            .map_err(|e| format!("解析本地数据目录失败：{e}"))?
            .join("Zetla")
            .join("tex")
            .join("texlive"),
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

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| format!("初始化下载客户端失败：{e}"))?;

    // 1) 下载 install-tl.zip（逐个镜像尝试；不做 HEAD 预检，部分镜像站对 HEAD 返回 403）
    let temp_dir = std::env::temp_dir().join("zetla-texlive-download");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
    let zip_path = temp_dir.join(INSTALLER_NAME);
    let extract_dir = temp_dir.join("installer");
    // 清掉上一次的残留
    let _ = std::fs::remove_file(&zip_path);
    let _ = std::fs::remove_dir_all(&extract_dir);

    let mut last_err = String::new();
    let mut repo_base: Option<String> = None;
    for url in TEXLIVE_INSTALLER_URLS {
        if st.cancelled.load(Ordering::SeqCst) {
            return Err(InstallFailure::cancelled());
        }
        emit(
            app,
            "download",
            8,
            0,
            format!(
                "正在从 {} 下载 {}（约 25 MB）…",
                host_of(url),
                INSTALLER_NAME
            ),
        );
        match download_installer(&client, app, st, url, &zip_path).await {
            Ok(()) => {
                // 仓库地址 = URL 去掉 installer 文件名（同一镜像的 tlnet 目录）
                repo_base = Some(
                    url.trim_end_matches(INSTALLER_NAME)
                        .trim_end_matches('/')
                        .to_string(),
                );
                break;
            }
            Err(e) if e == CANCELLED => {
                let _ = std::fs::remove_file(&zip_path);
                return Err(InstallFailure::cancelled());
            }
            Err(e) => {
                last_err = e;
                let _ = std::fs::remove_file(&zip_path);
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
        let _ = std::fs::remove_file(&zip_path);
        return Err(InstallFailure::cancelled());
    }

    // 2) 解压（zip 内含 TeX Live 专用 perl：tlpkg/tlperl）
    emit(app, "download", 15, 0, "正在解压安装器…");
    extract_install_tl_zip(&zip_path, &extract_dir)?;
    let _ = std::fs::remove_file(&zip_path);

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

    // 3) 生成 profile 文件
    emit(app, "install", 20, 0, "正在生成安装配置…");
    let profile_path = temp_dir.join("texlive.profile");
    if let Err(e) = generate_profile(&profile_path, target, scheme) {
        remove_dir_all_retry(&extract_dir);
        return Err(e.into());
    }

    // 4) 静默安装：直接调用自带 perl 跑 install-tl
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

    // 5) 校验安装：优先 xelatex，缺失时退 pdflatex/lualatex，不再硬绑 xelatex
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

    // 6) 写配置 / 台账 / 标记
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

/// 下载 install-tl.zip（直接 GET；部分镜像站对 HEAD 返回 403，故不做预检）
async fn download_installer(
    client: &reqwest::Client,
    app: &AppHandle,
    st: &Arc<TexInstallState>,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    if st.cancelled.load(Ordering::SeqCst) {
        return Err(CANCELLED.to_string());
    }
    let mut resp = tokio::select! {
        r = client.get(url).send() => r.map_err(|e| format!("连接镜像失败：{e}"))?,
        _ = st.cancel.notified() => return Err(CANCELLED.to_string()),
    };
    if !resp.status().is_success() {
        return Err(format!("镜像返回 HTTP {}", resp.status()));
    }
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("创建安装包文件失败：{e}"))?;

    let mut downloaded: u64 = 0;
    let mut window_bytes: u64 = 0;
    let mut window_start = Instant::now();
    let mut speed: u64 = 0;
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    loop {
        if st.cancelled.load(Ordering::SeqCst) {
            let _ = tokio::fs::remove_file(dest).await;
            return Err(CANCELLED.to_string());
        }
        let chunk = tokio::select! {
            c = resp.chunk() => c.map_err(|e| format!("下载中断：{e}"))?,
            _ = st.cancel.notified() => {
                let _ = tokio::fs::remove_file(dest).await;
                return Err(CANCELLED.to_string());
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
            speed = (window_bytes as f64 / window_start.elapsed().as_secs_f64()) as u64;
            window_bytes = 0;
            window_start = now;
        }
        if last_emit.elapsed() >= Duration::from_millis(300) {
            last_emit = now;
            let pct = total
                .filter(|t| *t > 0)
                .map(|t| 8 + ((downloaded.min(t) * 6) / t) as u32)
                .unwrap_or(0);
            emit(
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
            );
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("保存安装包失败：{e}"))?;

    let min_size = 15 * 1024 * 1024; // install-tl.zip 约 25MB，明显偏小视为失败
    if downloaded < min_size {
        let _ = tokio::fs::remove_file(dest).await;
        return Err(format!("安装包不完整（仅 {downloaded} 字节），请重试"));
    }
    emit(
        app,
        "download",
        15,
        speed,
        format!("下载完成 · {:.1} MB", downloaded as f64 / 1_048_576.0),
    );
    Ok(())
}

/// 解压 install-tl.zip
fn extract_install_tl_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("打开安装包失败：{e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取安装包失败：{e}"))?;
    archive
        .extract(dest)
        .map_err(|e| format!("解压安装包失败：{e}"))
}

/// 安装器入口：自带 Perl + install-tl 脚本
struct Installer {
    /// <root>/tlpkg/tlperl/bin/perl.exe
    perl: PathBuf,
    /// <root>/install-tl
    script: PathBuf,
    /// <root>
    root: PathBuf,
}

/// 在解压目录中定位 install-tl（zip 顶层带版本号目录，需递归找）
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
    let perl = root
        .join("tlpkg")
        .join("tlperl")
        .join("bin")
        .join(exe_name("perl"));
    if !perl.is_file() {
        return Err(format!(
            "安装包不完整：未找到 TeX Live 自带 Perl（{}）",
            perl.display()
        ));
    }
    let script = root.join("install-tl");
    if !script.is_file() {
        return Err(format!("安装包不完整：未找到 {}", script.display()));
    }
    Ok(Installer { perl, script, root })
}

/// 生成 TeX Live profile 文件
/// 路径用正斜杠（TeX Live 在 Windows 上同样接受，反斜杠可能被当作转义）；
/// 不写 binary_* 键，让 install-tl 按当前机器自动选择平台（Windows 平台名现为 `windows`）。
///
/// basic 用 scheme-custom + 显式集合：scheme-basic 只有 collection-basic +
/// collection-latex，不含 xetex/ctex。补 collection-xetex 后会带出
/// xetex / ctex / xecjk / fontspec / fandol / zhnumber，xelatex 和中文模板才可用。
fn generate_profile(path: &Path, target: &Path, scheme: TexLiveScheme) -> Result<(), String> {
    let texdir = target.to_string_lossy().replace('\\', "/");
    let collections = match scheme {
        TexLiveScheme::Basic => "collection-basic 1\ncollection-latex 1\ncollection-xetex 1\n",
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
    let script_arg = installer.script.to_string_lossy().to_string();
    let mut cmd = Command::new(&installer.perl);
    cmd.arg(&script_arg)
        .arg("-no-gui")
        .arg("-no-interaction")
        .arg("-profile")
        .arg(&profile_arg)
        .arg("-repository")
        .arg(repo)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 自带 Perl 依赖 PERL5LIB 定位模块；子进程（mktexlsr/fmtutil 等）也可能调用 perl
    let perl_lib = installer.root.join("tlpkg").join("tlperl").join("lib");
    let perl_bin = installer.root.join("tlpkg").join("tlperl").join("bin");
    let mut path_dirs = vec![perl_bin.clone()];
    if let Some(old) = std::env::var_os("PATH") {
        path_dirs.extend(std::env::split_paths(&old));
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
    cmd.env("PERL5LIB", &perl_lib)
        .env_remove("PERL5OPT")
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

/// 找安装目录里的引擎：TeX Live 标准布局为 <TEXDIR>/bin/windows。
/// 优先 xelatex；缺失时退 pdflatex/lualatex，避免把「安装成功但没 xelatex」误判成失败。
fn find_install_engine(root: &Path) -> Option<InstallEngine> {
    let dirs = [
        root.join("bin").join("windows"),
        root.join("bin").join("x64"),
        root.join("bin"),
        root.to_path_buf(),
    ];
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
    let _ = app.emit(
        EV_INSTALL_PROGRESS,
        TexInstallProgress {
            stage: stage.to_string(),
            percent,
            speed_bps,
            message: message.into(),
        },
    );
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
        // basic 用 scheme-custom 显式集合：scheme-basic 不含 xetex/ctex
        assert!(content.contains("selected_scheme scheme-custom"));
        assert!(content.contains("collection-basic 1"));
        assert!(content.contains("collection-latex 1"));
        assert!(content.contains("collection-xetex 1"));
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

    #[test]
    fn locates_bundled_perl() {
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

    fn unique() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    }
}
