// M0-14a · 应用配置持久化（偏好设置页数据层）
// %APPDATA%\Zetla\config.json（与 mockup 底部 hint 一致；Tauri config_dir 为 Roaming AppData）
// schema v1：schemaVersion / editor / autosave / build / pdf；M0-13 追加 window/session/layout
// 读写口径：缺文件或 JSON 损坏 → 回退默认值；越界/非法值 → 归一化；写盘 → 建目录 + 临时文件替换
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
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
/// M1-16：底部日志面板高度（拖拽上边界调整；与前端 LogPanel 的 LOG_MIN_H/LOG_MAX_H 一致）
pub const LOG_H_MIN: u32 = 120;
pub const LOG_H_MAX: u32 = 560;
pub const LOG_H_DEFAULT: u32 = 212;

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
    /// M1-10：公式模块配置（收藏 / 自定义 / 插入行为）
    pub formula: FormulaConfig,
    /// M1-8：表格模块配置（默认线型 / 转义 / 编号 / 位置）
    pub table: TableConfig,
    /// M1-15a：最近项目注册表（path = projectId；上限见 MAX_RECENT）
    pub recent_projects: Vec<ProjectEntry>,
    /// M1-17：LaTeX 语法高亮配色（数据驱动；设置页「外观与保存 → 语法高亮」编辑）
    pub highlight: HighlightConfig,
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
            formula: FormulaConfig::default(),
            table: TableConfig::default(),
            recent_projects: Vec::new(),
            highlight: HighlightConfig::default(),
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
    /// M0-13c：上次离开时打开的编辑器标签页（绝对路径，按打开顺序）
    pub open_files: Vec<String>,
    /// M0-13c：上次离开时的活动标签（须在 open_files 内；None=无活动标签）
    pub active_file: Option<String>,
}

/// M0-13c：会话标签页数量上限（防呆；超出按打开顺序截断）
pub const MAX_OPEN_FILES: usize = 50;

/// M0-13c：会话归一化——去空白/去重、截断至上限；active_file 不在列表内则置空
pub fn normalize_session(mut session: SessionConfig) -> SessionConfig {
    let mut files: Vec<String> = Vec::new();
    for p in session.open_files.drain(..) {
        let t = p.trim();
        if t.is_empty() || files.iter().any(|f| f == t) {
            continue;
        }
        files.push(t.to_string());
    }
    files.truncate(MAX_OPEN_FILES);
    session.open_files = files;
    session.active_file = session
        .active_file
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty() && session.open_files.iter().any(|p| p == a));
    session
}

/// M1-15a：最近项目注册表条目（与 src/types/project.ts ProjectEntry 对齐；path = projectId）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectEntry {
    /// 项目根绝对路径（= projectId）
    pub path: String,
    /// 展示名（可由 .ltex/config.json 的 name 覆盖，缺省取目录名）
    pub name: String,
    /// 模板 id（来自 .ltex/config.json 的 templateId；无则 null）
    pub template_id: Option<String>,
    /// 置顶
    pub pinned: bool,
    /// 归档（不移动/删除目录，仅欢迎页分组）
    pub archived: bool,
    /// 最近一次打开时间（ISO-8601；无则 null）
    pub last_opened: Option<String>,
}

/// M1-15a：最近项目注册表上限（防呆；超出按最近优先截断）
pub const MAX_RECENT: usize = 20;

