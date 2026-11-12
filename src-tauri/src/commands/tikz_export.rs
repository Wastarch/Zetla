// M2 · 绘图模块 F1-6（原 F2-1 内核前移）：XeLaTeX 只编译 TikZ 片段 → PDF → SVG。
//
// 与 compile_project 的区别：
//  - 不编译主文档、不写主文档、不产生 synctex / 辅助文件到项目目录；
//  - 每次在系统临时目录建一个独立工作区，编译完成（成功或失败）即整目录删除；
//  - 强制 -no-shell-escape，并在源码层拒绝 \write18 / \input / \openout 等任意文件读写；
//  - 返回 SVG **文本**而非磁盘路径：前端用 <img src="data:..."> 显示，绕开 asset scope
//    与浏览器缓存，也不需要为临时产物设计生命周期。
//
// 导言区是包了一层的，所以 log 里的行号要减去 preamble_lines 才对应绘图 Tab 的源码行。
// F2 导出落盘 / PNG 输出复用本文件的编译内核，不另起一套。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::process::Command;
use tokio::time::timeout;

use crate::commands::compile::{engine_search_dirs, find_engine, TexError};
use crate::commands::logparse::parse_log_text;

const COMPILE_TIMEOUT_SECS: u64 = 30;
const CONVERT_TIMEOUT_SECS: u64 = 15;
/// 单张 SVG 上限，避免异常 PDF 转出几十 MB 把 WebView 卡死
const MAX_SVG_BYTES: usize = 8 * 1024 * 1024;
static WORK_SEQ: AtomicU64 = AtomicU64::new(0);

/// 片段里禁止出现的构造（小写化后匹配）。
/// -no-shell-escape 只挡 \write18 执行，挡不住 \input / \openout 读写任意文件；
/// \documentclass / \begin{document} 会破坏 standalone 包装，也一并拒绝。
const FORBIDDEN: [&str; 12] = [
    "\\write18",
    "\\immediate",
    "\\openout",
    "\\openin",
    "\\directlua",
    "\\catcode",
    "\\csname",
    "\\input",
    "\\include{",
    "\\documentclass",
    "\\begin{document}",
    "\\end{document}",
];

