// M2 · 图片插入 TikZ · P2：暂存图片 manifest 与生命周期（登记 / 转正 / 安静清理 / 启动扫描）
//
// 生命周期口径（docs/dev/绘图模块/绘图模块-图片插入切片计划.md §2.1 / §2.2）：
//  · 选中的图片先落 <root>/<imageDir>/，并登记到 <root>/.ltex/diagram-assets.json（owned=true）；
//  · 插入主文档成功后，只把「最终写入的 \includegraphics 路径」命中者移出 manifest（转正）；
//  · 没插入的，在关 Tab / 换项目 / 启动时安静清理；清理前必须校验所有权 + sha256，
//    内容被用户改过就**不删**（宁留勿删），并丢弃该条目；
//  · 启动扫描额外做一次引用检查：项目里的 .tex 若提及该文件名则保留，防止崩溃后误删已插入的图。
//
// 跨平台：路径比较统一走 fs::canonicalize（自动吸收 Windows 大小写 / 盘符、macOS NFD、
// 符号链接的差异），canonicalize 失败才回落到「正斜杠 + Windows 小写」的字符串比较。
// 所有删除目标都必须 canonicalize 后落在项目根内，绝不接受外部路径。
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// 命令级串行锁：manifest 是「读-改-写」整体，两个 IPC 并发会互相覆盖
static MANIFEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn manifest_guard() -> MutexGuard<'static, ()> {
    MANIFEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

