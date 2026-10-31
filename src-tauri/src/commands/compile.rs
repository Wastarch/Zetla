// 编译引擎管理（开发文档 §3.3 / docs/开发计划.md M0-3/9/10/11）
// M0-3a：发行版检测（PATH + 常见安装目录探测、版本解析）
// M0-9：多遍编译（latexmk 优先 / 手写兜底管线、进度事件、取消）
// M1-3：自定义编译流程（steps 非空时绕过 latexmk，按步骤序列直跑：
// latex=引擎一遍、bibtex/biber=参考文献工具，如 LaTeX → BibTeX → LaTeX → LaTeX）
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::mpsc;
use which::which;

use crate::commands::logparse::{parse_log_text, parse_run_number};

/// 发行版检测结果（与 src/types/compile.ts TexDistInfo 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexDistInfo {
    /// 是否检测到可用发行版（任一引擎存在即 true）
    pub found: bool,
    /// 发行版名称："MiKTeX" / "TeX Live" / "None" / "Unknown"
    pub distribution: String,
    /// 版本号（取主引擎 --version 首行解析）
    pub version: Option<String>,
    /// 检测到的可执行引擎（含完整路径）
    pub engines: Vec<String>,
    /// 推荐引擎（默认 xelatex）
    pub recommended: String,
    /// M0-15b/c：Perl 运行时（TeX Live 自带）
    pub perl: crate::commands::perl::PerlInfo,
}

/// 需探测的引擎（按优先级）
const ENGINE_CANDIDATES: [&str; 4] = ["xelatex", "pdflatex", "lualatex", "latexmk"];

