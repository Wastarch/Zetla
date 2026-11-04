// 编译流程编排 —— 占位符展开（Tool/Recipe 通用化的关键）
// 参考 LaTeX Workshop 的 replaceArgumentPlaceholders：
//   %DOC% / %DOCFILE% / %DIR% / %OUTDIR% / %AUXDIR% / %DOC_EXT% / %DOCFILE_EXT%
//   / %WORKSPACE_FOLDER%，外加 _W32 变体（Windows 路径用 \ 分隔）。
// 约定：%X% 始终用 / 分隔（TeX 引擎普遍认 /）；%X_W32% 在 Windows 用 \（非 Windows 退化为 /）。
use std::path::Path;

/// 占位符替换上下文（主文件与项目根等绝对路径）
pub struct Ctx<'a> {
    /// 主文件（带扩展名），如 /proj/main.tex
    pub doc: &'a Path,
    /// 主文件所在目录，如 /proj
    pub dir: &'a Path,
    /// 输出目录（默认 = dir；未来支持 outputDir）
    pub out: &'a Path,
    /// 辅助文件目录（默认 = out）
    pub aux: &'a Path,
    /// 项目根（workspace root）
    pub ws: &'a Path,
}

/// 始终用 / 分隔（TeX 引擎在 Windows 也认 /；与 LaTeX Workshop 的 %DOC% 一致）
fn fwd(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// Windows 下转成 \ 分隔；非 Windows 退化为 /（与 LaTeX Workshop 行为一致）
fn w32(p: &Path) -> String {
    if cfg!(windows) {
        p.to_string_lossy().replace('/', "\\")
    } else {
        p.to_string_lossy().into_owned()
    }
}

/// 主文件路径（不含扩展名），用于 %DOC% / %DOC_W32%（保留原分隔符，fwd/w32 负责归一化）
fn doc_no_ext(doc: &Path) -> std::path::PathBuf {
    doc.with_extension("")
}

/// 展开单个字符串模板里的所有占位符（%X% 用 /；%X_W32% 在 Windows 用 \）
pub fn expand_str(tmpl: &str, ctx: &Ctx) -> String {
    let no_ext = doc_no_ext(ctx.doc);
    let f = |p: &Path| fwd(p);
    let w = |p: &Path| w32(p);
    // 顺序无关：各 token 以 %..% 包裹，互不重叠（%DOC% 不会误伤 %DOC_EXT%）
    let replacements: &[(&str, String)] = &[
        ("%DOC_EXT%", f(ctx.doc)),
        ("%DOC_EXT_W32%", w(ctx.doc)),
        ("%DOCFILE_EXT%", fwd(ctx.doc.file_name().unwrap_or_default().as_ref())),
        ("%DOCFILE_EXT_W32%", w(ctx.doc.file_name().unwrap_or_default().as_ref())),
        ("%DOC%", f(&no_ext)),
        ("%DOC_W32%", w(&no_ext)),
        ("%DOCFILE%", fwd(ctx.doc.file_stem().unwrap_or_default().as_ref())),
        ("%DOCFILE_W32%", w(ctx.doc.file_stem().unwrap_or_default().as_ref())),
        ("%DIR%", f(ctx.dir)),
        ("%DIR_W32%", w(ctx.dir)),
        ("%OUTDIR%", f(ctx.out)),
        ("%OUTDIR_W32%", w(ctx.out)),
        ("%AUXDIR%", f(ctx.aux)),
        ("%AUXDIR_W32%", w(ctx.aux)),
        ("%WORKSPACE_FOLDER%", f(ctx.ws)),
        ("%WORKSPACE_FOLDER_W32%", w(ctx.ws)),
    ];
    let mut s = tmpl.to_string();
    for (token, val) in replacements {
        if s.contains(token) {
            s = s.replace(token, val);
        }
    }
    s
}

/// 展开参数列表（args / env 值 / cwd 各自调用 expand_str）
pub fn expand_args(tmpl: &[String], ctx: &Ctx) -> Vec<String> {
    tmpl.iter().map(|a| expand_str(a, ctx)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ctx() -> Ctx<'static> {
        let doc = Path::new("/proj/sub/main.tex");
        let dir = Path::new("/proj/sub");
        Ctx {
            doc,
            dir,
            out: dir,
            aux: dir,
            ws: Path::new("/proj"),
        }
    }

    #[test]
    fn expands_core_placeholders() {
        let ctx = make_ctx();
        assert_eq!(expand_str("%DOC%", &ctx), "/proj/sub/main");
        assert_eq!(expand_str("%DOCFILE%", &ctx), "main");
        assert_eq!(expand_str("%DIR%", &ctx), "/proj/sub");
        assert_eq!(expand_str("%DOC_EXT%", &ctx), "/proj/sub/main.tex");
        assert_eq!(expand_str("%DOCFILE_EXT%", &ctx), "main.tex");
        assert_eq!(expand_str("%OUTDIR%", &ctx), "/proj/sub");
        assert_eq!(expand_str("%WORKSPACE_FOLDER%", &ctx), "/proj");
    }

    #[test]
    fn expands_w32_variants_on_windows() {
        let ctx = make_ctx();
        let sep = if cfg!(windows) { "\\" } else { "/" };
        assert_eq!(expand_str("%DIR_W32%", &ctx), format!("{sep}proj{sep}sub"));
        // 文件名类无分隔符，_W32 与常规一致
        assert_eq!(expand_str("%DOCFILE_W32%", &ctx), "main");
    }

    #[test]
    fn expands_in_argument_list() {
        let ctx = make_ctx();
        let args = vec![
            "-output-directory=%OUTDIR%".to_string(),
            "%DOC%".to_string(),
        ];
        let out = expand_args(&args, &ctx);
        assert_eq!(out, vec!["-output-directory=/proj/sub", "/proj/sub/main"]);
    }

    #[test]
    fn leaves_unknown_tokens_untouched() {
        let ctx = make_ctx();
        assert_eq!(
            expand_str("plain text %FOO% end", &ctx),
            "plain text %FOO% end"
        );
    }
}
