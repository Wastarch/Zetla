// 模板引擎（开发文档 §5，M0-7 交付）—— manifest 解析 / 变量校验 / 渲染 / 按结构生成项目
// MVP 收敛口径（§5.0）：内置 2 套单文件模板（article / ctex-cn），schema 只解析子集，
// 渲染器只做 <%= var %> 替换（刻意避开 LaTeX 的 {{}}），condition/用户模板/多文件模板 → M1/M3。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::Manager;
use walkdir::WalkDir;

use crate::commands::config::CONFIG_DIR_NAME;
use crate::commands::project::{is_aux_file, EXPORT_SKIP_DIRS};

// ── 类型（与 src/types/template.ts 对齐，manifest JSON 为 camelCase） ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMeta {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// M1-15e：是否为用户模板（%APPDATA%/Zetla/templates）
    pub is_user: bool,
    /// 编译引擎（列表项展示，省去逐个拉 manifest）
    pub engine: String,
}

fn meta_from(m: &TemplateManifest, is_user: bool) -> TemplateMeta {
    TemplateMeta {
        id: m.id.clone(),
        name: m.name.clone(),
        description: m.description.clone(),
        category: m.category.clone(),
        tags: m.tags.clone(),
        version: m.version.clone(),
        is_user,
        engine: m.build.engine.clone(),
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateManifest {
    #[serde(default = "d_schema_version")]
    pub schema_version: String,
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub version: Option<String>,
    #[serde(default)]
    pub build: BuildConfig,
    #[serde(default)]
    pub dependencies: Dependencies,
    #[serde(default)]
    pub variables: Vec<TemplateVar>,
    #[serde(default)]
    pub structure: Structure,
}

fn d_schema_version() -> String {
    "1.0".into()
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildConfig {
    #[serde(default = "d_engine")]
    pub engine: String,
    #[serde(default = "d_main_file")]
    pub main_file: String,
    #[serde(default = "d_output_dir")]
    pub output_dir: String,
    #[serde(default = "d_true")]
    pub synctex: bool,
}

impl Default for BuildConfig {
    fn default() -> Self {
        Self {
            engine: d_engine(),
            main_file: d_main_file(),
            output_dir: d_output_dir(),
            synctex: true,
        }
    }
}

fn d_engine() -> String {
    "xelatex".into()
}
fn d_main_file() -> String {
    "main.tex".into()
}
fn d_output_dir() -> String {
    "build".into()
}
fn d_true() -> bool {
    true
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependencies {
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub assets: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateVar {
    pub key: String,
    pub label: String,
    #[serde(rename = "type", default)]
    pub var_type: VarType,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub help: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VarType {
    #[default]
    String,
    Text,
    Select,
    Multiselect,
    Bool,
    Number,
    Date,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Structure {
    #[serde(default)]
    pub dirs: Vec<String>,
    #[serde(default)]
    pub files: Vec<FileSpec>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSpec {
    pub target: String,
    pub source: String,
    #[serde(default = "d_true")]
    pub render: bool,
    #[serde(default)]
    pub condition: Option<String>, // P1：条件文件（MVP 忽略，一律生成）
}

/// create_project 返回（与 src/types/project.ts ProjectInfo 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub template_id: String,
    pub engine: String,
    pub main_file: String,
    pub output_dir: String,
}

// ── 模板目录定位 ──────────────────────────────────────────

/// 内置模板目录：打包资源（bundle.resources templates/**）→ dev 兜底（CWD/src-tauri）
fn resolve_templates_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        for cand in [
            res.join("templates"),
            res.join("resources").join("templates"),
        ] {
            if cand.is_dir() {
                return cand;
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    for cand in [
        cwd.join("templates"),
        cwd.join("src-tauri").join("templates"),
    ] {
        if cand.is_dir() {
            return cand;
        }
    }
    cwd.join("templates")
}

/// M1-15e：用户模板目录（%APPDATA%/Zetla/templates；不存在则创建）
fn user_templates_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("解析配置目录失败: {}", e))?
        .join(CONFIG_DIR_NAME)
        .join("templates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建用户模板目录失败: {}", e))?;
    Ok(dir)
}

/// 按 id 解析模板包所在根目录（用户模板优先；返回包含 `<id>/manifest.json` 的父目录）
fn resolve_template_root(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    let user_dir = user_templates_dir(app)?;
    if user_dir.join(id).join("manifest.json").is_file() {
        return Ok(user_dir);
    }
    Ok(resolve_templates_dir(app))
}

// ── 引擎核心（可测试：全部以 tpl_root 为参数） ────────────

/// 模板 id 白名单校验（防路径穿越）
fn guard_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("非法模板 id: {}", id));
    }
    Ok(())
}

/// 包内/项目内相对路径：拒绝空、绝对路径与 `..` 逃逸
fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty()
        || Path::new(rel).is_absolute()
        || rel.split(['/', '\\']).any(|s| s == "..")
    {
        return Err(format!("非法路径: {}", rel));
    }
    Ok(base.join(rel))
}

fn list_templates_in(tpl_root: &Path) -> Vec<TemplateMeta> {
    list_templates_in_src(tpl_root, false)
}

fn list_templates_in_src(tpl_root: &Path, is_user: bool) -> Vec<TemplateMeta> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(tpl_root) {
        for entry in rd.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(dir.join("manifest.json")) else {
                continue;
            };
            let Ok(m) = serde_json::from_str::<TemplateManifest>(&text) else {
                continue;
            };
            let dir_name = dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if guard_id(&m.id).is_err() || m.id != dir_name {
                continue;
            }
            out.push(meta_from(&m, is_user));
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn load_manifest(tpl_root: &Path, id: &str) -> Result<TemplateManifest, String> {
    guard_id(id)?;
    let dir = tpl_root.join(id);
    let text = std::fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("模板不存在 {}: {}", id, e))?;
    let manifest: TemplateManifest =
        serde_json::from_str(&text).map_err(|e| format!("清单解析失败 {}: {}", id, e))?;
    if manifest.id != id {
        return Err(format!(
            "清单 id 与目录不一致: 目录 {} ≠ id {}",
            id, manifest.id
        ));
    }
    Ok(manifest)
}

/// manifest 变量默认值表（key → 字符串）
fn default_map(m: &TemplateManifest) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for v in &m.variables {
        if let Some(d) = &v.default {
            out.insert(v.key.clone(), value_to_string(d));
        }
    }
    out
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// 极简渲染器（§5.4）：支持 `<%= var %>` 替换与 `<% if KEY %>…<% else %>…<% endif %>`
/// 条件块（可嵌套）；未提供变量回退 manifest 默认值，再回退空串。
fn render_template(
    src: &str,
    vars: &HashMap<String, Value>,
    defaults: &HashMap<String, String>,
) -> String {
    render_inner(src, vars, defaults)
}

/// 取出变量值（vars 优先，其次 defaults 文本）
fn lookup_value<'a>(
    key: &str,
    vars: &'a HashMap<String, Value>,
    defaults: &HashMap<String, String>,
) -> Option<Value> {
    if let Some(v) = vars.get(key) {
        Some(v.clone())
    } else {
        defaults.get(key).map(|d| Value::String(d.clone()))
    }
}

/// 真值判定（与模板语义一致）
fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Value::Array(a) => !a.is_empty(),
        Value::Null => false,
        Value::Object(_) => true,
    }
}