/// F3-7：按画布尺寸导出时的固定画布（world pt）。仅作用于派生的 standalone 片段，
/// 绝不写回 CM6 源码；未传 / 开关关闭时所有行为与 F1-6 完全一致。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikzCanvasSize {
    pub width_pt: f64,
    pub height_pt: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TikzPreviewResult {
    /// "ok" | "error"
    pub status: String,
    /// 成功时的 SVG 文本（前端转成 data URL 塞进 <img>，不内联注入 DOM）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub svg: Option<String>,
    pub elapsed_ms: u64,
    /// standalone 导言区行数；log 行号减去它 = 绘图 Tab 源码行号
    pub preamble_lines: u32,
    pub errors: Vec<TexError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 编译内核产物：存活的临时工作区 + 编译出的 PDF 路径。
/// 调用方负责在产品取出后删除 `work`（无论成功失败）。
pub struct CompiledSnippet {
    pub work: PathBuf,
    pub pdf: PathBuf,
    pub preamble_lines: u32,
}

/// 编译失败的结构化信息（供 tikz_preview / tikz_export 各自转成返回体）。
pub struct CompileFailure {
    pub message: String,
    pub preamble_lines: u32,
    pub errors: Vec<TexError>,
}

/// 抽出 F1-6 的「片段 → standalone PDF」内核，tikz_preview 与 tikz_export 共用。
/// 成功返回存活的工作区（调用方清理）；失败返回 CompileFailure（内部已清工作区）。
pub async fn compile_snippet_to_pdf(
    app: &AppHandle,
    source: &str,
    engine: &str,
    canvas: Option<TikzCanvasSize>,
) -> Result<CompiledSnippet, CompileFailure> {
    if let Err(e) = validate_source(source) {
        return Err(CompileFailure {
            message: e,
            preamble_lines: 0,
            errors: Vec::new(),
        });
    }
    let dirs = engine_search_dirs(Some(app));
    let (engine_name, exe) = match pick_engine(engine, &dirs) {
        Some(v) => v,
        None => {
            return Err(CompileFailure {
                message: "未找到 XeLaTeX / LuaLaTeX / pdfLaTeX，请先在「环境引导」配置 TeX 发行版"
                    .to_string(),
                preamble_lines: 0,
                errors: Vec::new(),
            })
        }
    };
    let work = temp_workdir();
    if let Err(e) = std::fs::create_dir_all(&work) {
        return Err(CompileFailure {
            message: format!("创建临时编译目录失败：{e}"),
            preamble_lines: 0,
            errors: Vec::new(),
        });
    }
    let (doc, preamble_lines) = build_document_with_canvas(source, engine_name != "pdflatex", canvas);
    if let Err(e) = std::fs::write(work.join("snippet.tex"), &doc) {
        let _ = std::fs::remove_dir_all(&work);
        return Err(CompileFailure {
            message: format!("写入临时 .tex 失败：{e}"),
            preamble_lines,
            errors: Vec::new(),
        });
    }

    // 编译：-no-shell-escape 是硬约束；nonstopmode 保证不会等交互输入。
    let args = vec![
        "-no-shell-escape".to_string(),
        "-interaction=nonstopmode".to_string(),
        "-file-line-error".to_string(),
        "-halt-on-error".to_string(),
        format!("-output-directory={}", work.display()),
        "snippet.tex".to_string(),
    ];
    let out = match run_tool(&exe, &args, &work, &dirs, COMPILE_TIMEOUT_SECS).await {
        Ok(o) => o,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            return Err(CompileFailure {
                message: e,
                preamble_lines,
                errors: Vec::new(),
            });
        }
    };
    let pdf = work.join("snippet.pdf");
    if !out.status.success() || !pdf.is_file() {
        let log = std::fs::read_to_string(work.join("snippet.log"))
            .unwrap_or_else(|_| String::from_utf8_lossy(&out.stdout).into_owned());
        let errors = parse_errors(&log, &work, preamble_lines);
        // -file-line-error 把真实错误写成 `./snippet.tex:22: Package pgf Error: ...`，
        // 没有 `!` 前缀；brief_failure 只认 `!`，会误把 XeTeX 启动横幅当错误贴出来。
        // 结构化解析已经拿到了这条错误，优先用它，兜底才读原始日志/stdout。
        let brief = errors
            .first()
            .map(|e| e.raw.clone())
            .unwrap_or_else(|| brief_failure(&log, &out));
        let _ = std::fs::remove_dir_all(&work);
        return Err(CompileFailure {
            message: format!("{} 编译失败：{}", engine_name, brief),
            preamble_lines,
            errors,
        });
    }
    Ok(CompiledSnippet {
        work,
        pdf,
        preamble_lines,
    })
}

/// PDF → SVG（矢量；来自真 TeX 引擎）。产品落在 work 内，调用方取出后负责删除 work。
async fn convert_pdf_to_svg(pdf: &Path, work: &Path, dirs: &[PathBuf]) -> Result<PathBuf, String> {
    let converter = match find_engine("pdftocairo", dirs) {
        Some(p) => p,
        None => {
            return Err(
                "未找到 pdftocairo（Poppler / TeX Live 自带），无法把 PDF 转成矢量预览".to_string(),
            )
        }
    };
    let product = work.join("preview.svg");
    let args = vec![
        "-svg".to_string(),
        "-f".to_string(),
        "1".to_string(),
        "-l".to_string(),
        "1".to_string(),
        pdf.to_string_lossy().to_string(),
        product.to_string_lossy().to_string(),
    ];
    let out = match run_tool(&converter, &args, work, dirs, CONVERT_TIMEOUT_SECS).await {
        Ok(o) => o,
        Err(e) => return Err(e),
    };
    if product.is_file() {
        Ok(product)
    } else if let Some(p) = find_svg(work) {
        Ok(p)
    } else {
        let brief = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(format!(
            "pdftocairo 未生成 SVG{}",
            if brief.is_empty() {
                String::new()
            } else {
                format!("：{}", brief.chars().take(160).collect::<String>())
            }
        ))
    }
}

