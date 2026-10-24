// M0-14a · 应用配置持久化（偏好设置页数据层）
// %APPDATA%\Zetla\config.json（与 mockup 底部 hint 一致；Tauri config_dir 为 Roaming AppData）
// schema v1：schemaVersion / editor / autosave / build / pdf；M0-13 追加 window/session/layout
// 读写口径：缺文件或 JSON 损坏 → 回退默认值；越界/非法值 → 归一化；写盘 → 建目录 + 临时文件替换
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::Manager;

pub const CONFIG_DIR_NAME: &str = "Zetla";
pub const CONFIG_FILE_NAME: &str = "config.json";

/// 编辑器字体族白名单（设置页三个选项；非法值归一化为默认）
pub const FONT_FAMILIES: [&str; 3] = ["IBM Plex Mono", "Consolas", "Cascadia Mono"];
/// 编辑器字号合法范围（M0-14a 用户追加：Ctrl+滚轮缩放字体后为连续区间，越界回退默认）
pub const FONT_SIZE_MIN: u32 = 8;
pub const FONT_SIZE_MAX: u32 = 32;
/// 自动保存间隔可选值（秒）
pub const AUTOSAVE_INTERVALS: [u32; 4] = [5, 15, 30, 60];
/// PDF 默认缩放可选值
pub const PDF_ZOOMS: [&str; 4] = ["fit-width", "100", "125", "150"];

/// 侧栏宽度合法范围（与 App 拖拽范围一致）；预览比例合法范围
pub const SIDEBAR_MIN: u32 = 170;
pub const SIDEBAR_MAX: u32 = 560;
pub const PREVIEW_RATIO_MIN: f64 = 0.2;
pub const PREVIEW_RATIO_MAX: f64 = 0.75;
/// PDF 预览内缩略图/目录侧栏宽度范围（与 PdfPreview 拖拽范围一致）
pub const PV_SIDE_MIN: u32 = 110;
pub const PV_SIDE_MAX: u32 = 380;
pub const PV_SIDE_DEFAULT: u32 = 132;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub editor: EditorConfig,
    pub autosave: AutosaveConfig,
    pub build: BuildConfig,
    pub pdf: PdfConfig,
    /// 窗口尺寸/位置（M0-13）；None=未记录过，用 tauri.conf 默认
    pub window: WindowConfig,
    /// 会话记忆（M0-13）：上次打开项目根路径
    pub session: SessionConfig,
    /// 布局（M0-13）：侧栏/预览宽度与显隐
    pub layout: LayoutConfig,
    /// 通用开关（M0-13 设置页「通用」页签）
    pub general: GeneralConfig,
    /// TeX 代装记录（M0-15a）
    pub tex: TexConfig,
    /// @deprecated Perl 代装记录（M0-15b/c：TeX Live 自带 Perl，保留为兼容旧配置）
    pub perl: PerlConfig,
    /// M1-1：功能模块开关（模块 id → 是否启用；空 = 各模块走前端 defaultEnabled）
    pub modules: BTreeMap<String, bool>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            schema_version: 1,
            editor: EditorConfig::default(),
            autosave: AutosaveConfig::default(),
            build: BuildConfig::default(),
            pdf: PdfConfig::default(),
            window: WindowConfig::default(),
            session: SessionConfig::default(),
            layout: LayoutConfig::default(),
            general: GeneralConfig::default(),
            tex: TexConfig::default(),
            perl: PerlConfig::default(),
            modules: BTreeMap::new(),
        }
    }
}

