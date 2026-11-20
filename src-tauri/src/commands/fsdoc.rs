// 文件持久层（开发文档 §3.4-B）
// 职责：编码检测与转换、换行符保持、原子写、外部变更重读
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::Metadata;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use tauri::State;

/// 读取结果（与 src/types/project.ts FileDoc 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDoc {
    pub content: String,
    /// 检测到的编码（小写）："utf-8" | "gbk" | "utf-16le" | ...
    pub encoding: String,
    /// 换行符："lf" | "crlf"
    pub eol: String,
}

/// 写入选项（前端可显式指定，缺省时保持原文件格式）
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WriteOptions {
    pub encoding: Option<String>,
    pub eol: Option<String>,
}

// ── 编码探测 ────────────────────────────────────────────────

/// 返回 (编码, BOM 长度)。优先级：BOM → 严格 UTF-8 → chardetng → 兜底 GBK
fn detect(bytes: &[u8]) -> (&'static Encoding, usize) {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        return (enc, bom_len);
    }
    if std::str::from_utf8(bytes).is_ok() {
        return (UTF_8, 0);
    }
    let mut det = EncodingDetector::new();
    det.feed(bytes, true);
    // 中文 Windows 场景：allow_utf8=false 之外仍先走过严格 UTF-8 检测，
    // 此处探测结果非 UTF-8 时按其返回；GBK 是兜底而非首选
    let enc = det.guess(None, true);
    (enc, 0)
}

fn encoding_label(enc: &'static Encoding) -> String {
    enc.name().to_lowercase()
}

fn encoding_from_label(label: &str) -> &'static Encoding {
    match label.to_lowercase().as_str() {
        "utf-8" | "utf8" => UTF_8,
        "gbk" | "gb18030" | "gb2312" | "chinese" => encoding_rs::GBK,
        "utf-16le" | "utf16le" => encoding_rs::UTF_16LE,
        "utf-16be" | "utf16be" => encoding_rs::UTF_16BE,
        _ => UTF_8,
    }
}

// ── 换行符 ─────────────────────────────────────────────────

/// 检测首个换行风格；无换行时默认 lf
fn detect_eol(text: &str) -> String {
    let bytes = text.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if *b == b'\n' {
            return if i > 0 && bytes[i - 1] == b'\r' {
                "crlf".into()
            } else {
                "lf".into()
            };
        }
        if *b == b'\r' {
            // 孤立 \r（旧 Mac 风格）或 \r\n 都按 crlf 报告
            return "crlf".into();
        }
    }
    "lf".into()
}

/// 归一化为 LF（CRLF→LF，孤立 \r 保持不动）
fn to_lf(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    text.replace("\r\n", "\n")
}

/// 按目标 EOL 输出
fn apply_eol(text: &str, eol: &str) -> String {
    let lf = to_lf(text);
    if eol == "crlf" {
        lf.replace('\n', "\r\n")
    } else {
        lf
    }
}

// ── 读取 ──────────────────────────────────────────────────

/// 读取文件：自动探测编码（含 GBK），返回内容 + 元数据
fn read_file_inner(path: &str) -> Result<FileDoc, String> {
    let p = Path::new(path);
    let bytes = std::fs::read(p).map_err(|e| format!("读取失败 {}: {}", p.display(), e))?;
    let (enc, bom_len) = detect(&bytes);
    let body = if bytes.len() >= bom_len {
        &bytes[bom_len..]
    } else {
        &bytes[..]
    };
    let (text, _had_errors) = enc.decode_without_bom_handling(body);
    let eol = detect_eol(&text);
    Ok(FileDoc {
        content: text.into_owned(),
        encoding: encoding_label(enc),
        eol,
    })
}

/// 读文件（Tauri command）
#[tauri::command]
pub fn read_file(path: String) -> Result<FileDoc, String> {
    read_file_inner(&path)
}

/// 外部变更后放弃缓冲、重新读盘（与 read_file 同管线）
#[tauri::command]
pub fn revert_file(path: String) -> Result<FileDoc, String> {
    read_file_inner(&path)
}

// ── 写入（原子写） ─────────────────────────────────────────

