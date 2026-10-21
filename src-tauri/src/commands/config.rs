// M0-14a · 应用配置持久化（偏好设置页数据层）
// %APPDATA%\Zetla\config.json（与 mockup 底部 hint 一致；Tauri config_dir 为 Roaming AppData）
// schema v1：schemaVersion / editor / autosave / build / pdf；M0-13 追加 window/session/layout
// 读写口径：缺文件或 JSON 损坏 → 回退默认值；越界/非法值 → 归一化；写盘 → 建目录 + 临时文件替换
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

pub const CONFIG_DIR_NAME: &str = "Zetla";
pub const CONFIG_FILE_NAME: &str = "config.json";

/// 编辑器字体族白名单（设置页三个选项；非法值归一化为默认）
pub const FONT_FAMILIES: [&str; 3] = ["IBM Plex Mono", "Consolas", "Cascadia Mono"];
/// 编辑器字号可选值
pub const FONT_SIZES: [u32; 4] = [12, 13, 14, 16];
/// 自动保存间隔可选值（秒）
pub const AUTOSAVE_INTERVALS: [u32; 4] = [5, 15, 30, 60];
/// PDF 默认缩放可选值
pub const PDF_ZOOMS: [&str; 4] = ["fit-width", "100", "125", "150"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub editor: EditorConfig,
    pub autosave: AutosaveConfig,
    pub build: BuildConfig,
    pub pdf: PdfConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            schema_version: 1,
            editor: EditorConfig::default(),
            autosave: AutosaveConfig::default(),
            build: BuildConfig::default(),
            pdf: PdfConfig::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorConfig {
    pub font_family: String,
    pub font_size: u32,
    pub line_wrapping: bool,
}

impl Default for EditorConfig {
    fn default() -> Self {
        EditorConfig {
            font_family: "IBM Plex Mono".to_string(),
            font_size: 13,
            line_wrapping: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AutosaveConfig {
    pub enabled: bool,
    pub interval_seconds: u32,
    pub pause_while_compiling: bool,
}

impl Default for AutosaveConfig {
    fn default() -> Self {
        AutosaveConfig {
            enabled: true,
            interval_seconds: 30,
            pause_while_compiling: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BuildConfig {
    pub save_before_compile: bool,
}

impl Default for BuildConfig {
    fn default() -> Self {
        BuildConfig {
            save_before_compile: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PdfConfig {
    pub default_zoom: String,
}

impl Default for PdfConfig {
    fn default() -> Self {
        PdfConfig {
            default_zoom: "fit-width".to_string(),
        }
    }
}

/// 越界/非法值归一化（读盘与写盘统一走此入口）
pub fn normalize(mut cfg: AppConfig) -> AppConfig {
    if !FONT_FAMILIES.contains(&cfg.editor.font_family.as_str()) {
        cfg.editor.font_family = "IBM Plex Mono".to_string();
    }
    if !FONT_SIZES.contains(&cfg.editor.font_size) {
        cfg.editor.font_size = 13;
    }
    if !AUTOSAVE_INTERVALS.contains(&cfg.autosave.interval_seconds) {
        cfg.autosave.interval_seconds = 30;
    }
    if !PDF_ZOOMS.contains(&cfg.pdf.default_zoom.as_str()) {
        cfg.pdf.default_zoom = "fit-width".to_string();
    }
    cfg.schema_version = 1;
    cfg
}

/// 配置文件绝对路径（config_dir/Zetla/config.json）
pub fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .config_dir()
        .map_err(|e| format!("解析配置目录失败: {}", e))?
        .join(CONFIG_DIR_NAME);
    Ok(dir.join(CONFIG_FILE_NAME))
}

/// 读配置：文件缺失 / 读取失败 / JSON 损坏 → 默认值（不自动回写，避免误覆盖用户手工编辑）
pub fn read_config(path: &std::path::Path) -> AppConfig {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return normalize(AppConfig::default()),
    };
    match serde_json::from_str::<AppConfig>(&text) {
        Ok(cfg) => normalize(cfg),
        Err(_) => normalize(AppConfig::default()),
    }
}

/// 写配置：建目录 + 先写临时文件再替换（Windows 下 rename 目标存在需先移除）
pub fn write_config(path: &std::path::Path, cfg: &AppConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&normalize(cfg.clone()))
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("写入配置失败: {}", e))?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("替换配置失败: {}", e))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("替换配置失败: {}", e))?;
    Ok(())
}

/// 读应用配置（前端启动时调用；缺失/损坏回退默认）
#[tauri::command]
pub fn load_app_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    Ok(read_config(&path))
}

/// 保存应用配置（设置页「保存设置」调用；整对象写入）
#[tauri::command]
pub fn save_app_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    write_config(&path, &config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("zetla-config-tests")
            .join(format!("{}-{}-{}", tag, std::process::id(), uuid_like()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 毫秒级时间戳 + 计数器，避免并行测试目录冲突
    fn uuid_like() -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        format!("{}-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(), n)
    }

    #[test]
    fn read_missing_file_returns_defaults() {
        let p = tmp_dir("missing").join(CONFIG_FILE_NAME);
        let cfg = read_config(&p);
        assert_eq!(cfg, normalize(AppConfig::default()));
    }

    #[test]
    fn read_corrupt_json_returns_defaults() {
        let p = tmp_dir("corrupt").join(CONFIG_FILE_NAME);
        std::fs::write(&p, "{ not valid json ]").unwrap();
        let cfg = read_config(&p);
        assert_eq!(cfg, normalize(AppConfig::default()));
    }

    #[test]
    fn write_then_read_roundtrip() {
        let p = tmp_dir("roundtrip").join(CONFIG_FILE_NAME);
        let mut cfg = AppConfig::default();
        cfg.editor.font_size = 16;
        cfg.editor.font_family = "Cascadia Mono".to_string();
        cfg.editor.line_wrapping = false;
        cfg.autosave.enabled = false;
        cfg.autosave.interval_seconds = 60;
        cfg.build.save_before_compile = false;
        cfg.pdf.default_zoom = "125".to_string();
        write_config(&p, &cfg).unwrap();
        assert_eq!(read_config(&p), cfg);
        // 不留临时文件
        assert!(!p.with_extension("json.tmp").exists());
    }

    #[test]
    fn camel_case_keys() {
        let text = serde_json::to_string(&AppConfig::default()).unwrap();
        assert!(text.contains("schemaVersion"));
        assert!(text.contains("fontFamily"));
        assert!(text.contains("fontSize"));
        assert!(text.contains("lineWrapping"));
        assert!(text.contains("intervalSeconds"));
        assert!(text.contains("pauseWhileCompiling"));
        assert!(text.contains("saveBeforeCompile"));
        assert!(text.contains("defaultZoom"));
        // snake_case 不应出现
        assert!(!text.contains("font_family"));
        assert!(!text.contains("interval_seconds"));
    }

    #[test]
    fn normalizes_out_of_range_values() {
        let cfg = AppConfig::default();
        let raw = json!({
            "schemaVersion": 9,
            "editor": { "fontFamily": "Comic Sans", "fontSize": 99, "lineWrapping": true },
            "autosave": { "enabled": true, "intervalSeconds": 42, "pauseWhileCompiling": false },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "999" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let got = normalize(parsed);
        assert_eq!(got.editor.font_family, cfg.editor.font_family);
        assert_eq!(got.editor.font_size, 13);
        assert_eq!(got.autosave.interval_seconds, 30);
        assert_eq!(got.pdf.default_zoom, "fit-width");
        assert_eq!(got.schema_version, 1);
    }
}
