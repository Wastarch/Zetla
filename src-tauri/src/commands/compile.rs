// 编译引擎管理（开发文档 §3.3 / docs/开发计划.md M0-3/9/10/11）
// M0-3a：发行版检测（PATH + 常见安装目录探测、版本解析）
// M0-9：多遍编译（latexmk 优先 / 手写兜底管线、进度事件、取消）
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::mpsc;
use which::which;

/// 发行版检测结果（与 src/types/compile.ts TexDistInfo 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexDistInfo {
    /// 是否检测到可用发行版（任一引擎存在即 true）
    pub found: bool,
    /// 发行版名称："MiKTeX" / "TeX Live" / "Unknown"
    pub distribution: String,
    /// 版本号（取主引擎 --version 首行解析）
    pub version: Option<String>,
    /// 检测到的可执行引擎（含完整路径）
    pub engines: Vec<String>,
    /// 推荐引擎（默认 xelatex）
    pub recommended: String,
}

/// 需探测的引擎（按优先级）
const ENGINE_CANDIDATES: [&str; 4] = ["xelatex", "pdflatex", "lualatex", "latexmk"];

/// Windows 下额外检查的 MiKTeX 安装目录（PATH 之外的兜底）
#[cfg(windows)]
const MIKTEX_DIRS: [&str; 4] = [
    r"C:\Program Files\MiKTeX 25.1\miktex\bin\x64",
    r"C:\Program Files\MiKTeX 25\miktex\bin\x64",
    r"C:\Program Files\MiKTeX 24.4\miktex\bin\x64",
    r"C:\Program Files\MiKTeX\miktex\bin\x64",
];