/// 引擎可执行文件名（Windows 带 .exe）
fn engine_exe_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// 在给定目录列表中找引擎；全部落空才回退进程 PATH（which）
///
/// 目录优先级由调用方保证：受管目录（config.tex）→ 注册表 PATH → 进程 PATH。
/// 这样「Zetla 代装完成 / 用户手动装而进程 PATH 未刷新」时，无需重启就能检测到。
fn find_engine(name: &str, search_dirs: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    let exe = engine_exe_name(name);
    for dir in search_dirs {
        let candidate = dir.join(&exe);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Ok(p) = which(name) {
        return Some(p);
    }
    None
}

/// 分隔 PATH 文本（Windows `;`）为目录列表（去引号/空白/重复）
pub(crate) fn split_path_list(s: &str) -> Vec<std::path::PathBuf> {
    let sep = if cfg!(windows) { ';' } else { ':' };
    let mut out: Vec<std::path::PathBuf> = Vec::new();
    for raw in s.split(sep) {
        let trimmed = raw.trim().trim_matches('"').trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = std::path::PathBuf::from(trimmed);
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// Windows：读注册表里的用户 / 系统 PATH（只读不改；进程 PATH 未刷新时用）
#[cfg(windows)]
pub(crate) fn registry_path_dirs() -> Vec<std::path::PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let mut out = Vec::new();
    let read = |root: &RegKey, sub: &str| -> Option<String> {
        root.open_subkey(sub)
            .ok()?
            .get_value::<String, _>("Path")
            .ok()
    };
    if let Some(v) = read(&RegKey::predef(HKEY_CURRENT_USER), "Environment") {
        out.extend(split_path_list(&v));
    }
    if let Some(v) = read(
        &RegKey::predef(HKEY_LOCAL_MACHINE),
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    ) {
        out.extend(split_path_list(&v));
    }
    out
}

#[cfg(not(windows))]
pub(crate) fn registry_path_dirs() -> Vec<std::path::PathBuf> {
    Vec::new()
}

/// 引擎搜索目录（优先级序）：受管目录（config.tex）→ 注册表 PATH → 进程 PATH
fn engine_search_dirs(app: Option<&tauri::AppHandle>) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(app) = app {
        let path = crate::commands::config::config_path(app).unwrap_or_default();
        let cfg = crate::commands::config::read_config(&path);
        if let Some(bin) = &cfg.tex.engine_bin_dir {
            let base = std::path::PathBuf::from(bin);
            dirs.push(base.clone());
            // 兼容用户手动选择 TeX 安装根目录（而不是 bin\windows）的情况
            for sub in [r"bin\windows", r"bin\x64", r"bin"] {
                dirs.push(base.join(sub));
            }
        }
        if let Some(install) = &cfg.tex.install_dir {
            // engineBinDir 缺省时扫 install_dir 的常见 bin 布局（TeX Live 优先）
            for sub in [r"bin\windows", r"bin\x64", r"bin", ""] {
                let candidate = std::path::PathBuf::from(install).join(sub);
                dirs.push(candidate);
            }
            // TeX Live 自带 Perl（latexmk 需要，同时注入子进程 PATH）
            dirs.push(
                std::path::PathBuf::from(install)
                    .join("tlpkg")
                    .join("tlperl")
                    .join("bin"),
            );
        }
    }
    dirs.extend(registry_path_dirs());
    dirs.dedup();
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

/// 探测 TeX 发行版与引擎（Tauri command）
#[tauri::command]
pub fn detect_tex_distribution(app: tauri::AppHandle) -> TexDistInfo {
    // 冒烟逃生口（仅 debug 构建生效）：ZETLA_FORCE_NO_TEX=1 模拟未安装
    if cfg!(debug_assertions) && std::env::var("ZETLA_FORCE_NO_TEX").ok().as_deref() == Some("1") {
        return TexDistInfo {
            found: false,
            distribution: "None".to_string(),
            version: None,
            engines: Vec::new(),
            recommended: "xelatex".to_string(),
            perl: crate::commands::perl::PerlInfo::missing(),
        };
    }
    let search_dirs = engine_search_dirs(Some(&app));
    let mut info = detect_tex_distribution_in(&search_dirs);
    info.perl = crate::commands::perl::detect_perl(Some(&app));
    info
}

/// 检测核心（纯函数；app 相关的搜索目录由调用方传入）
/// 执行 `<exe> --version` 并取首行（超时 5s 兜底为 None）
fn probe_version(exe: &std::path::Path) -> Option<String> {
    let output = std::process::Command::new(exe)
        .arg("--version")
        // 不弹黑框（Windows）
        .hide_console()
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().next().map(|s| s.trim().to_string())
}

/// 从 `--version` 首行解析用户可读的版本串（M0-15a 冒烟反馈：
/// 此前展示引擎版本号 `3.141592653-…`，改为优先取括号里的发行版标记；
/// 只留版本号本身（发行版名由 UI 拼接，避免「TeX Live · TeX Live 2025」重复））
/// `XeTeX 3.141592653-2.6-0.999996 (TeX Live 2025)` → "2025"
/// `XeTeX 3.141592653-2.6-0.999996 (MiKTeX 25.1)` → "25.1"
pub(crate) fn parse_version_line(line: &str) -> Option<String> {
    for (mark, prefix) in [("(TeX Live ", "TeX Live "), ("(MiKTeX ", "MiKTeX ")] {
        if let Some(i) = line.find(mark) {
            let t = &line[i + 1..];
            let end = t.find(')').unwrap_or(t.len());
            let v = t[..end]
                .trim()
                .strip_prefix(prefix)
                .unwrap_or(t[..end].trim());
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    // 兜底：取首个连续数字段到第一个括号前（旧逻辑，"MiKTeX-mt 25.1" 等）
    let start = line.find(char::is_numeric)?;
    let tail = &line[start..];
    let end = tail
        .find("(TeX")
        .or_else(|| tail.find('('))
        .unwrap_or(tail.len());
    Some(tail[..end].trim().to_string())
}

/// Windows：子进程不弹控制台窗口；其他平台恒等返回
#[cfg(windows)]
pub(crate) trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl HideConsole for std::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW
        self.creation_flags(0x0800_0000);
        self
    }
}

#[cfg(not(windows))]
pub(crate) trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(not(windows))]
impl HideConsole for std::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

fn detect_tex_distribution_in(search_dirs: &[std::path::PathBuf]) -> TexDistInfo {
    let mut engines: Vec<String> = Vec::new();
    let mut found_paths: Vec<(&str, std::path::PathBuf)> = Vec::new();

    for name in ENGINE_CANDIDATES {
        if let Some(p) = find_engine(name, search_dirs) {
            engines.push(name.to_string());
            found_paths.push((name, p));
        }
    }

    let found = !engines.is_empty();

    // 版本：优先 xelatex，其次 pdflatex，再次 lualatex
    let version = ["xelatex", "pdflatex", "lualatex"]
        .iter()
        .find_map(|want| found_paths.iter().find(|(n, _)| n == want).map(|(_, p)| p))
        .and_then(|p| probe_version(p))
        .and_then(|line| parse_version_line(&line));

    // 发行版判定：安装目录含 MiKTeX → MiKTeX；含 texlive → TeX Live；有引擎但无法判定 → Unknown
    let distribution = if !found {
        "None".to_string()
    } else {
        let all_paths = found_paths
            .iter()
            .map(|(_, p)| p.to_string_lossy().to_lowercase())
            .collect::<String>();
        if all_paths.contains("miktex") {
            "MiKTeX".to_string()
        } else if all_paths.contains("texlive") {
            "TeX Live".to_string()
        } else {
            "Unknown".to_string()
        }
    };

    TexDistInfo {
        found,
        distribution,
        version,
        engines,
        recommended: "xelatex".to_string(),
        perl: crate::commands::perl::PerlInfo::missing(),
    }
}

// ─────────────────────────────────────────────────────────────
// M0-9 多遍编译
// ─────────────────────────────────────────────────────────────

/// 结构化编译错误（与 src/types/compile.ts TexError 对齐；M0-11 开始填充）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexError {
    pub file: String,
    pub line: u32,
    /// "error" | "warning"（交叉引用未定义等算 warning）
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    pub raw: String,
    pub readable: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// 编译结果（与 src/types/compile.ts CompileResult 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    /// "ok" | "error" | "cancelled"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pdf_path: Option<String>,
    pub errors: Vec<TexError>,
    /// 本次编译日志路径（存在才返回；前端「查看日志文件」用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    /// 实际调用编译器的次数
    pub passes: u32,
    pub duration_ms: u64,
}