/// 递归渲染：处理表达式替换与条件块
fn render_inner(
    src: &str,
    vars: &HashMap<String, Value>,
    defaults: &HashMap<String, String>,
) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(open) = rest.find("<%") {
        out.push_str(&rest[..open]);
        let after = &rest[open + 2..];
        let Some(close) = after.find("%>") else {
            // 未闭合：原样保留剩余
            out.push_str(&rest[open..]);
            return out;
        };
        let tag = after[..close].trim();
        let tail = &after[close + 2..];

        if let Some(expr) = tag.strip_prefix('=') {
            let key = expr.trim();
            let val = lookup_value(key, vars, defaults)
                .map(|v| value_to_string(&v))
                .unwrap_or_default();
            out.push_str(&val);
            rest = tail;
        } else if let Some(cond_key) = tag.strip_prefix("if ") {
            let key = cond_key.trim();
            let truthy = lookup_value(key, vars, defaults)
                .map(|v| is_truthy(&v))
                .unwrap_or(false);
            let (consumed, branch) = split_if_block(tail, truthy);
            out.push_str(&render_inner(branch, vars, defaults));
            rest = &tail[consumed..];
        } else {
            // else / endif / 未知标签：跳过
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// 解析 if 块：返回 (消耗的字节数, 选中分支文本)。
/// truthy=true → if 与 else(若有) 之间；false → else 与 endif 之间（无 else 则空）。
/// 进入时已在 if 体内部，故 depth 从 1 起算，自身层级的 else/endif 在 depth==1 命中。
fn split_if_block(body: &str, truthy: bool) -> (usize, &str) {
    let mut depth: usize = 1;
    let mut i = 0;
    let mut else_start: Option<usize> = None;
    let mut else_after: Option<usize> = None;
    while let Some(open) = body[i..].find("<%") {
        let abs = i + open;
        let after = &body[abs + 2..];
        let Some(close) = after.find("%>") else {
            break;
        };
        let tag = after[..close].trim();
        let tag_end = abs + 2 + close + 2;
        if tag == "endif" {
            if depth == 1 {
                if truthy {
                    let before = else_start.map(|es| &body[..es]).unwrap_or(&body[..abs]);
                    return (tag_end, before);
                }
                let chosen = else_after.map(|ea| &body[ea..abs]).unwrap_or("");
                return (tag_end, chosen);
            }
            depth -= 1;
        } else if tag == "else" {
            if depth == 1 && else_start.is_none() {
                else_start = Some(abs);
                else_after = Some(tag_end);
            }
        } else if tag.strip_prefix("if ").is_some() {
            depth += 1;
        }
        i = tag_end;
    }
    (body.len(), if truthy { body } else { "" })
}

fn create_project_in(
    tpl_root: &Path,
    template_id: &str,
    vars: &HashMap<String, Value>,
    target_path: &str,
) -> Result<ProjectInfo, String> {
    let manifest = load_manifest(tpl_root, template_id)?;
    let pkg = tpl_root.join(template_id);
    let defaults = default_map(&manifest);

    // 必填校验：required 且未提供且无默认值 → 报错
    for v in &manifest.variables {
        if v.required && !vars.contains_key(&v.key) && !defaults.contains_key(&v.key) {
            return Err(format!("缺少必填变量：{}（{}）", v.label, v.key));
        }
    }

    if target_path.trim().is_empty() {
        return Err("目标路径为空".into());
    }
    let root = PathBuf::from(target_path);
    if root.exists() && !root.is_dir() {
        return Err(format!("目标已存在且不是目录: {}", target_path));
    }
    let main_abs = root.join(&manifest.build.main_file);
    if main_abs.exists() {
        return Err(format!(
            "目标已存在主文件 {}（请换目录或先删除）",
            main_abs.display()
        ));
    }
    std::fs::create_dir_all(&root).map_err(|e| format!("创建项目目录失败: {}", e))?;

    // 空目录
    for d in &manifest.structure.dirs {
        let p = safe_join(&root, d)?;
        std::fs::create_dir_all(&p).map_err(|e| format!("创建目录失败 {}: {}", d, e))?;
    }

    // 文件（render=true 用变量渲染；否则原样复制；condition P1 忽略）
    for f in &manifest.structure.files {
        let src_p = safe_join(&pkg, &f.source)?;
        let dst_p = safe_join(&root, &f.target)?;
        if let Some(parent) = dst_p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        if f.render {
            let text = std::fs::read_to_string(&src_p)
                .map_err(|e| format!("读取模板文件失败 {}: {}", f.source, e))?;
            let out = render_template(&text, vars, &defaults);
            std::fs::write(&dst_p, out).map_err(|e| format!("写入失败 {}: {}", f.target, e))?;
        } else {
            std::fs::copy(&src_p, &dst_p).map_err(|e| format!("复制失败 {}: {}", f.source, e))?;
        }
    }

    // 依赖资源（cls/sty 等原样复制；MVP 单文件模板为空列表）
    for a in &manifest.dependencies.assets {
        let src_p = safe_join(&pkg, a)?;
        let dst_p = safe_join(&root, a)?;
        if let Some(parent) = dst_p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        std::fs::copy(&src_p, &dst_p).map_err(|e| format!("复制资源失败 {}: {}", a, e))?;
    }

    // 写 .ltex/config.json（项目权威入口；scan_project 优先读它）
    let cfg_dir = root.join(".ltex");
    std::fs::create_dir_all(&cfg_dir).map_err(|e| format!("创建 .ltex 失败: {}", e))?;
    let cfg = serde_json::json!({
        "engine": manifest.build.engine,
        "mainFile": manifest.build.main_file,
        "outputDir": manifest.build.output_dir,
        "templateId": manifest.id,
    });
    std::fs::write(
        cfg_dir.join("config.json"),
        serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入 .ltex/config.json 失败: {}", e))?;

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| target_path.to_string());
    Ok(ProjectInfo {
        path: root.to_string_lossy().into_owned(),
        name,
        template_id: manifest.id.clone(),
        engine: manifest.build.engine.clone(),
        main_file: main_abs.to_string_lossy().into_owned(),
        output_dir: manifest.build.output_dir.clone(),
    })
}

// ── M1-15e · 模板库管理（用户模板：另存为 / 导入） ──────────

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 名称 → 模板 id slug（ASCII 字母数字，其他折叠为 `-`；空则 `template`）
fn slugify(name: &str) -> String {
    let mut s = String::new();
    let mut dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash {
            s.push('-');
            dash = true;
        }
    }
    let trimmed = s.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "template".into()
    } else {
        trimmed
    }
}

/// 另存模板时跳过的目录（编译产物/隐藏/重型）
fn skip_project_dir(name: &str) -> bool {
    name == ".ltex"
        || name.eq_ignore_ascii_case("build")
        || name.eq_ignore_ascii_case("out")
        || EXPORT_SKIP_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
}

fn is_tex_path(p: &Path) -> bool {
    p.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("tex"))
        .unwrap_or(false)
}

/// 选主文件：config 指定（需存在）→ main.tex → 首个 .tex → "main.tex"
fn pick_main_tex(root: &Path, configured: &str) -> String {
    if !configured.trim().is_empty() && root.join(configured).is_file() {
        return configured.to_string();
    }
    if root.join("main.tex").is_file() {
        return "main.tex".into();
    }
    for entry in WalkDir::new(root).follow_links(false) {
        let Ok(e) = entry else { continue };
        if e.depth() == 0 || e.file_type().is_dir() || !is_tex_path(e.path()) {
            continue;
        }
        if let Ok(rel) = e.path().strip_prefix(root) {
            return rel.to_string_lossy().replace('\\', "/");
        }
    }
    "main.tex".into()
}

/// 读项目 `.ltex/config.json` 的 (engine, mainFile, outputDir)
fn read_project_build(root: &Path) -> (String, String, String) {
    let mut engine = "xelatex".to_string();
    let mut main = String::new();
    let mut output = "build".to_string();
    if let Ok(text) = std::fs::read_to_string(root.join(".ltex").join("config.json")) {
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if let Some(e) = v.get("engine").and_then(|x| x.as_str()) {
                if matches!(e, "xelatex" | "pdflatex" | "lualatex" | "latexmk") {
                    engine = e.to_string();
                }
            }
            if let Some(m) = v.get("mainFile").and_then(|x| x.as_str()) {
                main = m.to_string();
            }
            if let Some(o) = v.get("outputDir").and_then(|x| x.as_str()) {
                output = o.to_string();
            }
        }
    }
    let main = pick_main_tex(root, &main);
    (engine, main, output)
}