/// M1-15a：注册表归一化——清洗每个条目 / 按 path 去重（保留最后出现者）/
/// 截断至上限 / 排序（未归档在前 → 置顶在前 → last_opened 倒序，None 最后）。
/// 仅影响内存顺序与非法值，不触碰磁盘。
pub fn normalize_recent(mut v: Vec<ProjectEntry>) -> Vec<ProjectEntry> {
    // 1) 清洗每个条目
    for e in &mut v {
        e.path = e.path.trim().to_string();
        let name = e.name.trim().to_string();
        e.name = if name.is_empty() {
            Path::new(&e.path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        } else {
            name
        };
        e.template_id = clean_opt_str(e.template_id.take());
        e.last_opened = clean_opt_str(e.last_opened.take());
    }
    // 2) 去重（按 path；保留最后出现者）
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut dedup: Vec<ProjectEntry> = Vec::new();
    for e in v.into_iter().rev() {
        if e.path.is_empty() || !seen.insert(e.path.clone()) {
            continue;
        }
        dedup.push(e);
    }
    dedup.reverse();
    // 3) 排序：未归档在前 → 同组置顶在前 → last_opened 倒序（None 最后）
    dedup.sort_by(|a, b| {
        a.archived
            .cmp(&b.archived)
            .then_with(|| b.pinned.cmp(&a.pinned))
            .then_with(|| match (&a.last_opened, &b.last_opened) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(x), Some(y)) => y.cmp(x),
            })
    });
    // 4) 截断至上限（排序后截断 → 保留最相关/最近的 20 条）
    dedup.truncate(MAX_RECENT);
    dedup
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
    /// M1-16：底部编译日志面板高度（120–560，拖拽上边界调整）
    pub log_height: u32,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        LayoutConfig {
            sidebar_visible: true,
            sidebar_width: 258,
            preview_visible: true,
            preview_ratio: 0.5,
            pv_side_width: PV_SIDE_DEFAULT,
            log_height: LOG_H_DEFAULT,
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

/// M1-10：公式定义（内置库 + 用户自定义共用）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FormulaDef {
    /// 稳定 id（内置：fr-xxx；自定义：c-<时间戳>-<随机>）
    pub id: String,
    /// 展示名
    pub name: String,
    /// LaTeX 内容（内部片段，或 is_env 时的完整环境）
    pub latex: String,
    /// 分类
    pub category: String,
    /// 近似字形/说明（可选）
    pub glyph: Option<String>,
    /// 描述（可选；参与搜索）
    pub desc: Option<String>,
    /// 整段已是完整环境（插入时不套编号/行内包裹）；缺省 false
    pub is_env: bool,
}

/// M1-10：公式模块配置（收藏 / 自定义 / 插入行为）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FormulaConfig {
    /// 收藏的内置公式 id（去重、上限 100）
    pub favorites: Vec<String>,
    /// 用户自定义公式（按 id 去重、上限 200）
    pub custom: Vec<FormulaDef>,
    /// 插入时是否带公式编号：true=equation（编号），false=equation*（无编号）
    pub numbered: bool,
    /// 插入时是否为行内公式：true=$...$，false=display 环境（numbered 不生效）
    pub inline: bool,
}

/// M1-10：收藏数量上限（防呆）
pub const MAX_FAVORITES: usize = 100;
/// M1-10：自定义公式数量上限（防呆）
pub const MAX_CUSTOM_FORMULAS: usize = 200;

/// M1-10：公式配置归一化——favorites 去空白/去重/截断；custom 去空白 + 必填校验 +
/// 按 id 去重（后者覆盖）/截断；numbered/inline 保持布尔。
pub fn normalize_formula(mut f: FormulaConfig) -> FormulaConfig {
    let mut seen: Vec<String> = Vec::new();
    f.favorites.retain(|id| {
        let t = id.trim();
        !t.is_empty() && !seen.iter().any(|s| s == t) && {
            seen.push(t.to_string());
            true
        }
    });
    f.favorites.truncate(MAX_FAVORITES);

    let mut by_id: std::collections::HashMap<String, FormulaDef> = std::collections::HashMap::new();
    for mut d in f.custom.drain(..) {
        let id = d.id.trim().to_string();
        let name = d.name.trim().to_string();
        let latex = d.latex.trim().to_string();
        let category = d.category.trim().to_string();
        if id.is_empty() || name.is_empty() || latex.is_empty() || category.is_empty() {
            continue; // 必填字段缺失 → 丢弃
        }
        d.id = id;
        d.name = name;
        d.latex = latex;
        d.category = category;
        d.glyph = clean_opt_str(d.glyph);
        d.desc = clean_opt_str(d.desc);
        by_id.insert(d.id.clone(), d);
    }
    let mut custom: Vec<FormulaDef> = by_id.into_values().collect();
    custom.truncate(MAX_CUSTOM_FORMULAS);
    f.custom = custom;
    f
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
    /// 保存时自动编译：手动保存 .tex 成功后触发编译（不含自动保存，避免频繁编译）
    pub compile_on_save: bool,
    /// M1-18：实时预览（编辑停止后防抖自动编译；默认关，不改变存量行为）
    pub live_preview: bool,
    /// M1-18：实时预览防抖延迟（毫秒；归一化钳制 200–2000）
    pub live_preview_delay_ms: u32,
    /// M1-9b：编译成功完成后自动清理 LaTeX 辅助文件（.aux/.log/.out 等）
    pub clean_aux_after_compile: bool,
    /// M1-9c：清理辅助文件使用的后缀白名单（含点，如 ".aux"/".synctex.gz"）；
    /// 空=使用内置默认清单（见 fsdoc::DEFAULT_AUX_SUFFIXES）
    #[serde(default)]
    pub clean_aux_extensions: Vec<String>,
}

