// 项目管理（开发文档 §3.2）—— M0-6 交付
// scan_project: walkdir 扫树 + 主文件启发式（.ltex/config.json 权威读取 → M0-8）
// create_entry / remove_entry / rename_entry: 项目树右键文件操作
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use serde_json::Map;

/// 树节点（与 src/types/project.ts ProjectNode 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNode {
    pub name: String,
    /// 绝对路径
    pub path: String,
    /// "dir" | "file"（TS 字段名为 type）
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<ProjectNode>>,
    /// 是否为识别出的主文件
    pub is_main: bool,
}

/// 扫描结果（与 src/types/project.ts ProjectTree 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTree {
    pub root: String,
    /// 主文件绝对路径（无 .tex 时为空串）
    pub main_file: String,
    /// 编译引擎（.ltex/config.json 的 engine，缺省 xelatex）—— M0-9 状态栏展示
    pub engine: String,
    /// 图片目录（R5 拖拽导入；.ltex/config.json 的 imageDir，缺省 "figure"；相对项目根）
    pub image_dir: Option<String>,
    pub nodes: Vec<ProjectNode>,
}

const MAX_DEPTH: usize = 12;
const MAX_ENTRIES: usize = 5000;

/// 需要跳过的名字：隐藏项（含 .git/.ltex）与重型目录
fn skip_name(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "out" | "__pycache__"
        )
}

fn is_tex(p: &Path) -> bool {
    p.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("tex"))
        .unwrap_or(false)
}

fn to_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// 文件名字节中查找 ASCII 模式（GBK/UTF-8 通用，无需解码）
fn contains_bytes(path: &Path, pattern: &[u8]) -> bool {
    std::fs::read(path)
        .map(|b| b.windows(pattern.len()).any(|w| w == pattern))
        .unwrap_or(false)
}

fn depth_from(root: &Path, p: &Path) -> usize {
    p.strip_prefix(root)
        .map(|r| r.components().count())
        .unwrap_or(usize::MAX)
}

/// 扫描 + 组装
fn scan_project_inner(root: &str) -> Result<ProjectTree, String> {
    if root.trim().is_empty() {
        return Err("项目路径为空".into());
    }
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("不是有效目录: {}", root));
    }

    // 1) 收集（跳过隐藏/重型目录 + .ltex/config.json 的 exclude globs；条目上限保护，单条目错误跳过）
    let excludes = load_exclude(root_path);
    let mut entries: Vec<(PathBuf, bool)> = Vec::new();
    for item in WalkDir::new(root_path)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if skip_name(&name) {
                return false;
            }
            let rel = e
                .path()
                .strip_prefix(root_path)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            !should_exclude(&rel, &excludes)
        })
    {
        if entries.len() >= MAX_ENTRIES {
            break;
        }
        let Ok(e) = item else { continue };
        if e.depth() == 0 {
            continue;
        }
        entries.push((e.path().to_path_buf(), e.file_type().is_dir()));
    }

    // 2) 主文件：.ltex/config.json 权威（M0-7 完整版）→ 启发式回退
    let main_file = config_main_file(root_path).unwrap_or_else(|| pick_main(root_path, &entries));

    // 3) 组装树
    let mut children_map: HashMap<PathBuf, Vec<(PathBuf, bool)>> = HashMap::new();
    for item in entries {
        let parent = item
            .0
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root_path.to_path_buf());
        children_map.entry(parent).or_default().push(item);
    }
    let mut nodes = assemble(root_path, &mut children_map);

    if !main_file.is_empty() {
        flag_main(&mut nodes, &main_file);
    }

    Ok(ProjectTree {
        root: to_str(root_path),
        main_file,
        engine: config_engine(root_path),
        image_dir: config_image_dir(root_path),
        nodes,
    })
}

/// 读 .ltex/config.json 的 mainFile（项目权威入口；M0-7 完整版）。文件缺失/非法/目标不存在 → None 走启发式
fn config_main_file(root: &Path) -> Option<String> {
    let cfg = root.join(".ltex").join("config.json");
    let text = std::fs::read_to_string(cfg).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let mf = v.get("mainFile")?.as_str()?;
    if mf.trim().is_empty()
        || Path::new(mf).is_absolute()
        || mf.split(['/', '\\']).any(|s| s == "..")
    {
        return None;
    }
    let p = root.join(mf);
    p.is_file().then(|| to_str(&p))
}

