// M2 · 绘图模块：扫描当前项目里的 TikZ 来源（v1）。
// v1 范围：.tikz 整文件 + .tex/.ltx 中完整的 tikzpicture 环境。
// 只发现候选、不写盘；导入决策与覆盖安全策略在前端 diagram store。
// 复用 project.rs 的忽略规则（隐藏目录 / 构建产物 / .ltex exclude）与 fsdoc.rs 的编码探测，
// 避免与项目树口径漂移。
use crate::commands::fsdoc::read_file_inner;
use crate::commands::project::{load_exclude, should_exclude, skip_name};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const MAX_DEPTH: usize = 12;
const MAX_ENTRIES: usize = 5000;
const MAX_CANDIDATES: usize = 200;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

const BEGIN: &str = "\\begin{tikzpicture}";
const END: &str = "\\end{tikzpicture}";

/// 前端 `TikzSourceCandidate`（src/types/diagram.ts）一一对应，camelCase 由 serde 转换。
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TikzSourceCandidate {
    pub id: String,
    pub path: String,
    pub rel_path: String,
    /// "tikz-file" | "tex-env"
    pub kind: String,
    /// 规范化后的片段：库声明 + tikzpicture，可直接进绘图源码栏
    pub source: String,
    /// 原始文本（.tikz 为整文件；.tex 为环境原文），供 UI 预览/排错
    pub raw_source: String,
    pub start_line: usize,
    pub end_line: usize,
    pub libraries: Vec<String>,
    pub confidence: u32,
    pub reason: String,
    pub fingerprint: String,
    /// "project" = 项目扫描发现；"external" = 用户从项目外手动导入的文件
    pub origin: String,
}

/// 解析用户从系统文件对话框选出的单个外部文件（可在项目外）。
/// 后缀 / 大小校验 + 编码探测 + 环境提取全部复用项目扫描口径；
/// 返回的候选把 origin 标成 external，并给 id 加前缀避免与项目候选撞键。
#[tauri::command]
pub fn parse_tikz_file(path: String) -> Result<Vec<TikzSourceCandidate>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("文件路径为空".into());
    }
    let file = PathBuf::from(trimmed);
    if !file.is_file() {
        return Err(format!("不是有效文件: {}", trimmed));
    }
    if !is_candidate_ext(&file) {
        return Err("仅支持 .tikz / .tex / .ltx 文件".into());
    }
    let meta = std::fs::metadata(&file).map_err(|e| format!("读取文件信息失败: {}", e))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("文件过大（上限 2 MB）".into());
    }
    let abs = file.to_string_lossy().into_owned();
    let doc = read_file_inner(&abs)?;
    let text = doc.content.replace("\r\n", "\n").replace('\r', "\n");
    // 外部文件通常不在项目根下：以父目录为 root，rel_path 退化为文件名本身。
    let root = file.parent().unwrap_or(&file);
    let mut out = candidates_from_text(root, &file, &text);
    for c in &mut out {
        c.id = format!("external:{}", c.id);
        c.origin = "external".to_string();
        c.reason = format!("外部文件 · {}", c.reason);
    }
    Ok(out)
}

