// 项目目录监听（M0-9a）—— 资源管理器自动刷新
// 只关心「文件增减」：Create / Remove。保存内容（Modify/Data）与应用自身的
// 原子写临时文件（*.tmp → rename）一律忽略，避免每次 Ctrl+S 都重扫全树。
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// 防抖窗口：最后一条事件后静默这么久，才推一次刷新
const DEBOUNCE_MS: u64 = 500;

/// 事件名（必须与 src/ipc/events.ts RustEvents 一致）
pub const EV_PROJECT_CHANGED: &str = "project_changed";

/// 事件负载（与 src/types/project.ts ProjectChanged 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChanged {
    pub root: String,
}

/// 全局监听状态：同一时刻只监听一个项目根
#[derive(Default)]
pub struct WatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

/// 只有「增减」才值得刷新资源树
fn is_tree_event(kind: &EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Remove(_))
}

/// 忽略：`.ltex/` 配置、隐藏项（如 `.git`）、原子写临时文件
/// 只看项目根以下的相对段，避免项目本身位于隐藏目录时被整体忽略
fn is_ignored_path(root: &Path, p: &Path) -> bool {
    let rel = p.strip_prefix(root).unwrap_or(p);
    rel.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == ".ltex" || s.ends_with(".tmp") || (s.starts_with('.') && s.len() > 1)
    })
}

/// 开始监听项目根（重复调用即换根；失败不阻断打开项目）
#[tauri::command]
pub fn watch_project(
    app: AppHandle,
    state: State<'_, Arc<WatchState>>,
    root: String,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("不是有效目录: {root}"));
    }

    let (tx, rx) = mpsc::channel::<()>();
    let emit_root = root.clone();
    let emit_app = app.clone();

    // 防抖线程：收到首个事件后，持续吸走事件直到静默 DEBOUNCE_MS，再推一次
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    Ok(_) => continue,
                    Err(RecvTimeoutError::Timeout) => break,
                    // watcher 被释放（换根/关闭项目）→ 线程退出
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            let _ = emit_app.emit(
                EV_PROJECT_CHANGED,
                ProjectChanged {
                    root: emit_root.clone(),
                },
            );
        }
    });

    let filter_root = root_path.clone();
    let handler = move |res: notify::Result<Event>| {
        let Ok(ev) = res else { return };
        if !is_tree_event(&ev.kind) {
            return;
        }
        if ev.paths.iter().all(|p| is_ignored_path(&filter_root, p)) {
            return;
        }
        let _ = tx.send(());
    };

    let mut watcher =
        notify::recommended_watcher(handler).map_err(|e| format!("目录监听启动失败: {e}"))?;
    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("监听 {} 失败: {e}", root_path.display()))?;

    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "监听状态锁中毒".to_string())?;
    // 换根：drop 旧 watcher → 旧回调闭包释放 → 旧防抖线程收到 Disconnected 退出
    let old = guard.replace(watcher);
    drop(old);
    Ok(())
}

/// 停止监听（关闭项目时调用；当前 MVP 未提供关闭项目入口，留作扩展）
#[tauri::command]
pub fn unwatch_project(state: State<'_, Arc<WatchState>>) -> Result<(), String> {
    let old = state
        .watcher
        .lock()
        .map_err(|_| "监听状态锁中毒".to_string())?
        .take();
    drop(old);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, ModifyKind, RemoveKind};

    #[test]
    fn tree_events_are_create_or_remove_only() {
        assert!(is_tree_event(&EventKind::Create(CreateKind::File)));
        assert!(is_tree_event(&EventKind::Remove(RemoveKind::File)));
        // 保存内容 / 访问不触发刷新
        assert!(!is_tree_event(&EventKind::Modify(ModifyKind::Data(
            DataChange::Any
        ))));
        assert!(!is_tree_event(&EventKind::Access(AccessKind::Any)));
    }

    #[test]
    fn ignores_ltex_hidden_and_tmp_paths() {
        let root = Path::new("E:/proj");
        assert!(is_ignored_path(root, Path::new("E:/proj/.ltex/config.json")));
        assert!(is_ignored_path(root, Path::new("E:/proj/main.tex.tmp")));
        assert!(is_ignored_path(root, Path::new("E:/proj/.git/HEAD")));
        // 编译产物要刷新（不隐藏）
        assert!(!is_ignored_path(root, Path::new("E:/proj/main.pdf")));
        assert!(!is_ignored_path(root, Path::new("E:/proj/chapters/ch1.tex")));
        // 项目自己位于隐藏目录时，内部正常文件不应被忽略
        assert!(!is_ignored_path(
            Path::new("E:/proj/.projects/demo"),
            Path::new("E:/proj/.projects/demo/main.tex")
        ));
    }
}