/// 写文件：保持原编码/EOL（或按 options 指定），临时文件 + rename 原子替换
#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    options: Option<WriteOptions>,
) -> Result<(), String> {
    let opts = options.unwrap_or_default();
    let p = Path::new(&path);

    // 目标编码：options > 原文件 > UTF-8
    // 目标 EOL：options > 原文件 > 依据新内容探测
    let mut target_encoding = opts.encoding.clone();
    let mut target_eol = opts.eol.clone();

    if let Ok(orig_bytes) = std::fs::read(p) {
        if target_encoding.is_none() {
            let (enc, _) = detect(&orig_bytes);
            target_encoding = Some(encoding_label(enc));
        }
        if target_eol.is_none() {
            let (enc, bom_len) = detect(&orig_bytes);
            let body = if orig_bytes.len() >= bom_len {
                &orig_bytes[bom_len..]
            } else {
                &orig_bytes[..]
            };
            let (text, _) = enc.decode_without_bom_handling(body);
            target_eol = Some(detect_eol(&text));
        }
    }

    let enc_label = target_encoding.unwrap_or_else(|| "utf-8".into());
    let enc = encoding_from_label(&enc_label);
    let eol = target_eol.unwrap_or_else(|| detect_eol(&content));

    let normalized = apply_eol(&content, &eol);
    let (bytes, _enc_used, _unmappable) = enc.encode(&normalized);

    // 原子写：同目录临时文件 → rename 覆盖（Windows 下 rename 会替换已存在目标）
    let tmp_name = format!(
        "{}.tmp",
        p.file_name()
            .ok_or_else(|| format!("非法路径 {}", p.display()))?
            .to_string_lossy()
    );
    let tmp = p.parent().unwrap_or(Path::new(".")).join(tmp_name);

    std::fs::write(&tmp, &bytes).map_err(|e| format!("写临时文件失败: {}", e))?;
    if let Err(e) = std::fs::rename(&tmp, p) {
        let _ = std::fs::remove_file(&tmp); // 清理残留，原文件未被触碰
        return Err(format!("替换失败 {}: {}", p.display(), e));
    }
    Ok(())
}

// ── 清理辅助文件（M1-9）──────────────────────────────────
// 删 LaTeX 编译产物（.aux/.log/.bbl/.blg/.toc/.out/.synctex.gz/.lof/.lot/.idx/.ilg/.ind/.fls/.fdb_latexmk），
// 递归、不碰源（.tex/.bib/.cls/.sty）与产物 PDF。
// M1-9c：后缀白名单可由前端 cleanAuxExtensions 自定义；空列表回退到内置默认。

/// 清理结果（返回删除数与清单，供前端 toast）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanAuxResult {
    pub removed: usize,
    pub paths: Vec<String>,
}

/// 内置默认辅助文件后缀（含点；与前端 DEFAULT_AUX_EXTENSIONS 保持一致）
const DEFAULT_AUX_SUFFIXES: &[&str] = &[
    ".aux", ".log", ".bbl", ".blg", ".toc", ".out", ".lof", ".lot", ".idx", ".ilg", ".ind",
    ".fls", ".fdb_latexmk", ".synctex.gz",
];

/// 安全网：绝不删除的源 / 产物 / 资源后缀（即便被加入自定义列表也忽略），防误删
const PROTECTED_SUFFIXES: &[&str] = &[
    ".tex", ".bib", ".cls", ".sty", ".bst", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".tif",
    ".tiff", ".bmp", ".eps", ".svg", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg",
    ".def", ".dtx", ".ins", ".ltx",
];

/// 该路径是否匹配任一辅助文件后缀（不区分大小写；root 须为目录）
/// - `suffixes` 为空 → 回退内置默认清单
/// - 命中 PROTECTED_SUFFIXES 的一律不删（防呆）
fn is_aux_file(path: &Path, suffixes: &[String]) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if PROTECTED_SUFFIXES.iter().any(|s| name.ends_with(*s)) {
        return false;
    }
    let list: Vec<String> = if suffixes.is_empty() {
        DEFAULT_AUX_SUFFIXES.iter().map(|s| s.to_string()).collect()
    } else {
        suffixes.to_vec()
    };
    list.iter().any(|s| name.ends_with(&s.to_lowercase()))
}

/// 递归删除 root 下所有辅助文件（root 须为目录）
fn clean_aux_in(root: &Path, suffixes: &[String]) -> Result<CleanAuxResult, String> {
    if !root.is_dir() {
        return Err(format!("不是有效目录: {}", root.display()));
    }
    let mut removed = 0usize;
    let mut paths: Vec<String> = Vec::new();

    fn walk(dir: &Path, suffixes: &[String], removed: &mut usize, paths: &mut Vec<String>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let p = entry.path();
            let ft = entry.file_type()?;
            if ft.is_dir() {
                walk(&p, suffixes, removed, paths)?;
            } else if ft.is_file() && is_aux_file(&p, suffixes) {
                if std::fs::remove_file(&p).is_ok() {
                    *removed += 1;
                    paths.push(p.to_string_lossy().into_owned());
                }
            }
        }
        Ok(())
    }

    walk(root, suffixes, &mut removed, &mut paths)
        .map_err(|e| format!("清理失败 {}: {}", root.display(), e))?;
    Ok(CleanAuxResult { removed, paths })
}