/// 扫描项目根下的 TikZ 候选。空根 / 非目录返回 Err；无候选返回空数组（不是错误）。
#[tauri::command]
pub fn scan_tikz_sources(root: String) -> Result<Vec<TikzSourceCandidate>, String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("项目路径为空".into());
    }
    let root_path = Path::new(trimmed);
    if !root_path.is_dir() {
        return Err(format!("不是有效目录: {}", trimmed));
    }

    let excludes = load_exclude(root_path);
    let mut files: Vec<PathBuf> = Vec::new();
    for item in WalkDir::new(root_path)
        .follow_links(false)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            if skip_name(&name, false) {
                return false;
            }
            let rel = rel_path(root_path, e.path());
            !should_exclude(&rel, &excludes)
        })
    {
        if files.len() >= MAX_ENTRIES {
            break;
        }
        let Ok(entry) = item else { continue };
        if !entry.file_type().is_file() || !is_candidate_ext(entry.path()) {
            continue;
        }
        files.push(entry.path().to_path_buf());
    }

    let mut out: Vec<TikzSourceCandidate> = Vec::new();
    for path in files {
        if out.len() >= MAX_CANDIDATES {
            break;
        }
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let abs = path.to_string_lossy().into_owned();
        let Ok(doc) = read_file_inner(&abs) else { continue };
        // FileDoc 保留原 EOL；环境定位统一按 LF 口径，避免 CRLF 影响行号与片段内容。
        let text = doc.content.replace("\r\n", "\n").replace('\r', "\n");
        out.extend(candidates_from_text(root_path, &path, &text));
    }

    out.sort_by(|a, b| {
        b.confidence
            .cmp(&a.confidence)
            .then(a.rel_path.cmp(&b.rel_path))
            .then(a.start_line.cmp(&b.start_line))
    });
    out.truncate(MAX_CANDIDATES);
    Ok(out)
}

fn is_candidate_ext(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("tikz" | "tex" | "ltx")
    )
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn candidates_from_text(root: &Path, path: &Path, text: &str) -> Vec<TikzSourceCandidate> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    let rel = rel_path(root, path);
    let abs = path.to_string_lossy().into_owned();
    let libraries = collect_libraries(text);
    let envs = find_environments(text);
    let mut out = Vec::new();

    if is_tikz_file(path) {
        let (source, start, end, reason) = if let Some((begin, finish, env)) = envs.first() {
            (
                compose_source(&libraries, env),
                line_of(text, *begin),
                line_of(text, *finish),
                if envs.len() > 1 {
                    "TikZ 文件（含多张图，仅导入第一张）".to_string()
                } else {
                    "TikZ 文件".to_string()
                },
            )
        } else {
            let body = strip_document_shell(text);
            let body = body.trim();
            if !has_drawing_command(body) {
                return Vec::new();
            }
            let source = format!("{}\\begin{{tikzpicture}}\n{}\n{}\\end{{tikzpicture}}", lib_line(&libraries), body, "");
            (source, 1, text.lines().count(), "TikZ 文件（无环境，已自动包裹）".to_string())
        };
        out.push(make_candidate(
            &abs,
            &rel,
            "tikz-file",
            &source,
            text,
            start,
            end,
            libraries,
            100,
            reason,
        ));
        return out;
    }

    for (begin, finish, env) in envs {
        let source = compose_source(&libraries, &env);
        out.push(make_candidate(
            &abs,
            &rel,
            "tex-env",
            &source,
            &env,
            line_of(text, begin),
            line_of(text, finish),
            libraries.clone(),
            90,
            "LaTeX 中的 tikzpicture 环境".to_string(),
        ));
    }
    out
}

fn is_tikz_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("tikz"))
}

#[allow(clippy::too_many_arguments)]
fn make_candidate(
    path: &str,
    rel_path: &str,
    kind: &str,
    source: &str,
    raw_source: &str,
    start_line: usize,
    end_line: usize,
    libraries: Vec<String>,
    confidence: u32,
    reason: String,
) -> TikzSourceCandidate {
    let fp = fingerprint(source);
    TikzSourceCandidate {
        id: format!("{}:{}:{}", rel_path, start_line, &fp[..8]),
        path: path.to_string(),
        rel_path: rel_path.to_string(),
        kind: kind.to_string(),
        source: source.to_string(),
        raw_source: raw_source.to_string(),
        start_line,
        end_line,
        libraries,
        confidence,
        reason,
        fingerprint: fp,
        origin: "project".to_string(),
    }
}

fn fingerprint(source: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    hex::encode(hasher.finalize())
}