/// PDF → PNG（pdftocairo -r 300）。产品落在 work 内，调用方取出后负责删除 work。
async fn convert_pdf_to_png(pdf: &Path, work: &Path, dirs: &[PathBuf]) -> Result<PathBuf, String> {
    let converter = match find_engine("pdftocairo", dirs) {
        Some(p) => p,
        None => {
            return Err(
                "未找到 pdftocairo（Poppler / TeX Live 自带），无法把 PDF 转成 PNG".to_string(),
            )
        }
    };
    let product = work.join("preview.png");
    let args = vec![
        "-png".to_string(),
        "-r".to_string(),
        "300".to_string(),
        "-f".to_string(),
        "1".to_string(),
        "-l".to_string(),
        "1".to_string(),
        pdf.to_string_lossy().to_string(),
        product.to_string_lossy().to_string(),
    ];
    let out = match run_tool(&converter, &args, work, dirs, CONVERT_TIMEOUT_SECS).await {
        Ok(o) => o,
        Err(e) => return Err(e),
    };
    if product.is_file() {
        Ok(product)
    } else {
        let brief = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(format!(
            "pdftocairo 未生成 PNG{}",
            if brief.is_empty() {
                String::new()
            } else {
                format!("：{}", brief.chars().take(160).collect::<String>())
            }
        ))
    }
}

/// tikz_preview 的 error 返回体构造。
fn preview_failure(
    message: impl Into<String>,
    started: Instant,
    preamble_lines: u32,
    errors: Vec<TexError>,
) -> TikzPreviewResult {
    TikzPreviewResult {
        status: "error".to_string(),
        svg: None,
        elapsed_ms: started.elapsed().as_millis() as u64,
        preamble_lines,
        errors,
        message: Some(message.into()),
    }
}

fn validate_source(source: &str) -> Result<(), String> {
    if source.trim().is_empty() {
        return Err("TikZ 源码为空".to_string());
    }
    // 只匹配环境名前缀：\begin{tikzpicture}[scale=2] 这类带可选参数的写法同样合法。
    if !source.contains("\\begin{tikzpicture") {
        return Err("源码缺少 \\begin{tikzpicture}，精确预览只编译 TikZ 片段".to_string());
    }
    let lower = source.to_ascii_lowercase();
    for pat in FORBIDDEN {
        if lower.contains(pat) {
            return Err(format!(
                "出于安全考虑拒绝编译含 {} 的片段；精确预览在隔离临时目录中只画 TikZ 片段",
                pat
            ));
        }
    }
    Ok(())
}

/// 收集源码里所有 \usetikzlibrary{...} 的库名，去重后合并进导言区。
/// 源码原文一字不改（保留行号对应关系），重复加载库对 TikZ 无害。
fn collect_libraries(source: &str) -> Vec<String> {
    const MARK: &str = "\\usetikzlibrary{";
    let mut out: Vec<String> = Vec::new();
    let mut rest = source;
    while let Some(i) = rest.find(MARK) {
        let after = &rest[i + MARK.len()..];
        let Some(end) = after.find('}') else { break };
        for lib in after[..end].split(',') {
            let l = lib.trim().to_string();
            if !l.is_empty() && !out.contains(&l) {
                out.push(l);
            }
        }
        rest = &after[end + 1..];
    }
    out
}

/// 收集源码里所有 \usepackage{...} / \RequirePackage{...} 的包名，去重后合并进导言区。
/// 支持可选 [..] 参数（如 \usepackage[dvipsnames]{xcolor}）；其正文行由
/// strip_preamble_decl_lines 注释掉，以免留在 \begin{document} 之后触发
/// "Can be used only in preamble"。
fn collect_usepackage(source: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for cmd in ["\\usepackage", "\\RequirePackage"] {
        let mut rest = source;
        while let Some(i) = rest.find(cmd) {
            let after = &rest[i + cmd.len()..];
            // 跳过可选 [..] 参数
            let after = if let Some(b) = after.find('[') {
                match after[b..].find(']') {
                    Some(c) => &after[b + c + 1..],
                    None => break,
                }
            } else {
                after
            };
            // 提取 {..} 内的包名
            let after = match after.find('{') {
                Some(b) => &after[b + 1..],
                None => break,
            };
            let Some(end) = after.find('}') else { break };
            let arg = after[..end].trim().to_string();
            if !arg.is_empty() && !out.contains(&arg) {
                out.push(arg);
            }
            rest = &after[end + 1..];
        }
    }
    out
}