/// 读 .ltex/config.json 的 engine（M0-9）；缺省/非法 → xelatex
fn config_engine(root: &Path) -> String {
    let fallback = "xelatex".to_string();
    let cfg = root.join(".ltex").join("config.json");
    let Ok(text) = std::fs::read_to_string(cfg) else {
        return fallback;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return fallback;
    };
    match v.get("engine").and_then(|e| e.as_str()) {
        Some(e) if matches!(e, "xelatex" | "pdflatex" | "lualatex" | "latexmk") => e.to_string(),
        _ => fallback,
    }
}

/// 读 .ltex/config.json 的 imageDir（R5 拖拽导入）。
/// 缺省/缺失/非法（绝对路径或含 ..）→ None，前端回落 "figure"。
fn config_image_dir(root: &Path) -> Option<String> {
    let cfg = root.join(".ltex").join("config.json");
    let text = std::fs::read_to_string(cfg).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let d = v.get("imageDir")?.as_str()?.trim().to_string();
    if d.is_empty() || d.starts_with('/') || d.starts_with('\\') || d.contains("..") {
        return None;
    }
    Some(d)
}

/// 写回 .ltex/config.json 的 imageDir（R5 项目设置）。
/// 空串 = 删除该键（回落默认 "figure"）；仅允许相对项目根、禁止绝对路径与 .. 穿越。
#[tauri::command]
pub fn save_project_config(root: String, image_dir: String) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("项目根不存在: {}", root));
    }
    let d = image_dir.trim().to_string();
    if !d.is_empty() && (d.starts_with('/') || d.starts_with('\\') || d.contains("..")) {
        return Err("图片目录必须为相对项目根的路径（不允许绝对路径或 .. 穿越）".into());
    }
    let cfg_path = root_path.join(".ltex").join("config.json");
    let mut obj: Map<String, serde_json::Value> = if cfg_path.exists() {
        let text = std::fs::read_to_string(&cfg_path)
            .map_err(|e| format!("读取配置失败: {}", e))?;
        serde_json::from_str(&text).unwrap_or_else(|_| Map::new())
    } else {
        if let Some(parent) = cfg_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建 .ltex 失败: {}", e))?;
        }
        Map::new()
    };
    if d.is_empty() {
        obj.remove("imageDir");
    } else {
        obj.insert("imageDir".into(), serde_json::Value::String(d));
    }
    let out = serde_json::to_string_pretty(&obj)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(&cfg_path, out).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

// ── M1-15c · 项目配置读写（.ltex/config.json 可视化设置） ────────────────

/// .ltex/config.json 的可视化字段（与 src/types/project.ts ProjectConfig 对齐；缺省/空=未设置）
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectConfigDoc {
    pub engine: Option<String>,
    pub main_file: Option<String>,
    pub output_dir: Option<String>,
    pub image_dir: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub project_type: Option<String>,
    pub exclude: Option<Vec<String>>,
}

fn project_json_path(root: &Path) -> PathBuf {
    root.join(".ltex").join("config.json")
}

/// 读 .ltex/config.json 为 JSON 对象（缺失/损坏返回空 Map）
fn read_project_obj(root: &Path) -> Map<String, serde_json::Value> {
    match std::fs::read_to_string(project_json_path(root)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|_| Map::new()),
        Err(_) => Map::new(),
    }
}

/// 读取项目可视化配置（设置面板回填用）
#[tauri::command]
pub fn get_project_config(root: String) -> Result<ProjectConfigDoc, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("项目根不存在: {}", root));
    }
    let obj = read_project_obj(root_path);
    let s = |k: &str| obj.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Ok(ProjectConfigDoc {
        engine: s("engine"),
        main_file: s("mainFile"),
        output_dir: s("outputDir"),
        image_dir: s("imageDir"),
        name: s("name"),
        description: s("description"),
        project_type: s("projectType"),
        exclude: obj.get("exclude").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(str::to_string)
                .collect()
        }),
    })
}

/// 合法编译引擎（与前端下拉一致）
const PROJECT_ENGINES: [&str; 4] = ["xelatex", "pdflatex", "lualatex", "latexmk"];
/// 合法项目类型
const PROJECT_TYPES: [&str; 5] = ["article", "thesis", "beamer", "resume", "custom"];

/// 相对路径校验：空 → None；绝对路径 / .. 穿越 → Err
fn clean_rel(field: &str, s: Option<String>) -> Result<Option<String>, String> {
    let Some(v) = s else { return Ok(None) };
    let v = v.trim().to_string();
    if v.is_empty() {
        return Ok(None);
    }
    if v.starts_with('/') || v.starts_with('\\') || v.contains("..") {
        return Err(format!(
            "{} 必须为相对项目根的路径（不允许绝对路径或 .. 穿越）",
            field
        ));
    }
    Ok(Some(v))
}

