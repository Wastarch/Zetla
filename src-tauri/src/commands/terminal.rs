// 日志面板 · 内置终端（feat/terminal）
// 前端 xterm.js ⇄ 本模块 PTY 会话（Windows 走 ConPTY / Unix 走 pty，portable-pty 封装）。
// 输入：前端 terminal_write 传 base64 字节 → 投递到会话的 pty 工作线程；
// 输出：reader 线程只负责 read → 投递字节块 → 独立 emit 线程合并后推 terminal_output；
// 退出：wait 线程回收子进程 → terminal_exit 事件，并从会话表移除。
// PATH 注入复用 compile::engine_search_dirs（受管 TeX 目录 → 注册表 PATH → 进程 PATH），
// 保证终端里 latexmk/xelatex 与编译引擎可用性一致。
//
// ⚠ 线程模型（这是 0xCFFFFFFF「未响应闪退」的根因，改前务必读完）：
//   Tauri 的同步命令默认**跑在 UI 主线程**（ExecutionContext::Blocking）；而 emit 事件最终走
//   wry → ICoreWebView2::ExecuteScript，跨线程调用要主线程配合。于是过去出现过这样的死锁环：
//     主线程 terminal_resize 里 ResizePseudoConsole 同步等 conhost
//       → conhost 要把重排输出写进 pty 管道
//       → 管道满，因为 reader 线程正卡在 emit（等主线程）
//       → 死锁，窗口被判无响应。
//   因此本模块的硬约束：
//     ① 任何 pty 系统调用（写 / resize）都不许在命令线程上执行，且不许持会话表锁跨调用；
//     ② reader 线程只做 read + send，绝不碰 IPC；
//     ③ emit 放在独立线程，并把排队分块合并后再推（减少跨线程 eval 次数）；
//     ④ 只有 terminal_create（openpty + spawn 进程）比较重，标了 `#[tauri::command(async)]`
//        丢到线程池；write/resize/kill 保持同步命令（只做解码 + 投递队列，微秒级），
//        顺带保证按键顺序。
use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// 输出事件名（前端 events.ts RustEvents.terminalOutput 对应）
const EV_OUTPUT: &str = "terminal_output";
/// 退出事件名（前端 RustEvents.terminalExit 对应）
const EV_EXIT: &str = "terminal_exit";
/// 单次 emit 最多合并多少字节（减少 IPC 往返；交互回显仍由短读触发，不攒延迟）
const EMIT_BATCH: usize = 131_072;

/// pty 操作（全部交给会话专属线程串行执行）
enum PtyCmd {
    /// 键盘输入
    Write(Vec<u8>),
    /// 行列变化
    Resize(u16, u16),
    /// 关闭会话（线程退出 → master drop → ConPTY 会话关闭）
    Kill,
}

/// 一个活着的终端会话
struct Session {
    /// 杀进程句柄（clone_killer 与 wait 线程里的 child 分离，避免与阻塞的 wait 抢锁）
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    /// pty 操作通道：命令侧只 send 立即返回，真正的 pty 系统调用在专属线程里做
    tx: Sender<PtyCmd>,
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
    /// 实际使用的 shell 可执行文件名（前端标题展示）
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
        ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
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

/// 输出搬运：reader 线程 → emit 线程（只投递，不在读线程做 IPC）
type OutRx = Receiver<Vec<u8>>;

/// 创建终端会话（cwd 传当前项目根；None/不存在回退主目录）
///
/// `#[tauri::command(async)]`：函数体是同步的，但会被丢到线程池执行 ——
/// openpty / CreateProcessW 都是几百毫秒级的系统调用，放主线程上会让窗口卡顿甚至被判无响应。
/// 这里用 `app.state()` 取状态而不是把 `State` 当参数，避免把借用带进异步块。
#[tauri::command(async)]
pub fn terminal_create(
    app: AppHandle,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<TerminalCreated, String> {
    let state = app.state::<Arc<TerminalState>>();
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
    // master 随工作线程走（pty 的 resize 在这个线程上串行执行）
    let master = pair.master;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    // ① reader 线程：只 read + 投递，绝不 emit（emit 要主线程配合，一堵就把 pty 管道堵死）
    let (out_tx, out_rx): (Sender<Vec<u8>>, OutRx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        const CHUNK: usize = 8192;
        const MAX_ACC: usize = 65_536;
        let mut buf = [0u8; CHUNK];
        let mut acc: Vec<u8> = Vec::with_capacity(CHUNK);
        loop {
            match reader.read(&mut buf) {
                // EOF / 读失败：进程侧已关流
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    acc.extend_from_slice(&buf[..n]);
                    // 读满缓冲区说明还有存量，先攒着；读不满（pty 已掏空）立刻发 ——
                    // 交互回显零延迟，洪泛输出合并成大块
                    if n < CHUNK || acc.len() >= MAX_ACC {
                        let chunk = std::mem::replace(&mut acc, Vec::with_capacity(CHUNK));
                        if out_tx.send(chunk).is_err() {
                            break;
                        }
                    }
                }
            }
        }
        if !acc.is_empty() {
            let _ = out_tx.send(acc);
        }
    });