const MANIFEST_VERSION: u8 = 1;
/// 与 P1 prepare_assets 的单图上限一致
const MAX_ASSET_BYTES: u64 = 32 * 1024 * 1024;
/// -no-shell-escape 下 XeLaTeX 能直接吃的格式（SVG 需 svg 宏包，排除）
const ALLOWED_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "pdf"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StagedImageEntry {
    /// canonicalize 后的绝对路径
    pub abs_path: String,
    /// 登记时的内容指纹；清理前必须一致
    pub sha256: String,
    pub created_at: String,
    /// 是否由本会话暂存（false 的条目永不被自动删除）
    pub owned: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagingManifest {
    pub version: u8,
    pub entries: Vec<StagedImageEntry>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagingReport {
    /// 已被安静删除的文件
    pub deleted: Vec<String>,
    /// 因 hash 变化 / 被 .tex 引用 / 越界 / 删除失败而保留的文件
    pub kept: Vec<String>,
    /// 命中 \includegraphics 路径、已移出 manifest 的文件（永久保留）
    pub promoted: Vec<String>,
}

fn manifest_path(root: &Path) -> Result<PathBuf, String> {
    if !root.is_dir() {
        return Err(format!("项目根不存在: {}", root.display()));
    }
    Ok(root.join(".ltex").join("diagram-assets.json"))
}

/// manifest 缺失 / 损坏 → 空清单（宁留勿删：不凭猜测删盘上文件）
fn read_manifest(root: &Path) -> Result<StagingManifest, String> {
    let path = manifest_path(root)?;
    if !path.is_file() {
        return Ok(StagingManifest {
            version: MANIFEST_VERSION,
            entries: Vec::new(),
        });
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取暂存清单失败 {}: {}", path.display(), e))?;
    let mut manifest: StagingManifest = serde_json::from_str(&text).unwrap_or_default();
    manifest.version = MANIFEST_VERSION;
    Ok(manifest)
}

/// 先写 .tmp 再 rename，避免崩溃留半截 JSON；rename 覆盖失败时回落到直写
fn write_manifest(root: &Path, manifest: &StagingManifest) -> Result<(), String> {
    let path = manifest_path(root)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建 .ltex 失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("序列化暂存清单失败: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes())
        .map_err(|e| format!("写入暂存清单失败 {}: {}", tmp.display(), e))?;
    match std::fs::rename(&tmp, &path) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = std::fs::remove_file(&tmp);
            std::fs::write(&path, json.as_bytes())
                .map_err(|e| format!("写入暂存清单失败 {}: {}", path.display(), e))
        }
    }
}

fn canonical(p: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(p).ok()
}

fn norm_key(p: &str) -> String {
    let s = p.replace('\\', "/");
    // Windows fs::canonicalize 会返回 \\?\E:\... verbatim 前缀，字符串回退比较时先剥掉
    let s = s.strip_prefix("//?/").unwrap_or(&s).trim_end_matches('/');
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

/// 两条路径是否指向同一文件：优先 canonicalize（大小写 / NFD / 符号链接都由 OS 处理）
fn same_path(a: &str, b: &str) -> bool {
    match (canonical(Path::new(a)), canonical(Path::new(b))) {
        (Some(x), Some(y)) => x == y,
        _ => norm_key(a) == norm_key(b),
    }
}

fn within_root(file: &Path, root: &Path) -> bool {
    match (canonical(file), canonical(root)) {
        (Some(f), Some(r)) => f.starts_with(&r),
        _ => false,
    }
}

fn sha256_of(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("读取图片失败 {}: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

fn lower_ext(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// 登记一张已落盘的暂存图。重复登记同一路径会刷新 sha256（覆盖同名场景）。
#[tauri::command(rename_all = "camelCase")]
pub fn stage_image(root: String, abs_path: String) -> Result<StagedImageEntry, String> {
    let _guard = manifest_guard();
    let root_path = Path::new(&root);
    let file = Path::new(&abs_path);
    if !file.is_file() {
        return Err(format!("待登记图片不存在: {}", abs_path));
    }
    if !within_root(file, root_path) {
        return Err("待登记图片不在项目根内，已拒绝".into());
    }
    let ext = lower_ext(&abs_path);
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(format!("不支持的暂存图片格式 .{}", ext));
    }
    let size = std::fs::metadata(file)
        .map_err(|e| format!("读取图片信息失败: {}", e))?
        .len();
    if size > MAX_ASSET_BYTES {
        return Err("暂存图片超过 32MB 上限".into());
    }
    let hash = sha256_of(file)?;
    let real = canonical(file)
        .unwrap_or_else(|| file.to_path_buf())
        .to_string_lossy()
        .into_owned();
    let entry = StagedImageEntry {
        abs_path: real,
        sha256: hash,
        created_at: Utc::now().to_rfc3339(),
        owned: true,
    };

    let mut manifest = read_manifest(root_path)?;
    manifest
        .entries
        .retain(|e| !same_path(&e.abs_path, &abs_path));
    manifest.entries.push(entry.clone());
    write_manifest(root_path, &manifest)?;
    Ok(entry)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_staged_images(root: String) -> Result<Vec<StagedImageEntry>, String> {
    let _guard = manifest_guard();
    Ok(read_manifest(Path::new(&root))?.entries)
}

/// 转正：按「主文档最终写入的 \includegraphics 路径命中者」移出 manifest。
/// 未命中的条目原样保留，等后续清理流程处理。
#[tauri::command(rename_all = "camelCase")]
pub fn promote_staged_images(root: String, abs_paths: Vec<String>) -> Result<StagingReport, String> {
    let _guard = manifest_guard();
    let root_path = Path::new(&root);
    let mut manifest = read_manifest(root_path)?;
    let hits: Vec<String> = manifest
        .entries
        .iter()
        .filter(|e| {
            e.owned && abs_paths.iter().any(|p| same_path(&e.abs_path, p))
        })
        .map(|e| e.abs_path.clone())
        .collect();
    manifest.entries.retain(|e| !hits.contains(&e.abs_path));
    write_manifest(root_path, &manifest)?;
    Ok(StagingReport {
        promoted: hits,
        ..Default::default()
    })
}

/// 安静删除：所有权 + 项目根 + sha256 三重校验，任一不满足就保留（并丢弃条目）。
/// abs_paths 为 null 时清理全部条目；不弹任何确认框（与 useProjectStore.removeEntry 区分）。
#[tauri::command(rename_all = "camelCase")]
pub fn discard_staged_images(
    root: String,
    abs_paths: Option<Vec<String>>,
) -> Result<StagingReport, String> {
    let _guard = manifest_guard();
    let root_path = Path::new(&root);
    let mut manifest = read_manifest(root_path)?;
    let wanted: Vec<String> = abs_paths.unwrap_or_else(|| {
        manifest
            .entries
            .iter()
            .map(|e| e.abs_path.clone())
            .collect()
    });
    let mut report = StagingReport::default();
    let mut remaining = Vec::new();

    for entry in manifest.entries.drain(..) {
        let selected = wanted.iter().any(|p| same_path(&entry.abs_path, p));
        if !selected {
            remaining.push(entry);
            continue;
        }
        let file = Path::new(&entry.abs_path);
        let safe = entry.owned && within_root(file, root_path) && file.is_file();
        let intact = safe && sha256_of(file).ok().as_deref() == Some(entry.sha256.as_str());
        if !safe || !intact {
            // 内容被改动 / 所有权不符 / 越界 → 绝不删；条目丢弃后归用户
            report.kept.push(entry.abs_path);
            continue;
        }
        match std::fs::remove_file(file) {
            Ok(()) => report.deleted.push(entry.abs_path),
            Err(_) => {
                // 删除失败（占用 / 权限）时保留条目，下次还有机会清理
                report.kept.push(entry.abs_path.clone());
                remaining.push(entry);
            }
        }
    }
    manifest.entries = remaining;
    write_manifest(root_path, &manifest)?;
    Ok(report)
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name.to_lowercase().as_str(),
            "node_modules" | "target" | "dist" | "build" | "vendor"
        )
}

/// 启动扫描用：收集项目内 .tex 文本（小写），供「是否已被主文档引用」的保守判定。
/// 扫描不完整 / 超限 / 读失败 → None，调用方一律按「可能被引」处理，宁留勿删。
fn collect_tex_texts(root: &Path) -> Option<Vec<String>> {
    let mut texts = Vec::new();
    let mut seen = 0usize;
    for item in walkdir::WalkDir::new(root)
        .max_depth(6)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !e.file_type().is_dir() || !skip_dir(&name)
        })
    {
        let entry = match item {
            Ok(v) => v,
            Err(_) => return None,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let is_tex = entry
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("tex"))
            .unwrap_or(false);
        if !is_tex {
            continue;
        }
        seen += 1;
        if seen > 400 {
            return None;
        }
        let len = std::fs::metadata(entry.path()).ok()?.len();
        if len > 2 * 1024 * 1024 {
            return None;
        }
        let bytes = std::fs::read(entry.path()).ok()?;
        texts.push(String::from_utf8_lossy(&bytes).to_lowercase());
    }
    Some(texts)
}

fn is_referenced(abs_path: &str, texts: &[String]) -> bool {
    let name = Path::new(abs_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    !name.is_empty() && texts.iter().any(|t| t.contains(&name))
}

/// 启动扫描：上次会话残留的孤儿暂存图全部安静清理；
/// 若项目里已有 .tex 提到该文件名（例如崩溃前已插入），保守转正保留。
#[tauri::command(rename_all = "camelCase")]
pub fn sweep_staged_images(root: String) -> Result<StagingReport, String> {
    let _guard = manifest_guard();
    let root_path = Path::new(&root);
    let mut manifest = read_manifest(root_path)?;
    let texts = collect_tex_texts(root_path);
    let mut report = StagingReport::default();
    let mut remaining = Vec::new();

    for entry in manifest.entries.drain(..) {
        let file = Path::new(&entry.abs_path);
        // 扫描不可靠时一律保留，避免崩溃恢复阶段误删
        let referenced = texts
            .as_ref()
            .map(|t| is_referenced(&entry.abs_path, t))
            .unwrap_or(true);
        if referenced {
            report.kept.push(entry.abs_path);
            continue;
        }
        let safe = entry.owned && within_root(file, root_path) && file.is_file();
        let intact = safe && sha256_of(file).ok().as_deref() == Some(entry.sha256.as_str());
        if !safe || !intact {
            report.kept.push(entry.abs_path);
            continue;
        }
        match std::fs::remove_file(file) {
            Ok(()) => report.deleted.push(entry.abs_path),
            Err(_) => {
                report.kept.push(entry.abs_path.clone());
                remaining.push(entry);
            }
        }
    }
    manifest.entries = remaining;
    write_manifest(root_path, &manifest)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "zetla_staging_{}_{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("figure")).unwrap();
        dir
    }

    fn root_str(root: &Path) -> String {
        root.to_string_lossy().into_owned()
    }

    fn write_pic(root: &Path, name: &str, bytes: &[u8]) -> String {
        let p = root.join("figure").join(name);
        std::fs::write(&p, bytes).unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn stage_writes_manifest_and_promote_keeps_file() {
        let root = tmp_root("promote");
        let r = root_str(&root);
        let pic = write_pic(&root, "x.png", b"AAA");
        let entry = stage_image(r.clone(), pic.clone()).unwrap();
        assert!(entry.owned && entry.sha256.len() == 64);
        assert!(manifest_path(&root).unwrap().is_file());
        assert_eq!(list_staged_images(r.clone()).unwrap().len(), 1);

        let rep = promote_staged_images(r.clone(), vec![pic.clone()]).unwrap();
        assert_eq!(rep.promoted.len(), 1, "命中者转正");
        assert!(list_staged_images(r.clone()).unwrap().is_empty());
        assert!(Path::new(&pic).is_file(), "转正只移出清单，不删文件");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn promote_only_hits_given_paths() {
        let root = tmp_root("partial");
        let r = root_str(&root);
        let a = write_pic(&root, "a.png", b"a");
        let b = write_pic(&root, "b.png", b"b");
        stage_image(r.clone(), a.clone()).unwrap();
        stage_image(r.clone(), b.clone()).unwrap();
        let rep = promote_staged_images(r.clone(), vec!["figure/diagram.png".into()]).unwrap();
        assert!(rep.promoted.is_empty(), "导出成品路径不命中任何暂存源图");
        assert_eq!(list_staged_images(r).unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stage_rejects_outside_root_and_bad_ext() {
        let root = tmp_root("guards");
        let r = root_str(&root);
        let outside = std::env::temp_dir().join(format!("zetla_outside_{}.png", std::process::id()));
        std::fs::write(&outside, b"x").unwrap();
        assert!(stage_image(r.clone(), outside.to_string_lossy().into_owned()).is_err());
        let svg = write_pic(&root, "x.svg", b"x");
        assert!(stage_image(r, svg).is_err());
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn discard_deletes_untouched_and_keeps_modified() {
        let root = tmp_root("discard");
        let r = root_str(&root);
        let a = write_pic(&root, "a.png", b"a");
        let b = write_pic(&root, "b.png", b"b");
        stage_image(r.clone(), a.clone()).unwrap();
        stage_image(r.clone(), b.clone()).unwrap();
        std::fs::write(&b, b"user changed").unwrap(); // 用户改过内容

        let rep = discard_staged_images(r.clone(), None).unwrap();
        assert_eq!(rep.deleted.len(), 1, "未改动的静默删除：{:?}", rep.deleted);
        assert_eq!(rep.kept.len(), 1, "hash 变化的不删：{:?}", rep.kept);
        assert!(!Path::new(&a).is_file());
        assert!(Path::new(&b).is_file());
        assert!(list_staged_images(r).unwrap().is_empty(), "两条都移出 manifest");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sweep_keeps_referenced_and_deletes_orphan() {
        let root = tmp_root("sweep");
        let r = root_str(&root);
        let used = write_pic(&root, "used.png", b"u");
        let orphan = write_pic(&root, "orphan.png", b"o");
        stage_image(r.clone(), used.clone()).unwrap();
        stage_image(r.clone(), orphan.clone()).unwrap();
        std::fs::write(
            root.join("main.tex"),
            r"\includegraphics[width=3cm]{figure/used.png}",
        )
        .unwrap();

        let rep = sweep_staged_images(r.clone()).unwrap();
        assert!(Path::new(&used).is_file(), ".tex 引用过的保留（防崩溃误删）");
        assert!(!Path::new(&orphan).is_file(), "孤儿暂存图被清理");
        assert!(rep.kept.iter().any(|p| same_path(p, &used)));
        assert!(rep.deleted.iter().any(|p| same_path(p, &orphan)));
        assert!(list_staged_images(r).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn restaging_same_path_refreshes_hash() {
        let root = tmp_root("restage");
        let r = root_str(&root);
        let pic = write_pic(&root, "x.png", b"first");
        let first = stage_image(r.clone(), pic.clone()).unwrap();
        std::fs::write(&pic, b"second").unwrap();
        let second = stage_image(r.clone(), pic.clone()).unwrap();
        assert_ne!(first.sha256, second.sha256);
        assert_eq!(list_staged_images(r.clone()).unwrap().len(), 1, "同路径不重复登记");
        assert_eq!(discard_staged_images(r, None).unwrap().deleted.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
