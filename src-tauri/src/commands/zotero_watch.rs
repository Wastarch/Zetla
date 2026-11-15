// Zotero 联动 · Phase 1：受管 .bib 多路径监听
//
// 与 commands/watch.rs 的「项目根监听」刻意分开：
// - 那个只关心 Create/Remove 引起的资源树刷新，且重复调用即换根；
// - 这个只关心**指定 .bib 文件**的内容变化，需要多路径、内容 hash 去重、
//   300ms 防抖与自身写入抑制，语义完全不同，不改动既有 watcher。
//
// BBT 导出通常是「写临时文件 → rename 覆盖」，故监听的是 .bib 的**父目录**
// （非递归），并按 watched 文件白名单精确过滤同目录的其它噪声。
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// 必须与 zotero.rs 的同名常量一致（zotero.rs 单测会断言）
pub const BIB_CHANGED_EVENT: &str = "zotero:bib-changed";
/// 最后一条事件后静默这么久才推一次，避免 BBT 连写触发多次 reindex
pub const DEBOUNCE_MS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BibChanged {
    /// 绝对路径
    pub path: String,
    /// 内容 sha256；前端按 (path, hash) 去重
    pub hash: String,
    /// "external" = 外部（BBT/Zotero/用户）改盘；"sync" = Zetla 主动同步写盘
    pub reason: String,
}

#[derive(Default)]
pub struct ZoteroWatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Mutex<Vec<PathBuf>>,
    last_hash: Mutex<HashMap<String, String>>,
    /// Zetla 自己写盘前的 hash；watcher 收到回显后按 hash 精确抑制一次
    suppress: Mutex<HashSet<String>>,
    /// 持有 sender 防止防抖线程误判 Disconnected
    tx: Mutex<Option<mpsc::Sender<(PathBuf, String)>>>,
}

impl ZoteroWatchState {
    pub fn note_self_write(&self, hash: &str) {
        if let Ok(mut s) = self.suppress.lock() {
            s.insert(hash.to_string());
        }
    }

    fn consume_suppressed(&self, hash: &str) -> bool {
        self.suppress
            .lock()
            .map(|mut s| s.remove(hash))
            .unwrap_or(false)
    }

    pub fn set_last_hash(&self, path: &Path, hash: &str) {
        if let Ok(mut m) = self.last_hash.lock() {
            m.insert(path_key(path), hash.to_string());
        }
    }

    fn should_emit(&self, path: &Path, hash: &str) -> bool {
        let key = path_key(path);
        let mut m = match self.last_hash.lock() {
            Ok(m) => m,
            Err(_) => return false,
        };
        if m.get(&key).is_some_and(|h| h == hash) {
            return false;
        }
        m.insert(key, hash.to_string());
        true
    }

    fn set_watched(&self, paths: Vec<PathBuf>) {
        if let Ok(mut w) = self.watched.lock() {
            *w = paths;
        }
    }

    fn is_watched(&self, path: &Path) -> bool {
        let key = path_key(path);
        self.watched
            .lock()
            .map(|w| w.iter().any(|p| path_key(p) == key))
            .unwrap_or(false)
    }
}

/// 路径归一化：统一分隔符、剥 Windows verbatim 前缀、大小写折叠（仅用于比对）
pub fn path_key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    s.strip_prefix("//?/").unwrap_or(&s).to_lowercase()
}

/// 只接受 .bib 文件；排除隐藏项与原子写临时文件
pub fn is_bib_candidate(p: &Path) -> bool {
    let name = match p.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    if name.starts_with('.') || name.to_ascii_lowercase().ends_with(".tmp") {
        return false;
    }
    p.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("bib"))
        .unwrap_or(false)
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// 需要监听的父目录（去重；路径归一后比对）
pub fn parent_dirs(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for p in paths {
        if let Some(d) = p.parent() {
            let key = path_key(d);
            if seen.insert(key) {
                out.push(d.to_path_buf());
            }
        }
    }
    out
}