/// 在 PATH 中查找引擎；找不到时（Windows）回退扫描 MiKTeX 常见安装目录
fn find_engine(name: &str) -> Option<std::path::PathBuf> {
    if let Ok(p) = which(name) {
        return Some(p);
    }
    #[cfg(windows)]
    {
        for dir in MIKTEX_DIRS {
            let candidate = std::path::Path::new(dir).join(format!("{name}.exe"));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

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

/// Windows：子进程不弹控制台窗口；其他平台恒等返回
#[cfg(windows)]
trait HideConsole {
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
trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(not(windows))]
impl HideConsole for std::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

/// 探测 TeX 发行版与引擎（Tauri command）
#[tauri::command]
pub fn detect_tex_distribution() -> TexDistInfo {
    let mut engines: Vec<String> = Vec::new();
    let mut found_paths: Vec<(&str, std::path::PathBuf)> = Vec::new();

    for name in ENGINE_CANDIDATES {
        if let Some(p) = find_engine(name) {
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
        .and_then(|line| {
            // 首行形如 "XeTeX 3.141592653-2.6-0.999996 (TeX Live 2025)"
            // 或 "MiKTeX 25.1 (64-bit)"
            let start = line.find(char::is_numeric)?;
            let tail = &line[start..];
            let end = tail.find("(TeX").or_else(|| tail.find('(')).unwrap_or(tail.len());
            Some(tail[..end].trim().to_string())
        });

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
    }
}

// ─────────────────────────────────────────────────────────────
// M0-9 多遍编译
// ─────────────────────────────────────────────────────────────

/// 结构化编译错误（与 src/types/compile.ts TexError 对齐；M0-10 开始填充）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexError {
    pub file: String,
    pub line: u32,
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

/// 全局编译状态（P0：单并发，同一时刻只允许一个编译任务）
#[derive(Default)]
pub struct CompileState {
    /// 是否有任务在跑（含任务启动前的占位期）
    busy: AtomicBool,
    /// 用户点了取消
    cancelled: AtomicBool,
    /// 当前子进程句柄（cancel 时取走并 kill）
    child: Mutex<Option<Child>>,
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
}

/// 杀掉子进程树：latexmk 会再拉起 xelatex/perl，只 kill 父进程会留下孤儿进程
fn kill_tree(child: &mut Child) {
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
#[tauri::command]
pub async fn compile_project(
    app: AppHandle,
    state: State<'_, Arc<CompileState>>,
    root: String,
    main_file: String,
    engine: Option<String>,
) -> Result<(), String> {
    let st = state.inner().clone();
    // P0 单并发：抢不到锁说明已有任务
    if st.busy.swap(true, Ordering::SeqCst) {
        return Err("已有编译任务在进行中".to_string());
    }
    st.cancelled.store(false, Ordering::SeqCst);

    let job = Job {
        root: PathBuf::from(root),
        main: PathBuf::from(main_file),
        engine: engine.unwrap_or_else(|| "xelatex".to_string()),
    };

    if !job.main.is_file() {
        st.busy.store(false, Ordering::SeqCst);
        return Err(format!("主文件不存在：{}", job.main.display()));
    }

    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let result = run_job(&app, &st, &job, started).await;

        // 清场：残留子进程一律杀掉
        if let Ok(mut guard) = st.child.lock() {
            if let Some(mut child) = guard.take() {
                kill_tree(&mut child);
            }
        }
        st.busy.store(false, Ordering::SeqCst);
        let _ = app.emit(EV_FINISHED, result);
    });

    Ok(())
}

/// 取消当前编译（杀掉子进程；没有任务时报错）
#[tauri::command]
pub fn cancel_compile(state: State<'_, Arc<CompileState>>) -> Result<(), String> {
    let st = state.inner();
    if !st.busy.load(Ordering::SeqCst) {
        return Err("当前没有编译任务".to_string());
    }
    st.cancelled.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = st.child.lock() {
        if let Some(mut child) = guard.take() {
            kill_tree(&mut child);
        }
    }
    Ok(())
}

/// 执行完整编译流程，返回最终结果
async fn run_job(app: &AppHandle, st: &Arc<CompileState>, job: &Job, started: Instant) -> CompileResult {
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

    emit_progress(app, "prepare", 0, format!("准备编译 · {main_name}"));

    let mut passes: u32 = 0;
    let mut failed = false;
    let mut cancelled = false;

    if let Some(lmk) = find_engine("latexmk") {
        // 首选 latexmk：交叉引用 / 参考文献 / 多遍由它自己调度
        passes += 1;
        let args = vec![
            latexmk_flag(&job.engine).to_string(),
            "-synctex=1".to_string(),
            "-interaction=nonstopmode".to_string(),
            "-file-line-error".to_string(),
            main_name.clone(),
        ];
        emit_progress(app, "running", 0, format!("latexmk {}", latexmk_flag(&job.engine)));
        match run_cmd(app, st, &lmk, &args, &dir).await {
            CmdOutcome::Ok => {}
            CmdOutcome::Failed => failed = true,
            CmdOutcome::Cancelled => cancelled = true,
            CmdOutcome::SpawnError(msg) => {
                failed = true;
                emit_progress(app, "running", 0, msg);
            }
        }
    } else if let Some(exe) = find_engine(&job.engine) {
        // 兜底：引擎自带管线（第 1 遍 → biber（有 .bcf）→ 再两遍收敛）
        let tex_args = |name: &str| vec![
            "-synctex=1".to_string(),
            "-interaction=nonstopmode".to_string(),
            "-file-line-error".to_string(),
            name.to_string(),
        ];

        passes += 1;
        emit_progress(app, "running", 0, format!("{} · 第 1 遍", job.engine));
        match run_cmd(app, st, &exe, &tex_args(&main_name), &dir).await {
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
            if let Some(biber) = find_engine("biber") {
                emit_progress(app, "running", 0, "biber · 处理参考文献");
                match run_cmd(app, st, &biber, &[stem.clone()], &dir).await {
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
            if cancelled || st.cancelled.load(Ordering::SeqCst) {
                cancelled = true;
                break;
            }
            passes += 1;
            emit_progress(app, "running", 0, format!("{} · 第 {} 遍", job.engine, i + 2));
            match run_cmd(app, st, &exe, &tex_args(&main_name), &dir).await {
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

    cancelled |= st.cancelled.load(Ordering::SeqCst);
    let pdf_ok = pdf.is_file();
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
                format!("产出 {}", pdf.file_name().unwrap_or_default().to_string_lossy()),
            );
        } else {
            emit_progress(app, "done", 100, "未生成 PDF，请查看日志");
        }
    }

    CompileResult {
        status: status.to_string(),
        pdf_path: pdf_ok.then(|| pdf.to_string_lossy().to_string()),
        errors: Vec::new(),
        passes,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

/// 跑一条外部命令：逐行转发输出，返回退出状态
async fn run_cmd(
    app: &AppHandle,
    st: &Arc<CompileState>,
    exe: &Path,
    args: &[String],
    cwd: &Path,
) -> CmdOutcome {
    // 取消可能发生在两条命令之间（尚未 spawn）
    if st.cancelled.load(Ordering::SeqCst) {
        return CmdOutcome::Cancelled;
    }

    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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

    // 交给全局状态持有，cancel_compile 才能 kill
    if let Ok(mut guard) = st.child.lock() {
        *guard = Some(child);
    } else {
        return CmdOutcome::Failed;
    }

    loop {
        // 先排空已到达的输出
        while let Ok(line) = rx.try_recv() {
            if !line.trim().is_empty() {
                emit_progress(app, "running", 0, line);
            }
        }

        let mut finished: Option<bool> = None;
        {
            let Ok(mut guard) = st.child.lock() else {
                return CmdOutcome::Failed;
            };
            match guard.as_mut() {
                Some(c) => match c.try_wait() {
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
                if !line.trim().is_empty() {
                    emit_progress(app, "running", 0, line);
                }
            }
            return if ok { CmdOutcome::Ok } else { CmdOutcome::Failed };
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

    #[test]
    fn detect_returns_consistent_result() {
        let info = detect_tex_distribution();
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
    fn missing_engine_not_reported() {
        // 不存在的可执行文件不应被 find_engine 找到
        assert!(find_engine("definitely_not_a_tex_engine_xyz").is_none());
    }
}