/// 编译进度事件负载（与 src/types/compile.ts CompileProgress 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileProgress {
    /// prepare / running / done
    pub stage: String,
    /// 0–100（P0 不做百分比，固定 0）
    pub pct: u32,
    /// 当前动作描述；running 阶段为编译器输出的原始行
    pub current: String,
}

/// 事件名（必须与 src/ipc/events.ts RustEvents 一致）
pub const EV_PROGRESS: &str = "compile_progress";
pub const EV_FINISHED: &str = "compile_finished";

/// 槽位里的子进程：记录它属于哪个任务（代号）。
/// 只有「代号匹配」的任务才允许对它 try_wait / kill，
/// 避免旧任务收尾时误杀新任务的 latexmk（latest-wins 的核心安全线）。
struct SlotChild {
    seq: u64,
    child: Child,
}

/// 全局编译状态（M1-18b：latest-wins —— 同一时刻仍只有一个活任务，但新任务会顶掉旧任务）
#[derive(Default)]
pub struct CompileState {
    /// 任务代号自增器（每次 compile_project +1；0 保留给「空闲」，故从 1 起）
    next_seq: AtomicU64,
    /// 当前有效任务代号（0 = 空闲）；被顶替 = 与自己的代号不再相等
    running: AtomicU64,
    /// 被用户显式取消的任务代号（0 = 无）
    cancel_seq: AtomicU64,
    /// 当前子进程句柄（取消 / 被顶替时取走并 kill）
    child: Mutex<Option<SlotChild>>,
}

impl CompileState {
    /// 该任务是否已被更新的编译顶替
    fn is_stale(&self, seq: u64) -> bool {
        self.running.load(Ordering::SeqCst) != seq
    }

    /// 该任务是否应停止：用户取消 或 已被顶替
    fn is_cancelled(&self, seq: u64) -> bool {
        self.cancel_seq.load(Ordering::SeqCst) == seq || self.is_stale(seq)
    }

    /// 取走槽内子进程；`only_seq=Some(s)` 时仅在代号匹配时取走
    fn take_child(&self, only_seq: Option<u64>) -> Option<SlotChild> {
        let mut guard = self.child.lock().ok()?;
        match guard.as_ref() {
            Some(c) if only_seq.map_or(true, |s| c.seq == s) => guard.take(),
            _ => None,
        }
    }
}

/// 单个任务的私有副作用（不进全局状态，避免并发任务互相污染）
struct JobSig {
    seq: u64,
    /// latexmk 输出的最大 `Run number N`（用于统计真实遍数）
    rule_runs: AtomicU32,
}

impl JobSig {
    fn new(seq: u64) -> Self {
        JobSig {
            seq,
            rule_runs: AtomicU32::new(0),
        }
    }
}

/// 单条命令的执行结果
enum CmdOutcome {
    Ok,
    Failed,
    Cancelled,
    SpawnError(String),
}

struct Job {
    root: PathBuf,
    main: PathBuf,
    engine: String,
    /// M1-3：固定流程步骤序列（空=自动 latexmk；非空=按序直跑，见 config::BUILD_STEPS）
    steps: Vec<String>,
    /// 引擎搜索目录（受管/注册表），find_engine 与子进程 PATH 注入共用
    search_dirs: Vec<PathBuf>,
}

/// 杀掉子进程树：latexmk 会再拉起 xelatex/perl，只 kill 父进程会留下孤儿进程
pub(crate) fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        if let Some(pid) = child.id() {
            // /T 连子进程一起结束；/F 强制
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .hide_console()
                .output();
        }
    }
    let _ = child.start_kill();
}

/// 引擎 → latexmk 驱动参数
fn latexmk_flag(engine: &str) -> &'static str {
    match engine {
        "pdflatex" => "-pdf",
        "lualatex" => "-lualatex",
        _ => "-xelatex",
    }
}