fn relevant_kind(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

/// P1-3：开始监听一组 .bib（重复调用即替换整组；空数组等价于停止监听）
#[tauri::command]
pub fn zotero_watch_bibs(
    app: AppHandle,
    state: State<'_, Arc<ZoteroWatchState>>,
    paths: Vec<String>,
) -> Result<usize, String> {
    let watched: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| is_bib_candidate(p))
        .collect();

    // 先停旧 watcher：drop 会让旧回调闭包与旧 sender 一起释放，旧防抖线程收到 Disconnected 退出
    if let Ok(mut g) = state.watcher.lock() {
        drop(g.take());
    }
    if let Ok(mut g) = state.tx.lock() {
        drop(g.take());
    }
    state.set_watched(watched.clone());

    if watched.is_empty() {
        return Ok(0);
    }

    let (tx, rx) = mpsc::channel::<(PathBuf, String)>();
    let handler_tx = tx.clone();
    let emit_app = app.clone();
    std::thread::spawn(move || {
        while let Ok((first_path, first_hash)) = rx.recv() {
            let mut pending: HashMap<String, (PathBuf, String)> = HashMap::new();
            pending.insert(path_key(&first_path), (first_path, first_hash));
            loop {
                match rx.recv_timeout(Duration::from_millis(DEBOUNCE_MS)) {
                    Ok((p, h)) => {
                        pending.insert(path_key(&p), (p, h));
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            for (_, (p, h)) in pending {
                let _ = emit_app.emit(
                    BIB_CHANGED_EVENT,
                    &BibChanged {
                        path: p.to_string_lossy().into_owned(),
                        hash: h,
                        reason: "external".into(),
                    },
                );
            }
        }
    });

    let watch_state = state.inner().clone();
    let handler = move |res: notify::Result<Event>| {
        let Ok(ev) = res else { return };
        if !relevant_kind(&ev.kind) {
            return;
        }
        for p in &ev.paths {
            if !is_bib_candidate(p) || !watch_state.is_watched(p) {
                continue;
            }
            // Remove / rename 中间态读不到内容就跳过；下一次 Create 会带内容再来
            let Ok(bytes) = std::fs::read(p) else { continue };
            let hash = hash_bytes(&bytes);
            if watch_state.consume_suppressed(&hash) {
                watch_state.set_last_hash(p, &hash);
                continue;
            }
            if watch_state.should_emit(p, &hash) {
                let _ = handler_tx.send((p.clone(), hash));
            }
        }
    };

    let mut watcher =
        notify::recommended_watcher(handler).map_err(|e| format!("启动 .bib 监听失败：{e}"))?;
    let mut count = 0usize;
    for dir in parent_dirs(&watched) {
        if dir.is_dir() && watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok() {
            count += 1;
        }
    }
    // state 也持有一份真 sender：替换整组时 drop 掉它，旧防抖线程才会收到 Disconnected 退出
    if let Ok(mut g) = state.tx.lock() {
        *g = Some(tx);
    }
    if let Ok(mut g) = state.watcher.lock() {
        *g = Some(watcher);
    }
    Ok(count)
}

/// P1-3：停止监听（关闭项目 / 关闭联动时调用）
#[tauri::command]
pub fn zotero_unwatch_bibs(state: State<'_, Arc<ZoteroWatchState>>) -> Result<(), String> {
    if let Ok(mut g) = state.watcher.lock() {
        drop(g.take());
    }
    if let Ok(mut g) = state.tx.lock() {
        drop(g.take());
    }
    state.set_watched(Vec::new());
    if let Ok(mut m) = state.last_hash.lock() {
        m.clear();
    }
    if let Ok(mut s) = state.suppress.lock() {
        s.clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, ModifyKind};

    #[test]
    fn event_name_matches_zotero_module() {
        assert_eq!(
            BIB_CHANGED_EVENT,
            crate::commands::zotero::BIB_CHANGED_EVENT
        );
    }

    #[test]
    fn only_bib_files_are_candidates() {
        assert!(is_bib_candidate(Path::new("E:/p/references.bib")));
        assert!(is_bib_candidate(Path::new("E:/p/REFS.BIB")));
        assert!(!is_bib_candidate(Path::new("E:/p/references.bib.tmp")));
        assert!(!is_bib_candidate(Path::new("E:/p/references.tex")));
        assert!(!is_bib_candidate(Path::new("E:/p/.hidden.bib")));
        assert!(!is_bib_candidate(Path::new("E:/p/chapter1")));
    }

    #[test]
    fn path_key_folds_windows_verbatim_and_case() {
        assert_eq!(path_key(Path::new("E:/Proj/Refs.bib")), "e:/proj/refs.bib");
        assert_eq!(path_key(Path::new("E:\\Proj\\Refs.bib")), "e:/proj/refs.bib");
        assert_eq!(
            path_key(Path::new("\\\\?\\E:\\Proj\\Refs.bib")),
            "e:/proj/refs.bib"
        );
    }

    #[test]
    fn parent_dirs_dedupes() {
        let d = parent_dirs(&[
            PathBuf::from("E:/p/a.bib"),
            PathBuf::from("E:/p/b.bib"),
            PathBuf::from("E:/p/sub/c.bib"),
        ]);
        assert_eq!(d.len(), 2);
        assert_eq!(path_key(&d[0]), "e:/p");
        assert_eq!(path_key(&d[1]), "e:/p/sub");
    }

    #[test]
    fn hash_is_stable_and_content_sensitive() {
        assert_eq!(hash_bytes(b"abc"), hash_bytes(b"abc"));
        assert_ne!(hash_bytes(b"abc"), hash_bytes(b"abd"));
        assert_eq!(hash_bytes(b"abc").len(), 64);
    }

    #[test]
    fn relevant_kinds_cover_rename_and_modify() {
        assert!(relevant_kind(&EventKind::Create(CreateKind::File)));
        assert!(relevant_kind(&EventKind::Modify(ModifyKind::Data(
            DataChange::Any
        ))));
        assert!(!relevant_kind(&EventKind::Access(AccessKind::Any)));
    }

    #[test]
    fn watched_and_hash_dedupe_work() {
        let st = ZoteroWatchState::default();
        let p = PathBuf::from("E:/p/references.bib");
        st.set_watched(vec![p.clone()]);
        assert!(st.is_watched(&PathBuf::from("e:/p/REFERENCES.BIB")));
        assert!(!st.is_watched(&PathBuf::from("E:/p/other.bib")));

        assert!(st.should_emit(&p, "h1"));
        assert!(!st.should_emit(&p, "h1")); // 同 hash 不重复发
        assert!(st.should_emit(&p, "h2")); // 新 hash 发

        // 自身写入：先登记再收到回显 → 被抑制
        st.note_self_write("self-hash");
        assert!(st.consume_suppressed("self-hash"));
        assert!(!st.consume_suppressed("self-hash")); // 只消费一次
        assert!(!st.consume_suppressed("other-hash"));
    }

    #[test]
    fn serialize_bib_changed_uses_camel_case() {
        let v = serde_json::to_value(BibChanged {
            path: "E:/p/a.bib".into(),
            hash: "xx".into(),
            reason: "external".into(),
        })
        .unwrap();
        assert_eq!(v["path"], "E:/p/a.bib");
        assert_eq!(v["hash"], "xx");
        assert_eq!(v["reason"], "external");
    }
}