/// 收集项目文件（跳过 .ltex/编译产物/重型目录/辅助文件），返回 (绝对路径, 相对路径正斜杠)
fn collect_project_files(root: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            e.depth() == 0 || !skip_project_dir(&name)
        })
    {
        let Ok(e) = entry else { continue };
        if e.depth() == 0 || e.file_type().is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy();
        if is_aux_file(&name) {
            continue;
        }
        let Ok(rel) = e.path().strip_prefix(root) else {
            continue;
        };
        out.push((e.path().to_path_buf(), rel.to_string_lossy().replace('\\', "/")));
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

/// 递归复制目录（用于导入模板）
fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {}", e))?;
    for entry in WalkDir::new(src).follow_links(false) {
        let e = entry.map_err(|e| format!("遍历失败: {}", e))?;
        let Ok(rel) = e.path().strip_prefix(src) else {
            continue;
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = dst.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            std::fs::copy(e.path(), &target).map_err(|e| format!("复制失败: {}", e))?;
        }
    }
    Ok(())
}

/// 解压 zip 到 dst（用 enclosed_name 防路径穿越）
fn extract_zip(src: &Path, dst: &Path) -> Result<(), String> {
    let file = std::fs::File::open(src).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut z = zip::ZipArchive::new(file).map_err(|e| format!("读取压缩包失败: {}", e))?;
    for i in 0..z.len() {
        let mut f = z
            .by_index(i)
            .map_err(|e| format!("读取压缩包条目失败: {}", e))?;
        let Some(rel) = f.enclosed_name() else {
            continue; // 路径穿越条目跳过
        };
        let out = dst.join(&rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            let mut w = std::fs::File::create(&out).map_err(|e| format!("写入失败: {}", e))?;
            std::io::copy(&mut f, &mut w).map_err(|e| format!("解压写入失败: {}", e))?;
        }
    }
    Ok(())
}

/// 校验 manifest（导入时把关坏包）：变量 key 规则 / 重复 / 保留字 / 选项完备性
fn validate_manifest(m: &TemplateManifest) -> Result<(), String> {
    if m.id.trim().is_empty() {
        return Err("模板 id 不能为空".into());
    }
    if m.name.trim().is_empty() {
        return Err("模板名不能为空".into());
    }
    validate_vars(&m.variables)
}

/// 变量定义合法性：key 命名规则、去重、保留字、label 必填、select/multiselect 需选项
fn validate_vars(vars: &[TemplateVar]) -> Result<(), String> {
    let mut seen: HashSet<&str> = HashSet::new();
    for v in vars {
        let k = v.key.trim();
        if k.is_empty() {
            return Err("变量名不能为空".into());
        }
        let first_ok = k.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_');
        let rest_ok = k
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_');
        if first_ok != Some(true) || !rest_ok {
            return Err(format!("变量名不合法（仅限字母/数字/下划线，且不以数字开头）: {}", k));
        }
        if matches!(k, "if" | "else" | "endif") {
            return Err(format!("变量名不能使用渲染器保留字: {}", k));
        }
        if !seen.insert(k) {
            return Err(format!("变量名重复: {}", k));
        }
        if v.label.trim().is_empty() {
            return Err(format!("变量 {} 缺少显示名（label）", k));
        }
        if matches!(v.var_type, VarType::Select | VarType::Multiselect)
            && v.options.iter().all(|o| o.trim().is_empty())
        {
            return Err(format!("变量 {} 为选择类型，但未提供任何选项", k));
        }
    }
    Ok(())
}

/// 在解压/导入根中定位包含 manifest.json 的模板包目录（根或唯一一层子目录）
fn find_pkg_root(dir: &Path) -> Result<PathBuf, String> {
    if dir.join("manifest.json").is_file() {
        return Ok(dir.to_path_buf());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && p.join("manifest.json").is_file() {
                candidates.push(p);
            }
        }
    }
    if candidates.len() == 1 {
        Ok(candidates.remove(0))
    } else {
        Err("未找到 manifest.json（模板包需包含清单）".into())
    }
}

// ── 根据项目制作模板（M1-16）──────────────────────────────
//
// 与旧「另存为模板」的区别：带 variables（向导表单）+ 统一导出 zip 交换格式。
// 变量来源三层：自动提取候选（\title/\author/\date）→ 向导确认/补充 → 生成时严格回填。

/// 自动候选变量绑定的 LaTeX 命令（key 与命令同名）：制作模板时回填为 <%= key %>
const BOUND_CMDS: [&str; 3] = ["title", "author", "date"];

const CMD_LABELS: [&str; 3] = ["标题", "作者", "日期"];

/// 在一行内定位 `\cmd{ value }`，返回值的字节区间 [start, end)（不含花括号）。
/// 严格口径：值内出现 `{`（嵌套）视为复杂值不处理；`\cmd` 后需为空白再到 `{`；
/// `\cmd` 后跟字母（如 \titlepage）不算匹配。
fn find_cmd_value_range(line: &str, cmd: &str) -> Option<(usize, usize)> {
    let pat = format!("\\{}", cmd);
    let bytes = line.as_bytes();
    let mut from = 0usize;
    while let Some(pos) = line[from..].find(&pat) {
        let at = from + pos;
        let after = at + pat.len();
        // 命令名必须完整（\titlefoo 不算 \title）
        if bytes
            .get(after)
            .map(|b| b.is_ascii_alphabetic())
            .unwrap_or(false)
        {
            from = after;
            continue;
        }
        // \cmd 与 { 之间只允许空白
        let mut i = after;
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
            i += 1;
        }
        if bytes.get(i) != Some(&b'{') {
            from = after;
            continue;
        }
        // 扫描闭合 }：中途出现 { 视为嵌套，放弃该命令
        let inner_start = i + 1;
        let mut j = inner_start;
        while j < bytes.len() {
            match bytes[j] {
                b'{' => return None,
                b'}' => {
                    // 内部已是占位符（回填过）→ 跳过该次出现，继续向后找
                    let inner = &line[inner_start..j];
                    if inner.trim_start().starts_with("<%") {
                        from = j + 1;
                        break;
                    }
                    return Some((inner_start, j));
                }
                _ => j += 1,
            }
        }
        // break 到这里：占位符跳过后继续找下一处
        if j < bytes.len() {
            continue;
        }
        return None; // 未闭合
    }
    None
}

/// 对一行执行回填：`\cmd{...}` → `\cmd{<%= key %>}`（bound: (命令, 变量名)）
fn backfill_line(line: &str, bound: &[(&str, &str)]) -> String {
    let mut out = line.to_string();
    for (cmd, key) in bound {
        while let Some((s, e)) = find_cmd_value_range(&out, cmd) {
            out.replace_range(s..e, &format!("<%= {} %>", key));
        }
    }
    out
}

/// 整文件回填（保留原行尾：CRLF 项目回填后仍为 CRLF，末尾换行不丢）
fn backfill_text(text: &str, bound: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(text.len() + 32);
    let mut rest = text;
    while let Some(nl) = rest.find('\n') {
        let line = &rest[..nl];
        out.push_str(&backfill_line(line, bound));
        out.push('\n');
        rest = &rest[nl + 1..];
    }
    out.push_str(&backfill_line(rest, bound));
    out
}

/// 候选变量（analyze_project 返回，供向导预填）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateCandidate {
    pub key: String,
    pub label: String,
    /// 主文件中提取到的当前值（作为向导默认值）
    pub value: String,
    /// 所在文件（相对路径）
    pub file: String,
    /// 行号（1 起）
    pub line: u32,
    /// 全项目 .tex 中该命令的出现次数
    pub count: u32,
}

/// 文件清单项（勾选用）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFileInfo {
    pub path: String,
    pub tex: bool,
}

/// analyze_project 返回
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateAnalysis {
    pub files: Vec<TemplateFileInfo>,
    pub candidates: Vec<TemplateCandidate>,
    pub engine: String,
    pub main_file: String,
    pub output_dir: String,
}