/// 源码里的 \usetikzlibrary{...} / \usepackage{...} / \RequirePackage{...} 等「只能在导言区出现的命令」
/// 已由 collect_libraries / collect_usepackage 合并进导言区；若原样留在 \begin{document} 之后，
/// LaTeX 会报 "Can be used only in preamble"。这里把「独占整行」的声明改成注释，行数不变 ——
/// 保证 log 行号减 preamble_lines 后仍精确对应绘图 Tab 的源码行。
/// 允许行尾 % 注释（旧版因要求行尾必须是 `}` 而漏掉这类行，导致声明残留在正文报错）。
fn is_pure_preamble_decl(line: &str) -> bool {
    // 去掉尾随 % 注释后再判断
    let core = match line.trim().find('%') {
        Some(i) => line.trim()[..i].trim(),
        None => line.trim(),
    };
    if core.is_empty() {
        return false;
    }
    // \usetikzlibrary{...} / \usepackage{...} / \RequirePackage{...}
    for mark in ["\\usetikzlibrary{", "\\usepackage{", "\\RequirePackage{"] {
        if let Some(pos) = core.find(mark) {
            if pos == 0 && core.ends_with('}') {
                return true;
            }
        }
    }
    // \usepackage[opt]{...} / \RequirePackage[opt]{...}
    for mark in ["\\usepackage[", "\\RequirePackage["] {
        if let Some(pos) = core.find(mark) {
            if pos == 0 && core.contains(']') && core.ends_with('}') {
                return true;
            }
        }
    }
    false
}