impl Default for BuildConfig {
    fn default() -> Self {
        BuildConfig {
            save_before_compile: true,
            engine: "auto".to_string(),
            steps: Vec::new(),
            compile_on_save: false,
            live_preview: false,
            live_preview_delay_ms: LIVE_PREVIEW_DELAY_DEFAULT,
            clean_aux_after_compile: false,
            clean_aux_extensions: Vec::new(),
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

/// M1-18：实时预览防抖延迟范围（毫秒；与前端 LIVE_PREVIEW_DELAY_PRESETS / SettingsDialog 一致）
pub const LIVE_PREVIEW_DELAY_MIN: u32 = 200;
pub const LIVE_PREVIEW_DELAY_MAX: u32 = 2000;
pub const LIVE_PREVIEW_DELAY_DEFAULT: u32 = 600;

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

/// M1-8 · 表格模块配置（与前端 AppSettings.table 一一对应）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TableConfig {
    /// 线型：booktabs（三线表）/ grid（全框线）/ plain（无线）
    pub style: String,
    /// 是否带编号（false → table*，不进入表格目录）
    pub numbered: bool,
    /// 浮动位置参数（默认 htbp）
    pub placement: String,
    /// label 前缀（默认 "tab:"）
    pub label_prefix: String,
    /// 单元格转义：smart（保留 $..$ 与命令）/ full / off
    pub escape: String,
    /// 新表默认带表头
    pub header_row: bool,
    /// 面板「＋行」上限（模型硬上限仍为 100）
    pub max_rows: u32,
    /// 面板「＋列」上限（模型硬上限仍为 20）
    pub max_cols: u32,
}

impl Default for TableConfig {
    fn default() -> Self {
        TableConfig {
            style: "booktabs".to_string(),
            numbered: true,
            placement: "htbp".to_string(),
            label_prefix: "tab:".to_string(),
            escape: "smart".to_string(),
            header_row: true,
            max_rows: 100,
            max_cols: 20,
        }
    }
}

/// 表格配置归一化：白名单 + 位置上界 + 行列上限钳制
pub fn normalize_table(mut t: TableConfig) -> TableConfig {
    const STYLES: [&str; 3] = ["booktabs", "grid", "plain"];
    const ESCAPES: [&str; 3] = ["smart", "full", "off"];
    if !STYLES.contains(&t.style.as_str()) {
        t.style = "booktabs".to_string();
    }
    if !ESCAPES.contains(&t.escape.as_str()) {
        t.escape = "smart".to_string();
    }
    // placement 仅允许字母与 '!'（如 htbp / H / !htbp）；空或含非法字符回退默认
    t.placement = t.placement.trim().to_string();
    if t.placement.is_empty()
        || !t
            .placement
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == '!')
    {
        t.placement = "htbp".to_string();
    }
    if t.label_prefix.chars().count() > 24 {
        t.label_prefix = "tab:".to_string();
    }
    t.max_rows = t.max_rows.clamp(1, 100);
    t.max_cols = t.max_cols.clamp(1, 20);
    t
}

/// M1-17：LaTeX 语法高亮配色（数据驱动，与前端 settings.highlight.latex 对应；camelCase）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HighlightConfig {
    /// 高亮分组（有序；顺序决定优先级：靠后更高）
    pub latex: Vec<HighlightGroupConfig>,
}

impl Default for HighlightConfig {
    /// 默认值即「默认 12 组」，与 normalize（空列表兜底默认组）及前端
    /// DEFAULT_SETTINGS.highlight.latex 保持一致——
    /// 避免 AppConfig::default() 与「写盘→读盘」归一化结果不等（往返测试即因此失败）。
    fn default() -> Self {
        HighlightConfig {
            latex: default_highlight(),
        }
    }
}

/// M1-17：单个高亮分组（可扩展：数量不限，tags 为 lezer 标签名；camelCase）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HighlightGroupConfig {
    pub id: String,
    pub label: String,
    /// 该组着色的 lezer 标签名（如 "keyword"、"variableName"）；缺省时由默认同名组补齐
    #[serde(default)]
    pub tags: Vec<String>,
    pub light: String,
    pub dark: String,
}

