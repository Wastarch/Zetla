// M1-15a · 项目注册表命令（与 Rust AppConfig.recent_projects / 前端 ProjectEntry 对齐）
// 注册表落 %APPDATA%\Zetla\config.json（AppConfig 内），读写复用 config.rs 的
// read_config / write_config / config_path；每个命令读改写整份 AppConfig 并
// 返回更新后的 recent_projects，便于前端即时同步本地镜像（避免 persist 回写旧值清空）。
use std::path::Path;

use crate::commands::config::{
    config_path, read_config, write_config, AppConfig, ProjectEntry,
};

/// path 规范化：去空白、去尾部路径分隔符（便于跨调用稳定匹配）
fn norm_key(p: &str) -> String {
    let t = p.trim();
    t.trim_end_matches(['/', '\\']).to_string()
}

/// 读 .ltex/config.json 的 name / templateId（缺省 None；非法 JSON 时忽略）
fn read_ltex_meta(root: &Path) -> (Option<String>, Option<String>) {
    let cfg = root.join(".ltex").join("config.json");
    let Ok(text) = std::fs::read_to_string(cfg) else {
        return (None, None);
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return (None, None);
    };
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let template_id = v
        .get("templateId")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (name, template_id)
}

/// 目录展示名（path 末段；空 path 回退空串）
fn dir_name(root: &str) -> String {
    Path::new(root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 打开/切换到某项目后写回注册表：upsert（更新 name/template_id/last_opened，
/// 保留 pinned/archived）；同时更新 session.last_project。返回更新后的注册表。
#[tauri::command]
pub fn register_recent_project(
    app: tauri::AppHandle,
    root: String,
) -> Result<Vec<ProjectEntry>, String> {
    let key = norm_key(&root);
    if key.is_empty() {
        return Err("项目路径为空".into());
    }
    let root_path = Path::new(&key);
    if !root_path.is_dir() {
        return Err(format!("不是有效目录: {}", key));
    }
    let (cfg_name, cfg_tpl) = read_ltex_meta(root_path);
    let display = cfg_name.unwrap_or_else(|| dir_name(&key));
    let now = chrono::Utc::now().to_rfc3339();

    let path = config_path(&app)?;
    let mut cfg: AppConfig = read_config(&path);
    let existing = cfg
        .recent_projects
        .iter_mut()
        .find(|e| norm_key(&e.path) == key);
    match existing {
        Some(e) => {
            e.name = display;
            e.template_id = cfg_tpl;
            e.last_opened = Some(now);
            // pinned / archived 保留不动
        }
        None => {
            cfg.recent_projects.push(ProjectEntry {
                path: key.clone(),
                name: display,
                template_id: cfg_tpl,
                pinned: false,
                archived: false,
                last_opened: Some(now),
            });
        }
    }
    cfg.session.last_project = Some(key);
    // normalize 负责去重/截断/排序（并回写 last_project）
    let cfg = crate::commands::config::normalize(cfg);
    write_config(&path, &cfg)?;
    Ok(cfg.recent_projects)
}

/// 读取注册表（已归一化：去重/截断/排序）
#[tauri::command]
pub fn list_recent_projects(app: tauri::AppHandle) -> Result<Vec<ProjectEntry>, String> {
    let path = config_path(&app)?;
    let cfg: AppConfig = read_config(&path);
    Ok(cfg.recent_projects)
}

/// 置顶/取消置顶；返回更新后的注册表。path 不在注册表时报错。
#[tauri::command]
pub fn pin_project(
    app: tauri::AppHandle,
    path: String,
    pinned: bool,
) -> Result<Vec<ProjectEntry>, String> {
    let key = norm_key(&path);
    let cfg_path = config_path(&app)?;
    let mut cfg: AppConfig = read_config(&cfg_path);
    let entry = cfg
        .recent_projects
        .iter_mut()
        .find(|e| norm_key(&e.path) == key)
        .ok_or_else(|| format!("项目不在最近列表中: {}", key))?;
    entry.pinned = pinned;
    let cfg = crate::commands::config::normalize(cfg);
    write_config(&cfg_path, &cfg)?;
    Ok(cfg.recent_projects)
}

/// 归档/取消归档；返回更新后的注册表。path 不在注册表时报错。
#[tauri::command]
pub fn archive_project(
    app: tauri::AppHandle,
    path: String,
    archived: bool,
) -> Result<Vec<ProjectEntry>, String> {
    let key = norm_key(&path);
    let cfg_path = config_path(&app)?;
    let mut cfg: AppConfig = read_config(&cfg_path);
    let entry = cfg
        .recent_projects
        .iter_mut()
        .find(|e| norm_key(&e.path) == key)
        .ok_or_else(|| format!("项目不在最近列表中: {}", key))?;
    entry.archived = archived;
    let cfg = crate::commands::config::normalize(cfg);
    write_config(&cfg_path, &cfg)?;
    Ok(cfg.recent_projects)
}