fn strip_preamble_decl_lines(source: &str) -> String {
    source
        .lines()
        .map(|line| {
            if is_pure_preamble_decl(line) {
                format!("% {}", line.trim())
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// F3-7：只在**派生的源码副本**里注入固定画布 bounding box，行数不变（不换行），
/// 保证 log 行号减 preamble_lines 仍精确映射绘图 Tab 源码。找不到 tikzpicture 时原样返回。
fn apply_canvas_bounding_box(source: &str, canvas: TikzCanvasSize) -> String {
    const NEEDLE: &str = "\\begin{tikzpicture}";
    let Some(pos) = source.find(NEEDLE) else {
        return source.to_string();
    };
    let mut at = pos + NEEDLE.len();
    // \begin{tikzpicture}[options] 时把插入点放到选项之后，避免破坏环境开头语法。
    if source[at..].starts_with('[') {
        if let Some(close) = source[at..].find(']') {
            at += close + 1;
        }
    }
    let w = if canvas.width_pt.is_finite() && canvas.width_pt > 0.0 { canvas.width_pt } else { 1.0 };
    let h = if canvas.height_pt.is_finite() && canvas.height_pt > 0.0 { canvas.height_pt } else { 1.0 };
    let insert = format!("\\use as bounding box (0,0) rectangle ({w:.4}pt,{h:.4}pt);");
    let mut out = String::with_capacity(source.len() + insert.len());
    out.push_str(&source[..at]);
    out.push_str(&insert);
    out.push_str(&source[at..]);
    out
}

/// 生成最小 standalone 文档；返回 (文档文本, 导言区行数)。
/// 只有 Unicode 引擎且源码含非 ASCII 时才加载 ctex，避免纯英文图因缺 ctex 编译失败。
fn build_document(source: &str, unicode_engine: bool) -> (String, u32) {
    build_document_with_canvas(source, unicode_engine, None)
}

/// F3-7：带固定画布的派生文档。canvas=None 时逐字节等价于 F1-6 的原包装。
fn build_document_with_canvas(
    source: &str,
    unicode_engine: bool,
    canvas: Option<TikzCanvasSize>,
) -> (String, u32) {
    let mut doc = String::new();
    doc.push_str("\\documentclass[tikz,border=4pt]{standalone}\n");
    doc.push_str("\\usepackage{tikz}\n");
    doc.push_str("\\usepackage{amsmath,amssymb}\n");
    if unicode_engine && source.chars().any(|c| !c.is_ascii()) {
        doc.push_str("\\usepackage[UTF8]{ctex}\n");
    }
    let libs = collect_libraries(source);
    if !libs.is_empty() {
        doc.push_str(&format!("\\usetikzlibrary{{{}}}\n", libs.join(",")));
    }
    let pkgs = collect_usepackage(source);
    for p in &pkgs {
        doc.push_str(&format!("\\usepackage{{{}}}\n", p));
    }
    doc.push_str("\\begin{document}\n");
    let preamble_lines = doc.lines().count() as u32;
    let body = strip_preamble_decl_lines(source.trim_end());
    match canvas {
        Some(size) => doc.push_str(&apply_canvas_bounding_box(&body, size)),
        None => doc.push_str(&body),
    }
    doc.push_str("\n\\end{document}\n");
    (doc, preamble_lines)
}

fn pick_engine(requested: &str, dirs: &[PathBuf]) -> Option<(String, PathBuf)> {
    let mut order: Vec<&str> = Vec::new();
    if matches!(requested, "xelatex" | "lualatex" | "pdflatex") {
        order.push(requested);
    }
    for e in ["xelatex", "lualatex", "pdflatex"] {
        if !order.contains(&e) {
            order.push(e);
        }
    }
    for e in order {
        if let Some(p) = find_engine(e, dirs) {
            return Some((e.to_string(), p));
        }
    }
    None
}

fn temp_workdir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seq = WORK_SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "zetla-tikz-{}-{}-{}",
        std::process::id(),
        nanos,
        seq
    ))
}

/// 统一子进程：隐藏黑框、注入受管 TeX PATH、放宽日志折行、超时 kill_on_drop。
async fn run_tool(
    exe: &Path,
    args: &[String],
    cwd: &Path,
    dirs: &[PathBuf],
    secs: u64,
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：不弹控制台黑框
        cmd.as_std_mut().creation_flags(0x0800_0000);
    }
    cmd.env("max_print_line", "10000")
        .env("error_line", "254")
        .env("half_error_line", "238");
    if !dirs.is_empty() {
        let mut joined = dirs.to_vec();
        joined.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        if let Ok(paths) = std::env::join_paths(&joined) {
            cmd.env("PATH", paths);
        }
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 {}：{}", exe.display(), e))?;
    let out = timeout(Duration::from_secs(secs), child.wait_with_output())
        .await
        .map_err(|_| format!("{} 执行超过 {}s，已终止", exe.display(), secs))?
        .map_err(|e| format!("{} 执行失败：{}", exe.display(), e))?;
    Ok(out)
}

/// logparse 的结构化错误 → 减去导言区偏移，映射回绘图 Tab 源码行。
fn parse_errors(log: &str, work: &Path, preamble_lines: u32) -> Vec<TexError> {
    let default_file = work.join("snippet.tex");
    let mut out = parse_log_text(log, work, &default_file);
    for e in &mut out {
        e.line = e.line.saturating_sub(preamble_lines).max(1);
        e.file = "绘图源码".to_string();
    }
    out.into_iter()
        .filter(|e| e.severity == "error")
        .take(12)
        .collect()
}

fn brief_failure(log: &str, out: &std::process::Output) -> String {
    for line in log.lines() {
        let t = line.trim();
        if t.starts_with('!') && t.len() > 2 {
            return t.to_string();
        }
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let text = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if text.is_empty() {
        "未生成 PDF，且日志为空".to_string()
    } else {
        text.chars().take(240).collect()
    }
}

/// 单页时 pdftocairo 输出 <name>.svg，多页时可能输出 <name>-1.svg，兜底扫目录。
fn find_svg(work: &Path) -> Option<PathBuf> {
    std::fs::read_dir(work).ok().and_then(|it| {
        for entry in it.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) == Some("svg") {
                return Some(p);
            }
        }
        None
    })
}