fn set_or_remove(obj: &mut Map<String, serde_json::Value>, key: &str, v: Option<String>) {
    match v {
        Some(x) => {
            obj.insert(key.to_string(), serde_json::Value::String(x));
        }
        None => {
            obj.remove(key);
        }
    }
}

/// 写回项目可视化配置（保留 templateId/modules 等未管理键；空值删除对应键）
#[tauri::command]
pub fn update_project_config(root: String, config: ProjectConfigDoc) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("项目根不存在: {}", root));
    }

    // 引擎白名单（空=删除，回落默认 xelatex）
    let engine = match config.engine.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(e) => {
            if !PROJECT_ENGINES.contains(&e) {
                return Err(format!("未知编译引擎: {}", e));
            }
            Some(e.to_string())
        }
    };
    // 项目类型白名单
    let project_type = match config
        .project_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        None => None,
        Some(t) => {
            if !PROJECT_TYPES.contains(&t) {
                return Err(format!("未知项目类型: {}", t));
            }
            Some(t.to_string())
        }
    };
    // 相对路径字段
    let main_file = clean_rel("主文件", config.main_file)?;
    if let Some(mf) = &main_file {
        if !root_path.join(mf).is_file() {
            return Err(format!("主文件不存在或不在项目内: {}", mf));
        }
    }
    let output_dir = clean_rel("输出目录", config.output_dir)?;
    let image_dir = clean_rel("图片目录", config.image_dir)?;
    // 排除规则：相对 glob，逐条校验
    let exclude = match config.exclude {
        None => None,
        Some(list) => {
            let mut out: Vec<String> = Vec::new();
            for raw in list {
                let pat = raw.trim().trim_start_matches("./").to_string();
                if pat.is_empty() {
                    continue;
                }
                if pat.starts_with('/')
                    || pat.starts_with('\\')
                    || pat.split(['/', '\\']).any(|seg| seg == "..")
                {
                    return Err(format!("排除规则必须为相对 glob: {}", pat));
                }
                out.push(pat);
            }
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
    };
    let name = config
        .name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let description = config
        .description
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // 读改写（保留未管理键）
    let mut obj = read_project_obj(root_path);
    set_or_remove(&mut obj, "engine", engine);
    set_or_remove(&mut obj, "mainFile", main_file);
    set_or_remove(&mut obj, "outputDir", output_dir);
    set_or_remove(&mut obj, "imageDir", image_dir);
    set_or_remove(&mut obj, "name", name);
    set_or_remove(&mut obj, "description", description);
    set_or_remove(&mut obj, "projectType", project_type);
    match exclude {
        Some(list) => {
            obj.insert(
                "exclude".to_string(),
                serde_json::Value::Array(
                    list.into_iter().map(serde_json::Value::String).collect(),
                ),
            );
        }
        None => {
            obj.remove("exclude");
        }
    }

    let cfg_path = project_json_path(root_path);
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建 .ltex 失败: {}", e))?;
    }
    let out = serde_json::to_string_pretty(&obj).map_err(|e| format!("序列化配置失败: {}", e))?;
    std::fs::write(&cfg_path, out).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

/// 读取 exclude globs（.ltex/config.json 的 exclude 数组；非法项忽略）
fn load_exclude(root: &Path) -> Vec<String> {
    read_project_obj(root)
        .get("exclude")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().trim_start_matches("./").replace('\\', "/"))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn should_exclude(rel: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| glob_match(p, rel))
}

