// 图片导入（开发文档 §R5 · M1-7）—— 拖拽/粘贴/插入菜单的图片落盘
// import_image：接收图片字节，写盘到项目图片目录（来自 .ltex/config.json 的 imageDir，缺省 figure），
//   文件名冲突自动去重，返回绝对路径/相对根路径/最终文件名。
// import_image_from_path：菜单选图入口，源是磁盘路径，读字节后复用同一落盘逻辑。
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 导入结果（与 src/types/project.ts ImportImageResult 对齐；camelCase）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageResult {
    /// 落盘后的绝对路径（前端算相对 .tex 目录路径用）
    pub abs_path: String,
    /// 相对项目根（正斜杠），如 "figure/xxx.png"（仅用于回显/存储）
    pub rel_root_path: String,
    /// 去重后的最终文件名
    pub file_name: String,
}

fn to_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// 文件名去重：已存在则 base-1.ext / base-2.ext 递推（不静默覆盖既有文件）
fn dedupe_name(dir: &Path, name: &str) -> String {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return name.to_string();
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_string());
    let ext = Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut i = 1u32;
    loop {
        let next = format!("{}-{}{}", stem, i, ext);
        if !dir.join(&next).exists() {
            return next;
        }
        i += 1;
    }
}

/// 把图片字节落盘到 `root/image_dir/` 下（建目录 + 去重 + 写盘），返回结果
fn place_image(
    root: &str,
    image_dir: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<ImportImageResult, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("项目根不存在: {}", root));
    }
    // 路径穿越防护：仅允许相对项目根的子目录
    if image_dir.starts_with('/') || image_dir.starts_with('\\') || image_dir.contains("..") {
        return Err("图片目录不合法：必须为相对项目根的路径".into());
    }
    let dir_norm = image_dir
        .trim()
        .trim_matches(|c| c == '/' || c == '\\')
        .to_string();
    let dir_path: PathBuf = if dir_norm.is_empty() {
        root_path.to_path_buf()
    } else {
        root_path.join(&dir_norm)
    };
    // 防御：join 后仍需落在项目根内
    if !dir_path.starts_with(root_path) {
        return Err("图片目录越出项目根，已拒绝".into());
    }
    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("创建图片目录失败 {}: {}", dir_path.display(), e))?;

    let final_name = dedupe_name(&dir_path, file_name);
    let final_path = dir_path.join(&final_name);
    std::fs::write(&final_path, bytes)
        .map_err(|e| format!("写入图片失败 {}: {}", final_path.display(), e))?;

    let rel_root = if dir_norm.is_empty() {
        final_name.clone()
    } else {
        format!("{}/{}", dir_norm, final_name)
    };

    Ok(ImportImageResult {
        abs_path: to_str(&final_path),
        rel_root_path: rel_root,
        file_name: final_name,
    })
}

/// 拖拽/粘贴入口：直接拿到图片字节（前端 File.arrayBuffer → Uint8Array → Vec<u8>）
#[tauri::command]
pub fn import_image(
    root: String,
    image_dir: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<ImportImageResult, String> {
    place_image(&root, &image_dir, &file_name, &bytes)
}

/// 菜单选图入口：源是磁盘路径，读字节后复用同一落盘逻辑
#[tauri::command]
pub fn import_image_from_path(
    root: String,
    image_dir: String,
    src_path: String,
) -> Result<ImportImageResult, String> {
    let src = Path::new(&src_path);
    if !src.is_file() {
        return Err(format!("源文件不存在: {}", src_path));
    }
    let file_name = src
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "源文件名非法".to_string())?;
    let bytes = std::fs::read(src)
        .map_err(|e| format!("读取源文件失败 {}: {}", src_path, e))?;
    // 复用落盘逻辑（普通函数调用，无额外 RPC）
    import_image(root, image_dir, file_name, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zetla_image_test_{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn places_into_figure_subdir_and_returns_paths() {
        let root = tmp_root("basic");
        let r = place_image(root.to_str().unwrap(), "figure", "pic.png", b"data").unwrap();
        assert_eq!(r.file_name, "pic.png");
        // rel_root_path 是规范的「相对项目根、正斜杠」路径
        assert_eq!(r.rel_root_path, "figure/pic.png");
        // abs_path 平台相关（Windows 为反斜杠），只校验关键段存在
        assert!(r.abs_path.contains("figure") && r.abs_path.contains("pic.png"));
        assert!(root.join("figure/pic.png").is_file());
        assert_eq!(std::fs::read(root.join("figure/pic.png")).unwrap(), b"data");
    }

    #[test]
    fn deduplicates_on_conflict() {
        let root = tmp_root("dedup");
        let _ = place_image(root.to_str().unwrap(), "figure", "pic.png", b"a").unwrap();
        let r = place_image(root.to_str().unwrap(), "figure", "pic.png", b"b").unwrap();
        assert_eq!(r.file_name, "pic-1.png");
        assert!(root.join("figure/pic-1.png").is_file());
    }

    #[test]
    fn rejects_traversal_and_absolute_dir() {
        let root = tmp_root("guards");
        assert!(place_image(root.to_str().unwrap(), "../evil", "x.png", b"1").is_err());
        assert!(place_image(root.to_str().unwrap(), "/abs", "x.png", b"1").is_err());
        assert!(place_image(root.to_str().unwrap(), "a/../../b", "x.png", b"1").is_err());
    }

    #[test]
    fn empty_dir_places_at_root() {
        let root = tmp_root("empty");
        let r = place_image(root.to_str().unwrap(), "", "x.png", b"1").unwrap();
        assert_eq!(r.rel_root_path, "x.png");
        assert!(root.join("x.png").is_file());
    }
}