/// XeLaTeX 精确预览：把 tikzpicture 片段单独编译成矢量 SVG。
/// 所有可预期的失败都以 status:"error" 返回（前端统一渲染错误态），只有临时目录 IO
/// 异常才走 Err(String)。复用 compile_snippet_to_pdf 内核。
#[tauri::command]
pub async fn tikz_preview(
    app: AppHandle,
    source: String,
    engine: String,
    canvas: Option<TikzCanvasSize>,
) -> Result<TikzPreviewResult, String> {
    let started = Instant::now();
    let compiled = match compile_snippet_to_pdf(&app, &source, &engine, canvas).await {
        Ok(c) => c,
        Err(f) => {
            return Ok(preview_failure(
                f.message,
                started,
                f.preamble_lines,
                f.errors,
            ))
        }
    };
    let dirs = engine_search_dirs(Some(&app));
    let svg_path = match convert_pdf_to_svg(&compiled.pdf, &compiled.work, &dirs).await {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&compiled.work);
            return Ok(preview_failure(e, started, compiled.preamble_lines, Vec::new()));
        }
    };
    let svg = match std::fs::read_to_string(&svg_path) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&compiled.work);
            return Ok(preview_failure(
                format!("读取 SVG 产物失败：{e}"),
                started,
                compiled.preamble_lines,
                Vec::new(),
            ));
        }
    };
    let _ = std::fs::remove_dir_all(&compiled.work);
    if svg.len() > MAX_SVG_BYTES {
        return Ok(preview_failure(
            "SVG 产物过大（>8MB），已丢弃以免拖慢界面；请精简图形后重试",
            started,
            compiled.preamble_lines,
            Vec::new(),
        ));
    }
    Ok(TikzPreviewResult {
        status: "ok".to_string(),
        svg: Some(svg),
        elapsed_ms: started.elapsed().as_millis() as u64,
        preamble_lines: compiled.preamble_lines,
        errors: Vec::new(),
        message: None,
    })
}

// ── F5-1：导出产物落盘（复用上面的编译内核）──────────────────────────────

// 注：tikz_export 现以扁平参数接收（见下方命令签名，rename_all = "camelCase"
// 让 out_path ↔ outPath），此包装结构已弃用，避免与前端扁平调用约定不一致。

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TikzExportResult {
    /// "ok" | "exists" | "error"
    pub status: String,
    pub out_path: Option<String>,
    pub elapsed_ms: u64,
    pub preamble_lines: u32,
    pub errors: Vec<TexError>,
    pub message: Option<String>,
}

fn export_failure(
    message: impl Into<String>,
    started: Instant,
    preamble_lines: u32,
    errors: Vec<TexError>,
) -> TikzExportResult {
    TikzExportResult {
        status: "error".to_string(),
        out_path: None,
        elapsed_ms: started.elapsed().as_millis() as u64,
        preamble_lines,
        errors,
        message: Some(message.into()),
    }
}

