// 文件持久层（开发文档 §3.4-B）
// 职责：编码检测与转换、换行符保持、原子写、外部变更重读
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_8};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
}