/// 清理辅助文件（Tauri command）：传入项目根目录 + 自定义后缀白名单
/// `extensions` 为空 → 使用内置默认清单；命中 PROTECTED_SUFFIXES 的不会被删。
#[tauri::command]
pub fn clean_aux(root: String, extensions: Vec<String>) -> Result<CleanAuxResult, String> {
    clean_aux_in(Path::new(&root), &extensions)
}

// ── M1-41：清除全部编译产物（仅菜单手动清理使用）────────────────────────
// 与上面的 clean_aux 完全隔离：自动清理（useCompile.ts）继续走旧命令，旧
// PROTECTED_SUFFIXES 仍保护 .pdf；新规则把 PDF 与未知后缀（有 outputDir 时）
// 都视为编译产物，只靠下面的用户文件白名单保护用户自己的资源与代码。

/// 项目树隐藏 / 新规则共用的 LaTeX 中间文件后缀（19 项，含复合后缀）
pub(crate) const TREE_AUX_SUFFIXES: [&str; 19] = [
    ".aux", ".log", ".bbl", ".blg", ".toc", ".out", ".lof", ".lot", ".idx", ".ilg", ".ind",
    ".fls", ".fdb_latexmk", ".synctex.gz", ".nav", ".snm", ".vrb", ".bcf", ".run.xml",
];

/// 用户自己写的代码（不含 .pdf，pdf 在新规则中是产物）
const USER_SOURCE_SUFFIXES: &[&str] = &[
    ".tex", ".bib", ".cls", ".sty", ".bst", ".dtx", ".ins", ".ltx", ".lua", ".py", ".js",
    ".jsx", ".ts", ".tsx", ".sh", ".bat", ".ps1", ".r", ".rmd", ".ipynb", ".c", ".cpp", ".h",
    ".hpp", ".java", ".go", ".rs", ".sql", ".html", ".css", ".rst",
];

/// 用户导入的图片/资源（= 前端 EXT_IMG 去掉 pdf，并补 webp/avif/字体）
const USER_ASSET_SUFFIXES: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".bmp", ".eps", ".tif", ".tiff",
    ".ico", ".ttf", ".otf", ".woff", ".woff2", ".eot",
];

/// 用户文档/配置（.xml 由产物判定优先，故 .run.xml 仍会被删）
const USER_DOC_SUFFIXES: &[&str] = &[
    ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".csv", ".xml",
];

/// 递归时跳过的大型工具目录（扫描根本身不跳过，即便名为 out）
const SKIP_DIR_NAMES: &[&str] = &["node_modules", "target", "dist", "out", "__pycache__"];

const CLEAN_MAX_DEPTH: usize = 12;
const CLEAN_MAX_ENTRIES: usize = 5000;
const CLEAN_MAX_TOKENS: usize = 16;
const PREVIEW_LIST_LIMIT: usize = 12;

/// 预览结果：files 只回前 12 条用于确认文案，total 是全量数量
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildOutputPreview {
    pub token: u64,
    pub files: Vec<String>,
    pub total: usize,
    pub dir_label: String,
}

/// 执行结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanBuildOutputsResult {
    pub removed: usize,
    pub dirs_removed: usize,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct SnapFile {
    abs: PathBuf,
    rel: String,
    modified: Option<u128>,
}

#[derive(Debug)]
struct CleanSnapshot {
    root: PathBuf,
    files: Vec<SnapFile>,
    empty_dir_candidates: Vec<PathBuf>,
}

/// 快照表：token 是幂等句柄（最多保留 16 份），执行后即销毁
#[derive(Default)]
pub struct CleanState {
    next: AtomicU64,
    snapshots: Mutex<HashMap<u64, CleanSnapshot>>,
}

impl CleanState {
    fn alloc(&self, snap: CleanSnapshot) -> u64 {
        let token = self.next.fetch_add(1, Ordering::Relaxed);
        let mut map = self.snapshots.lock().unwrap_or_else(|e| e.into_inner());
        while map.len() >= CLEAN_MAX_TOKENS {
            match map.keys().copied().min() {
                Some(oldest) => {
                    map.remove(&oldest);
                }
                None => break,
            }
        }
        map.insert(token, snap);
        token
    }

    fn take(&self, token: u64) -> Option<CleanSnapshot> {
        let mut map = self.snapshots.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&token)
    }
}

fn ends_with_any(name: &str, list: &[&str]) -> bool {
    list.iter().any(|s| name.ends_with(*s))
}

/// 已知编译产物后缀：19 项中间文件 + PDF（优先级高于用户白名单，保证 .run.xml 被删）
fn is_known_artifact_name(lower: &str) -> bool {
    ends_with_any(lower, &TREE_AUX_SUFFIXES[..]) || lower.ends_with(".pdf")
}