/// F5-1：把 tikzpicture 片段编译后转成 PNG / SVG / PDF 并落盘到 out_path。
/// 复用 compile_snippet_to_pdf 内核与全部安全校验；成功 / 失败都不写主文档、不污染源码。
/// 返回 "exists" 时由前端确认是否覆盖后再以 force:true 重试。
#[tauri::command(rename_all = "camelCase")]
pub async fn tikz_export(
    app: AppHandle,
    source: String,
    engine: String,
    canvas: Option<TikzCanvasSize>,
    format: String,
    out_path: String,
    force: bool,
) -> Result<TikzExportResult, String> {
    let started = Instant::now();
    let format = format.to_ascii_lowercase();
    if !matches!(format.as_str(), "png" | "svg" | "pdf") {
        return Ok(export_failure(
            format!("不支持的导出格式：{format}"),
            started,
            0,
            Vec::new(),
        ));
    }
    let out = PathBuf::from(&out_path);
    if out.exists() && !force {
        return Ok(TikzExportResult {
            status: "exists".to_string(),
            out_path: Some(out_path.clone()),
            elapsed_ms: started.elapsed().as_millis() as u64,
            preamble_lines: 0,
            errors: Vec::new(),
            message: Some("目标文件已存在，是否覆盖？".to_string()),
        });
    }
    let compiled = match compile_snippet_to_pdf(&app, &source, &engine, canvas).await
    {
        Ok(c) => c,
        Err(f) => return Ok(export_failure(f.message, started, f.preamble_lines, f.errors)),
    };
    let dirs = engine_search_dirs(Some(&app));
    let product = match format.as_str() {
        "pdf" => compiled.pdf.clone(),
        "svg" => match convert_pdf_to_svg(&compiled.pdf, &compiled.work, &dirs).await {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&compiled.work);
                return Ok(export_failure(e, started, compiled.preamble_lines, Vec::new()));
            }
        },
        "png" => match convert_pdf_to_png(&compiled.pdf, &compiled.work, &dirs).await {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&compiled.work);
                return Ok(export_failure(e, started, compiled.preamble_lines, Vec::new()));
            }
        },
        _ => unreachable!(),
    };
    if let Some(parent) = out.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            let _ = std::fs::remove_dir_all(&compiled.work);
            return Ok(export_failure(
                format!("创建目标目录失败：{e}"),
                started,
                compiled.preamble_lines,
                Vec::new(),
            ));
        }
    }
    if let Err(e) = std::fs::copy(&product, &out) {
        let _ = std::fs::remove_dir_all(&compiled.work);
        return Ok(export_failure(
            format!("写入文件失败：{e}"),
            started,
            compiled.preamble_lines,
            Vec::new(),
        ));
    }
    // 写后校验：极少数情况下 copy 返回 Ok 但目标仍不存在（权限 / 防病毒拦截 / 路径重定向），
    // 不能再以「成功」误导前端。这里给出明确失败，而不是静默返回 ok。
    if !out.is_file() {
        let _ = std::fs::remove_dir_all(&compiled.work);
        return Ok(export_failure(
            format!("写入后未找到输出文件：{out_path}", out_path = out_path),
            started,
            compiled.preamble_lines,
            Vec::new(),
        ));
    }
    let _ = std::fs::remove_dir_all(&compiled.work);
    Ok(TikzExportResult {
        status: "ok".to_string(),
        out_path: Some(out_path.clone()),
        elapsed_ms: started.elapsed().as_millis() as u64,
        preamble_lines: compiled.preamble_lines,
        errors: Vec::new(),
        message: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}";

    #[test]
    fn canvas_none_is_byte_identical_to_legacy() {
        assert_eq!(
            build_document(SRC, false),
            build_document_with_canvas(SRC, false, None)
        );
    }

    #[test]
    fn canvas_bounding_box_in_derived_copy_only() {
        let size = TikzCanvasSize { width_pt: 426.79, height_pt: 702.78 };
        let (doc, lines) = build_document_with_canvas(SRC, false, Some(size));
        assert!(doc.contains("\\use as bounding box (0,0) rectangle (426.7900pt,702.7800pt);"));
        assert_eq!(doc.lines().count(), build_document(SRC, false).0.lines().count());
        assert_eq!(lines, build_document(SRC, false).1);
        assert!(doc.contains("\\draw (0,0) -- (1,1);"));
    }

    #[test]
    fn canvas_bounding_box_after_environment_options() {
        let src = "\\begin{tikzpicture}[>=Stealth]\n  \\draw (0,0)--(1,1);\n\\end{tikzpicture}";
        let size = TikzCanvasSize { width_pt: 100.0, height_pt: 100.0 };
        let (doc, _) = build_document_with_canvas(src, false, Some(size));
        assert!(doc.contains("\\begin{tikzpicture}[>=Stealth]\\use as bounding box"));
    }

    #[test]
    fn accepts_plain_tikzpicture() {
        assert!(validate_source(SRC).is_ok());
    }

    #[test]
    fn accepts_tikzpicture_with_options() {
        let src = "\\begin{tikzpicture}[>=Stealth, font=\\small]\n  \\draw (0,0)--(1,1);\n\\end{tikzpicture}";
        assert!(validate_source(src).is_ok());
        let (doc, n) = build_document(src, true);
        assert_eq!(doc.lines().nth(n as usize), Some("\\begin{tikzpicture}[>=Stealth, font=\\small]"));
    }

    #[test]
    fn rejects_empty_and_full_document() {
        assert!(validate_source("  ").is_err());
        assert!(validate_source("\\draw (0,0)--(1,1);").is_err());
        assert!(validate_source("\\documentclass{article}\n\\begin{document}x\\end{document}").is_err());
    }

    #[test]
    fn rejects_unsafe_tex_constructs() {
        for pat in ["\\write18{whoami}", "\\input{/etc/passwd}", "\\openout", "\\directlua{os.execute()}"] {
            let src = format!("{}\n{}", SRC, pat);
            assert!(validate_source(&src).is_err(), "应拒绝 {pat}");
        }
    }

    #[test]
    fn libraries_are_merged_and_deduped() {
        let src = "\\usetikzlibrary{arrows.meta,calc}\n\\usetikzlibrary{angles, calc}\n\\begin{tikzpicture}\\end{tikzpicture}";
        assert_eq!(
            collect_libraries(src),
            vec!["arrows.meta", "calc", "angles"]
        );
    }

    #[test]
    fn preamble_lines_map_back_to_source() {
        let (doc, n) = build_document(SRC, false);
        let lines: Vec<&str> = doc.lines().collect();
        assert_eq!(lines[n as usize], "\\begin{tikzpicture}");
        assert_eq!(lines[(n + 1) as usize], "  \\draw (0,0) -- (1,1);");
        assert_eq!(lines.last().copied(), Some("\\end{document}"));
    }

    #[test]
    fn library_lines_are_commented_without_shifting_source_lines() {
        let src = "\\usetikzlibrary{angles,quotes}\n\\begin{tikzpicture}\n  \\draw (0,0)--(1,1);\n\\end{tikzpicture}";
        let (doc, n) = build_document(src, true);
        let lines: Vec<&str> = doc.lines().collect();
        assert!(doc.contains("\\usetikzlibrary{angles,quotes}\n"));
        assert_eq!(lines[n as usize], "% \\usetikzlibrary{angles,quotes}");
        assert_eq!(lines[(n + 1) as usize], "\\begin{tikzpicture}");
        assert_eq!(lines[(n + 2) as usize], "  \\draw (0,0)--(1,1);");
    }

    #[test]
    fn preamble_only_decls_hoisted_without_line_shift() {
        // \usetikzlibrary 带尾注释 + \usepackage 都应被抽到导言区；正文整行注释、行数不变，
        // 否则会触发 "Can be used only in preamble"。这正是导出报错的根因之一。
        let src = "\\usetikzlibrary{arrows.meta}  % arrows\n\\usepackage{tikz-3dplot}\n\\begin{tikzpicture}\n  \\draw (0,0)--(1,1);\n\\end{tikzpicture}";
        let (doc, n) = build_document(src, false);
        assert!(doc.contains("\\usetikzlibrary{arrows.meta}\n"));
        assert!(doc.contains("\\usepackage{tikz-3dplot}\n"));
        let lines: Vec<&str> = doc.lines().collect();
        // 正文里两行声明被注释，且 \begin{tikzpicture} 仍精确落在 n 行之后
        assert_eq!(lines[n as usize], "% \\usetikzlibrary{arrows.meta}  % arrows");
        assert_eq!(lines[(n + 1) as usize], "% \\usepackage{tikz-3dplot}");
        assert_eq!(lines[(n + 2) as usize], "\\begin{tikzpicture}");
    }

    #[test]
    fn file_line_error_is_structured_for_brief_message() {
        // -file-line-error 的错误行没有 `!` 前缀，旧 brief_failure 会漏掉它。
        let log = "This is XeTeX, Version 3.141592653\n\
                   ./snippet.tex:22: Package pgf Error: Unknown arrow tip kind 'Latex'.\n";
        let errors = parse_errors(log, Path::new("."), 4);
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].raw,
            "Package pgf Error: Unknown arrow tip kind 'Latex'."
        );
        assert_eq!(errors[0].line, 18);
    }

    #[test]
    fn ctex_only_for_unicode_engine_and_non_ascii_source() {
        let cn = format!("{SRC}\n% 中文注释");
        assert!(build_document(&cn, true).0.contains("ctex"));
        assert!(!build_document(&cn, false).0.contains("ctex"));
        assert!(!build_document(SRC, true).0.contains("ctex"));
    }

    #[test]
    fn workdirs_are_unique() {
        assert_ne!(temp_workdir(), temp_workdir());
    }
}