/// 极简 glob（`*` 不跨 `/`，`**` 跨 `/`，`**/` 可匹配 0 个目录，`?` 单字符）
fn glob_match(pattern: &str, text: &str) -> bool {
    fn rec(p: &[char], t: &[char]) -> bool {
        if p.is_empty() {
            return t.is_empty();
        }
        // **/ 可匹配 0 个或多个目录
        if p.len() >= 3 && p[0] == '*' && p[1] == '*' && p[2] == '/' {
            if rec(&p[3..], t) {
                return true;
            }
            return (0..t.len()).any(|k| t[k] == '/' && rec(&p[3..], &t[k + 1..]));
        }
        match p[0] {
            '*' => {
                if p.len() >= 2 && p[1] == '*' {
                    let mut i = 0;
                    while i < p.len() && p[i] == '*' {
                        i += 1;
                    }
                    (0..=t.len()).any(|k| rec(&p[i..], &t[k..]))
                } else {
                    let mut k = 0;
                    loop {
                        if rec(&p[1..], &t[k..]) {
                            return true;
                        }
                        if k >= t.len() || t[k] == '/' {
                            return false;
                        }
                        k += 1;
                    }
                }
            }
            '?' => !t.is_empty() && t[0] != '/' && rec(&p[1..], &t[1..]),
            c => !t.is_empty() && t[0] == c && rec(&p[1..], &t[1..]),
        }
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    rec(&p, &t)
}

/// 主文件识别：根 main.tex → 按(深度, 名称)第一个含 \documentclass 的 .tex → 第一个 .tex
fn pick_main(root: &Path, entries: &[(PathBuf, bool)]) -> String {
    let main = root.join("main.tex");
    if main.is_file() {
        return to_str(&main);
    }
    let mut tex: Vec<&(PathBuf, bool)> = entries
        .iter()
        .filter(|(p, is_dir)| !*is_dir && is_tex(p))
        .collect();
    tex.sort_by(|a, b| {
        depth_from(root, &a.0)
            .cmp(&depth_from(root, &b.0))
            .then_with(|| {
                let na =
                    a.0.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                let nb =
                    b.0.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                na.cmp(&nb)
            })
    });
    if let Some((p, _)) = tex
        .iter()
        .find(|(p, _)| contains_bytes(p, b"\\documentclass"))
    {
        return to_str(p);
    }
    tex.first().map(|(p, _)| to_str(p)).unwrap_or_default()
}

fn sort_entries(v: &mut Vec<(PathBuf, bool)>) {
    v.sort_by(|a, b| {
        b.1.cmp(&a.1) // 目录在前
            .then_with(|| {
                let na =
                    a.0.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                let nb =
                    b.0.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                na.cmp(&nb)
            })
    });
}

/// 递归组装（children_map 消费式取用）
fn assemble(dir: &Path, map: &mut HashMap<PathBuf, Vec<(PathBuf, bool)>>) -> Vec<ProjectNode> {
    let Some(mut kids) = map.remove(dir) else {
        return Vec::new();
    };
    sort_entries(&mut kids);
    kids.into_iter()
        .map(|(p, is_dir)| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| to_str(&p));
            if is_dir {
                let children = assemble(&p, map);
                ProjectNode {
                    name,
                    path: to_str(&p),
                    node_type: "dir".into(),
                    children: Some(children),
                    is_main: false,
                }
            } else {
                ProjectNode {
                    name,
                    path: to_str(&p),
                    node_type: "file".into(),
                    children: None,
                    is_main: false,
                }
            }
        })
        .collect()
}

fn flag_main(nodes: &mut [ProjectNode], main_file: &str) {
    for n in nodes.iter_mut() {
        if n.path == main_file {
            n.is_main = true;
        }
        if let Some(children) = n.children.as_mut() {
            flag_main(children, main_file);
        }
    }
}

// ── 扫描命令 ────────────────────────────────────────────────

#[tauri::command]
pub fn scan_project(path: String) -> Result<ProjectTree, String> {
    scan_project_inner(&path)
}

// ── 文件操作（项目树右键） ─────────────────────────────────

/// 基础防护：非空、非盘符根（无文件名 → 拒绝）
fn guard_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    let p = PathBuf::from(path);
    if p.file_name().is_none() {
        return Err(format!("危险路径，已拒绝: {}", path));
    }
    Ok(p)
}

/// 新建文件/目录（kind: "tex" | "file" | "dir"），返回最终绝对路径
/// - kind=tex：无 .tex 后缀时自动补全；不覆盖已存在目标
#[tauri::command]
pub fn create_entry(path: String, kind: String) -> Result<String, String> {
    let mut p = guard_path(&path)?;
    match kind.as_str() {
        "tex" => {
            let has_tex = p
                .extension()
                .map(|e| e.to_string_lossy().eq_ignore_ascii_case("tex"))
                .unwrap_or(false);
            if !has_tex {
                p.set_extension("tex");
            }
        }
        "file" | "dir" => {}
        other => return Err(format!("未知类型 kind={}", other)),
    }
    let final_path = to_str(&p);
    if p.exists() {
        return Err(format!("已存在: {}", final_path));
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建父目录失败 {}: {}", parent.display(), e))?;
        }
    }
    if kind == "dir" {
        std::fs::create_dir_all(&p).map_err(|e| format!("创建目录失败: {}", e))?;
    } else {
        std::fs::write(&p, b"").map_err(|e| format!("创建文件失败: {}", e))?;
    }
    Ok(final_path)
}