/// M1-17：LaTeX 语法高亮默认配色（与前端 DEFAULT_LATEX_HIGHLIGHT 一致；id 顺序即优先级）
fn default_highlight() -> Vec<HighlightGroupConfig> {
    vec![
        HighlightGroupConfig { id: "meta".into(), label: "verbatim 内容 / 正文".into(), tags: vec!["meta".into(), "content".into()], light: "#7a828c".into(), dark: "#7e8794".into() },
        HighlightGroupConfig { id: "comment".into(), label: "注释".into(), tags: vec!["comment".into()], light: "#8d959e".into(), dark: "#6b7480".into() },
        HighlightGroupConfig { id: "string".into(), label: "字面参数 / 数字".into(), tags: vec!["string".into(), "number".into()], light: "#9a5b0d".into(), dark: "#e0b169".into() },
        HighlightGroupConfig { id: "keyword".into(), label: "控制序列（\\cmd / \\begin / \\end）".into(), tags: vec!["keyword".into(), "definitionKeyword".into()], light: "#2b62cf".into(), dark: "#7fb0ff".into() },
        HighlightGroupConfig { id: "heading".into(), label: "章节命令".into(), tags: vec!["heading".into()], light: "#1e4fae".into(), dark: "#7fb0ff".into() },
        HighlightGroupConfig { id: "operator".into(), label: "数学符号 / $".into(), tags: vec!["operator".into(), "variableName".into(), "processingInstruction".into()], light: "#9a5b0d".into(), dark: "#e0b169".into() },
        HighlightGroupConfig { id: "bracket".into(), label: "括号".into(), tags: vec!["bracket".into()], light: "#7a828c".into(), dark: "#7e8794".into() },
        HighlightGroupConfig { id: "class".into(), label: "环境名 / \\label / \\ref / \\cite".into(), tags: vec!["className".into(), "labelName".into(), "quote".into()], light: "#0d7a6e".into(), dark: "#6fd3c4".into() },
        HighlightGroupConfig { id: "strong".into(), label: "加粗文本".into(), tags: vec!["strong".into()], light: "#1b1f24".into(), dark: "#e8eaed".into() },
        HighlightGroupConfig { id: "emphasis".into(), label: "斜体文本".into(), tags: vec!["emphasis".into()], light: "#1b1f24".into(), dark: "#e8eaed".into() },
        HighlightGroupConfig { id: "monospace".into(), label: "等宽文本".into(), tags: vec!["monospace".into()], light: "#1b1f24".into(), dark: "#e8eaed".into() },
        HighlightGroupConfig { id: "invalid".into(), label: "非法字符".into(), tags: vec!["invalid".into()], light: "#c2382f".into(), dark: "#f26a60".into() },
    ]
}