    // ② emit 线程：合并排队分块再推事件（每次 emit 都是一次跨线程 eval，越少越好）
    let app_emit = app.clone();
    std::thread::spawn(move || {
        let mut batch: Vec<u8> = Vec::with_capacity(EMIT_BATCH);
        while let Ok(first) = out_rx.recv() {
            batch.extend_from_slice(&first);
            while batch.len() < EMIT_BATCH {
                match out_rx.try_recv() {
                    Ok(next) => batch.extend_from_slice(&next),
                    Err(_) => break,
                }
            }
            let payload = TerminalOutputEvent {
                id,
                data: base64::engine::general_purpose::STANDARD.encode(&batch),
            };
            batch.clear();
            let _ = app_emit.emit(EV_OUTPUT, payload);
        }
    });

    // ③ pty 工作线程：独占 writer + master，串行处理写入 / 尺寸变化
    //    resize 只在这里发生 —— 绝不放在命令线程上（ResizePseudoConsole 会同步等 conhost）
    let (cmd_tx, cmd_rx): (Sender<PtyCmd>, Receiver<PtyCmd>) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut w = writer;
        while let Ok(cmd) = cmd_rx.recv() {
            match cmd {
                PtyCmd::Write(bytes) => {
                    if w.write_all(&bytes).is_err() || w.flush().is_err() {
                        break;
                    }
                }
                PtyCmd::Resize(rows, cols) => {
                    let _ = master.resize(PtySize {
                        rows: rows.max(2),
                        cols: cols.max(2),
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
                PtyCmd::Kill => break,
            }
        }
        // 线程退出即 drop master → ConPTY 会话关闭，子进程随之收尾
    });

    // ④ 回收线程：wait → terminal_exit → 从会话表移除（drop tx → 工作线程退出）
    let app_wait = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        let _ = app_wait.emit(EV_EXIT, TerminalExitEvent { id, code });
        if let Some(st) = app_wait.try_state::<Arc<TerminalState>>() {
            if let Ok(mut m) = st.sessions.lock() {
                m.remove(&id);
            }
        }
    });

    let name = shell
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(&shell)
        .to_string();
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        Session {
            killer: Mutex::new(killer),
            tx: cmd_tx,
        },
    );
    Ok(TerminalCreated { id, shell: name })
}

/// 写入键盘输入（data = base64 字节）
/// 只做解码 + 投递队列，pty 写由会话线程做 —— 这条命令留在同步执行（主线程）反而更快，
/// 而且能保证按键顺序与用户敲击顺序一致。
#[tauri::command]
pub fn terminal_write(
    state: State<'_, Arc<TerminalState>>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    let tx = {
        let st = state.sessions.lock().map_err(|e| e.to_string())?;
        st.get(&id).map(|s| s.tx.clone())
    };
    // 会话已退出/被回收：丢弃输入即可（前端也会在 exit 后停发）
    if let Some(tx) = tx {
        let _ = tx.send(PtyCmd::Write(bytes));
    }
    Ok(())
}

/// 前端窗口尺寸变化后同步 pty 尺寸（投递给会话线程，主线程不做 ResizePseudoConsole）
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, Arc<TerminalState>>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let tx = {
        let st = state.sessions.lock().map_err(|e| e.to_string())?;
        st.get(&id).map(|s| s.tx.clone())
    };
    if let Some(tx) = tx {
        let _ = tx.send(PtyCmd::Resize(rows, cols));
    }
    Ok(())
}

/// 显式关闭终端（杀子进程；会话由回收线程从表里移除）
#[tauri::command]
pub fn terminal_kill(state: State<'_, Arc<TerminalState>>, id: u32) -> Result<(), String> {
    let session = {
        let mut st = state.sessions.lock().map_err(|e| e.to_string())?;
        st.remove(&id)
    };
    if let Some(session) = session {
        // 通知工作线程收工（它 drop master → 关闭 ConPTY）；再兜底杀进程
        let _ = session.tx.send(PtyCmd::Kill);
        let _ = session.killer.lock().map_err(|e| e.to_string())?.kill();
    }
    Ok(())
}