/// 分析项目：文件清单 + 候选变量（只读，可反复调用预览）
fn analyze_project_in(root: &Path) -> Result<TemplateAnalysis, String> {
    if !root.is_dir() {
        return Err(format!("项目目录不存在: {}", root.display()));
    }
    let collected = collect_project_files(root);
    if collected.is_empty() {
        return Err("项目为空，无法制作模板".into());
    }
    let (engine, main_file, output_dir) = read_project_build(root);

    // 各绑定命令在全项目 .tex 中的出现次数（单行简单值口径）
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for (abs, _) in &collected {
        if !is_tex_path(abs) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(abs) else {
            continue;
        };
        for line in text.lines() {
            for cmd in BOUND_CMDS {
                if find_cmd_value_range(line, cmd).is_some() {
                    *counts.entry(cmd).or_insert(0) += 1;
                }
            }
        }
    }

    // 主文件中首个出现作为默认值
    let mut candidates = Vec::new();
    if let Ok(text) = std::fs::read_to_string(root.join(&main_file)) {
        for (idx, cmd) in BOUND_CMDS.iter().enumerate() {
            for (i, line) in text.lines().enumerate() {
                if let Some((s, e)) = find_cmd_value_range(line, cmd) {
                    let value = line[s..e].trim().to_string();
                    if value.is_empty() {
                        continue;
                    }
                    candidates.push(TemplateCandidate {
                        key: (*cmd).to_string(),
                        label: CMD_LABELS[idx].to_string(),
                        value,
                        file: main_file.clone(),
                        line: (i + 1) as u32,
                        count: counts.get(cmd).copied().unwrap_or(0),
                    });
                    break;
                }
            }
        }
    }

    Ok(TemplateAnalysis {
        files: collected
            .into_iter()
            .map(|(abs, rel)| TemplateFileInfo {
                path: rel,
                tex: is_tex_path(&abs),
            })
            .collect(),
        candidates,
        engine,
        main_file,
        output_dir,
    })
}

/// 把模板包目录打包为 zip（相对路径统一正斜杠；失败时清理残留文件）
fn zip_dir_to(src: &Path, dst: &Path) -> Result<(), String> {
    let f = std::fs::File::create(dst).map_err(|e| format!("创建压缩包失败: {}", e))?;
    let mut zw = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default();
    let mut err: Option<String> = None;
    'outer: for entry in WalkDir::new(src).follow_links(false) {
        let e = match entry {
            Ok(e) => e,
            Err(e) => {
                err = Some(format!("遍历失败: {}", e));
                break;
            }
        };
        if e.file_type().is_dir() {
            continue;
        }
        let rel = match e.path().strip_prefix(src) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(e) => {
                err = Some(format!("路径错误: {}", e));
                break;
            }
        };
        if let Err(e) = zw.start_file(&rel, opts) {
            err = Some(format!("写入压缩包条目失败: {}", e));
            break 'outer;
        }
        let mut file = match std::fs::File::open(e.path()) {
            Ok(f) => f,
            Err(e) => {
                err = Some(format!("读取失败: {}", e));
                break;
            }
        };
        if let Err(e) = std::io::copy(&mut file, &mut zw) {
            err = Some(format!("压缩写入失败: {}", e));
            break;
        }
    }
    if err.is_none() {
        if let Err(e) = zw.finish() {
            err = Some(format!("完成压缩包失败: {}", e));
        }
    }
    if let Some(msg) = err {
        let _ = std::fs::remove_file(dst);
        return Err(msg);
    }
    Ok(())
}

/// 根据当前项目制作模板：勾选文件 → 绑定变量回填占位符 → manifest → 导出 zip / 安装
#[allow(clippy::too_many_arguments)]
fn make_template_in(
    root: &Path,
    name: &str,
    description: Option<String>,
    category: Option<String>,
    variables: &[TemplateVar],
    files: &[String],
    export_path: Option<&Path>,
    install: bool,
    user_dir: &Path,
    builtin_dir: &Path,
) -> Result<TemplateMeta, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("模板名不能为空".into());
    }
    validate_vars(variables)?;
    if !root.is_dir() {
        return Err(format!("项目目录不存在: {}", root.display()));
    }

    // 只收勾选的文件（仍按项目扫描口径过滤，防止勾选编译产物/辅助文件）
    let wanted: HashSet<&str> = files.iter().map(|s| s.as_str()).collect();
    let all: Vec<(PathBuf, String)> = collect_project_files(root)
        .into_iter()
        .filter(|(_, rel)| wanted.contains(rel.as_str()))
        .collect();
    if all.is_empty() {
        return Err("未选中任何有效文件（编译产物等已自动排除）".into());
    }

    std::fs::create_dir_all(user_dir).map_err(|e| format!("创建用户模板目录失败: {}", e))?;

    // id：安装时须与用户目录及内置模板都不冲突
    let base = slugify(name);
    let mut id = format!("{}-{}", base, now_secs());
    if install {
        let mut n = 1u32;
        while user_dir.join(&id).exists() || builtin_dir.join(&id).is_dir() {
            id = format!("{}-{}-{}", base, now_secs(), n);
            n += 1;
        }
    }

    // 在用户模板目录的隐藏临时目录组装模板包（结束后清理）
    let pkg = user_dir.join(format!(".craft-{}", now_secs()));
    let _ = std::fs::remove_dir_all(&pkg);
    let result = (|| -> Result<TemplateMeta, String> {
        std::fs::create_dir_all(&pkg).map_err(|e| format!("创建模板目录失败: {}", e))?;

        // 绑定变量：key ∈ BOUND_CMDS 的变量 → 对应命令回填
        let bound: Vec<(&str, &str)> = variables
            .iter()
            .filter(|v| BOUND_CMDS.contains(&v.key.as_str()))
            .map(|v| (v.key.as_str(), v.key.as_str()))
            .collect();

        let mut specs: Vec<FileSpec> = Vec::new();
        for (abs, rel) in &all {
            let dst = pkg.join(rel);
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            let mut rendered = false;
            if !bound.is_empty() && is_tex_path(abs) {
                if let Ok(text) = std::fs::read_to_string(abs) {
                    let out = backfill_text(&text, &bound);
                    std::fs::write(&dst, out).map_err(|e| format!("写入失败 {}: {}", rel, e))?;
                    rendered = true;
                }
            }
            if !rendered {
                std::fs::copy(abs, &dst).map_err(|e| format!("复制失败 {}: {}", rel, e))?;
            }
            specs.push(FileSpec {
                target: rel.clone(),
                source: rel.clone(),
                render: rendered,
                condition: None,
            });
        }

        let (engine, main_file, output_dir) = read_project_build(root);
        let manifest = TemplateManifest {
            schema_version: "1.0".into(),
            id: id.clone(),
            name: name.to_string(),
            description: description.filter(|s| !s.trim().is_empty()),
            category: category.filter(|s| !s.trim().is_empty()),
            tags: Vec::new(),
            version: Some("1.0.0".into()),
            build: BuildConfig {
                engine,
                main_file,
                output_dir,
                synctex: true,
            },
            dependencies: Dependencies::default(),
            variables: variables.to_vec(),
            structure: Structure {
                dirs: Vec::new(),
                files: specs,
            },
        };
        let json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("序列化模板清单失败: {}", e))?;
        std::fs::write(pkg.join("manifest.json"), json)
            .map_err(|e| format!("写入模板清单失败: {}", e))?;

        // 导出 zip（统一交换格式）
        if let Some(p) = export_path {
            zip_dir_to(&pkg, p)?;
        }

        // 安装到用户模板目录（「我的模板」）
        if install {
            copy_tree(&pkg, &user_dir.join(&id))?;
        }

        Ok(meta_from(&manifest, install))
    })();

    let _ = std::fs::remove_dir_all(&pkg);
    result
}