/// 主文件名（去 .tex）：只有 `<stem>.*` 才可能是本次主文件编译产物。
/// 用户导入的 figure/xxx.pdf、章节的 ch.aux 等非主文件名一律保留。
fn main_stem(main_file: &str) -> String {
    Path::new(main_file)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 主文件前缀 + 后缀双重判定：
/// - 有 outputDir：`<stem>.*` 且非用户文件即产物（含未知后缀）
/// - 无 outputDir：还需命中 19 类中间文件或 `.pdf`
fn is_main_artifact_name(lower_name: &str, lower_stem: &str, outdir_mode: bool) -> bool {
    if lower_stem.is_empty() || !lower_name.starts_with(lower_stem) {
        return false;
    }
    if !lower_name[lower_stem.len()..].starts_with('.') {
        return false;
    }
    outdir_mode || is_known_artifact_name(lower_name)
}

/// 用户文件判定：点号路径（含 .ltex/.git）、符号链接、用户代码/资源/文档白名单。
/// 产物后缀先判，但进入本函数前已由 is_main_artifact_name 做过主文件名前缀过滤，
/// 因此用户手写的 notes.log 与导入的 figure/xxx.pdf 不会走到这里。
fn is_user_file(abs: &Path, root: &Path) -> bool {
    let rel = abs.strip_prefix(root).unwrap_or(abs);
    if rel
        .components()
        .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    {
        return true;
    }
    if let Ok(md) = std::fs::symlink_metadata(abs) {
        if md.file_type().is_symlink() {
            return true;
        }
    }
    let name = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if is_known_artifact_name(&name) {
        return false;
    }
    ends_with_any(&name, USER_SOURCE_SUFFIXES)
        || ends_with_any(&name, USER_ASSET_SUFFIXES)
        || ends_with_any(&name, USER_DOC_SUFFIXES)
}

fn modified_nanos(md: &Metadata) -> Option<u128> {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
}

/// 解析清理范围：有 outputDir → <root>/<outputDir>（outdir_mode=true，未知后缀也删）；
/// 无 → 主文件父目录（outdir_mode=false，只删已知产物后缀）。
fn resolve_clean_dir(
    root: &Path,
    main_file: &str,
    output_dir: Option<String>,
) -> Result<(PathBuf, String, bool), String> {
    let root_canon = root.canonicalize().map_err(|e| format!("项目目录无效: {e}"))?;
    let rel = crate::commands::project::clean_rel("构建产物目录", output_dir)?;
    let (dir, label, outdir_mode) = match rel {
        Some(r) => {
            let rp = Path::new(&r);
            if rp.components().any(|c| {
                matches!(
                    c,
                    Component::Prefix(_) | Component::RootDir | Component::ParentDir
                )
            }) {
                return Err("构建产物目录必须为项目内的相对路径".into());
            }
            (root.join(rp), format!("构建产物目录：{}", r), true)
        }
        None => {
            let parent = Path::new(main_file)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(root);
            (parent.to_path_buf(), "主文件所在目录".to_string(), false)
        }
    };
    if !dir.starts_with(root) {
        return Err("构建产物目录必须位于项目目录内".into());
    }
    if let Ok(c) = dir.canonicalize() {
        if !c.starts_with(&root_canon) {
            return Err("构建产物目录必须位于项目目录内".into());
        }
    }
    Ok((dir, label, outdir_mode))
}

/// 扫描并生成快照（不删除任何文件）
fn collect_snapshot(
    root: &Path,
    dir: &Path,
    outdir_mode: bool,
    main_stem: &str,
) -> Result<CleanSnapshot, String> {
    fn walk(
        root: &Path,
        cur: &Path,
        outdir_mode: bool,
        stem: &str,
        depth: usize,
        visited: &mut usize,
        files: &mut Vec<SnapFile>,
        dirs: &mut Vec<PathBuf>,
    ) -> std::io::Result<()> {
        if depth > CLEAN_MAX_DEPTH || *visited >= CLEAN_MAX_ENTRIES {
            return Ok(());
        }
        let mut subdirs = Vec::new();
        for entry in std::fs::read_dir(cur)? {
            let entry = entry?;
            *visited += 1;
            if *visited >= CLEAN_MAX_ENTRIES {
                break;
            }
            let p = entry.path();
            let ft = entry.file_type()?;
            if ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if ft.is_dir() {
                if SKIP_DIR_NAMES.contains(&name.to_ascii_lowercase().as_str()) {
                    continue;
                }
                subdirs.push(p.clone());
                dirs.push(p);
            } else if ft.is_file() {
                // 主文件名前缀是硬门槛：非 <stem>.* 的文件（含用户导入 PDF）一律不进快照
                let lower = name.to_ascii_lowercase();
                if !is_main_artifact_name(&lower, stem, outdir_mode) {
                    continue;
                }
                if is_user_file(&p, root) {
                    continue;
                }
                let Ok(md) = std::fs::metadata(&p) else { continue };
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .into_owned();
                files.push(SnapFile {
                    abs: p,
                    rel,
                    modified: modified_nanos(&md),
                });
            }
        }
        for d in subdirs {
            walk(root, &d, outdir_mode, stem, depth + 1, visited, files, dirs)?;
        }
        Ok(())
    }

    let stem = main_stem.to_ascii_lowercase();
    let mut visited = 0usize;
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    walk(
        root,
        dir,
        outdir_mode,
        &stem,
        0,
        &mut visited,
        &mut files,
        &mut dirs,
    )
    .map_err(|e| format!("扫描构建产物失败: {e}"))?;
    Ok(CleanSnapshot {
        root: root.to_path_buf(),
        files,
        empty_dir_candidates: dirs,
    })
}

/// 按快照执行删除：二次校验用户文件/mtime，只删快照内的文件与空目录
fn apply_snapshot(snap: CleanSnapshot) -> CleanBuildOutputsResult {
    let mut removed = 0usize;
    let mut paths = Vec::new();
    for f in &snap.files {
        if is_user_file(&f.abs, &snap.root) {
            continue;
        }
        let md = match std::fs::symlink_metadata(&f.abs) {
            Ok(m) if m.file_type().is_file() => m,
            _ => continue,
        };
        if modified_nanos(&md) != f.modified {
            continue;
        }
        if std::fs::remove_file(&f.abs).is_ok() {
            removed += 1;
            paths.push(f.rel.clone());
        }
    }
    // 自底向上删空目录；含用户文件的目录 remove_dir 会失败，天然保留。
    // 扫描根本身不在 candidates 中，清理后目录一定还在。
    let mut dirs_removed = 0usize;
    for d in snap.empty_dir_candidates.iter().rev() {
        if std::fs::remove_dir(d).is_ok() {
            dirs_removed += 1;
        }
    }
    CleanBuildOutputsResult {
        removed,
        dirs_removed,
        paths,
    }
}

/// 预览待清理文件（不删）：生成快照并返回确认文案所需的清单
#[tauri::command]
pub fn preview_build_outputs(
    root: String,
    main_file: String,
    output_dir: Option<String>,
    state: State<'_, Arc<CleanState>>,
) -> Result<BuildOutputPreview, String> {
    let root_path = Path::new(&root);
    let (dir, dir_label, outdir_mode) = resolve_clean_dir(root_path, &main_file, output_dir)?;
    // 确认弹窗明确写出「仅 main.*」，避免用户以为整目录都会被清空
    let stem = main_stem(&main_file);
    let dir_label = if stem.is_empty() {
        dir_label
    } else {
        format!("{}（仅 {}.*）", dir_label, stem)
    };
    if !dir.is_dir() {
        return Ok(BuildOutputPreview {
            token: 0,
            files: Vec::new(),
            total: 0,
            dir_label,
        });
    }
    let snap = collect_snapshot(root_path, &dir, outdir_mode, &stem)?;
    let total = snap.files.len();
    let files: Vec<String> = snap
        .files
        .iter()
        .take(PREVIEW_LIST_LIMIT)
        .map(|f| f.rel.clone())
        .collect();
    if total == 0 {
        return Ok(BuildOutputPreview {
            token: 0,
            files,
            total,
            dir_label,
        });
    }
    let token = state.alloc(snap);
    Ok(BuildOutputPreview {
        token,
        files,
        total,
        dir_label,
    })
}

/// 按预览 token 执行清理（前端不能指定路径）
#[tauri::command]
pub fn clean_build_outputs(
    token: u64,
    state: State<'_, Arc<CleanState>>,
) -> Result<CleanBuildOutputsResult, String> {
    let snap = state
        .take(token)
        .ok_or_else(|| "预览已失效，请重新点击清理".to_string())?;
    Ok(apply_snapshot(snap))
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::GBK;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> String {
        let dir = std::env::temp_dir().join("zetla_fsdoc_test");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name).to_string_lossy().into_owned()
    }

    fn read_bytes(path: &str) -> Vec<u8> {
        std::fs::read(path).unwrap()
    }

    #[test]
    fn gbk_crlf_read_no_mojibake() {
        let path = tmp_path("gbk_crlf.tex");
        let text = "中文测试：毕业论文\r\n第二行内容\r\n";
        let (bytes, _, _) = GBK.encode(text);
        std::fs::write(&path, &bytes).unwrap();

        let doc = read_file_inner(&path).unwrap();
        assert_eq!(doc.encoding, "gbk");
        assert_eq!(doc.eol, "crlf");
        assert_eq!(doc.content, text);
    }

    #[test]
    fn utf8_lf_roundtrip_lossless() {
        let path = tmp_path("utf8_lf.tex");
        let text = "\\section{引言}\n内容 without 中文混合\n";
        std::fs::write(&path, text.as_bytes()).unwrap();

        let doc = read_file_inner(&path).unwrap();
        assert_eq!(doc.encoding, "utf-8");
        assert_eq!(doc.eol, "lf");

        // 读→写（不改）→ 再读：字节级无损
        write_file(path.clone(), doc.content.clone(), None).unwrap();
        assert_eq!(read_bytes(&path), text.as_bytes());
    }

    #[test]
    fn gbk_roundtrip_keeps_encoding_and_eol() {
        let path = tmp_path("gbk_rt.tex");
        let orig = "旧文档标题\r\n正文段落\r\n";
        let (bytes, _, _) = GBK.encode(orig);
        std::fs::write(&path, &bytes).unwrap();

        let doc = read_file_inner(&path).unwrap();
        // 写回同样内容 → 仍是 GBK + CRLF，字节一致
        write_file(path.clone(), doc.content.clone(), None).unwrap();
        assert_eq!(read_bytes(&path), bytes.as_ref());
    }

    #[test]
    fn lf_content_converted_to_original_crlf() {
        let path = tmp_path("crlf_convert.tex");
        let orig = "行一\r\n行二\r\n";
        let (bytes, _, _) = GBK.encode(orig);
        std::fs::write(&path, &bytes).unwrap();

        // 前端（CodeMirror 归一化）送来 LF 内容 + 新增一行
        let new_content = "行一\n行二\n新增行\n";
        write_file(path.clone(), new_content.to_string(), None).unwrap();

        let doc = read_file_inner(&path).unwrap();
        assert_eq!(doc.encoding, "gbk");
        assert_eq!(doc.eol, "crlf");
        assert_eq!(doc.content, "行一\r\n行二\r\n新增行\r\n");
    }

    #[test]
    fn explicit_options_override_original() {
        let path = tmp_path("override.tex");
        std::fs::write(&path, "old\r\n".as_bytes()).unwrap();

        let opts = WriteOptions {
            encoding: Some("utf-8".into()),
            eol: Some("lf".into()),
        };
        write_file(path.clone(), "新内容\r\n".to_string(), Some(opts)).unwrap();

        let doc = read_file_inner(&path).unwrap();
        assert_eq!(doc.encoding, "utf-8");
        assert_eq!(doc.eol, "lf");
        assert_eq!(doc.content, "新内容\n");
    }

    #[test]
    fn write_to_invalid_path_fails_without_touching_source() {
        let path = tmp_path("target_ok.tex");
        std::fs::write(&path, "keep me".as_bytes()).unwrap();
        // 目标所在父目录不存在 → 写临时文件失败，原文件不受影响
        let bad = path.clone() + "_no_such_dir/x.tex";
        let dir_parent = std::path::Path::new(&bad).parent().unwrap().to_path_buf();
        assert!(write_file(bad, "x".into(), None).is_err());
        assert!(!dir_parent.exists());
        assert_eq!(read_bytes(&path), b"keep me");
    }

    #[test]
    fn clean_aux_removes_only_aux_files() {
        let dir: PathBuf = PathBuf::from(tmp_path("clean_aux"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.aux"), "x").unwrap();
        std::fs::write(dir.join("main.log"), "x").unwrap();
        std::fs::write(dir.join("main.synctex.gz"), "x").unwrap();
        std::fs::write(dir.join("main.fdb_latexmk"), "x").unwrap();
        std::fs::write(dir.join("main.pdf"), "KEEP").unwrap();
        std::fs::write(dir.join("main.tex"), "KEEP").unwrap();
        std::fs::write(dir.join("refs.bib"), "KEEP").unwrap();
        std::fs::create_dir_all(dir.join("chapters")).unwrap();
        std::fs::write(dir.join("chapters/ch.aux"), "x").unwrap();
        std::fs::write(dir.join("chapters/ch.tex"), "KEEP").unwrap();

        // 空列表 → 回退内置默认清单
        let res = clean_aux_in(&dir, &Vec::new()).unwrap();
        assert_eq!(res.removed, 5);

        // 源 / PDF 必须保留
        assert_eq!(std::fs::read_to_string(dir.join("main.pdf")).unwrap(), "KEEP");
        assert_eq!(std::fs::read_to_string(dir.join("main.tex")).unwrap(), "KEEP");
        assert_eq!(std::fs::read_to_string(dir.join("refs.bib")).unwrap(), "KEEP");
        assert_eq!(
            std::fs::read_to_string(dir.join("chapters/ch.tex")).unwrap(),
            "KEEP"
        );
        // 辅助文件已删
        assert!(!dir.join("main.aux").exists());
        assert!(!dir.join("main.log").exists());
        assert!(!dir.join("main.synctex.gz").exists());
        assert!(!dir.join("main.fdb_latexmk").exists());
        assert!(!dir.join("chapters/ch.aux").exists());

        // 二次清理：无残留
        let res2 = clean_aux_in(&dir, &Vec::new()).unwrap();
        assert_eq!(res2.removed, 0);
    }

    #[test]
    fn clean_aux_custom_extensions() {
        let dir: PathBuf = PathBuf::from(tmp_path("clean_aux_custom"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.aux"), "x").unwrap(); // 自定义列表不含 .aux → 保留
        std::fs::write(dir.join("b.nav"), "x").unwrap(); // 自定义列表含 .nav → 删
        std::fs::write(dir.join("c.synctex.gz"), "x").unwrap(); // 自定义列表含 .synctex.gz → 删
        std::fs::write(dir.join("d.tex"), "KEEP").unwrap(); // 受保护 → 永远保留

        // 仅按用户给的 .nav / .synctex.gz 删
        let exts = vec![".nav".to_string(), ".synctex.gz".to_string()];
        let res = clean_aux_in(&dir, &exts).unwrap();
        assert_eq!(res.removed, 2);
        assert!(!dir.join("b.nav").exists());
        assert!(!dir.join("c.synctex.gz").exists());
        assert!(dir.join("a.aux").exists()); // 默认清单的 .aux 不在自定义列表 → 保留
        assert_eq!(std::fs::read_to_string(dir.join("d.tex")).unwrap(), "KEEP"); // 防呆
    }

    #[test]
    fn clean_aux_rejects_non_dir() {
        let f = tmp_path("not_a_dir.tex");
        std::fs::write(&f, "x").unwrap();
        assert!(clean_aux_in(Path::new(&f), &Vec::new()).is_err());
    }

    // ── M1-41：手动清理全部编译产物 ──
    fn fresh_dir(name: &str) -> PathBuf {
        let p = PathBuf::from(tmp_path(name));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn put(p: &Path, text: &str) {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn clean_outputs_with_outdir_keeps_user_files() {
        let root = fresh_dir("clean_outputs_outdir");
        let out = root.join("build");
        put(&out.join("main.pdf"), "x");
        put(&out.join("main.aux"), "x");
        put(&out.join("main.xyz"), "x"); // 有 outputDir：主文件名前缀 + 未知后缀也算产物
        put(&out.join("sub/main.log"), "x"); // 子目录里的同名产物也删
        put(&out.join("sub/ch.log"), "KEEP"); // 非主文件名 → 保留
        put(&out.join("figure/ZGNR能带 N=10.pdf"), "KEEP"); // 用户导入 PDF 矢量图
        put(&out.join("fig.png"), "KEEP");
        put(&out.join("user.tex"), "KEEP");
        put(&out.join("main.tex"), "KEEP"); // 主文件源码即使同名也保护
        put(&out.join("notes.md"), "KEEP");
        put(&out.join("x.py"), "KEEP");
        put(&out.join("weird.xyz"), "KEEP"); // 非主文件名 → 保留
        put(&out.join(".hidden"), "KEEP");
        put(&out.join(".ltex/config.json"), "KEEP");
        std::fs::create_dir_all(out.join("empty")).unwrap();

        let snap = collect_snapshot(&root, &out, true, "main").unwrap();
        let res = apply_snapshot(snap);
        assert_eq!(res.removed, 4); // main.pdf / main.aux / main.xyz / sub/main.log
        assert_eq!(res.dirs_removed, 1); // empty；sub 与 figure 仍有用户文件
        for keep in [
            "sub/ch.log",
            "figure/ZGNR能带 N=10.pdf",
            "fig.png",
            "user.tex",
            "main.tex",
            "notes.md",
            "x.py",
            "weird.xyz",
            ".hidden",
            ".ltex/config.json",
        ] {
            assert!(out.join(keep).exists(), "应保留 {keep}");
        }
        assert!(out.is_dir(), "扫描根必须保留，保证可重新编译");
        assert!(!out.join("main.pdf").exists());
        assert!(!out.join("main.aux").exists());
        assert!(!out.join("sub/main.log").exists());
    }

    #[test]
    fn clean_outputs_without_outdir() {
        let root = fresh_dir("clean_outputs_no_outdir");
        for suffix in TREE_AUX_SUFFIXES.iter() {
            put(&root.join(format!("main{suffix}")), "x");
        }
        put(&root.join("main.pdf"), "x");
        put(&root.join("chapters/main.pdf"), "x"); // 主文件名同名 → 删
        put(&root.join("chapters/ch.aux"), "KEEP"); // 章节辅助文件非主文件名 → 保留
        put(&root.join("figure/ZGNR能带 N=10.pdf"), "KEEP"); // 用户导入 PDF → 保留
        put(&root.join("main.tex"), "KEEP");
        put(&root.join("refs.bib"), "KEEP");
        put(&root.join("fig.webp"), "KEEP");
        put(&root.join(".ltex/config.json"), "KEEP");
        put(&root.join("node_modules/main.pdf"), "KEEP"); // 重型目录跳过

        let snap = collect_snapshot(&root, &root, false, "main").unwrap();
        let res = apply_snapshot(snap);
        assert_eq!(res.removed, TREE_AUX_SUFFIXES.len() + 2);
        assert!(!root.join("main.pdf").exists());
        assert!(!root.join("chapters/main.pdf").exists());
        for name in [
            "chapters/ch.aux",
            "figure/ZGNR能带 N=10.pdf",
            "main.tex",
            "refs.bib",
            "fig.webp",
            ".ltex/config.json",
            "node_modules/main.pdf",
        ] {
            assert!(root.join(name).exists(), "应保留 {name}");
        }
        // 无 outputDir 时未知后缀即使带主文件名也不删（保守）
        put(&root.join("main.mystery"), "KEEP");
        let snap2 = collect_snapshot(&root, &root, false, "main").unwrap();
        assert_eq!(apply_snapshot(snap2).removed, 0);
    }

    #[test]
    fn clean_outputs_rejects_outdir_outside_root() {
        let root = fresh_dir("clean_outputs_escape");
        assert!(resolve_clean_dir(&root, "", Some("../../evil".into())).is_err());
        #[cfg(windows)]
        assert!(resolve_clean_dir(&root, "", Some("C:/evil".into())).is_err());
        // 合法相对路径可解析
        let (dir, _, outdir_mode) = resolve_clean_dir(&root, "", Some("build".into())).unwrap();
        assert_eq!(dir, root.join("build"));
        assert!(outdir_mode);
    }

    #[test]
    fn clean_outputs_token_snapshot_guards_changes() {
        let root = fresh_dir("clean_outputs_token");
        let out = root.join("build");
        put(&out.join("main.log"), "old");
        put(&out.join("main.pdf"), "x");
        let state = CleanState::default();
        let token = {
            let snap = collect_snapshot(&root, &out, true, "main").unwrap();
            state.alloc(snap)
        };
        // 预览后新增文件、改动已列文件 —— 都不该被删
        put(&out.join("figure/imported.pdf"), "x");
        put(&out.join("main2.pdf"), "x");
        std::thread::sleep(std::time::Duration::from_millis(20));
        put(&out.join("main.log"), "changed");
        let res = apply_snapshot(state.take(token).unwrap());
        assert_eq!(res.removed, 1);
        assert!(out.join("figure/imported.pdf").exists());
        assert!(out.join("main2.pdf").exists());
        assert!(out.join("main.log").exists());
        assert!(!out.join("main.pdf").exists());
    }

    #[test]
    fn clean_outputs_token_consumed_and_idempotent() {
        let root = fresh_dir("clean_outputs_idempotent");
        let out = root.join("build");
        put(&out.join("main.pdf"), "x");
        put(&out.join("user.tex"), "KEEP");
        let state = CleanState::default();
        let snap = collect_snapshot(&root, &out, true, "main").unwrap();
        let token = state.alloc(snap);
        assert_eq!(apply_snapshot(state.take(token).unwrap()).removed, 1);
        assert!(state.take(token).is_none(), "token 只能消费一次");
        let snap2 = collect_snapshot(&root, &out, true, "main").unwrap();
        assert_eq!(snap2.files.len(), 0);
        assert_eq!(apply_snapshot(snap2).removed, 0);
        assert_eq!(std::fs::read_to_string(out.join("user.tex")).unwrap(), "KEEP");
    }

    #[test]
    fn clean_aux_regression_pdf_still_protected() {
        let dir = fresh_dir("clean_aux_pdf_regression");
        put(&dir.join("main.pdf"), "KEEP");
        put(&dir.join("main.aux"), "x");
        let res = clean_aux_in(&dir, &Vec::new()).unwrap();
        assert_eq!(res.removed, 1);
        assert_eq!(std::fs::read_to_string(dir.join("main.pdf")).unwrap(), "KEEP");
    }
}