/// 窗口几何：None 表示未记录（沿用 tauri.conf.json 的初始窗口配置）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowConfig {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionConfig {
    /// 上次打开的项目根路径（绝对路径）；打开项目时写回
    pub last_project: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutConfig {
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub preview_visible: bool,
    /// 编辑区/预览比例（0.2–0.75）
    pub preview_ratio: f64,
    /// PDF 预览内缩略图/目录侧栏宽度（110–380，拖拽调整）
    pub pv_side_width: u32,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        LayoutConfig {
            sidebar_visible: true,
            sidebar_width: 258,
            preview_visible: true,
            preview_ratio: 0.5,
            pv_side_width: PV_SIDE_DEFAULT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralConfig {
    pub restore_last_project: bool,
    pub remember_window: bool,
    pub restore_layout: bool,
    /// M1-2b：主题（"light" / "dark" / "auto"=跟随系统；缺省与非法值均按 light）
    #[serde(default = "default_theme")]
    pub theme: String,
}

/// 主题缺省值（旧配置无 theme 字段时走亮色）
fn default_theme() -> String {
    "light".to_string()
}

/// M0-15a：Zetla 代装的 TeX（检测优先用、编译时注入子进程 PATH）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TexConfig {
    /// 发行版：texlive；None=没有 Zetla 代装记录
    pub distro: Option<String>,
    /// TeX 安装根目录（台账/卸载器也读这个）
    pub install_dir: Option<String>,
    /// 引擎可执行目录（xelatex.exe 所在；优先级最高的搜索位置）
    pub engine_bin_dir: Option<String>,
}

/// M0-15a：tex.distro 白名单
pub const TEX_DISTROS: [&str; 1] = ["texlive"];

/// @deprecated M0-15b/c：TeX Live 自带 Perl，此结构体保留仅为兼容旧配置
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PerlConfig {
    pub install_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorConfig {
    pub font_family: String,
    pub font_size: u32,
    pub line_wrapping: bool,
    /// M0-14a 用户追加：Ctrl+滚轮缩放编辑器字体（默认开）
    pub mouse_wheel_zoom: bool,
}

impl Default for EditorConfig {
    fn default() -> Self {
        EditorConfig {
            font_family: "IBM Plex Mono".to_string(),
            font_size: 13,
            line_wrapping: true,
            mouse_wheel_zoom: true,
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
    /// M1-3：默认编译引擎（"auto"=跟随项目 .ltex/config.json；显式值全局覆盖）
    #[serde(default = "default_build_engine")]
    pub engine: String,
    /// M1-3：编译流程步骤序列（空=自动 latexmk；非空=按序直跑，
    /// 如 ["latex","bibtex","latex","latex"] = LaTeX → BibTeX → LaTeX → LaTeX）
    #[serde(default = "default_build_steps")]
    pub steps: Vec<String>,
}

impl Default for BuildConfig {
    fn default() -> Self {
        BuildConfig {
            save_before_compile: true,
            engine: "auto".to_string(),
            steps: Vec::new(),
        }
    }
}

/// M1-3：编译引擎白名单（与 src/types/settings.ts CompileEngine 一致）
pub const BUILD_ENGINES: [&str; 4] = ["auto", "xelatex", "pdflatex", "lualatex"];
/// M1-3：编译流程步骤白名单（与 src/types/settings.ts CompileStep 一致）
pub const BUILD_STEPS: [&str; 3] = ["latex", "bibtex", "biber"];
/// M1-2b：主题白名单（与 src/types/settings.ts AppTheme 一致；"auto"=跟随系统明暗）
pub const THEMES: [&str; 3] = ["light", "dark", "auto"];
/// M1-3：固定流程步骤数上限（防呆；空序列 = 自动）
pub const MAX_STEPS: usize = 8;

fn default_build_engine() -> String {
    "auto".to_string()
}

fn default_build_steps() -> Vec<String> {
    Vec::new()
}

/// M1-3：流程归一化——只保留白名单步骤、超上限截断；空序列 = 自动（latexmk）
pub fn normalize_build_steps(steps: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in steps {
        if BUILD_STEPS.contains(&s.as_str()) && out.len() < MAX_STEPS {
            out.push(s);
        }
    }
    out
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
    // M0-14a 用户追加：字号改为 8–32 连续范围（Ctrl+滚轮缩放），越界回退默认
    if cfg.editor.font_size < FONT_SIZE_MIN || cfg.editor.font_size > FONT_SIZE_MAX {
        cfg.editor.font_size = 13;
    }
    if !AUTOSAVE_INTERVALS.contains(&cfg.autosave.interval_seconds) {
        cfg.autosave.interval_seconds = 30;
    }
    if !PDF_ZOOMS.contains(&cfg.pdf.default_zoom.as_str()) {
        cfg.pdf.default_zoom = "fit-width".to_string();
    }
    // M1-2b：主题白名单（"auto"=跟随系统；非法值回退 light，避免前端 data-theme 落空）
    if !THEMES.contains(&cfg.general.theme.as_str()) {
        cfg.general.theme = "light".to_string();
    }
    // M1-3：编译引擎白名单 + 流程步骤归一化（非法引擎回退 auto，保持「跟随项目」行为）
    if !BUILD_ENGINES.contains(&cfg.build.engine.as_str()) {
        cfg.build.engine = "auto".to_string();
    }
    cfg.build.steps = normalize_build_steps(cfg.build.steps);
    // M0-13：布局钳制（与前端拖拽范围一致）
    if cfg.layout.sidebar_width < SIDEBAR_MIN {
        cfg.layout.sidebar_width = SIDEBAR_MIN;
    }
    if cfg.layout.sidebar_width > SIDEBAR_MAX {
        cfg.layout.sidebar_width = SIDEBAR_MAX;
    }
    if !(PREVIEW_RATIO_MIN..=PREVIEW_RATIO_MAX).contains(&cfg.layout.preview_ratio) {
        cfg.layout.preview_ratio = 0.5;
    }
    if cfg.layout.pv_side_width < PV_SIDE_MIN || cfg.layout.pv_side_width > PV_SIDE_MAX {
        cfg.layout.pv_side_width = PV_SIDE_DEFAULT;
    }
    // M0-15a：tex 代装记录归一化（先去空白再校验 distro 白名单）
    // distro 非法 → 清空；distro 为 null 允许保留目录（「手动指定引擎目录」场景）
    cfg.tex.distro = clean_opt_str(cfg.tex.distro);
    cfg.tex.install_dir = clean_opt_str(cfg.tex.install_dir);
    cfg.tex.engine_bin_dir = clean_opt_str(cfg.tex.engine_bin_dir);
    cfg.perl.install_dir = clean_opt_str(cfg.perl.install_dir);
    if cfg
        .tex
        .distro
        .as_deref()
        .map_or(false, |d| !TEX_DISTROS.contains(&d))
    {
        cfg.tex.distro = None;
        cfg.tex.install_dir = None;
        cfg.tex.engine_bin_dir = None;
    }
    cfg.schema_version = 1;
    cfg
}

/// Option<String> 去空白：空/全空白 → None
fn clean_opt_str(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.trim().is_empty())
        .map(|v| v.trim().to_string())
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
        format!(
            "{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
            n
        )
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
        cfg.editor.font_size = 15; // 滚轮产生的非预设值也应往返保留
        cfg.editor.font_family = "Cascadia Mono".to_string();
        cfg.editor.line_wrapping = false;
        cfg.editor.mouse_wheel_zoom = false;
        cfg.autosave.enabled = false;
        cfg.autosave.interval_seconds = 60;
        cfg.build.save_before_compile = false;
        cfg.pdf.default_zoom = "125".to_string();
        cfg.window = WindowConfig {
            width: Some(1440),
            height: Some(1080),
            x: Some(-1920),
            y: Some(24),
            maximized: true,
        };
        cfg.session.last_project = Some("E:\\Project\\ZetlaDocs".to_string());
        cfg.layout.sidebar_visible = false;
        cfg.layout.sidebar_width = 320;
        cfg.layout.preview_visible = false;
        cfg.layout.preview_ratio = 0.42;
        cfg.layout.pv_side_width = 200;
        cfg.general.restore_last_project = false;
        cfg.general.remember_window = false;
        cfg.general.restore_layout = false;
        cfg.general.theme = "dark".to_string();
        cfg.tex.distro = Some("texlive".to_string());
        cfg.tex.install_dir = Some("C:\\Users\\u\\AppData\\Local\\Zetla\\tex\\texlive".to_string());
        cfg.tex.engine_bin_dir =
            Some("C:\\Users\\u\\AppData\\Local\\Zetla\\tex\\texlive\\bin\\windows".to_string());
        cfg.perl.install_dir = Some("D:\\Zetla\\perl\\strawberry".to_string());
        // M1-1：模块开关往返保留（含 false 显式停用）
        cfg.modules.insert("symbol".to_string(), true);
        cfg.modules.insert("demo".to_string(), false);
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
        assert!(text.contains("mouseWheelZoom"));
        assert!(text.contains("intervalSeconds"));
        assert!(text.contains("pauseWhileCompiling"));
        assert!(text.contains("saveBeforeCompile"));
        assert!(text.contains("defaultZoom"));
        // M0-13 字段
        assert!(text.contains("lastProject"));
        assert!(text.contains("sidebarWidth"));
        assert!(text.contains("previewRatio"));
        assert!(text.contains("pvSideWidth"));
        assert!(text.contains("restoreLastProject"));
        assert!(text.contains("rememberWindow"));
        assert!(text.contains("restoreLayout"));
        // M0-15a 字段
        assert!(text.contains("installDir"));
        assert!(text.contains("engineBinDir"));
        // M0-15b 字段
        assert!(text.contains("perl"));
        // M1-1 字段
        assert!(text.contains("modules"));
        // M1-2 字段
        assert!(text.contains("theme"));
        // M1-3 字段（精确到值，避免与 tex.engineBinDir 混淆）
        assert!(text.contains("\"engine\":\"auto\""));
        assert!(text.contains("\"steps\":[]"));
        // snake_case 不应出现
        assert!(!text.contains("font_family"));
        assert!(!text.contains("interval_seconds"));
        assert!(!text.contains("last_project"));
    }

    #[test]
    fn build_engine_steps_default_and_roundtrip() {
        // M1-3：旧配置缺 engine/steps → auto/[]（保持「跟随项目 + latexmk 自动」行为）
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "general": { "restoreLastProject": true }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.build.engine, "auto");
        assert!(parsed.build.steps.is_empty());

        // 显式值往返保留（传统参考文献四步流程）
        let mut cfg = AppConfig::default();
        cfg.build.engine = "pdflatex".to_string();
        cfg.build.steps = vec![
            "latex".to_string(),
            "bibtex".to_string(),
            "latex".to_string(),
            "latex".to_string(),
        ];
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"engine\":\"pdflatex\""));
        assert!(text.contains("\"steps\":[\"latex\",\"bibtex\",\"latex\",\"latex\"]"));
        let back = serde_json::from_str::<AppConfig>(&text).unwrap();
        assert_eq!(back.build.engine, "pdflatex");
        assert_eq!(back.build.steps, cfg.build.steps);

        // 归一化：非法引擎 → auto；非法/超限步骤被剔除
        let mut bad = AppConfig::default();
        bad.build.engine = "tectonic".to_string();
        bad.build.steps = vec![
            "latex".to_string(),
            "makeindex".to_string(),
            "latex".to_string(),
        ];
        let norm = normalize(bad);
        assert_eq!(norm.build.engine, "auto");
        assert_eq!(norm.build.steps, vec!["latex".to_string(), "latex".to_string()]);
    }

    #[test]
    fn normalize_build_steps_filters_and_caps() {
        // 白名单过滤
        assert_eq!(
            normalize_build_steps(vec!["latex".into(), "bibtex".into(), "biber".into()]),
            vec!["latex", "bibtex", "biber"]
        );
        // 空序列 = 自动
        assert!(normalize_build_steps(Vec::new()).is_empty());
        // 超上限截断（10 个 latex → 8 个）
        let many: Vec<String> = (0..10).map(|_| "latex".to_string()).collect();
        assert_eq!(normalize_build_steps(many).len(), MAX_STEPS);
    }

    #[test]
    fn theme_default_light_and_roundtrip() {
        // M1-2：缺 theme 字段 → light；显式 dark 往返保留
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "general": { "restoreLastProject": true }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.general.theme, "light");

        let mut cfg = AppConfig::default();
        cfg.general.theme = "dark".to_string();
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"theme\":\"dark\""));
        assert_eq!(
            serde_json::from_str::<AppConfig>(&text).unwrap().general.theme,
            "dark"
        );
    }

    #[test]
    fn theme_auto_roundtrip_and_invalid_falls_back_light() {
        // M1-2b："auto"（跟随系统）往返保留；非法值归一化为 light
        let mut cfg = AppConfig::default();
        cfg.general.theme = "auto".to_string();
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"theme\":\"auto\""));
        assert_eq!(
            serde_json::from_str::<AppConfig>(&text).unwrap().general.theme,
            "auto"
        );

        let mut bad = AppConfig::default();
        bad.general.theme = "blue".to_string();
        assert_eq!(normalize(bad).general.theme, "light");
    }

    #[test]
    fn modules_default_empty_and_partial_ok() {
        // M1-1：旧配置缺 modules → serde default 空 map，不报错
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert!(parsed.modules.is_empty());

        // 部分覆盖只影响写入的键；归一化不清洗未知模块 id（前端注册表是权威）
        let raw = json!({ "modules": { "symbol": true } });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.modules.get("symbol"), Some(&true));
        assert_eq!(normalize(parsed).modules.get("symbol"), Some(&true));
    }

    #[test]
    fn font_size_range() {
        // M0-14a 用户追加：8–32 连续范围；边界保留，越界回退 13
        for n in [8u32, 10, 15, 24, 32] {
            let raw = json!({
                "schemaVersion": 1,
                "editor": { "fontFamily": "IBM Plex Mono", "fontSize": n, "lineWrapping": true, "mouseWheelZoom": true }
            });
            let parsed: AppConfig = serde_json::from_value(raw).unwrap();
            assert_eq!(normalize(parsed).editor.font_size, n);
        }
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 7, "lineWrapping": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(normalize(parsed).editor.font_size, 13);
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 33, "lineWrapping": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(normalize(parsed).editor.font_size, 13);
        // 旧配置缺 mouseWheelZoom → serde default = true
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert!(normalize(parsed).editor.mouse_wheel_zoom);
    }

    #[test]
    fn tex_config_normalize() {
        // M0-15a：distro 白名单外 → 整条清空；空白 → None
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "tex": {
                "distro": "tinytex",
                "installDir": "C:\\tex\\mi",
                "engineBinDir": "C:\\tex\\mi\\bin"
            }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let got = normalize(parsed);
        assert_eq!(got.tex, crate::commands::config::TexConfig::default());

        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "tex": {
                "distro": "  texlive  ",
                "installDir": "  ",
                "engineBinDir": "C:\\tex\\tl\\bin\\windows"
            }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let got = normalize(parsed);
        assert_eq!(got.tex.distro.as_deref(), Some("texlive"));
        assert_eq!(got.tex.install_dir, None);
        assert_eq!(
            got.tex.engine_bin_dir.as_deref(),
            Some("C:\\tex\\tl\\bin\\windows")
        );

        // distro=null 但手动指定了引擎目录 → 目录保留（引导面板「手动指定引擎目录」）
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "tex": { "engineBinDir": "C:\\tex\\tl\\bin\\windows" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let got = normalize(parsed);
        assert_eq!(got.tex.distro, None);
        assert_eq!(got.tex.install_dir, None);
        assert_eq!(
            got.tex.engine_bin_dir.as_deref(),
            Some("C:\\tex\\tl\\bin\\windows")
        );
    }

    #[test]
    fn perl_config_normalize() {
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "perl": { "installDir": "  D:\\Zetla\\perl  " }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(
            normalize(parsed).perl.install_dir.as_deref(),
            Some("D:\\Zetla\\perl")
        );

        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "perl": { "installDir": "  " }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(normalize(parsed).perl.install_dir, None);
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

    #[test]
    fn pv_side_width_default_and_clamp() {
        // 旧配置缺字段 → 用 Default（132），不报错
        let raw = json!({
            "layout": {
                "sidebarVisible": true,
                "sidebarWidth": 258,
                "previewVisible": true,
                "previewRatio": 0.5
            }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.layout.pv_side_width, PV_SIDE_DEFAULT);

        // 越界 → 回退默认；合法值保留
        for (input, expect) in [
            (PV_SIDE_MIN - 1, PV_SIDE_DEFAULT),
            (PV_SIDE_MIN, PV_SIDE_MIN),
            (200, 200),
            (PV_SIDE_MAX, PV_SIDE_MAX),
            (PV_SIDE_MAX + 1, PV_SIDE_DEFAULT),
        ] {
            let mut cfg = AppConfig::default();
            cfg.layout.pv_side_width = input;
            assert_eq!(normalize(cfg).layout.pv_side_width, expect, "input={input}");
        }
    }
}