/// 删除用户模板（拒绝内置 id 与不存在；仅动用户模板目录）
fn delete_template_in(id: &str, user_dir: &Path, builtin_dir: &Path) -> Result<(), String> {
    guard_id(id)?;
    if builtin_dir.join(id).join("manifest.json").is_file() {
        return Err(format!("内置模板不可删除: {}", id));
    }
    let pkg = user_dir.join(id);
    if !pkg.join("manifest.json").is_file() {
        return Err(format!("用户模板不存在: {}", id));
    }
    std::fs::remove_dir_all(&pkg).map_err(|e| format!("删除模板失败: {}", e))
}

/// 导入模板（仅 .zip）：解压 → 定位包根 → 校验 manifest → 复制到用户模板目录
fn import_template_in(
    src: &Path,
    user_dir: &Path,
    builtin_dir: &Path,
) -> Result<TemplateMeta, String> {
    if !src.exists() {
        return Err(format!("导入源不存在: {}", src.display()));
    }
    if !src.is_file()
        || !src
            .extension()
            .map(|e| e.to_string_lossy().eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
    {
        return Err("仅支持导入 .zip 模板压缩包".into());
    }
    std::fs::create_dir_all(user_dir).map_err(|e| format!("创建用户模板目录失败: {}", e))?;

    // 解压 zip 到临时目录，再定位包根（zip 内可能嵌套一层根目录）
    let tmp = user_dir.join(format!(".import-{}", now_secs()));
    let _ = std::fs::remove_dir_all(&tmp);
    let result = (|| -> Result<TemplateMeta, String> {
        std::fs::create_dir_all(&tmp).map_err(|e| format!("创建临时目录失败: {}", e))?;
        extract_zip(src, &tmp)?;
        let pkg_root = find_pkg_root(&tmp)?;
        let text = std::fs::read_to_string(pkg_root.join("manifest.json"))
            .map_err(|e| format!("读取模板清单失败: {}", e))?;
        let manifest: TemplateManifest =
            serde_json::from_str(&text).map_err(|e| format!("模板清单解析失败: {}", e))?;
        validate_manifest(&manifest)?;
        guard_id(&manifest.id)?;
        if builtin_dir.join(&manifest.id).join("manifest.json").is_file() {
            return Err(format!("模板 id 与内置模板冲突: {}", manifest.id));
        }
        let dest = user_dir.join(&manifest.id);
        if dest.exists() {
            return Err(format!("模板已存在: {}", manifest.id));
        }
        copy_tree(&pkg_root, &dest)?;
        Ok(meta_from(&manifest, true))
    })();

    let _ = std::fs::remove_dir_all(&tmp);
    result
}

// ── Tauri 命令 ────────────────────────────────────────────

/// 合并内置 + 用户模板（用户同 id 覆盖内置）
fn all_templates(app: &tauri::AppHandle) -> Result<Vec<TemplateMeta>, String> {
    let builtin_dir = resolve_templates_dir(app);
    let user_dir = user_templates_dir(app)?;
    let builtin = list_templates_in(&builtin_dir);
    let user = list_templates_in_src(&user_dir, true);
    let user_ids: HashSet<&str> = user.iter().map(|m| m.id.as_str()).collect();
    let mut out: Vec<TemplateMeta> = builtin
        .into_iter()
        .filter(|m| !user_ids.contains(m.id.as_str()))
        .collect();
    out.extend(user);
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub fn list_templates(app: tauri::AppHandle) -> Result<Vec<TemplateMeta>, String> {
    all_templates(&app)
}

/// M1-15e：删除用户模板（内置模板拒绝）
#[tauri::command]
pub fn delete_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let user_dir = user_templates_dir(&app)?;
    let builtin = resolve_templates_dir(&app);
    delete_template_in(&id, &user_dir, &builtin)
}

#[tauri::command]
pub fn get_template(app: tauri::AppHandle, id: String) -> Result<TemplateManifest, String> {
    let root = resolve_template_root(&app, &id)?;
    load_manifest(&root, &id)
}

#[tauri::command]
pub fn create_project(
    app: tauri::AppHandle,
    template_id: String,
    variables: HashMap<String, Value>,
    target_path: String,
) -> Result<ProjectInfo, String> {
    let root = resolve_template_root(&app, &template_id)?;
    create_project_in(&root, &template_id, &variables, &target_path)
}

/// M1-16：分析项目（候选变量 + 文件清单），供制作向导预览
#[tauri::command]
pub fn analyze_project(root: String) -> Result<TemplateAnalysis, String> {
    analyze_project_in(Path::new(&root))
}

/// M1-16：根据当前项目制作模板（变量回填 → 导出 zip，可选安装到用户模板目录）
#[tauri::command]
pub fn make_template(
    app: tauri::AppHandle,
    root: String,
    name: String,
    description: Option<String>,
    category: Option<String>,
    variables: Vec<TemplateVar>,
    files: Vec<String>,
    export_path: Option<String>,
    install: bool,
) -> Result<TemplateMeta, String> {
    let user_dir = user_templates_dir(&app)?;
    let builtin = resolve_templates_dir(&app);
    make_template_in(
        Path::new(&root),
        &name,
        description,
        category,
        &variables,
        &files,
        export_path.as_deref().map(Path::new),
        install,
        &user_dir,
        &builtin,
    )
}

/// M1-15e：导入自定义模板（目录或 .zip）
#[tauri::command]
pub fn import_template(app: tauri::AppHandle, src: String) -> Result<TemplateMeta, String> {
    let user_dir = user_templates_dir(&app)?;
    let builtin = resolve_templates_dir(&app);
    import_template_in(Path::new(&src), &user_dir, &builtin)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 仓库内置模板目录（测试直接读源码目录，不依赖打包资源）
    fn builtin_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates")
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zetla_tpl_test_{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 构造一个临时模板包（manifest JSON + main.tex.tmpl）
    fn make_pkg(root: &Path, id: &str, manifest_json: &str, tmpl: &str) {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("manifest.json"), manifest_json).unwrap();
        std::fs::write(dir.join("main.tex.tmpl"), tmpl).unwrap();
    }

    #[test]
    fn lists_builtin_templates() {
        let v = list_templates_in(&builtin_root());
        assert_eq!(v.len(), 7, "应恰好内置 7 套模板（M0 article/ctex-cn + M1-9 thesis/beamer/resume + nxuthesis + lecture-cn）");
        let ids: Vec<&str> = v.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&"article") && ids.contains(&"ctex-cn"));
        assert!(ids.contains(&"thesis-cn") && ids.contains(&"beamer-cn") && ids.contains(&"resume-cn"));
        // 排序稳定（字母序）
        assert_eq!(
            ids,
            vec!["article", "beamer-cn", "ctex-cn", "lecture-cn", "nxuthesis", "resume-cn", "thesis-cn"]
        );
        // 元数据齐全
        let a = v.iter().find(|m| m.id == "article").unwrap();
        assert!(!a.name.is_empty() && a.description.is_some());
        // 多文件模板：thesis-cn 含章节拆分结构与分组变量
        let t = v.iter().find(|m| m.id == "thesis-cn").unwrap();
        assert!(!t.description.is_none());
        let tm = load_manifest(&builtin_root(), "thesis-cn").unwrap();
        assert!(tm.structure.dirs.contains(&"chapters".to_string()));
        assert!(tm.variables.iter().any(|vv| vv.group.as_deref() == Some("基本信息")));
        assert!(tm.variables.iter().any(|vv| vv.var_type == VarType::Select));
    }

    #[test]
    fn get_template_manifest_subset() {
        let m = load_manifest(&builtin_root(), "article").unwrap();
        assert_eq!(m.schema_version, "1.0");
        assert_eq!(m.build.main_file, "main.tex");
        assert_eq!(m.build.output_dir, "build");
        assert_eq!(m.structure.files.len(), 1);
        assert_eq!(m.variables.len(), 2);
        assert!(m.variables.iter().any(|v| v.key == "title" && v.required));

        let c = load_manifest(&builtin_root(), "ctex-cn").unwrap();
        assert_eq!(c.build.engine, "xelatex");
    }

    #[test]
    fn get_template_rejects_bad_id() {
        assert!(load_manifest(&builtin_root(), "nope").is_err());
        assert!(load_manifest(&builtin_root(), "../x").is_err());
        assert!(load_manifest(&builtin_root(), "").is_err());
    }

    #[test]
    fn render_replaces_vars_defaults_and_unknown() {
        let mut vars = HashMap::new();
        vars.insert("title".to_string(), Value::String("你好 LaTeX".into()));
        let mut defaults = HashMap::new();
        defaults.insert("author".to_string(), "Anon".to_string());

        let out = render_template(
            "T=<%= title %> A=<%= author %> U=<%= nope %> {{keep}}",
            &vars,
            &defaults,
        );
        assert_eq!(out, "T=你好 LaTeX A=Anon U= {{keep}}");

        // 数字/布尔；未闭合占位原样保留；{{}} 不受影响
        let mut nb = HashMap::new();
        nb.insert("n".to_string(), Value::Number(3.into()));
        nb.insert("b".to_string(), Value::Bool(true));
        assert_eq!(
            render_template("n=<%= n %> b=<%= b %> x <%= y", &nb, &defaults),
            "n=3 b=true x <%= y"
        );
    }

    #[test]
    fn create_project_end_to_end() {
        let tpl = tmp_dir("tpl");
        make_pkg(
            &tpl,
            "testpkg",
            r#"{
              "schemaVersion": "1.0",
              "id": "testpkg",
              "name": "测试模板",
              "variables": [
                {"key": "title", "label": "标题", "type": "string", "required": true},
                {"key": "author", "label": "作者", "type": "string", "default": "Anon"}
              ],
              "structure": {
                "dirs": ["chapters"],
                "files": [
                  {"target": "main.tex", "source": "main.tex.tmpl", "render": true},
                  {"target": "raw.txt", "source": "raw.txt", "render": false}
                ]
              }
            }"#,
            "\\documentclass{article}\n\\title{<%= title %>}\n\\author{<%= author %>}\n",
        );
        std::fs::write(tpl.join("testpkg/raw.txt"), "plain bytes").unwrap();

        let target = tmp_dir("proj").join("mydoc");

        // 缺必填变量 → 报错
        assert!(
            create_project_in(&tpl, "testpkg", &HashMap::new(), target.to_str().unwrap()).is_err()
        );

        let mut vars = HashMap::new();
        vars.insert("title".to_string(), Value::String("论文题目".into()));
        let info = create_project_in(&tpl, "testpkg", &vars, target.to_str().unwrap()).unwrap();

        // 返回值
        assert_eq!(info.template_id, "testpkg");
        assert!(info.main_file.ends_with("main.tex"));
        assert!(Path::new(&info.main_file).is_file());

        // 渲染内容
        let main = std::fs::read_to_string(target.join("main.tex")).unwrap();
        assert!(main.contains("\\title{论文题目}"));
        assert!(
            main.contains("\\author{Anon}"),
            "author 应取 manifest 默认值"
        );
        // 非渲染文件原样复制；目录已创建
        assert_eq!(
            std::fs::read_to_string(target.join("raw.txt")).unwrap(),
            "plain bytes"
        );
        assert!(target.join("chapters").is_dir());

        // .ltex/config.json 权威入口
        let cfg: Value = serde_json::from_str(
            &std::fs::read_to_string(target.join(".ltex/config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(cfg["templateId"], "testpkg");
        assert_eq!(cfg["mainFile"], "main.tex");
        assert_eq!(cfg["engine"], "xelatex");

        // 二次创建同目录（主文件已存在）→ 报错
        assert!(create_project_in(&tpl, "testpkg", &vars, target.to_str().unwrap()).is_err());
    }

    #[test]
    fn create_project_rejects_path_traversal() {
        let tpl = tmp_dir("tpl_trav");
        // target 逃逸
        make_pkg(
            &tpl,
            "evil1",
            r#"{"id":"evil1","name":"n","structure":{"files":[{"target":"../evil.tex","source":"main.tex.tmpl","render":true}]}}"#,
            "x",
        );
        // source 逃逸
        make_pkg(
            &tpl,
            "evil2",
            r#"{"id":"evil2","name":"n","structure":{"files":[{"target":"a.tex","source":"../outside.tmpl","render":true}]}}"#,
            "x",
        );
        let target = tmp_dir("proj_trav");
        assert!(
            create_project_in(&tpl, "evil1", &HashMap::new(), target.to_str().unwrap()).is_err()
        );
        assert!(
            create_project_in(&tpl, "evil2", &HashMap::new(), target.to_str().unwrap()).is_err()
        );
        assert!(!target.join("evil.tex").exists());
        assert!(!target.join("a.tex").exists());
    }

    #[test]
    fn create_builtin_templates_compile_shape() {
        // 全部内置模板端到端生成（不求可编译，求结构与变量替换正确）
        for id in ["article", "ctex-cn", "thesis-cn", "beamer-cn", "resume-cn", "nxuthesis", "lecture-cn"] {
            let target = tmp_dir(&format!("builtin_{}", id));
            let m = load_manifest(&builtin_root(), id).unwrap();
            let dflt = default_map(&m);
            let mut vars = HashMap::new();
            for (k, v) in dflt {
                vars.insert(k, Value::String(v));
            }
            // 必填且无默认值 → 补占位，确保通过必填校验
            for v in &m.variables {
                if v.required && !vars.contains_key(&v.key) {
                    vars.insert(v.key.clone(), Value::String("示例".into()));
                }
            }
            let info =
                create_project_in(&builtin_root(), id, &vars, target.to_str().unwrap()).unwrap();
            assert!(Path::new(&info.main_file).is_file());
            let main = std::fs::read_to_string(&info.main_file).unwrap();
            assert!(main.contains("\\begin{document}"));
            // 单文件模板不生成多余目录；多文件模板的章节文件已生成
            assert!(target.join(".ltex/config.json").is_file());
        }
        // thesis-cn 多文件：章节文件与目录齐备
        let tgt = tmp_dir("builtin_thesis-cn");
        let tm = load_manifest(&builtin_root(), "thesis-cn").unwrap();
        let tdflt = default_map(&tm);
        let mut vars = HashMap::new();
        for (k, v) in tdflt {
            vars.insert(k, Value::String(v));
        }
        for v in &tm.variables {
            if v.required && !vars.contains_key(&v.key) {
                vars.insert(v.key.clone(), Value::String("示例".into()));
            }
        }
        let info = create_project_in(&builtin_root(), "thesis-cn", &vars, tgt.to_str().unwrap()).unwrap();
        assert!(tgt.join("chapters/intro.tex").is_file());
        assert!(tgt.join("chapters/conclusion.tex").is_file());
        let main = std::fs::read_to_string(&info.main_file).unwrap();
        assert!(main.contains("\\input{chapters/intro}"));
        // 必填变量已渲染
        assert!(main.contains("\\title{"));
        // beamer-cn：主题变量已落入 \usetheme
        let btgt = tmp_dir("builtin_beamer-cn");
        let bm = load_manifest(&builtin_root(), "beamer-cn").unwrap();
        let bdflt = default_map(&bm);
        let mut bvars = HashMap::new();
        for (k, v) in bdflt {
            bvars.insert(k, Value::String(v));
        }
        for v in &bm.variables {
            if v.required && !bvars.contains_key(&v.key) {
                bvars.insert(v.key.clone(), Value::String("示例".into()));
            }
        }
        let binfo = create_project_in(&builtin_root(), "beamer-cn", &bvars, btgt.to_str().unwrap()).unwrap();
        let bmain = std::fs::read_to_string(&binfo.main_file).unwrap();
        assert!(bmain.contains("\\usetheme{Madrid}"));

        // nxuthesis：联合导师条件块留空时，\nxusetup{} 内不得出现空行
        // （keyval 参数块遇空行会报 "Paragraph ended before \kv@processor@default was complete"）
        let ntgt = tmp_dir("builtin_nxuthesis");
        let nm = load_manifest(&builtin_root(), "nxuthesis").unwrap();
        let mut nvars = HashMap::new();
        for (k, v) in default_map(&nm) {
            nvars.insert(k, Value::String(v));
        }
        for v in &nm.variables {
            if v.required && !nvars.contains_key(&v.key) {
                nvars.insert(v.key.clone(), Value::String("示例".into()));
            }
        }
        nvars.remove("coSupervisor"); // 模拟未填写联合导师
        create_project_in(&builtin_root(), "nxuthesis", &nvars, ntgt.to_str().unwrap()).unwrap();
        let setup = std::fs::read_to_string(ntgt.join("nxusetup.tex")).unwrap();
        // 模板文件在 Windows（core.autocrlf=true）下为 CRLF，渲染结果随之保留 CRLF；
        // 断言只关心「换行结构」，先统一成 LF 再比对，避免行尾差异造成假失败。
        let setup = setup.replace("\r\n", "\n");
        let start = setup.find("\\nxusetup{").expect("nxusetup.tex 应含 \\nxusetup");
        let body = &setup[start..];
        let end = body.find("\n}\n").expect("\\nxusetup 应有闭合行");
        assert!(
            !body[..end].contains("\n\n"),
            "\\nxusetup 内出现空行（条件块渲染缺陷），片段：\n{}",
            &body[..end]
        );
    }

    #[test]
    fn render_supports_if_else_blocks() {
        // 非嵌套 if/else
        let mut vars = HashMap::new();
        vars.insert("opt".to_string(), Value::String("yes".into()));
        assert_eq!(
            render_template("A<% if opt %>ON<% else %>OFF<% endif %>B", &vars, &HashMap::new()),
            "AONB"
        );
        vars.insert("opt".to_string(), Value::String("".into()));
        assert_eq!(
            render_template("A<% if opt %>ON<% else %>OFF<% endif %>B", &vars, &HashMap::new()),
            "AOFFB"
        );
        // 无 else：falsy 取空
        assert_eq!(
            render_template("X<% if opt %>Y<% endif %>Z", &vars, &HashMap::new()),
            "XZ"
        );
        // 嵌套 if
        let mut nested = HashMap::new();
        nested.insert("a".to_string(), Value::Bool(true));
        nested.insert("b".to_string(), Value::Bool(true));
        assert_eq!(
            render_template("<% if a %>A<% if b %>B<% endif %>C<% endif %>", &nested, &HashMap::new()),
            "ABC"
        );
        // 表达式与条件混用；未闭合 <% 原样保留；falsy 条件块内容丢弃
        assert_eq!(
            render_template("v=<%= x %> <% if y %>Y<% endif %> <%= z", &nested, &HashMap::new()),
            "v=  <%= z"
        );
        // bool 真值：falsy(bool=false) 取 else
        let mut bf = HashMap::new();
        bf.insert("flag".to_string(), Value::Bool(false));
        assert_eq!(
            render_template("<% if flag %>T<% else %>F<% endif %>", &bf, &HashMap::new()),
            "F"
        );
    }

    // ── M1-15e 模板库管理 ──

    #[test]
    fn list_marks_user_templates() {
        let user_dir = tmp_dir("user_tpl_list");
        make_pkg(
            &user_dir,
            "u1",
            r#"{"id":"u1","name":"U1","structure":{"files":[]}}"#,
            "x",
        );
        let v = list_templates_in_src(&user_dir, true);
        assert_eq!(v.len(), 1);
        assert!(v[0].is_user);
        // 内置列表默认非用户
        assert!(list_templates_in(&builtin_root()).iter().all(|m| !m.is_user));
    }

    // ── M1-16 根据项目制作模板 ──

    #[test]
    fn cmd_scan_and_backfill() {
        assert_eq!(find_cmd_value_range("\\title{A B}", "title"), Some((7, 10)));
        assert_eq!(find_cmd_value_range("\\title {spaced}", "title"), Some((8, 14)));
        assert_eq!(find_cmd_value_range("\\title{}", "title"), Some((7, 7)));
        // 命令名必须完整 / 嵌套花括号 / 未闭合 / 无花括号 → 不匹配
        assert_eq!(find_cmd_value_range("\\titlepage", "title"), None);
        assert_eq!(find_cmd_value_range("\\title{a{b}c}", "title"), None);
        assert_eq!(find_cmd_value_range("\\title{unclosed", "title"), None);
        assert_eq!(find_cmd_value_range("no cmd here", "title"), None);
        // 回填：同行多处；已占位符的出现跳过（防死循环）
        assert_eq!(
            backfill_line("t=\\title{x} u=\\title{y}", &[("title", "title")]),
            "t=\\title{<%= title %>} u=\\title{<%= title %>}"
        );
        assert_eq!(
            backfill_line("\\title{<%= title %>}", &[("title", "title")]),
            "\\title{<%= title %>}"
        );
        // 行尾保留：CRLF 不丢、末尾换行不丢
        assert_eq!(backfill_text("a\r\nb\n", &[("title", "title")]), "a\r\nb\n");
    }

    #[test]
    fn analyze_project_extracts_candidates() {
        let proj = tmp_dir("proj_analyze").join("P");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join("main.tex"),
            "\\documentclass{article}\n\\title{我的论文}\n\\author{张三}\n\\date{2026-01-01}\n\\begin{document}\\titlepage\\end{document}\n",
        )
        .unwrap();
        std::fs::write(proj.join("intro.tex"), "\\section{x}\n\\title{重复标题}\n").unwrap();

        let a = analyze_project_in(&proj).unwrap();
        assert_eq!(a.main_file, "main.tex");
        assert!(a.files.iter().any(|f| f.path == "main.tex" && f.tex));
        assert!(a.files.iter().any(|f| f.path == "intro.tex" && f.tex));

        let get = |k: &str| a.candidates.iter().find(|c| c.key == k).unwrap();
        assert_eq!(get("title").value, "我的论文");
        assert_eq!(get("title").line, 2);
        assert_eq!(get("title").count, 2, "main.tex 1 次 + intro.tex 1 次");
        assert_eq!(get("author").value, "张三");
        assert_eq!(get("date").value, "2026-01-01");
        // \titlepage 不该把 title 撑成两次
        assert_eq!(get("title").count, 2);

        // 嵌套花括号的复杂值不提取
        std::fs::write(proj.join("main.tex"), "\\title{嵌套{内}层}\n").unwrap();
        let a2 = analyze_project_in(&proj).unwrap();
        assert!(a2.candidates.iter().all(|c| c.key != "title"));
    }

    #[test]
    fn make_template_backfills_installs_and_exports_zip() {
        let proj = tmp_dir("proj_make_tpl").join("P");
        std::fs::create_dir_all(proj.join(".ltex")).unwrap();
        std::fs::write(
            proj.join("main.tex"),
            "\\documentclass{article}\r\n\\title{原标题}\r\n\\author{某人}\r\n\\date{今天}\r\n",
        )
        .unwrap();
        std::fs::write(proj.join("fig.png"), "png").unwrap();
        std::fs::write(
            proj.join(".ltex/config.json"),
            r#"{"engine":"xelatex","mainFile":"main.tex"}"#,
        )
        .unwrap();

        let vars = vec![
            TemplateVar {
                key: "title".into(),
                label: "标题".into(),
                var_type: VarType::String,
                required: true,
                default: Some(Value::String("原标题".into())),
                options: vec![],
                group: None,
                placeholder: None,
                help: None,
            },
            TemplateVar {
                key: "author".into(),
                label: "作者".into(),
                var_type: VarType::String,
                required: false,
                default: Some(Value::String("某人".into())),
                options: vec![],
                group: None,
                placeholder: None,
                help: None,
            },
        ];
        let files = vec!["main.tex".to_string(), "fig.png".to_string()];
        let user_dir = tmp_dir("user_tpl_make");
        let builtin = builtin_root();
        let zip_path = tmp_dir("make_export").join("out.zip");

        let meta = make_template_in(
            &proj,
            "我的模板",
            None,
            None,
            &vars,
            &files,
            Some(&zip_path),
            true,
            &user_dir,
            &builtin,
        )
        .unwrap();
        assert!(meta.is_user);

        // 安装的包：绑定命令已回填；未定义变量的命令不动；CRLF 与末尾换行保留
        let pkg = user_dir.join(&meta.id);
        let main = std::fs::read_to_string(pkg.join("main.tex")).unwrap();
        assert!(main.contains("\\title{<%= title %>}"));
        assert!(main.contains("\\author{<%= author %>}"));
        assert!(!main.contains("\\date{<%="), "date 未定义变量，不应回填");
        assert!(main.contains("\\date{今天}"));
        assert!(main.contains("\r\n"), "CRLF 应保留");
        assert!(main.ends_with("\r\n"), "末尾换行应保留");
        // 非渲染文件原样复制
        assert_eq!(std::fs::read_to_string(pkg.join("fig.png")).unwrap(), "png");

        let m = load_manifest(&user_dir, &meta.id).unwrap();
        assert_eq!(m.variables.len(), 2);
        assert_eq!(m.build.engine, "xelatex");

        // 用安装的模板创建项目 → 变量渲染
        let mut vv = HashMap::new();
        vv.insert("title".to_string(), Value::String("新标题".into()));
        vv.insert("author".to_string(), Value::String("李四".into()));
        let target = tmp_dir("proj_from_make").join("out");
        create_project_in(&user_dir, &meta.id, &vv, target.to_str().unwrap()).unwrap();
        let created = std::fs::read_to_string(target.join("main.tex")).unwrap();
        assert!(created.contains("\\title{新标题}"));
        assert!(created.contains("\\author{李四}"));

        // 导出的 zip 可再导入（交换格式闭环）
        assert!(zip_path.is_file());
        let user_dir2 = tmp_dir("user_tpl_make2");
        let meta2 = import_template_in(&zip_path, &user_dir2, &builtin).unwrap();
        assert_eq!(meta2.id, meta.id);
        assert!(user_dir2.join(&meta.id).join("manifest.json").is_file());

        // 变量校验：key 非法 / 重复 / select 无选项 → 拒绝
        let bad_key = vec![TemplateVar {
            key: "1bad".into(),
            label: "K".into(),
            var_type: VarType::String,
            required: false,
            default: None,
            options: vec![],
            group: None,
            placeholder: None,
            help: None,
        }];
        assert!(make_template_in(&proj, "bad", None, None, &bad_key, &files, None, true, &user_dir, &builtin).is_err());
        let dup: Vec<TemplateVar> = vec![vars[0].clone(), vars[0].clone()];
        assert!(make_template_in(&proj, "dup", None, None, &dup, &files, None, true, &user_dir, &builtin).is_err());
        let no_opts = vec![TemplateVar {
            key: "style".into(),
            label: "样式".into(),
            var_type: VarType::Select,
            required: false,
            default: None,
            options: vec![],
            group: None,
            placeholder: None,
            help: None,
        }];
        assert!(make_template_in(&proj, "noopts", None, None, &no_opts, &files, None, true, &user_dir, &builtin).is_err());
    }

    #[test]
    fn import_template_zip_only() {
        let user_dir = tmp_dir("user_tpl_import");
        let builtin = builtin_root();

        // 目录导入 → 已不支持（统一 zip 交换格式）
        let src = tmp_dir("tpl_src_dir").join("my-tpl");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("manifest.json"),
            r#"{"id":"my-tpl","name":"导入模板","structure":{"files":[]}}"#,
        )
        .unwrap();
        assert!(import_template_in(&src, &user_dir, &builtin).is_err());

        // zip 导入（嵌套一层根目录也可定位）
        let zip_root = tmp_dir("tpl_src_zip");
        let pkg = zip_root.join("ziptpl");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(
            pkg.join("manifest.json"),
            r#"{"id":"ziptpl","name":"Zip 模板","structure":{"files":[{"target":"main.tex","source":"main.tex.tmpl","render":true}]}}"#,
        )
        .unwrap();
        std::fs::write(pkg.join("main.tex.tmpl"), "zip body").unwrap();
        let zip_path = zip_root.join("tpl.zip");
        {
            let f = std::fs::File::create(&zip_path).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            for name in ["manifest.json", "main.tex.tmpl"] {
                let opts = zip::write::SimpleFileOptions::default();
                zw.start_file(format!("ziptpl/{}", name), opts).unwrap();
                let mut file = std::fs::File::open(pkg.join(name)).unwrap();
                std::io::copy(&mut file, &mut zw).unwrap();
            }
            zw.finish().unwrap();
        }
        let meta2 = import_template_in(&zip_path, &user_dir, &builtin).unwrap();
        assert_eq!(meta2.id, "ziptpl");
        assert!(user_dir.join("ziptpl/manifest.json").is_file());
        assert!(user_dir.join("ziptpl/main.tex.tmpl").is_file());
        // 重复导入 → 拒绝
        assert!(import_template_in(&zip_path, &user_dir, &builtin).is_err());

        // 与内置 id 冲突 → 拒绝
        let conflict_root = tmp_dir("tpl_src_conflict");
        let conflict_pkg = conflict_root.join("article");
        std::fs::create_dir_all(&conflict_pkg).unwrap();
        std::fs::write(
            conflict_pkg.join("manifest.json"),
            r#"{"id":"article","name":"x","structure":{"files":[]}}"#,
        )
        .unwrap();
        let conflict_zip = conflict_root.join("article.zip");
        {
            let f = std::fs::File::create(&conflict_zip).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            zw.start_file("article/manifest.json", opts).unwrap();
            std::io::copy(
                &mut std::fs::File::open(conflict_pkg.join("manifest.json")).unwrap(),
                &mut zw,
            )
            .unwrap();
            zw.finish().unwrap();
        }
        assert!(import_template_in(&conflict_zip, &user_dir, &builtin).is_err());

        // 变量不合法的坏包 → 拒绝（select 无选项）
        let bad_root = tmp_dir("tpl_src_badvars");
        let bad_pkg = bad_root.join("badvars");
        std::fs::create_dir_all(&bad_pkg).unwrap();
        std::fs::write(
            bad_pkg.join("manifest.json"),
            r#"{"id":"badvars","name":"x","variables":[{"key":"k","label":"K","type":"select"}],"structure":{"files":[]}}"#,
        )
        .unwrap();
        let bad_zip = bad_root.join("badvars.zip");
        {
            let f = std::fs::File::create(&bad_zip).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            zw.start_file("badvars/manifest.json", opts).unwrap();
            std::io::copy(
                &mut std::fs::File::open(bad_pkg.join("manifest.json")).unwrap(),
                &mut zw,
            )
            .unwrap();
            zw.finish().unwrap();
        }
        assert!(import_template_in(&bad_zip, &user_dir, &builtin).is_err());
    }

    #[test]
    fn delete_user_template_only() {
        let user_dir = tmp_dir("user_tpl_del");
        make_pkg(
            &user_dir,
            "u1",
            r#"{"id":"u1","name":"U1","structure":{"files":[]}}"#,
            "x",
        );
        let builtin = builtin_root();
        delete_template_in("u1", &user_dir, &builtin).unwrap();
        assert!(!user_dir.join("u1").exists());
        // 已不存在 → 拒绝
        assert!(delete_template_in("u1", &user_dir, &builtin).is_err());
        // 内置 id → 拒绝
        assert!(delete_template_in("article", &user_dir, &builtin).is_err());
        // 非法 id → 拒绝
        assert!(delete_template_in("../x", &user_dir, &builtin).is_err());
    }
}