/// M1-17：高亮配色归一化（可扩展分组版）。
/// - 已保存列表为空 → 用默认 12 组。
/// - 否则保留已保存分组（覆盖默认），并补齐默认里「已保存缺失」的组（前向兼容，保证默认组不丢失）；
/// - 已保存分组若 tags 为空，用默认同名组的 tags 兜底。
/// 这样主题预设（可含 >12 组）能完整保留，同时未来新增的默认组会自动补入。
pub fn normalize_highlight(h: HighlightConfig) -> HighlightConfig {
    if h.latex.is_empty() {
        return HighlightConfig { latex: default_highlight() };
    }
    let defaults = default_highlight();
    // 以已保存分组建索引（按 id）；tags 为空时用默认同名组的 tags 兜底
    let saved: std::collections::HashMap<String, HighlightGroupConfig> =
        h.latex.into_iter().map(|g| (g.id.clone(), g)).collect();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut latex: Vec<HighlightGroupConfig> = Vec::new();
    // 1) 先按默认 12 组顺序输出（用已保存颜色/tags 覆盖），保证稳定优先级与索引
    for d in defaults {
        let g = match saved.get(&d.id) {
            Some(s) => HighlightGroupConfig {
                id: d.id.clone(),
                label: d.label.clone(),
                tags: if s.tags.is_empty() {
                    d.tags.clone()
                } else {
                    s.tags.clone()
                },
                light: s.light.clone(),
                dark: s.dark.clone(),
            },
            None => d,
        };
        seen.insert(g.id.clone());
        latex.push(g);
    }
    // 2) 再追加默认里没有的「额外分组」（来自主题预设，如更多 lezer 标签）
    for s in saved.values() {
        if seen.contains(&s.id) {
            continue;
        }
        latex.push(HighlightGroupConfig {
            id: s.id.clone(),
            label: s.label.clone(),
            tags: s.tags.clone(),
            light: s.light.clone(),
            dark: s.dark.clone(),
        });
    }
    HighlightConfig { latex }
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
    // M0-13c：会话标签页归一化（去空白/去重/截断；active_file 必须在列表内）
    cfg.session = normalize_session(cfg.session);
    // M1-10：公式配置归一化（收藏去重/截断；自定义校验/去重/截断）
    cfg.formula = normalize_formula(cfg.formula);
    // M1-8：表格配置归一化（线型/转义白名单；位置字符集；行列上限）
    cfg.table = normalize_table(cfg.table);
    // M1-15a：最近项目注册表归一化（去重/截断/排序）
    cfg.recent_projects = normalize_recent(cfg.recent_projects);
    // M1-3：编译引擎白名单 + 流程步骤归一化（非法引擎回退 auto，保持「跟随项目」行为）
    if !BUILD_ENGINES.contains(&cfg.build.engine.as_str()) {
        cfg.build.engine = "auto".to_string();
    }
    cfg.build.steps = normalize_build_steps(cfg.build.steps);
    // M1-18：实时预览防抖延迟钳制（手改配置/旧值越界兜底）
    cfg.build.live_preview_delay_ms = cfg
        .build
        .live_preview_delay_ms
        .clamp(LIVE_PREVIEW_DELAY_MIN, LIVE_PREVIEW_DELAY_MAX);
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
    // M1-16：日志面板高度钳制（拖拽已限幅，此处兜底手改配置）
    cfg.layout.log_height = cfg.layout.log_height.clamp(LOG_H_MIN, LOG_H_MAX);
    // M1-17：LaTeX 语法高亮配色归一化（以默认 12 组为蓝本，覆盖已保存颜色）
    cfg.highlight = normalize_highlight(cfg.highlight);
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
        cfg.build.compile_on_save = true;
        cfg.build.clean_aux_after_compile = true;
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
        cfg.layout.log_height = 320;
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
        assert!(text.contains("compileOnSave"));
        // M1-18 字段
        assert!(text.contains("livePreview"));
        assert!(text.contains("livePreviewDelayMs"));
        assert!(text.contains("defaultZoom"));
        // M0-13 字段
        assert!(text.contains("lastProject"));
        assert!(text.contains("sidebarWidth"));
        assert!(text.contains("previewRatio"));
        assert!(text.contains("pvSideWidth"));
        // M1-16 字段
        assert!(text.contains("logHeight"));
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
        // M1-8 字段（表格模块）
        assert!(text.contains("\"table\""));
        assert!(text.contains("\"labelPrefix\":\"tab:\""));
        assert!(text.contains("\"headerRow\":true"));
        assert!(text.contains("\"maxRows\":100"));
        assert!(text.contains("\"style\":\"booktabs\""));
        // snake_case 不应出现
        assert!(!text.contains("font_family"));
        assert!(!text.contains("interval_seconds"));
        assert!(!text.contains("last_project"));
        assert!(!text.contains("label_prefix"));
        assert!(!text.contains("header_row"));
    }

    #[test]
    fn normalize_table_clamps_invalid_values() {
        let mut t = TableConfig {
            style: "fancy".to_string(),
            numbered: false,
            placement: " htbp ".to_string(),
            label_prefix: "tab:".to_string(),
            escape: "raw".to_string(),
            header_row: false,
            max_rows: 9999,
            max_cols: 0,
        };
        t = normalize_table(t);
        assert_eq!(t.style, "booktabs");
        assert_eq!(t.escape, "smart");
        assert_eq!(t.placement, "htbp"); // 去空白后合法
        assert_eq!(t.max_rows, 100);
        assert_eq!(t.max_cols, 1);

        let mut bad = TableConfig::default();
        bad.placement = "htbp; rm -rf".to_string();
        assert_eq!(normalize_table(bad).placement, "htbp");
        assert_eq!(normalize_table(TableConfig::default()).placement, "htbp");
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
    fn session_open_files_roundtrip_and_normalize() {
        // M0-13c：open_files/active_file 往返保留；旧配置缺字段 → 空
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" },
            "session": {
                "lastProject": "D:/proj",
                "openFiles": ["D:/proj/main.tex", "D:/proj/chap/intro.tex"],
                "activeFile": "D:/proj/chap/intro.tex"
            }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.session.open_files.len(), 2);
        assert_eq!(
            parsed.session.active_file.as_deref(),
            Some("D:/proj/chap/intro.tex")
        );
        // camelCase 键名往返
        let text = serde_json::to_string(&parsed).unwrap();
        assert!(text.contains("\"openFiles\""));
        assert!(text.contains("\"activeFile\""));

        // 归一化：去空白项/去重/截断；active_file 不在列表内 → None
        let mut cfg = AppConfig::default();
        cfg.session.open_files = vec![
            "  ".into(),
            "D:/a.tex".into(),
            "D:/a.tex".into(),
            "D:/b.tex".into(),
        ];
        cfg.session.active_file = Some("D:/ghost.tex".into());
        let got = normalize(cfg);
        assert_eq!(got.session.open_files, vec!["D:/a.tex", "D:/b.tex"]);
        assert_eq!(got.session.active_file, None);

        let mut many = AppConfig::default();
        many.session.open_files = (0..60).map(|i| format!("D:/f{i}.tex")).collect();
        many.session.active_file = Some("D:/f59.tex".into());
        let got = normalize(many);
        assert_eq!(got.session.open_files.len(), MAX_OPEN_FILES);
        assert_eq!(got.session.active_file, None); // 被截断掉
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

    #[test]
    fn formula_default_and_normalize() {
        // 缺 formula 字段 → serde default（空收藏/空自定义/编号关/行内关）
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert!(parsed.formula.favorites.is_empty());
        assert!(parsed.formula.custom.is_empty());
        assert!(!parsed.formula.numbered);
        assert!(!parsed.formula.inline);

        // camelCase 键名往返
        let text = serde_json::to_string(&parsed).unwrap();
        assert!(text.contains("\"formula\""));
        assert!(text.contains("\"favorites\""));
        assert!(text.contains("\"custom\""));
        assert!(text.contains("\"numbered\""));
        assert!(text.contains("\"inline\""));

        // 归一化：favorites 去空白/去重/截断；custom 必填校验 + 按 id 去重/截断
        let mut cfg = AppConfig::default();
        cfg.formula.favorites = vec![
            "fr-a".into(),
            "  ".into(),
            "fr-a".into(),
            "fr-b".into(),
        ];
        cfg.formula.custom = vec![
            // 必填缺失应被丢弃
            FormulaDef {
                id: "".into(),
                name: "坏".into(),
                latex: "x".into(),
                category: "c".into(),
                ..Default::default()
            },
            // 正常条目：空白应被 trim
            FormulaDef {
                id: "c1".into(),
                name: "  A  ".into(),
                latex: " \\alpha ".into(),
                category: "  trig  ".into(),
                glyph: Some("  α  ".into()),
                ..Default::default()
            },
            // 同 id 后者覆盖前者
            FormulaDef {
                id: "c1".into(),
                name: "B".into(),
                latex: "y".into(),
                category: "c".into(),
                ..Default::default()
            },
            // 另一条目：单独验证 trim
            FormulaDef {
                id: "c2".into(),
                name: "  D  ".into(),
                latex: " z ".into(),
                category: "  k  ".into(),
                ..Default::default()
            },
        ];
        let got = normalize_formula(cfg.formula);
        assert_eq!(got.favorites, vec!["fr-a".to_string(), "fr-b".to_string()]);
        // c1 出现两次 → 去重保留后者（B）；c2 正常；空 id 条目被丢弃
        assert_eq!(got.custom.len(), 2);
        let by_id: std::collections::HashMap<&str, &FormulaDef> =
            got.custom.iter().map(|d| (d.id.as_str(), d)).collect();
        let c1 = by_id.get("c1").unwrap();
        assert_eq!(c1.name, "B"); // 后者覆盖前者
        assert_eq!(c1.latex, "y");
        assert_eq!(c1.category, "c");
        assert_eq!(c1.glyph, None); // 后者无 glyph
        let c2 = by_id.get("c2").unwrap();
        assert_eq!(c2.name, "D"); // 空白被 trim
        assert_eq!(c2.latex, "z");
        assert_eq!(c2.category, "k");
    }

    #[test]
    fn recent_projects_normalize_dedup_sort_cap() {
        // 空 → 空
        assert!(normalize_recent(Vec::new()).is_empty());

        // 清洗：name 空白回退目录名；空 path 丢弃；去重保留最后出现者
        let raw = vec![
            ProjectEntry {
                path: "  D:/a  ".into(),
                name: "  ".into(),
                template_id: Some("  t1  ".into()),
                pinned: false,
                archived: false,
                last_opened: Some(" 2026-01-01T00:00:00Z  ".into()),
            },
            ProjectEntry {
                path: "D:/a".into(), // 与上面去重（path 去空白后相同）
                name: "A2".into(),
                template_id: None,
                pinned: true,
                archived: false,
                last_opened: Some("2026-03-01T00:00:00Z".into()),
            },
            ProjectEntry {
                path: "D:/b".into(),
                name: "B".into(),
                template_id: None,
                pinned: false,
                archived: true, // 归档应在后
                last_opened: None,
            },
            ProjectEntry {
                path: "".into(), // 空 path → 丢弃
                name: "ghost".into(),
                template_id: None,
                pinned: true,
                archived: false,
                last_opened: None,
            },
        ];
        let got = normalize_recent(raw);
        // 去重后 D:/a 仅一条（保留「最后出现者」→ A2；template_id 随后者为 None）
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].path, "D:/a");
        assert_eq!(got[0].name, "A2");
        assert_eq!(got[0].template_id, None);
        assert!(got[0].pinned);
        assert_eq!(got[0].last_opened.as_deref(), Some("2026-03-01T00:00:00Z"));
        // 归档项在后
        assert_eq!(got[1].path, "D:/b");
        assert!(got[1].archived);
        // 空 path 被丢弃

        // 排序：未归档 + 置顶 + 最近在前
        let raw = vec![
            ProjectEntry {
                path: "D:/old".into(),
                name: "old".into(),
                template_id: None,
                pinned: false,
                archived: false,
                last_opened: Some("2026-01-01T00:00:00Z".into()),
            },
            ProjectEntry {
                path: "D:/pinned".into(),
                name: "pinned".into(),
                template_id: None,
                pinned: true,
                archived: false,
                last_opened: Some("2026-01-01T00:00:00Z".into()),
            },
            ProjectEntry {
                path: "D:/new".into(),
                name: "new".into(),
                template_id: None,
                pinned: false,
                archived: false,
                last_opened: Some("2026-05-01T00:00:00Z".into()),
            },
            ProjectEntry {
                path: "D:/arch".into(),
                name: "arch".into(),
                template_id: None,
                pinned: false,
                archived: true,
                last_opened: Some("2026-09-01T00:00:00Z".into()),
            },
        ];
        let got = normalize_recent(raw);
        let order: Vec<&str> = got.iter().map(|e| e.path.as_str()).collect();
        // 期望：pinned（置顶）→ new（最近）→ old（较旧）→ arch（归档最后）
        assert_eq!(order, vec!["D:/pinned", "D:/new", "D:/old", "D:/arch"]);

        // 截断至上限：造 25 条，期望保留 20 条
        let many: Vec<ProjectEntry> = (0..25)
            .map(|i| ProjectEntry {
                path: format!("D:/p{i}"),
                name: format!("p{i}"),
                template_id: None,
                pinned: false,
                archived: false,
                last_opened: Some(format!("2026-12-{:02}T00:00:00Z", (i % 28) + 1)),
            })
            .collect();
        assert_eq!(normalize_recent(many).len(), MAX_RECENT);
    }

    #[test]
    fn recent_projects_camel_case_keys() {
        let mut cfg = AppConfig::default();
        cfg.recent_projects = vec![ProjectEntry {
            path: "D:/x".into(),
            name: "x".into(),
            template_id: Some("t".into()),
            pinned: true,
            archived: false,
            last_opened: Some("2026-01-01T00:00:00Z".into()),
        }];
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"recentProjects\""));
        assert!(text.contains("\"templateId\""));
        assert!(text.contains("\"pinned\""));
        assert!(text.contains("\"archived\""));
        assert!(text.contains("\"lastOpened\""));
        // snake_case 不应出现
        assert!(!text.contains("recent_projects"));
        assert!(!text.contains("template_id"));
        assert!(!text.contains("last_opened"));
    }

    #[test]
    fn highlight_default_camel_case_and_roundtrip() {
        // M1-17：缺 highlight 字段 → serde default（空 latex）→ normalize 补全 12 组默认配色
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let norm = normalize(parsed);
        assert_eq!(norm.highlight.latex.len(), 12);
        assert_eq!(norm.highlight.latex[3].id, "keyword");
        // 默认 keyword 亮色 = 前端 DEFAULT_LATEX_HIGHLIGHT 一致
        assert_eq!(norm.highlight.latex[3].light, "#2b62cf");

        // camelCase 键名
        let text = serde_json::to_string(&norm).unwrap();
        assert!(text.contains("\"highlight\""));
        assert!(text.contains("\"latex\""));
        assert!(text.contains("\"light\""));
        assert!(text.contains("\"dark\""));

        // 自定义颜色往返保留（只改 keyword 的亮色）
        // 注意：AppConfig::default() 的 highlight.latex 为空，须经 normalize 补全 12 组后再改
        let mut cfg = normalize(AppConfig::default());
        cfg.highlight.latex[3].light = "#ff0000".to_string();
        let text = serde_json::to_string(&cfg).unwrap();
        let back = serde_json::from_str::<AppConfig>(&text).unwrap();
        assert_eq!(normalize(back).highlight.latex[3].light, "#ff0000");
    }

    #[test]
    fn highlight_normalize_fills_missing_groups() {
        // 仅提供 1 个分组 → normalize 以默认 12 组为蓝本，补齐全部分组
        let raw = json!({
            "highlight": {
                "latex": [ { "id": "keyword", "label": "K", "light": "#123456", "dark": "#654321" } ]
            }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let norm = normalize(parsed);
        assert_eq!(norm.highlight.latex.len(), 12);
        // 已提供分组用其颜色
        assert_eq!(norm.highlight.latex[3].light, "#123456");
        assert_eq!(norm.highlight.latex[3].dark, "#654321");
        // 缺失分组回落默认
        assert_eq!(norm.highlight.latex[0].id, "meta");
        assert_eq!(norm.highlight.latex[0].light, "#7a828c");
        // 缺省 label 被默认 label 补齐
        assert_eq!(norm.highlight.latex[3].label, "控制序列（\\cmd / \\begin / \\end）");
        // 缺省 tags 被默认同名组的 tags 补齐（keyword 应有 ["keyword","definitionKeyword"]）
        assert!(norm.highlight.latex[3].tags.contains(&"keyword".to_string()));
        assert!(norm.highlight.latex[3].tags.contains(&"definitionKeyword".to_string()));
    }

    #[test]
    fn highlight_normalize_preserves_extra_preset_groups() {
        // M1-17 扩展：主题预设可含默认之外的分组（如 propertyName），归一化后应保留
        let raw = json!({
            "highlight": {
                "latex": [
                    { "id": "keyword", "label": "K", "tags": ["keyword"], "light": "#111111", "dark": "#222222" },
                    { "id": "propertyName", "label": "属性名", "tags": ["propertyName"], "light": "#333333", "dark": "#444444" }
                ]
            }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        let norm = normalize(parsed);
        // 默认 12 组 + 1 个额外分组（propertyName）
        assert_eq!(norm.highlight.latex.len(), 13);
        let extra = norm.highlight.latex.iter().find(|g| g.id == "propertyName").unwrap();
        assert_eq!(extra.light, "#333333");
    }

    #[test]
    fn live_preview_default_and_normalize() {
        // M1-18：旧配置缺字段 → 默认关 + 600ms（不改变存量「按需编译」行为）
        let raw = json!({
            "schemaVersion": 1,
            "editor": { "fontFamily": "IBM Plex Mono", "fontSize": 13, "lineWrapping": true, "mouseWheelZoom": true },
            "autosave": { "enabled": true, "intervalSeconds": 30, "pauseWhileCompiling": true },
            "build": { "saveBeforeCompile": true },
            "pdf": { "defaultZoom": "fit-width" }
        });
        let parsed: AppConfig = serde_json::from_value(raw).unwrap();
        assert!(!parsed.build.live_preview);
        assert_eq!(parsed.build.live_preview_delay_ms, LIVE_PREVIEW_DELAY_DEFAULT);

        // 显式值往返保留 + camelCase 键名
        let mut cfg = AppConfig::default();
        cfg.build.live_preview = true;
        cfg.build.live_preview_delay_ms = 800;
        let text = serde_json::to_string(&cfg).unwrap();
        assert!(text.contains("\"livePreview\":true"));
        assert!(text.contains("\"livePreviewDelayMs\":800"));
        let back = serde_json::from_str::<AppConfig>(&text).unwrap();
        assert!(back.build.live_preview);
        assert_eq!(back.build.live_preview_delay_ms, 800);

        // 归一化：越界延迟被钳制到 [200, 2000]
        let mut low = AppConfig::default();
        low.build.live_preview_delay_ms = 10;
        assert_eq!(
            normalize(low).build.live_preview_delay_ms,
            LIVE_PREVIEW_DELAY_MIN
        );
        let mut high = AppConfig::default();
        high.build.live_preview_delay_ms = 99999;
        assert_eq!(
            normalize(high).build.live_preview_delay_ms,
            LIVE_PREVIEW_DELAY_MAX
        );
    }
}