/// 推一条进度事件（失败不致命）
fn emit_progress(app: &AppHandle, stage: &str, pct: u32, current: impl Into<String>) {
    let _ = app.emit(
        EV_PROGRESS,
        CompileProgress {
            stage: stage.to_string(),
            pct,
            current: current.into(),
        },
    );
}

/// 开始编译（立即返回；实际编译在后台任务里跑，事件回传前端）
/// M1-3：engine 缺省 xelatex；steps 空=自动（latexmk 判定），非空=按序直跑的固定流程
/// M1-18b：latest-wins —— 若已有任务在跑，不报错，而是直接顶掉（杀子进程树、旧任务静默退出），
///        保证实时预览「重叠触发总是落到最新内容」且不出现「已有编译任务在进行中」。
#[tauri::command]
pub async fn compile_project(
    app: AppHandle,
    state: State<'_, Arc<CompileState>>,
    root: String,
    main_file: String,
    engine: Option<String>,
    steps: Option<Vec<String>>,
) -> Result<(), String> {
    let st = state.inner().clone();

    // 领新代号并抢占「当前任务」位：swap 之后旧任务立刻变成 stale（它会在下个检查点退出）
    let seq = st.next_seq.fetch_add(1, Ordering::SeqCst) + 1;
    let prev = st.running.swap(seq, Ordering::SeqCst);
    // 新一轮的取消标记清零（否则上一轮"用户取消"会误伤新任务）
    st.cancel_seq.store(0, Ordering::SeqCst);

    if prev != 0 {
        // latest-wins：顶掉旧任务——杀它的子进程树（旧任务自身发现 stale 后静默收尾）
        // 只杀「上一个任务」的子进程：若槽里已是更新任务的（并发极窄窗口），留给它自己
        if let Some(mut c) = st.take_child(Some(prev)) {
            kill_tree(&mut c.child);
        }
    }

    let sig = JobSig::new(seq);
    let job = Job {
        root: PathBuf::from(root),
        main: PathBuf::from(main_file),
        engine: engine.unwrap_or_else(|| "xelatex".to_string()),
        // 归一化与 Rust 配置同源：剔非法步骤、超限截断（防呆，前端已保证合法）
        steps: crate::commands::config::normalize_build_steps(steps.unwrap_or_default()),
        search_dirs: engine_search_dirs(Some(&app)),
    };

    if !job.main.is_file() {
        // 只有仍是当前任务时才归还 slot（可能已被更快的一次调用顶替）
        let _ = st
            .running
            .compare_exchange(seq, 0, Ordering::SeqCst, Ordering::SeqCst);
        return Err(format!("主文件不存在：{}", job.main.display()));
    }

    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let result = run_job(&app, &st, &job, started, &sig).await;

        // 收尾：只有「仍是当前任务」才清场并回传结果。
        // 被顶替的任务一律静默退出——既不 emit finished（否则会覆盖新任务的状态），
        // 也不动全局 slot（里面的子进程已属于新任务）。
        if st
            .running
            .compare_exchange(seq, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            if let Some(mut c) = st.take_child(Some(seq)) {
                kill_tree(&mut c.child);
            }
            let _ = app.emit(EV_FINISHED, result);
        }
    });

    Ok(())
}

/// 取消当前编译（杀掉子进程；没有任务时报错）
#[tauri::command]
pub fn cancel_compile(state: State<'_, Arc<CompileState>>) -> Result<(), String> {
    let st = state.inner();
    let seq = st.running.load(Ordering::SeqCst);
    if seq == 0 {
        return Err("当前没有编译任务".to_string());
    }
    st.cancel_seq.store(seq, Ordering::SeqCst);
    if let Some(mut c) = st.take_child(Some(seq)) {
        kill_tree(&mut c.child);
    }
    Ok(())
}