/// 删除文件/目录（MVP 直删不进回收站；盘符根等危险路径拒绝）
#[tauri::command]
pub fn remove_entry(path: String) -> Result<(), String> {
    let p = guard_path(&path)?;
    if !p.exists() {
        return Err(format!("不存在: {}", path));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| format!("删除目录失败 {}: {}", p.display(), e))?;
    } else {
        std::fs::remove_file(&p).map_err(|e| format!("删除文件失败 {}: {}", p.display(), e))?;
    }
    Ok(())
}

/// 重命名/移动（目标必须唯一），返回新绝对路径
#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<String, String> {
    let src = guard_path(&from)?;
    let dst = guard_path(&to)?;
    if !src.exists() {
        return Err(format!("源不存在: {}", from));
    }
    if src == dst {
        return Ok(to);
    }
    if dst.exists() {
        return Err(format!("目标已存在: {}", to));
    }
    if let Some(parent) = dst.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目标目录失败 {}: {}", parent.display(), e))?;
        }
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("重命名失败 {} → {}: {}", from, to, e))?;
    Ok(to_str(&dst))
}

// ── 复制（M0-6 补充：树复制粘贴） ──────────────────────────

const COPY_MAX_DEPTH: u32 = 32;
const COPY_MAX_ENTRIES: usize = 5000;

/// 复制文件/目录（目标已存在则报错，不覆盖、不自动改名）
#[tauri::command]
pub fn copy_entry(from: String, to: String) -> Result<String, String> {
    let src = guard_path(&from)?;
    let dst = guard_path(&to)?;
    if !src.exists() {
        return Err(format!("源不存在: {}", from));
    }
    if src == dst {
        return Err("源与目标相同".into());
    }
    if dst.exists() {
        return Err(format!("目标已存在: {}", to));
    }
    if let Some(parent) = dst.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目标目录失败 {}: {}", parent.display(), e))?;
        }
    }
    if src.is_dir() {
        let mut count = 0usize;
        copy_dir(&src, &dst, 0, &mut count)?;
    } else {
        std::fs::copy(&src, &dst).map_err(|e| format!("复制失败 {}: {}", src.display(), e))?;
    }
    Ok(to_str(&dst))
}

