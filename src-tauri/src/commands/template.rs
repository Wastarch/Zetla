// 模板引擎（开发文档 §5，M0-7 交付）—— manifest 解析 / 变量校验 / 渲染 / 按结构生成项目
// MVP 收敛口径（§5.0）：内置 2 套单文件模板（article / ctex-cn），schema 只解析子集，
// 渲染器只做 <%= var %> 替换（刻意避开 LaTeX 的 {{}}），condition/用户模板/多文件模板 → M1/M3。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Manager;

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
}

impl From<&TemplateManifest> for TemplateMeta {
    fn from(m: &TemplateManifest) -> Self {
        Self {
            id: m.id.clone(),
            name: m.name.clone(),
            description: m.description.clone(),
            category: m.category.clone(),
            tags: m.tags.clone(),
            version: m.version.clone(),
        }
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

#[derive(Debug, Deserialize, Serialize)]
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
        for cand in [res.join("templates"), res.join("resources").join("templates")] {
            if cand.is_dir() {
                return cand;
            }
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    for cand in [cwd.join("templates"), cwd.join("src-tauri").join("templates")] {
        if cand.is_dir() {
            return cand;
        }
    }
    cwd.join("templates")
}

// ── 引擎核心（可测试：全部以 tpl_root 为参数） ────────────

/// 模板 id 白名单校验（防路径穿越）
fn guard_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
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
            out.push(TemplateMeta::from(&m));
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
        return Err(format!("清单 id 与目录不一致: 目录 {} ≠ id {}", id, manifest.id));
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

/// 极简渲染器（§5.4）：只做 `<%= var %>` 替换；未提供变量回退 manifest 默认值，再回退空串
fn render_template(
    src: &str,
    vars: &HashMap<String, Value>,
    defaults: &HashMap<String, String>,
) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(start) = rest.find("<%=") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 3..];
        let Some(end) = after.find("%>") else {
            // 未闭合占位 → 原样保留
            out.push_str(&rest[start..]);
            return out;
        };
        let key = after[..end].trim();
        let val = match vars.get(key) {
            Some(v) => value_to_string(v),
            None => defaults.get(key).cloned().unwrap_or_default(),
        };
        out.push_str(&val);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
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
            std::fs::copy(&src_p, &dst_p)
                .map_err(|e| format!("复制失败 {}: {}", f.source, e))?;
        }
    }

    // 依赖资源（cls/sty 等原样复制；MVP 单文件模板为空列表）
    for a in &manifest.dependencies.assets {
        let src_p = safe_join(&pkg, a)?;
        let dst_p = safe_join(&root, a)?;
        if let Some(parent) = dst_p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        std::fs::copy(&src_p, &dst_p)
            .map_err(|e| format!("复制资源失败 {}: {}", a, e))?;
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

// ── Tauri 命令 ────────────────────────────────────────────

#[tauri::command]
pub fn list_templates(app: tauri::AppHandle) -> Result<Vec<TemplateMeta>, String> {
    Ok(list_templates_in(&resolve_templates_dir(&app)))
}

#[tauri::command]
pub fn get_template(app: tauri::AppHandle, id: String) -> Result<TemplateManifest, String> {
    load_manifest(&resolve_templates_dir(&app), &id)
}

#[tauri::command]
pub fn create_project(
    app: tauri::AppHandle,
    template_id: String,
    variables: HashMap<String, Value>,
    target_path: String,
) -> Result<ProjectInfo, String> {
    create_project_in(
        &resolve_templates_dir(&app),
        &template_id,
        &variables,
        &target_path,
    )
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
        assert_eq!(v.len(), 2, "应恰好内置 2 套模板");
        let ids: Vec<&str> = v.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&"article") && ids.contains(&"ctex-cn"));
        // 排序稳定
        assert_eq!(ids, vec!["article", "ctex-cn"]);
        // 元数据齐全
        let a = v.iter().find(|m| m.id == "article").unwrap();
        assert!(!a.name.is_empty() && a.description.is_some());
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
        assert!(create_project_in(&tpl, "testpkg", &HashMap::new(), target.to_str().unwrap())
            .is_err());

        let mut vars = HashMap::new();
        vars.insert("title".to_string(), Value::String("论文题目".into()));
        let info =
            create_project_in(&tpl, "testpkg", &vars, target.to_str().unwrap()).unwrap();

        // 返回值
        assert_eq!(info.template_id, "testpkg");
        assert!(info.main_file.ends_with("main.tex"));
        assert!(Path::new(&info.main_file).is_file());

        // 渲染内容
        let main = std::fs::read_to_string(target.join("main.tex")).unwrap();
        assert!(main.contains("\\title{论文题目}"));
        assert!(main.contains("\\author{Anon}"), "author 应取 manifest 默认值");
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
        assert!(create_project_in(&tpl, "evil1", &HashMap::new(), target.to_str().unwrap())
            .is_err());
        assert!(create_project_in(&tpl, "evil2", &HashMap::new(), target.to_str().unwrap())
            .is_err());
        assert!(!target.join("evil.tex").exists());
        assert!(!target.join("a.tex").exists());
    }

    #[test]
    fn create_builtin_templates_compile_shape() {
        // 两套内置模板端到端生成（不求可编译，求结构正确）
        for id in ["article", "ctex-cn"] {
            let target = tmp_dir(&format!("builtin_{}", id));
            let mut vars = HashMap::new();
            vars.insert("title".to_string(), Value::String("标题".into()));
            vars.insert("author".to_string(), Value::String("作者".into()));
            let info =
                create_project_in(&builtin_root(), id, &vars, target.to_str().unwrap()).unwrap();
            assert!(Path::new(&info.main_file).is_file());
            let main = std::fs::read_to_string(&info.main_file).unwrap();
            assert!(main.contains("\\title{标题}"));
            assert!(main.contains("\\begin{document}"));
            // 单文件模板不生成多余目录
            assert_eq!(info.output_dir, "build");
            assert!(target.join(".ltex/config.json").is_file());
        }
    }
}