fn line_of(text: &str, byte_index: usize) -> usize {
    let upto = byte_index.min(text.len());
    1 + text.as_bytes()[..upto]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
}

fn lib_line(libraries: &[String]) -> String {
    if libraries.is_empty() {
        String::new()
    } else {
        format!("\\usetikzlibrary{{{}}}\n", libraries.join(","))
    }
}

fn compose_source(libraries: &[String], env: &str) -> String {
    format!("{}{}", lib_line(libraries), env.trim())
}

/// 只保留绘图有效部分：去掉 standalone 外壳，库声明单独提到最前面。
fn strip_document_shell(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let t = line.trim_start();
            !(t.starts_with("\\documentclass")
                || t.starts_with("\\usepackage")
                || t.starts_with("\\begin{document}")
                || t.starts_with("\\end{document}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn has_drawing_command(text: &str) -> bool {
    ["\\draw", "\\node", "\\path", "\\fill", "\\coordinate"]
        .iter()
        .any(|cmd| text.contains(cmd))
}

/// 收集 \usetikzlibrary{a,b} 中的库名，去重保序。
fn collect_libraries(text: &str) -> Vec<String> {
    const KEY: &str = "\\usetikzlibrary{";
    let mut out: Vec<String> = Vec::new();
    let mut search = 0;
    while let Some(rel) = text[search..].find(KEY) {
        let begin = search + rel + KEY.len();
        let Some(close_rel) = text[begin..].find('}') else { break };
        let body = &text[begin..begin + close_rel];
        for lib in body.split(',') {
            let lib = lib.trim();
            if lib.is_empty() || out.iter().any(|x| x == lib) {
                continue;
            }
            out.push(lib.to_string());
        }
        search = begin + close_rel + 1;
    }
    out
}

/// 找完整 tikzpicture 环境；支持 `[options]` 与嵌套 tikzpicture，跳过被反斜杠转义的伪命令。
fn find_environments(text: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let mut search = 0;
    while let Some(rel) = text[search..].find(BEGIN) {
        let begin = search + rel;
        if is_escaped(text, begin) {
            search = begin + 1;
            continue;
        }
        let after_begin = begin + BEGIN.len();
        let body_start = if text.as_bytes().get(after_begin) == Some(&b'[') {
            match text[after_begin..].find(']') {
                Some(k) => after_begin + k + 1,
                None => after_begin,
            }
        } else {
            after_begin
        };
        let Some(end) = matching_end(text, body_start) else {
            search = after_begin;
            continue;
        };
        out.push((begin, end, text[begin..end].to_string()));
        search = end;
    }
    out
}

fn matching_end(text: &str, from: usize) -> Option<usize> {
    let mut depth = 1usize;
    let mut pos = from;
    while pos < text.len() {
        let next_begin = text[pos..].find(BEGIN).map(|x| pos + x);
        let next_end = text[pos..].find(END).map(|x| pos + x);
        match (next_begin, next_end) {
            (Some(b), Some(e)) if b < e => {
                if is_escaped(text, b) {
                    pos = b + 1;
                } else {
                    depth += 1;
                    pos = b + BEGIN.len();
                }
            }
            (_, Some(e)) => {
                if is_escaped(text, e) {
                    pos = e + 1;
                } else {
                    depth -= 1;
                    if depth == 0 {
                        return Some(e + END.len());
                    }
                    pos = e + END.len();
                }
            }
            (Some(b), None) => {
                pos = if is_escaped(text, b) {
                    b + 1
                } else {
                    depth += 1;
                    b + BEGIN.len()
                };
            }
            (None, None) => return None,
        }
    }
    None
}

fn is_escaped(text: &str, index: usize) -> bool {
    index > 0 && text.as_bytes()[index - 1] == b'\\'
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "zetla-tikz-scan-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn scan_finds_tikz_file_and_tex_environment() {
        let root = temp_root();
        write(
            &root,
            "figures/flow.tikz",
            "\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}\n",
        );
        write(
            &root,
            "chapters/main.tex",
            "\\documentclass{article}\n\\usepackage{tikz}\n\\usetikzlibrary{arrows.meta}\n\\begin{document}\n\\begin{tikzpicture}\n  \\node at (0,0) {A};\n\\end{tikzpicture}\n\\end{document}\n",
        );

        let found = scan_tikz_sources(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].kind, "tikz-file");
        assert!(found[0].source.contains("\\begin{tikzpicture}"));
        assert_eq!(found[1].kind, "tex-env");
        assert_eq!(found[1].libraries, vec!["arrows.meta"]);
        assert!(found[1].source.starts_with("\\usetikzlibrary{arrows.meta}"));
        assert_eq!(found[1].start_line, 5);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_extracts_every_environment_in_a_tex_file() {
        let root = temp_root();
        write(
            &root,
            "all.tex",
            "\\begin{tikzpicture}[scale=2]\n  \\draw (0,0) -- (1,0);\n\\end{tikzpicture}\ntext\n\\begin{tikzpicture}\n  \\node {B};\n\\end{tikzpicture}\n",
        );

        let found = scan_tikz_sources(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].start_line, 1);
        assert_eq!(found[0].end_line, 3);
        assert_eq!(found[1].start_line, 5);
        assert!(found[0].source.contains("[scale=2]"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_ignores_hidden_build_dirs_and_unrelated_extensions() {
        let root = temp_root();
        let picture = "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}";
        write(&root, ".git/hidden.tikz", picture);
        write(&root, "build/out.tikz", picture);
        write(&root, "notes.md", picture);
        write(&root, "figures/ok.tikz", picture);

        let found = scan_tikz_sources(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].rel_path, "figures/ok.tikz");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scan_wraps_bare_tikz_file_without_environment() {
        let root = temp_root();
        write(&root, "bare.tikz", "\\draw (0,0) -- (1,1);\n");

        let found = scan_tikz_sources(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(found.len(), 1);
        assert!(found[0].source.starts_with("\\begin{tikzpicture}"));
        assert!(found[0].source.ends_with("\\end{tikzpicture}"));
        assert_eq!(found[0].kind, "tikz-file");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn parse_external_file_marks_origin_and_supports_tex_env() {
        let root = temp_root();
        write(
            &root,
            "outside.tex",
            "\\documentclass{article}\n\\usetikzlibrary{positioning}\n\\begin{document}\n\\begin{tikzpicture}\n  \\node {X};\n\\end{tikzpicture}\n\\end{document}\n",
        );
        let path = root.join("outside.tex").to_string_lossy().into_owned();

        let found = parse_tikz_file(path).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].origin, "external");
        assert!(found[0].id.starts_with("external:"));
        assert_eq!(found[0].rel_path, "outside.tex");
        assert_eq!(found[0].kind, "tex-env");
        assert_eq!(found[0].libraries, vec!["positioning"]);
        assert!(found[0].source.contains("\\begin{tikzpicture}"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn parse_external_file_rejects_bad_path_and_ext() {
        let root = temp_root();
        write(&root, "notes.md", "not tikz");
        assert!(parse_tikz_file(root.join("missing.tikz").to_string_lossy().into_owned()).is_err());
        assert!(parse_tikz_file(root.join("notes.md").to_string_lossy().into_owned()).is_err());
        assert!(parse_tikz_file(String::new()).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn extractor_keeps_nested_scope_inside_one_environment() {
        let text = "\\begin{tikzpicture}\n  \\begin{scope}[shift={(1,0)}]\n    \\draw (0,0)--(1,1);\n  \\end{scope}\n\\end{tikzpicture}";
        let envs = find_environments(text);
        assert_eq!(envs.len(), 1);
        assert!(envs[0].2.contains("\\begin{scope}"));
        assert!(envs[0].2.trim_end().ends_with("\\end{tikzpicture}"));
    }
}