/// 递归复制目录（深度/条目上限保护；单条目读取错误跳过）
fn copy_dir(src: &Path, dst: &Path, depth: u32, count: &mut usize) -> Result<(), String> {
    if depth > COPY_MAX_DEPTH {
        return Err("目录层级过深，已中止".into());
    }
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {}", dst.display(), e))?;
    let read =
        std::fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?;
    for item in read {
        if *count >= COPY_MAX_ENTRIES {
            return Err("复制条目数超限，已中止".into());
        }
        let Ok(entry) = item else { continue };
        *count += 1;
        let from_p = entry.path();
        let to_p = dst.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir(&from_p, &to_p, depth + 1, count)?;
        } else {
            std::fs::copy(&from_p, &to_p)
                .map_err(|e| format!("复制失败 {}: {}", from_p.display(), e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个测试独立子目录，避免并行冲突
    fn tmp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zetla_project_test_{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_builds_tree_and_skips_hidden_and_heavy_dirs() {
        let root = tmp_root("scan");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(root.join("chapters/intro.tex"), "intro").unwrap();
        std::fs::write(root.join(".hidden.tex"), "x").unwrap();
        std::fs::write(root.join("node_modules/pkg/a.tex"), "x").unwrap();

        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        let names: Vec<&str> = tree.nodes.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"chapters"));
        assert!(names.contains(&"main.tex"));
        assert!(!names.contains(&".git"));
        assert!(!names.contains(&".hidden.tex"));
        assert!(!names.contains(&"node_modules"));

        let chapters = tree.nodes.iter().find(|n| n.name == "chapters").unwrap();
        assert_eq!(chapters.node_type, "dir");
        assert_eq!(chapters.children.as_ref().unwrap().len(), 1);

        // 根 main.tex 优先
        assert!(tree.main_file.ends_with("main.tex"));
        let main_node = tree
            .nodes
            .iter()
            .find(|n| n.path == tree.main_file)
            .unwrap();
        assert!(main_node.is_main);
    }

    #[test]
    fn main_file_heuristic_prefers_documentclass() {
        let root = tmp_root("heur");
        std::fs::write(root.join("aaa.tex"), "只有正文").unwrap();
        std::fs::write(root.join("zzz.tex"), "\\documentclass[12pt]{ctexart}").unwrap();

        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("zzz.tex"));
    }

    #[test]
    fn main_file_falls_back_to_first_tex_then_empty() {
        let root = tmp_root("fallback");
        std::fs::write(root.join("notes.tex"), "无 documentclass").unwrap();
        std::fs::write(root.join("a_only.md"), "md").unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("notes.tex"));

        let empty = tmp_root("no_tex");
        std::fs::write(empty.join("readme.md"), "md").unwrap();
        let tree = scan_project_inner(empty.to_str().unwrap()).unwrap();
        assert_eq!(tree.main_file, "");
        assert!(tree.nodes.iter().all(|n| !n.is_main));
    }

    #[test]
    fn create_entry_kinds_and_no_overwrite() {
        let root = tmp_root("create");
        let tex = root.join("chapter1").join("sec");
        let created = create_entry(tex.to_str().unwrap().to_string(), "tex".into()).unwrap();
        assert!(created.ends_with("sec.tex"));
        assert!(Path::new(&created).is_file());

        // 已存在 → 报错
        assert!(create_entry(created.clone(), "tex".into()).is_err());

        let dir = create_entry(
            root.join("figures").to_str().unwrap().to_string(),
            "dir".into(),
        )
        .unwrap();
        assert!(Path::new(&dir).is_dir());

        // 非法 kind / 空路径
        assert!(create_entry(root.join("x").to_str().unwrap().to_string(), "exe".into()).is_err());
        assert!(create_entry("".into(), "tex".into()).is_err());
    }

    #[test]
    fn rename_entry_moves_and_refuses_existing_target() {
        let root = tmp_root("rename");
        let src = root.join("old.tex");
        std::fs::write(&src, "content").unwrap();

        let to = root.join("new.tex");
        let got = rename_entry(
            src.to_str().unwrap().to_string(),
            to.to_str().unwrap().to_string(),
        )
        .unwrap();
        assert!(got.ends_with("new.tex"));
        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "content");

        // 目标已存在 → 报错
        let other = root.join("other.tex");
        std::fs::write(&other, "x").unwrap();
        assert!(
            rename_entry(
                to.to_str().unwrap().to_string(),
                other.to_str().unwrap().to_string(),
            )
            .is_err()
        );
    }

    #[test]
    fn remove_entry_deletes_file_and_dir_and_guards_root() {
        let root = tmp_root("remove");
        let f = root.join("junk.tex");
        std::fs::write(&f, "x").unwrap();
        remove_entry(f.to_str().unwrap().to_string()).unwrap();
        assert!(!f.exists());

        let d = root.join("junkdir");
        std::fs::create_dir_all(d.join("inner")).unwrap();
        std::fs::write(d.join("inner/a.tex"), "x").unwrap();
        remove_entry(d.to_str().unwrap().to_string()).unwrap();
        assert!(!d.exists());

        // 危险路径（盘符根/无文件名）与不存在路径
        let danger = if cfg!(windows) {
            "C:\\".to_string()
        } else {
            "/".to_string()
        };
        assert!(remove_entry(danger).is_err());
        assert!(remove_entry(root.join("nope.tex").to_str().unwrap().to_string()).is_err());
    }

    #[test]
    fn rename_entry_guards_invalid_paths() {
        assert!(rename_entry("".into(), "x.tex".into()).is_err());
        assert!(rename_entry("x.tex".into(), "".into()).is_err());
        assert!(rename_entry("no_such_file.tex".into(), "y.tex".into()).is_err());
    }

    #[test]
    fn copy_entry_copies_file_with_content() {
        let root = tmp_root("copy_file");
        let src = root.join("a.tex");
        std::fs::write(&src, "hello copy").unwrap();
        let dst = root.join("sub").join("b.tex");
        let got = copy_entry(
            src.to_str().unwrap().to_string(),
            dst.to_str().unwrap().to_string(),
        )
        .unwrap();
        assert!(got.ends_with("b.tex"));
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "hello copy");
        // 源保留
        assert!(src.exists());
    }

    #[test]
    fn copy_entry_copies_dir_recursively() {
        let root = tmp_root("copy_dir");
        let src = root.join("pkg");
        std::fs::create_dir_all(src.join("inner")).unwrap();
        std::fs::write(src.join("main.tex"), "doc").unwrap();
        std::fs::write(src.join("inner/chap.tex"), "chap").unwrap();

        let dst = root.join("pkg_copy");
        copy_entry(
            src.to_str().unwrap().to_string(),
            dst.to_str().unwrap().to_string(),
        )
        .unwrap();
        assert!(dst.join("main.tex").is_file());
        assert!(dst.join("inner/chap.tex").is_file());
        assert_eq!(
            std::fs::read_to_string(dst.join("inner/chap.tex")).unwrap(),
            "chap"
        );
        // 源目录保留
        assert!(src.join("main.tex").is_file());
    }

    #[test]
    fn copy_entry_refuses_existing_target_and_same_path() {
        let root = tmp_root("copy_conflict");
        let src = root.join("a.tex");
        std::fs::write(&src, "x").unwrap();
        let dst = root.join("b.tex");
        std::fs::write(&dst, "old").unwrap();
        assert!(
            copy_entry(
                src.to_str().unwrap().to_string(),
                dst.to_str().unwrap().to_string()
            )
            .is_err()
        );
        // 冲突不覆盖
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "old");
        // 同源同目标
        assert!(
            copy_entry(
                src.to_str().unwrap().to_string(),
                src.to_str().unwrap().to_string()
            )
            .is_err()
        );
    }

    #[test]
    fn copy_entry_errors_on_missing_source() {
        let root = tmp_root("copy_missing");
        assert!(
            copy_entry(
                root.join("nope.tex").to_str().unwrap().to_string(),
                root.join("out.tex").to_str().unwrap().to_string(),
            )
            .is_err()
        );
        assert!(!root.join("out.tex").exists());
    }

    #[test]
    fn copy_entry_guards_invalid_paths() {
        assert!(copy_entry("".into(), "x.tex".into()).is_err());
        assert!(copy_entry("x.tex".into(), "".into()).is_err());
    }

    #[test]
    fn scan_project_prefers_config_main_file() {
        let root = tmp_root("cfg_main");
        std::fs::write(root.join("aaa.tex"), "无 documentclass").unwrap();
        std::fs::write(root.join("realmain.tex"), "\\documentclass{ctexart}").unwrap();
        let ltex = root.join(".ltex");
        std::fs::create_dir_all(&ltex).unwrap();
        // config 显式指定 aaa.tex（启发式会选 realmain.tex）→ 证明 config 优先
        std::fs::write(
            ltex.join("config.json"),
            r#"{"engine":"xelatex","mainFile":"aaa.tex"}"#,
        )
        .unwrap();

        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("aaa.tex"), "config 应优先于启发式");
        assert!(
            tree.nodes
                .iter()
                .any(|n| n.path == tree.main_file && n.is_main),
            "is_main 应标记 config 指定的主文件"
        );

        // 非法 config（目标不存在）→ 回退启发式（含 documentclass 的 realmain.tex）
        std::fs::write(ltex.join("config.json"), r#"{"mainFile":"missing.tex"}"#).unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("realmain.tex"));

        // 路径穿越 → 拒绝并回退
        std::fs::write(ltex.join("config.json"), r#"{"mainFile":"../evil.tex"}"#).unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("realmain.tex"), "路径穿越应被拒绝");

        // 绝对路径 → 拒绝并回退
        std::fs::write(ltex.join("config.json"), r#"{"mainFile":"C:/evil.tex"}"#).unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("realmain.tex"));
    }

    #[test]
    fn scan_project_reports_engine_from_config() {
        let root = tmp_root("cfg_engine");
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();

        // 无 config → 默认 xelatex
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert_eq!(tree.engine, "xelatex");

        // config 指定 pdflatex → 读出真实引擎
        let ltex = root.join(".ltex");
        std::fs::create_dir_all(&ltex).unwrap();
        std::fs::write(
            ltex.join("config.json"),
            r#"{"engine":"pdflatex","mainFile":"main.tex"}"#,
        )
        .unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert_eq!(tree.engine, "pdflatex");

        // 非法引擎 → 回退 xelatex
        std::fs::write(
            ltex.join("config.json"),
            r#"{"engine":"tectonic","mainFile":"main.tex"}"#,
        )
        .unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert_eq!(tree.engine, "xelatex");
    }

    #[test]
    fn glob_match_basics() {
        // 单 * 不跨分隔符
        assert!(glob_match("*.aux", "main.aux"));
        assert!(!glob_match("*.aux", "sub/main.aux"));
        // ** 跨分隔符；**/ 可匹配 0 个目录
        assert!(glob_match("**/*.aux", "main.aux"));
        assert!(glob_match("**/*.aux", "a/b/c.aux"));
        // 目录名精确匹配（供 filter_entry 剪枝）
        assert!(glob_match("build", "build"));
        assert!(!glob_match("build", "build2"));
        // ? 单字符且不跨分隔符
        assert!(glob_match("a?c.tex", "abc.tex"));
        assert!(!glob_match("a?c.tex", "a/c.tex"));
        // 精确
        assert!(glob_match("chapters/*", "chapters/intro.tex"));
        assert!(!glob_match("chapters/*", "chapters/sub/intro.tex"));
    }

    #[test]
    fn scan_project_applies_exclude_globs() {
        let root = tmp_root("exclude");
        std::fs::create_dir_all(root.join("build")).unwrap();
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(root.join("scratch.tex"), "x").unwrap();
        std::fs::write(root.join("build/generated.tex"), "x").unwrap();
        std::fs::write(root.join("chapters/notes.aux"), "x").unwrap();
        let ltex = root.join(".ltex");
        std::fs::create_dir_all(&ltex).unwrap();
        std::fs::write(
            ltex.join("config.json"),
            r#"{"exclude":["build","**/*.aux","scratch.tex"]}"#,
        )
        .unwrap();

        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        let names: Vec<&str> = tree.nodes.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"main.tex"));
        assert!(names.contains(&"chapters"));
        assert!(!names.contains(&"build"), "排除目录应隐藏");
        assert!(!names.contains(&"scratch.tex"), "排除文件应隐藏");
        // chapters 下的 .aux 被隐藏，目录保留
        let chapters = tree.nodes.iter().find(|n| n.name == "chapters").unwrap();
        let kids: Vec<&str> = chapters
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|n| n.name.as_str())
            .collect();
        assert!(kids.is_empty(), "chapters 下仅 .aux，应被隐藏: {:?}", kids);
    }

    #[test]
    fn update_project_config_validates_and_preserves_unknown_keys() {
        let root = tmp_root("proj_cfg_update");
        std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::write(root.join("chapter.tex"), "x").unwrap();
        let ltex = root.join(".ltex");
        std::fs::create_dir_all(&ltex).unwrap();
        std::fs::write(
            ltex.join("config.json"),
            r#"{"templateId":"article-basic","modules":{"table":true}}"#,
        )
        .unwrap();

        // 正常写入：保存 name/engine/mainFile/exclude/imageDir
        update_project_config(
            root.to_str().unwrap().to_string(),
            ProjectConfigDoc {
                engine: Some("pdflatex".into()),
                main_file: Some("main.tex".into()),
                output_dir: Some("out".into()),
                image_dir: Some("figure".into()),
                name: Some("  我的论文  ".into()),
                description: Some("desc".into()),
                project_type: Some("article".into()),
                exclude: Some(vec!["build".into(), "**/*.aux".into()]),
            },
        )
        .unwrap();

        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(ltex.join("config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(v["engine"], "pdflatex");
        assert_eq!(v["mainFile"], "main.tex");
        assert_eq!(v["outputDir"], "out");
        assert_eq!(v["imageDir"], "figure");
        assert_eq!(v["name"], "我的论文"); // trim
        assert_eq!(v["description"], "desc");
        assert_eq!(v["projectType"], "article");
        assert_eq!(v["exclude"][0], "build");
        // 未管理键保留
        assert_eq!(v["templateId"], "article-basic");
        assert_eq!(v["modules"]["table"], true);

        // 校验失败：非法引擎 / 主文件穿越 / 不存在主文件 / 非法 exclude
        let bad = |doc: ProjectConfigDoc| {
            update_project_config(root.to_str().unwrap().to_string(), doc).is_err()
        };
        assert!(bad(ProjectConfigDoc {
            engine: Some("tectonic".into()),
            ..Default::default()
        }));
        assert!(bad(ProjectConfigDoc {
            main_file: Some("../evil.tex".into()),
            ..Default::default()
        }));
        assert!(bad(ProjectConfigDoc {
            main_file: Some("missing.tex".into()),
            ..Default::default()
        }));
        assert!(bad(ProjectConfigDoc {
            exclude: Some(vec!["/abs".into()]),
            ..Default::default()
        }));

        // 清空：空串/空数组应删除对应键
        update_project_config(
            root.to_str().unwrap().to_string(),
            ProjectConfigDoc {
                engine: Some("  ".into()),
                main_file: Some("".into()),
                exclude: Some(vec![]),
                ..Default::default()
            },
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(ltex.join("config.json")).unwrap(),
        )
        .unwrap();
        assert!(v.get("engine").is_none());
        assert!(v.get("mainFile").is_none());
        assert!(v.get("exclude").is_none());
        // 仍未管理键保留
        assert_eq!(v["templateId"], "article-basic");
    }
}
