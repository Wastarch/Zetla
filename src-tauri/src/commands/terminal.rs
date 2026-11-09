// 日志面板 · 内置终端（feat/terminal）
// 前端 xterm.js ⇄ 本模块 PTY 会话（Windows 走 ConPTY / Unix 走 pty，portable-pty 封装）。
// 输入：前端 terminal_write 传 base64 字节 → 写入 pty master writer；
// 输出：reader 线程逐块读 pty → base64 → terminal_output 事件推给前端；
// 退出：wait 线程回收子进程 → terminal_exit 事件，并从会话表移除。
// PATH 注入复用 compile::engine_search_dirs（受管 TeX 目录 → 注册表 PATH → 进程 PATH），
// 保证终端里 latexmk/xelatex 与编译引擎可用性一致。
use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// 输出事件名（前端 events.ts RustEvents.terminalOutput 对应）
const EV_OUTPUT: &str = "terminal_output";
/// 退出事件名（前端 RustEvents.terminalExit 对应）
const EV_EXIT: &str = "terminal_exit";

/// 一个活着的终端会话
struct Session {
    /// pty master（drop 时关闭会话端；resize 也走它）
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// 杀进程句柄（clone_killer 与 wait 线程里的 child 分离，避免与阻塞的 wait 抢锁）
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    /// 键盘输入写入端（take_writer 每个会话只能取一次，存住复用）
    writer: Mutex<Box<dyn Write + Send>>,
}

/// 会话表（id → 会话）；lib.rs manage 注入
pub struct TerminalState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// terminal_create 返回（与 src/types/terminal.ts TerminalCreated 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreated {
    pub id: u32,
    /// 实际使用的 shell 可执行文件名（前端欢迎行展示）
    pub shell: String,
}

/// terminal_output 事件负载（data = base64 字节）
#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutputEvent {
    pub id: u32,
    pub data: String,
}

/// terminal_exit 事件负载（code 为 None 时表示被信号终止/无法取回码）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub id: u32,
    pub code: Option<u32>,
}

/// 选 shell：Windows 用 PowerShell（-NoLogo 去版权头），Unix 用 $SHELL 兜底 bash/sh
fn pick_shell() -> (String, Vec<String>) {
    if cfg!(windows) {
        (
            "powershell.exe".to_string(),
            vec!["-NoLogo".to_string()],
        )
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (shell, Vec::new())
    }
}

/// 兜底工作目录：用户主目录（USERPROFILE / HOME），再兜进程 cwd
fn fallback_cwd() -> std::path::PathBuf {
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let p = std::path::PathBuf::from(home);
        if p.is_dir() {
            return p;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}

/// 构造子进程环境：显式复制进程环境（避免 CommandBuilder 默认环境的实现差异），
/// 再把受管 TeX 目录前置进 PATH —— 与编译子进程同一套可见性口径
fn build_command(shell: &str, args: &[String], cwd: &std::path::Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    for a in args {
        cmd.arg(a);
    }
    for (k, v) in std::env::vars_os() {
        cmd.env(k, v);
    }
    let mut dirs = crate::commands::compile::engine_search_dirs(None);
    dirs.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    if let Ok(path) = std::env::join_paths(&dirs) {
        cmd.env("PATH", path);
    }
    // Unix 下交互程序（vim/htop）需要 TERM；ConPTY 由宿主自动协商，不用管
    if !cfg!(windows) {
        cmd.env("TERM", "xterm-256color");
    }
    cmd
}

/// 创建终端会话（cwd 传当前项目根；None/不存在回退主目录）
#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, TerminalState>,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<TerminalCreated, String> {
    let (shell, args) = pick_shell();
    let cwd = cwd
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(fallback_cwd);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut child = pair
        .slave
        .spawn_command(build_command(&shell, &args, &cwd))
        .map_err(|e| e.to_string())?;
    // 父进程侧立刻关掉 slave，否则 EOF 语义不成立（退出检测会悬空）
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    // 杀进程句柄在 child 移交回收线程前先克隆出来（terminal_kill 用）
    let killer = child.clone_killer();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    // 输出线程：pty → base64 → terminal_output（EOF 即进程侧关流，静默收尾）
    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let payload = TerminalOutputEvent {
                        id,
                        data: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
                    };
                    let _ = app_out.emit(EV_OUTPUT, payload);
                }
            }
        }
    });

    // 回收线程：wait → terminal_exit → 从会话表移除
    let app_wait = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = app_wait.emit(
            EV_EXIT,
            TerminalExitEvent {
                id,
                code,
            },
        );
        if let Some(st) = app_wait.try_state::<TerminalState>() {
            st.sessions.lock().ok().map(|mut m| m.remove(&id));
        }
    });

    let name = shell.rsplit(['\\', '/']).next().unwrap_or(&shell).to_string();
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Session {
            master: pair.master,
            killer: Mutex::new(killer),
            writer: Mutex::new(writer),
        },
    );
    Ok(TerminalCreated { id, shell: name })
}

/// 写入键盘输入（data = base64 字节）
#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let st = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = st.get(&id).ok_or("terminal session not found")?;
    let mut w = session.writer.lock().map_err(|e| e.to_string())?;
    w.write_all(&bytes).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// 前端窗口尺寸变化后同步 pty 尺寸
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let st = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = st.get(&id).ok_or("terminal session not found")?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 显式关闭终端（杀子进程；会话由回收线程从表里移除）
#[tauri::command]
pub fn terminal_kill(state: State<'_, TerminalState>, id: u32) -> Result<(), String> {
    let session = {
        let mut st = state.sessions.lock().map_err(|e| e.to_string())?;
        st.remove(&id)
    };
    if let Some(session) = session {
        // killer 与 wait 线程里的 child 分离，这里锁不会与阻塞的 wait 抢锁
        let _ = session.killer.lock().map_err(|e| e.to_string())?.kill();
        // master drop 即关闭会话端（pty EOF → 输出线程收尾）
    }
    Ok(())
}