/// 执行完整编译流程，返回最终结果
async fn run_job(
    app: &AppHandle,
    st: &Arc<CompileState>,
    job: &Job,
    started: Instant,
    sig: &JobSig,
) -> CompileResult {
    // 产物与 main.tex 同目录（用户定稿：不设 -output-directory）
    let dir = job
        .main
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| job.root.clone());
    let main_name = job
        .main
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = job
        .main
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let pdf = dir.join(format!("{stem}.pdf"));
    let log = dir.join(format!("{stem}.log"));
    // 编译前记录产物 / 日志 mtime：失败时目录里可能残留上一次的结果
    let pdf_mtime_before = std::fs::metadata(&pdf).and_then(|m| m.modified()).ok();
    let log_mtime_before = std::fs::metadata(&log).and_then(|m| m.modified()).ok();

    emit_progress(app, "prepare", 0, format!("准备编译 · {main_name}"));

    let mut passes: u32 = 0;
    let mut failed = false;
    let mut cancelled = false;

    // latexmk 是 Perl 脚本：没有可用 Perl 时不要硬跑，直接走引擎自带管线
    let latexmk = find_engine("latexmk", &job.search_dirs);
    // 没有 latexmk 就不必探测 Perl；只有准备走 latexmk 时才做 smoke
    let perl_ok = latexmk.is_none()
        || crate::commands::perl::find_working_perl_in(&job.search_dirs).is_some();
    // M1-3：自定义固定流程时绕过 latexmk（它自行判定遍数、无法指定），按 steps 直跑
    let use_latexmk = job.steps.is_empty() && latexmk.is_some() && perl_ok;

    // 引擎直跑参数（固定遍数分支与兜底管线共用）
    let tex_args = |name: &str| {
        vec![
            "-synctex=1".to_string(),
            "-interaction=nonstopmode".to_string(),
            "-file-line-error".to_string(),
            name.to_string(),
        ]
    };

    if !job.steps.is_empty() {
        // M1-3：自定义固定流程（如 LaTeX → BibTeX → LaTeX → LaTeX），绕过 latexmk 按序直跑
        let total = job.steps.len();
        for (i, step) in job.steps.iter().enumerate() {
            if cancelled || st.is_cancelled(sig.seq) {
                cancelled = true;
                break;
            }
            let pos = i + 1;
            match step.as_str() {
                "latex" => match find_engine(&job.engine, &job.search_dirs) {
                    Some(exe) => {
                        passes += 1;
                        emit_progress(
                            app,
                            "running",
                            0,
                            format!("{} · 第 {pos}/{total} 步（LaTeX）", job.engine),
                        );
                        match run_cmd(app, st, sig, &exe, &tex_args(&main_name), &dir, &job.search_dirs)
                            .await
                        {
                            CmdOutcome::Ok => {}
                            CmdOutcome::Failed => failed = true,
                            CmdOutcome::Cancelled => {
                                cancelled = true;
                                break;
                            }
                            CmdOutcome::SpawnError(msg) => {
                                failed = true;
                                emit_progress(app, "running", 0, msg);
                            }
                        }
                    }
                    None => {
                        failed = true;
                        emit_progress(
                            app,
                            "running",
                            0,
                            format!("未找到编译引擎 {}，请检查 TeX 发行版安装", job.engine),
                        );
                        break;
                    }
                },
                // bibtex / biber：用户显式排入流程，但本机没装时不致命——跳过该步骤并提示
                "bibtex" | "biber" => match find_engine(step, &job.search_dirs) {
                    Some(exe) => {
                        emit_progress(
                            app,
                            "running",
                            0,
                            format!("{step} · 处理参考文献（第 {pos}/{total} 步）"),
                        );
                        match run_cmd(app, st, sig, &exe, &[stem.clone()], &dir, &job.search_dirs).await
                        {
                            CmdOutcome::Ok => {}
                            CmdOutcome::Failed => failed = true,
                            CmdOutcome::Cancelled => {
                                cancelled = true;
                                break;
                            }
                            CmdOutcome::SpawnError(msg) => {
                                failed = true;
                                emit_progress(app, "running", 0, msg);
                            }
                        }
                    }
                    None => {
                        emit_progress(
                            app,
                            "running",
                            0,
                            format!("未找到 {step}，跳过该步骤（第 {pos}/{total} 步）"),
                        );
                    }
                },
                // 归一化已剔非法步骤；双保险忽略
                _ => {}
            }
        }
    } else if use_latexmk {
        let lmk = latexmk.as_ref().expect("latexmk checked above");
        // 首选 latexmk：交叉引用 / 参考文献 / 多遍由它自己调度
        passes += 1;
        let args = vec![
            latexmk_flag(&job.engine).to_string(),
            "-synctex=1".to_string(),
            "-interaction=nonstopmode".to_string(),
            "-file-line-error".to_string(),
            main_name.clone(),
        ];
        emit_progress(
            app,
            "running",
            0,
            format!("latexmk {}", latexmk_flag(&job.engine)),
        );
        match run_cmd(app, st, sig, lmk, &args, &dir, &job.search_dirs).await {
            CmdOutcome::Ok => {}
            CmdOutcome::Failed => failed = true,
            CmdOutcome::Cancelled => cancelled = true,
            CmdOutcome::SpawnError(msg) => {
                failed = true;
                emit_progress(app, "running", 0, msg);
            }
        }
    } else if let Some(exe) = find_engine(&job.engine, &job.search_dirs) {
        if latexmk.is_some() && !perl_ok {
            emit_progress(
                app,
                "running",
                0,
                "未检测到可用 Perl，跳过 latexmk，改用直接引擎管线",
            );
        }
        // 兜底：引擎自带管线（第 1 遍 → biber（有 .bcf）→ 再两遍收敛）
        passes += 1;
        emit_progress(app, "running", 0, format!("{} · 第 1 遍", job.engine));
        match run_cmd(app, st, sig, &exe, &tex_args(&main_name), &dir, &job.search_dirs).await {
            CmdOutcome::Ok => {}
            CmdOutcome::Failed => failed = true,
            CmdOutcome::Cancelled => cancelled = true,
            CmdOutcome::SpawnError(msg) => {
                failed = true;
                emit_progress(app, "running", 0, msg);
            }
        }

        // 参考文献：biblatex 会写 .bcf
        if !cancelled && dir.join(format!("{stem}.bcf")).is_file() {
            if let Some(biber) = find_engine("biber", &job.search_dirs) {
                emit_progress(app, "running", 0, "biber · 处理参考文献");
                match run_cmd(app, st, sig, &biber, &[stem.clone()], &dir, &job.search_dirs).await {
                    CmdOutcome::Ok => {}
                    CmdOutcome::Failed => failed = true,
                    CmdOutcome::Cancelled => cancelled = true,
                    CmdOutcome::SpawnError(msg) => {
                        failed = true;
                        emit_progress(app, "running", 0, msg);
                    }
                }
            }
        }

        // 再跑两遍，让 \ref / \cite 收敛
        for i in 0..2 {
            if cancelled || st.is_cancelled(sig.seq) {
                cancelled = true;
                break;
            }
            passes += 1;
            emit_progress(
                app,
                "running",
                0,
                format!("{} · 第 {} 遍", job.engine, i + 2),
            );
            match run_cmd(app, st, sig, &exe, &tex_args(&main_name), &dir, &job.search_dirs).await {
                CmdOutcome::Ok => {}
                CmdOutcome::Failed => failed = true,
                CmdOutcome::Cancelled => {
                    cancelled = true;
                    break;
                }
                CmdOutcome::SpawnError(msg) => {
                    failed = true;
                    emit_progress(app, "running", 0, msg);
                }
            }
        }
    } else {
        failed = true;
        emit_progress(
            app,
            "running",
            0,
            format!("未找到编译引擎 {}，请检查 TeX 发行版安装", job.engine),
        );
    }

    cancelled |= st.is_cancelled(sig.seq);
    let pdf_mtime_after = std::fs::metadata(&pdf).and_then(|m| m.modified()).ok();
    // 本轮是否真的重写了产物（mtime 变化 / 从无到有）；命令全成功时放宽，避免低精度文件系统误判
    let pdf_written = match (pdf_mtime_before, pdf_mtime_after) {
        (Some(b), Some(a)) => a != b,
        (None, Some(_)) => true,
        _ => false,
    };
    let pdf_ok = pdf.is_file() && (pdf_written || !failed);
    let status = if cancelled {
        "cancelled"
    } else if failed || !pdf_ok {
        "error"
    } else {
        "ok"
    };

    if !cancelled {
        if pdf_ok {
            emit_progress(
                app,
                "done",
                100,
                format!(
                    "产出 {}",
                    pdf.file_name().unwrap_or_default().to_string_lossy()
                ),
            );
        } else {
            emit_progress(app, "done", 100, "未生成 PDF，请查看日志");
        }
    }

    // M0-11：解析 .log（取消时日志可能写了一半；引擎都没调起来才认为是旧日志）
    // 注意 latexmk 可能因上一轮失败而「Nothing to do」不重写日志，此时日志仍是它报错的依据，照常解析
    let log_mtime_after = std::fs::metadata(&log).and_then(|m| m.modified()).ok();
    let log_written = match (log_mtime_before, log_mtime_after) {
        (Some(b), Some(a)) => a != b,
        (None, Some(_)) => true,
        _ => false,
    };
    let errors = if cancelled || (passes == 0 && !log_written) {
        Vec::new()
    } else {
        std::fs::read(&log)
            .map(|b| parse_log_text(&String::from_utf8_lossy(&b), &dir, &job.main))
            .unwrap_or_default()
    };
    let log_path = log.is_file().then(|| log.to_string_lossy().to_string());
    // latexmk 实际跑了几遍：取输出里的最大 Run number（直跑引擎按调用次数）
    let passes = passes.max(sig.rule_runs.load(Ordering::SeqCst));

    CompileResult {
        status: status.to_string(),
        pdf_path: (status == "ok" && pdf_ok).then(|| pdf.to_string_lossy().to_string()),
        errors,
        log_path,
        passes,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

/// 转发一行编译输出；顺便记录 latexmk 的 `Run number N`（passes 统计）
/// 已被顶替的任务不再转发（避免旧任务的输出污染新任务的日志面板）
fn forward_line(app: &AppHandle, st: &Arc<CompileState>, sig: &JobSig, line: &str) {
    if st.is_stale(sig.seq) {
        return;
    }
    if let Some(n) = parse_run_number(line) {
        sig.rule_runs.fetch_max(n, Ordering::SeqCst);
    }
    if !line.trim().is_empty() {
        emit_progress(app, "running", 0, line);
    }
}

/// 跑一条外部命令：逐行转发输出，返回退出状态
/// `path_dirs` 非空时前置进子进程 PATH（受管 TeX 目录 / 注册表 PATH 目录）
async fn run_cmd(
    app: &AppHandle,
    st: &Arc<CompileState>,
    sig: &JobSig,
    exe: &Path,
    args: &[String],
    cwd: &Path,
    path_dirs: &[PathBuf],
) -> CmdOutcome {
    // 取消可能发生在两条命令之间（尚未 spawn）
    if st.is_cancelled(sig.seq) {
        return CmdOutcome::Cancelled;
    }

    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // M1-19：让 TeX 别把日志按 79 列硬折断。
    // kpathsea 的 max_print_line 默认 79，长路径/长报错会被 TeX 自己插换行写成多行，
    // 面板再宽也只显示半行（.log 文件同样受影响）。这三个值可按环境变量覆盖，
    // 放宽后一行完整输出，实际换行交给面板宽度（CSS soft wrap）决定。
    cmd.env("max_print_line", "10000")
        .env("error_line", "254")
        .env("half_error_line", "238");
    if !path_dirs.is_empty() {
        let mut joined: Vec<PathBuf> = path_dirs.to_vec();
        joined.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        if let Ok(paths) = std::env::join_paths(&joined) {
            cmd.env("PATH", paths);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：避免编译时闪控制台
        cmd.as_std_mut().creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return CmdOutcome::SpawnError(format!("无法启动 {}：{e}", exe.display()));
        }
    };

    // stdout / stderr 合并成一条行流（编译器两边都会写）
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

    // 交给全局状态持有，cancel_compile / 顶替才能 kill。
    // spawn 与登记之间也可能被顶替：先复查一次，避免把过期子进程塞进槽位。
    if st.is_cancelled(sig.seq) {
        let _ = child.start_kill();
        return CmdOutcome::Cancelled;
    }
    match st.child.lock() {
        Ok(mut guard) => {
            if let Some(mut old) = guard.take() {
                // 槽里残留的旧子进程（上一任务被顶替时的极端窗口）：顺手清掉
                kill_tree(&mut old.child);
            }
            *guard = Some(SlotChild {
                seq: sig.seq,
                child,
            });
        }
        Err(_) => return CmdOutcome::Failed,
    }

    loop {
        // 先排空已到达的输出
        while let Ok(line) = rx.try_recv() {
            forward_line(app, st, sig, &line);
        }

        // 每轮复查取消/顶替：可覆盖「spawn 后、登记前被顶替」的窗口，
        // 也保证被顶替后 30ms 内自杀子进程（不让旧编译白跑到底）
        if st.is_cancelled(sig.seq) {
            if let Some(mut c) = st.take_child(Some(sig.seq)) {
                kill_tree(&mut c.child);
            }
            return CmdOutcome::Cancelled;
        }

        let mut finished: Option<bool> = None;
        {
            let Ok(mut guard) = st.child.lock() else {
                return CmdOutcome::Failed;
            };
            match guard.as_mut() {
                // 槽里的子进程不属于本任务 → 已被顶替/取消
                Some(c) if c.seq != sig.seq => return CmdOutcome::Cancelled,
                Some(c) => match c.child.try_wait() {
                    Ok(Some(status)) => {
                        finished = Some(status.success());
                        guard.take();
                    }
                    Ok(None) => {}
                    Err(_) => {
                        finished = Some(false);
                        guard.take();
                    }
                },
                // 被 cancel_compile 取走
                None => return CmdOutcome::Cancelled,
            }
        }

        if let Some(ok) = finished {
            while let Ok(line) = rx.try_recv() {
                forward_line(app, st, sig, &line);
            }
            return if ok {
                CmdOutcome::Ok
            } else {
                CmdOutcome::Failed
            };
        }

        tokio::time::sleep(Duration::from_millis(30)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latexmk_flag_matches_engine() {
        assert_eq!(latexmk_flag("xelatex"), "-xelatex");
        assert_eq!(latexmk_flag("pdflatex"), "-pdf");
        assert_eq!(latexmk_flag("lualatex"), "-lualatex");
        // 未知引擎回退 xelatex
        assert_eq!(latexmk_flag("tectonic"), "-xelatex");
    }

    /// M1-18b：latest-wins 状态机——新任务顶掉旧任务后，旧任务必须被判为「取消」，
    /// 且旧任务的取消标记不得误伤新任务。
    #[test]
    fn latest_wins_supersedes_previous_job() {
        let st = CompileState::default();

        // 第一个任务
        let first = st.next_seq.fetch_add(1, Ordering::SeqCst) + 1;
        assert_eq!(st.running.swap(first, Ordering::SeqCst), 0); // 之前空闲
        assert!(!st.is_stale(first));
        assert!(!st.is_cancelled(first));

        // 第二个任务顶替（模拟 compile_project 的 swap）
        let second = st.next_seq.fetch_add(1, Ordering::SeqCst) + 1;
        assert_ne!(first, second);
        assert_eq!(st.running.swap(second, Ordering::SeqCst), first);
        st.cancel_seq.store(0, Ordering::SeqCst); // 新一轮清取消标记

        assert!(st.is_stale(first), "旧任务应被判定为过期");
        assert!(st.is_cancelled(first), "过期任务等价于取消");
        assert!(!st.is_stale(second));
        assert!(!st.is_cancelled(second), "旧任务的取消不应误伤新任务");

        // 用户取消只作用于「当前」任务
        st.cancel_seq.store(second, Ordering::SeqCst);
        assert!(st.is_cancelled(second));
        st.cancel_seq.store(0, Ordering::SeqCst);

        // 收尾：只有当前任务能归还 slot（旧任务的 CAS 必须失败）
        assert!(st
            .running
            .compare_exchange(first, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_err());
        assert!(st
            .running
            .compare_exchange(second, 0, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
        assert_eq!(st.running.load(Ordering::SeqCst), 0);
    }

    /// 槽位按任务代号归属：非本任务的子进程不会被本任务取走/误杀
    #[test]
    fn child_slot_is_generation_scoped() {
        let st = CompileState::default();
        // 空槽：按代号取也取不到，且不 panic
        assert!(st.take_child(Some(7)).is_none());
        assert!(st.take_child(None).is_none());
    }

    #[test]
    fn detect_returns_consistent_result() {
        // 纯核心：不注入受管目录（which 仍可能命中本机 TeX，因此只验自洽性）
        let info = detect_tex_distribution_in(&[]);
        // 结果自洽：found 与 engines 一致
        assert_eq!(info.found, !info.engines.is_empty());
        if info.found {
            // 有引擎时必须给出发行版与推荐引擎
            assert_ne!(info.distribution, "None");
            assert_eq!(info.recommended, "xelatex");
            // 推荐引擎若可用，应出现在列表中；本机装了 TeX 时推荐引擎必须在列表里
            if info.engines.contains(&"xelatex".to_string()) {
                assert!(info.version.is_some(), "有 xelatex 时应解析出版本");
            }
        }
    }

    #[test]
    fn parses_latexmk_run_number() {
        assert_eq!(parse_run_number("Run number 2 of rule 'xelatex'"), Some(2));
        assert_eq!(parse_run_number("Run number 10 of rule 'biber'"), Some(10));
        assert_eq!(parse_run_number("Latexmk: Nothing to do"), None);
    }

    #[test]
    fn missing_engine_not_reported() {
        // 不存在的可执行文件不应被 find_engine 找到（含空目录列表与进程 PATH 回退）
        assert!(find_engine("definitely_not_a_tex_engine_xyz", &[]).is_none());
    }

    #[test]
    fn splits_path_list_and_dedups() {
        // M0-15a：注册表 PATH 合并用的解析（Windows 分号，去引号/空白/重复）
        let dirs = split_path_list(r#"C:\TeX\bin;"C:\Program Files\MiKTeX\bin";C:\TeX\bin"#);
        assert_eq!(dirs.len(), 2);
        assert_eq!(dirs[0], std::path::PathBuf::from(r"C:\TeX\bin"));
        assert!(split_path_list("   ;\t;a").len() == 1);
    }

    #[test]
    fn parse_version_line_favors_distro_mark() {
        // M0-15a 冒烟反馈：优先括号里的发行版标记，而不是引擎版本号（只留版本号本身）
        assert_eq!(
            parse_version_line("XeTeX 3.141592653-2.6-0.999996 (TeX Live 2025)"),
            Some("2025".to_string())
        );
        assert_eq!(
            parse_version_line("XeTeX 3.141592653-2.6-0.999996 (MiKTeX 25.1)"),
            Some("25.1".to_string())
        );
        // 无标记时回退旧逻辑
        assert_eq!(
            parse_version_line("MiKTeX-mt 25.1"),
            Some("25.1".to_string())
        );
    }
}
