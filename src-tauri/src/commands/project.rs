// 项目管理（开发文档 §3.2）—— M0-6 交付
// scan_project: walkdir 扫树 + 主文件启发式（.ltex/config.json 权威读取 → M0-8）
// create_entry / remove_entry / rename_entry: 项目树右键文件操作
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

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

    // 1) 收集（跳过隐藏/重型目录，条目上限保护，单条目错误跳过）
    let mut entries: Vec<(PathBuf, bool)> = Vec::new();
    for item in WalkDir::new(root_path)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            e.depth() == 0 || !skip_name(&name)
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
        nodes,
    })
}

/// 读 .ltex/config.json 的 mainFile（项目权威入口；M0-7 完整版）。文件缺失/非法/目标不存在 → None 走启发式
fn config_main_file(root: &Path) -> Option<String> {
    let cfg = root.join(".ltex").join("config.json");
    let text = std::fs::read_to_string(cfg).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let mf = v.get("mainFile")?.as_str()?;
    if mf.trim().is_empty() || Path::new(mf).is_absolute() || mf.split(['/', '\\']).any(|s| s == "..")
    {
        return None;
    }
    let p = root.join(mf);
    p.is_file().then(|| to_str(&p))
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
                let na = a.0.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                let nb = b.0.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
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
                let na = a.0.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                let nb = b.0.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
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
    let read = std::fs::read_dir(src)
        .map_err(|e| format!("读取目录失败 {}: {}", src.display(), e))?;
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
        let created = create_entry(
            tex.to_str().unwrap().to_string(),
            "tex".into(),
        )
        .unwrap();
        assert!(created.ends_with("sec.tex"));
        assert!(Path::new(&created).is_file());

        // 已存在 → 报错
        assert!(create_entry(created.clone(), "tex".into()).is_err());

        let dir = create_entry(root.join("figures").to_str().unwrap().to_string(), "dir".into())
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
        assert!(rename_entry(
            to.to_str().unwrap().to_string(),
            other.to_str().unwrap().to_string(),
        )
        .is_err());
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
        let danger = if cfg!(windows) { "C:\\".to_string() } else { "/".to_string() };
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
        let got = copy_entry(src.to_str().unwrap().to_string(), dst.to_str().unwrap().to_string())
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
        copy_entry(src.to_str().unwrap().to_string(), dst.to_str().unwrap().to_string()).unwrap();
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
        assert!(copy_entry(src.to_str().unwrap().to_string(), dst.to_str().unwrap().to_string())
            .is_err());
        // 冲突不覆盖
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "old");
        // 同源同目标
        assert!(copy_entry(src.to_str().unwrap().to_string(), src.to_str().unwrap().to_string())
            .is_err());
    }

    #[test]
    fn copy_entry_errors_on_missing_source() {
        let root = tmp_root("copy_missing");
        assert!(copy_entry(
            root.join("nope.tex").to_str().unwrap().to_string(),
            root.join("out.tex").to_str().unwrap().to_string(),
        )
        .is_err());
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
            tree.nodes.iter().any(|n| n.path == tree.main_file && n.is_main),
            "is_main 应标记 config 指定的主文件"
        );

        // 非法 config（目标不存在）→ 回退启发式（含 documentclass 的 realmain.tex）
        std::fs::write(
            ltex.join("config.json"),
            r#"{"mainFile":"missing.tex"}"#,
        )
        .unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("realmain.tex"));

        // 路径穿越 → 拒绝并回退
        std::fs::write(
            ltex.join("config.json"),
            r#"{"mainFile":"../evil.tex"}"#,
        )
        .unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("realmain.tex"), "路径穿越应被拒绝");

        // 绝对路径 → 拒绝并回退
        std::fs::write(
            ltex.join("config.json"),
            r#"{"mainFile":"C:/evil.tex"}"#,
        )
        .unwrap();
        let tree = scan_project_inner(root.to_str().unwrap()).unwrap();
        assert!(tree.main_file.ends_with("realmain.tex"));
    }
}
