// M0-11 · TeX 日志解析 —— .log → Vec<TexError>
// 编译统一带 -file-line-error：错误行形如 `./main.tex:12: Missing $ inserted.`；
// 少数错误（如找不到宏包）仍以 `! LaTeX Error: ...` 开头，回退到后续 `l.N` 行取行号。
use crate::commands::compile::TexError;
use std::collections::HashSet;
use std::path::Path;

/// 单次最多返回的条数（异常日志防刷屏）
const MAX_ERRORS: usize = 100;

/// 解析日志文件（Tauri command；独立便于单测，M0-12 也可复用）
#[tauri::command]
pub fn parse_tex_log(log_path: String) -> Result<Vec<TexError>, String> {
    let path = Path::new(&log_path);
    let bytes = std::fs::read(path).map_err(|e| format!("读取日志失败：{e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    let base = path.parent().unwrap_or_else(|| Path::new("."));
    let default_file = path.with_extension("tex");
    Ok(parse_log_text(&text, base, &default_file))
}

/// 错误规则：needles 全部命中（不区分大小写）即视为匹配
struct Rule {
    needles: &'static [&'static str],
    readable: &'static str,
    fix: &'static str,
    hint: &'static str,
}

/// 高频错误规则表（具体规则在前，泛化规则在后）
const RULES: &[Rule] = &[
    Rule {
        needles: &["missing $ inserted"],
        readable: "数学模式未闭合：$ 可能没有成对，或正文里出现了 _、^ 等数学符号。",
        fix: "检查报错行及上一行的 $ 是否成对（TeX 常在空行/段落结束时才报，行号可能晚一行）；正文里的 _ / ^ 要转义为 \\_ / \\^。",
        hint: "数学模式",
    },
    Rule {
        needles: &["undefined control sequence"],
        readable: "命令未定义：TeX 不认识这个控制序列。",
        fix: "检查命令拼写；若是宏包提供的命令，确认已 \\usepackage 对应宏包。",
        hint: "未定义命令",
    },
    Rule {
        needles: &["environment", "undefined"],
        readable: "环境未定义：使用了未声明或拼错的 LaTeX 环境。",
        fix: "检查 \\begin{...} 的环境名拼写，确认对应宏包已加载。",
        hint: "环境未定义",
    },
    Rule {
        needles: &["missing \\begin{document}"],
        readable: "缺少 \\begin{document}：正文内容写在了导言区。",
        fix: "在 \\documentclass 与正文之间补 \\begin{document}，文末补 \\end{document}。",
        hint: "文档结构",
    },
    Rule {
        needles: &["ended by"],
        readable: "环境没有正确闭合：某个 \\begin{...} 被不匹配的 \\end{...} 提前结束。",
        fix: "检查每个 \\begin 是否都有配对的 \\end，注意嵌套顺序。",
        hint: "环境闭合",
    },
    Rule {
        needles: &["runaway argument"],
        readable: "参数未闭合：某个命令的参数缺少右大括号或 \\end。",
        fix: "检查报错位置附近的 { }、\\end{...} 是否完整。",
        hint: "参数闭合",
    },
    Rule {
        needles: &["file ended while scanning"],
        readable: "文件提前结束：扫描参数/环境时到了文件末尾。",
        fix: "补上缺失的 } 或 \\end{...}，常见于 itemize/enumerate 未闭合。",
        hint: "文件截断",
    },
    Rule {
        needles: &["font", "not found"],
        readable: "字体缺失：文档使用的字体在本机找不到。",
        fix: "安装对应字体；使用 fontspec/ctex 时检查字体名拼写。",
        hint: "字体缺失",
    },
    Rule {
        needles: &["font", "not loadable"],
        readable: "字体无法加载：字体文件损坏或格式不受支持。",
        fix: "确认字体已安装且可被 XeLaTeX 读取，或换用系统自带字体。",
        hint: "字体加载",
    },
    Rule {
        needles: &["file", "not found"],
        readable: "文件或宏包缺失：\\usepackage 引用的宏包在发行版里找不到。",
        fix: "用 TeX 发行版管理器安装该宏包，或检查文件名/拼写。",
        hint: "文件缺失",
    },
    Rule {
        needles: &["there were undefined references"],
        readable: "交叉引用未解析：\\ref / \\cite 还没收敛。",
        fix: "再编译一遍；若仍报错，检查 \\label / \\ref 是否成对且拼写一致。",
        hint: "交叉引用",
    },
    Rule {
        needles: &["citation", "undefined"],
        readable: "文献引用未定义：\\cite 的 key 不存在。",
        fix: "检查 .bib 中是否有对应条目，并重新运行 BibTeX/biber 后再编译。",
        hint: "文献引用",
    },
    Rule {
        needles: &["reference", "undefined"],
        readable: "交叉引用未定义：\\ref 指向的 \\label 不存在。",
        fix: "检查 \\label 是否已定义、拼写是否一致，必要时再编译一遍。",
        hint: "交叉引用",
    },
    Rule {
        needles: &["missing }"],
        readable: "缺少右大括号 }。",
        fix: "检查报错行附近的 { } 配对。",
        hint: "大括号",
    },
    Rule {
        needles: &["extra }"],
        readable: "多余的右大括号 }。",
        fix: "删除多余 }，或补上对应的左大括号。",
        hint: "大括号",
    },
    Rule {
        needles: &["misplaced alignment tab"],
        readable: "对齐符 & 位置错误：表格/对齐环境外使用了 &。",
        fix: "把 & 放进 tabular/align 等环境，或用 \\& 转义。",
        hint: "对齐符",
    },
    Rule {
        needles: &["double superscript"],
        readable: "上标重复：同一处写了两个 ^。",
        fix: "合并上标，例如 x^{a+b}。",
        hint: "上下标",
    },
    Rule {
        needles: &["double subscript"],
        readable: "下标重复：同一处写了两个 _。",
        fix: "合并下标，例如 x_{i,j}。",
        hint: "上下标",
    },
    Rule {
        needles: &["bad math environment delimiter"],
        readable: "数学定界符不匹配。",
        fix: "检查 $...$、\\(...\\)、\\[...\\] 是否成对。",
        hint: "数学定界符",
    },
    Rule {
        needles: &["unicode character"],
        readable: "字符编码问题：当前引擎无法处理该 Unicode 字符。",
        fix: "使用 XeLaTeX + ctex/xeCJK，或把字符替换为可用命令。",
        hint: "编码/字体",
    },
    Rule {
        needles: &["capacity exceeded"],
        readable: "超出 TeX 容量：宏递归或嵌套过深。",
        fix: "检查是否有递归宏/过深嵌套，拆分内容或增大 TeX 容量。",
        hint: "容量",
    },
    Rule {
        needles: &["there's no line here to end"],
        readable: "命令位置不对：这里不能换行/分段。",
        fix: "删除该处的 \\\\ 或 \\newline，检查是否在段落外使用。",
        hint: "命令位置",
    },
    Rule {
        needles: &["illegal unit of measure"],
        readable: "长度单位非法。",
        fix: "检查长度参数是否带单位（pt/cm/em 等）。",
        hint: "长度单位",
    },
    Rule {
        needles: &["missing number"],
        readable: "缺少数字参数：命令需要数字却读到空值。",
        fix: "检查报错命令的参数是否为空或含非法字符。",
        hint: "参数",
    },
    Rule {
        needles: &["no legal \\end found"],
        readable: "缺少 \\end{document}：文档没有合法的 \\end 结束（常见于漏写或注释掉 \\end{document}）。",
        fix: "在文件末尾补上 \\end{document}。",
        hint: "文档结束",
    },
    Rule {
        needles: &["emergency stop"],
        readable: "编译被紧急中止：通常是前面的错误导致 TeX 无法继续。",
        fix: "先修复日志中更靠前的错误。",
        hint: "编译中止",
    },
    Rule {
        needles: &["fatal error occurred"],
        readable: "编译发生致命错误，已中止。",
        fix: "查看日志中更靠前的具体错误并修复。",
        hint: "致命错误",
    },
    Rule {
        needles: &["package", "error"],
        readable: "宏包报错：某个宏包在处理时失败。",
        fix: "查看原始信息中的宏包名，检查参数或宏包版本。",
        hint: "宏包",
    },
    Rule {
        needles: &["latex error"],
        readable: "LaTeX 编译错误。",
        fix: "查看原始报错与行号，按提示修正。",
        hint: "LaTeX 错误",
    },
];

fn match_rule(raw: &str) -> Option<&'static Rule> {
    let lower = raw.to_lowercase();
    RULES
        .iter()
        .find(|r| r.needles.iter().all(|n| lower.contains(n)))
}

/// 解析日志文本（纯函数，便于单测）
pub fn parse_log_text(text: &str, base_dir: &Path, default_file: &Path) -> Vec<TexError> {
    let lines: Vec<&str> = text.lines().collect();
    let mut errors: Vec<TexError> = Vec::new();
    let mut seen: HashSet<(String, u32, String)> = HashSet::new();
    // TeX 日志里的「最近打开的 .tex」，用于没有 file:line 前缀的 `!` 错误
    let mut current_file: Option<String> = None;
    let fallback_file = default_file.to_string_lossy().into_owned();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim_end();

        if let Some(f) = scan_open_tex(line) {
            current_file = Some(resolve_file(&f, base_dir));
        }

        // 1) 带位置前缀：`./main.tex:12: Missing $ inserted.`
        if let Some((file, line_no, msg)) = split_file_line(line) {
            let raw = strip_bang(&msg);
            if !raw.is_empty() {
                let file = resolve_file(&file, base_dir);
                push_error(&mut errors, &mut seen, file, line_no, raw, "error");
            }
            i += 1;
            continue;
        }

        // 2) 无位置前缀：`! LaTeX Error: ...`，向下找 `l.N` 取行号；
        //    另顺带收后续诊断行（如 Emergency stop 后的 `*** (job aborted, no legal \end found)`）
        if let Some(rest) = line.trim_start().strip_prefix('!') {
            let raw = strip_bang(rest);
            if !raw.is_empty() {
                let mut line_no = 0;
                let mut note: Option<String> = None;
                for next in lines.iter().skip(i + 1).take(10) {
                    let t = next.trim();
                    if t.starts_with("l.") && line_no == 0 {
                        if let Some(n) = parse_l_line(t) {
                            line_no = n;
                        }
                    }
                    // Emergency stop 的真实原因多半在紧随其后的 `*** ...` 行
                    if t.contains("no legal \\end found") {
                        note = Some(t.trim_start_matches('*').trim().to_string());
                    }
                    // 诊断行出现在 `l.N` 之前，两者都可能存在，不提前 break
                    if line_no > 0 && note.is_some() {
                        break;
                    }
                }
                let raw = match note {
                    Some(n) => format!("{raw} ({n})"),
                    None => raw,
                };
                let file = current_file.clone().unwrap_or_else(|| fallback_file.clone());
                push_error(&mut errors, &mut seen, file, line_no, raw, "error");
            }
            i += 1;
            continue;
        }

        // 3) 未解析的交叉引用（编译成功时也会出现，错误面板在「警告」页展示）
        let trimmed = line.trim_start();
        if trimmed.starts_with("LaTeX Warning:") && trimmed.to_lowercase().contains("undefined") {
            let line_no = parse_input_line(trimmed).unwrap_or(0);
            let file = current_file.clone().unwrap_or_else(|| fallback_file.clone());
            push_error(
                &mut errors,
                &mut seen,
                file,
                line_no,
                trimmed.to_string(),
                "warning",
            );
        }

        i += 1;
    }

    // 同文件同行已有具体错误时，「Emergency stop.」只是噪声
    let specific: HashSet<(String, u32)> = errors
        .iter()
        .filter(|e| !e.raw.to_lowercase().contains("emergency stop"))
        .map(|e| (e.file.clone(), e.line))
        .collect();
    errors.retain(|e| {
        !(e.raw.to_lowercase().contains("emergency stop")
            && specific.contains(&(e.file.clone(), e.line)))
    });

    // 已有带行号的引用/文献警告时，「There were undefined ...」汇总条是冗余且无行号的
    let has_detail_warning = errors
        .iter()
        .any(|e| e.raw.contains("on input line") && e.raw.to_lowercase().contains("undefined"));
    if has_detail_warning {
        errors.retain(|e| {
            let lower = e.raw.to_lowercase();
            !(lower.contains("there were undefined")
                && !lower.contains("on input line")
                && e.severity == "warning")
        });
    }

    errors
}

fn push_error(
    errors: &mut Vec<TexError>,
    seen: &mut HashSet<(String, u32, String)>,
    file: String,
    line: u32,
    raw: String,
    severity: &str,
) {
    if errors.len() >= MAX_ERRORS {
        return;
    }
    if !seen.insert((file.clone(), line, raw.clone())) {
        return;
    }
    let (readable, fix, hint) = match match_rule(&raw) {
        Some(r) => (r.readable.to_string(), Some(r.fix.to_string()), Some(r.hint.to_string())),
        None => (raw.clone(), None, None),
    };
    errors.push(TexError {
        file,
        line,
        severity: severity.to_string(),
        col: None,
        raw,
        readable,
        fix,
        hint,
    });
}

/// 匹配 `path:line: message`（首个 `:<digits>:`，兼容 Windows 盘符冒号与路径空格）
fn split_file_line(line: &str) -> Option<(String, u32, String)> {
    let t = line.trim_start();
    let bytes = t.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b':' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b':' {
                let file = t[..i].trim();
                let msg = t[j + 1..].trim();
                if !file.is_empty() && !msg.is_empty() {
                    if let Ok(line_no) = t[i + 1..j].parse::<u32>() {
                        return Some((file.to_string(), line_no, msg.to_string()));
                    }
                }
            }
        }
        i += 1;
    }
    None
}

/// 取 `l.12` 的行号
fn parse_l_line(line: &str) -> Option<u32> {
    let rest = line.trim_start().strip_prefix("l.")?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// 取 `on input line 12` 的行号
fn parse_input_line(line: &str) -> Option<u32> {
    let idx = line.find("on input line ")?;
    let rest = &line[idx + "on input line ".len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// 扫描日志行里最近打开的 `.tex`（形如 `(./main.tex`）
fn scan_open_tex(line: &str) -> Option<String> {
    let mut found = None;
    let mut rest = line;
    while let Some(pos) = rest.find('(') {
        rest = &rest[pos + 1..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == ')' || c == '(')
            .unwrap_or(rest.len());
        let tok = &rest[..end];
        if tok.to_ascii_lowercase().ends_with(".tex") {
            found = Some(tok.to_string());
        }
        rest = &rest[end..];
    }
    found
}

fn strip_bang(s: &str) -> String {
    s.trim().trim_start_matches('!').trim().to_string()
}

/// 日志里的相对路径按日志所在目录补全；`./` / `.\` 前缀去掉
fn resolve_file(file: &str, base_dir: &Path) -> String {
    let mut f = file.trim();
    if let Some(rest) = f.strip_prefix("./").or_else(|| f.strip_prefix(".\\")) {
        f = rest;
    }
    let p = Path::new(f);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        base_dir.join(p)
    };
    abs.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_fixture(name: &str) -> Vec<TexError> {
        let text = match name {
            "missing-dollar" => include_str!("../../tests/fixtures/logs/missing-dollar.log"),
            "missing-end" => include_str!("../../tests/fixtures/logs/missing-end.log"),
            "missing-package" => include_str!("../../tests/fixtures/logs/missing-package.log"),
            "missing-end-document" => {
                include_str!("../../tests/fixtures/logs/missing-end-document.log")
            }
            _ => panic!("unknown fixture"),
        };
        let base = Path::new(env!("CARGO_MANIFEST_DIR"));
        parse_log_text(text, base, &base.join(format!("{name}.tex")))
    }

    #[test]
    fn parses_missing_dollar() {
        let errs = parse_fixture("missing-dollar");
        let e = errs
            .iter()
            .find(|e| e.raw.contains("Missing $ inserted"))
            .expect("应命中缺 $ 错误");
        assert!(e.file.ends_with("missing-dollar.tex"), "file={}", e.file);
        assert_eq!(e.line, 3);
        assert!(e.readable.contains("数学"), "readable={}", e.readable);
        assert!(e.fix.is_some());
        assert_eq!(e.hint.as_deref(), Some("数学模式"));
        // 编译在同一文件报了第 3、4 行两处，去重后保持两条
        assert_eq!(
            errs.iter()
                .filter(|e| e.raw.contains("Missing $ inserted"))
                .count(),
            2
        );
    }

    #[test]
    fn parses_missing_end() {
        let errs = parse_fixture("missing-end");
        let e = errs
            .iter()
            .find(|e| e.raw.contains("ended by"))
            .expect("应命中环境未闭合");
        assert!(e.file.ends_with("missing-end.tex"), "file={}", e.file);
        assert_eq!(e.line, 5);
        assert!(e.readable.contains("环境"), "readable={}", e.readable);
    }

    #[test]
    fn parses_missing_package_and_drops_emergency_noise() {
        let errs = parse_fixture("missing-package");
        let e = errs
            .iter()
            .find(|e| e.raw.contains("nosuchpackage123.sty"))
            .expect("应命中宏包缺失");
        assert!(e.file.ends_with("missing-package.tex"), "file={}", e.file);
        assert_eq!(e.line, 3);
        assert!(e.readable.contains("宏包"), "readable={}", e.readable);
        // 同一行还有一条 `Emergency stop.`，应被过滤
        assert_eq!(errs.len(), 1, "errors={:?}", errs);
    }

    #[test]
    fn parses_warning_and_marks_severity() {
        let text = concat!(
            "(./warn.tex",
            "\nLaTeX Warning: Reference `eq:1' on page 1 undefined on input line 5.\n",
        );
        let base = Path::new(env!("CARGO_MANIFEST_DIR"));
        let errs = parse_log_text(text, base, &base.join("main.tex"));
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].severity, "warning");
        assert_eq!(errs[0].line, 5);
        assert!(errs[0].file.ends_with("warn.tex"));
    }

    #[test]
    fn parses_missing_end_document() {
        let errs = parse_fixture("missing-end-document");
        // `! Emergency stop.` 的真实原因在接下来的 `*** (job aborted, no legal \end found)`，
        // raw 应合并该诊断，可读文案命中「缺少 \end{document}」而不是笼统的「紧急中止」
        let e = errs
            .iter()
            .find(|e| e.raw.contains("no legal \\end found"))
            .expect("raw 应合并 no legal \\end found 诊断");
        assert!(e.readable.contains("\\end{document}"), "{}", e.readable);
        assert!(e.severity == "error");
        // TeX 不报行号
        assert_eq!(e.line, 0);
        // 只应有一条：Emergency stop 不再单独成条
        assert_eq!(errs.len(), 1, "errors={:?}", errs);
    }

    #[test]
    fn drops_summary_warning_when_detail_exists() {
        let text = concat!(
            "(./refs.tex",
            "\nLaTeX Warning: Reference `nope' on page 1 undefined on input line 3.",
            "\nLaTeX Warning: There were undefined references.\n",
        );
        let base = Path::new(env!("CARGO_MANIFEST_DIR"));
        let errs = parse_log_text(text, base, &base.join("main.tex"));
        // 汇总条已去重，只剩可跳的明细
        assert_eq!(errs.len(), 1, "errors={:?}", errs);
        assert_eq!(errs[0].severity, "warning");
        assert_eq!(errs[0].line, 3);
        assert!(errs[0].readable.contains("交叉引用"));
    }

    #[test]
    fn errors_are_marked_error_severity() {
        let errs = parse_fixture("missing-dollar");
        assert!(errs.iter().all(|e| e.severity == "error"));
    }

    #[test]
    fn resolves_relative_paths_against_log_dir() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR"));
        let text = "./sub/ch.tex:7: Undefined control sequence.\n";
        let errs = parse_log_text(text, base, &base.join("main.tex"));
        assert_eq!(errs.len(), 1);
        assert!(Path::new(&errs[0].file).is_absolute());
        assert!(errs[0].file.ends_with("ch.tex"));
        assert_eq!(errs[0].line, 7);
    }
}

/// 解析 latexmk 的 `Run number N of rule ...`（compile 侧统计 passes）
pub fn parse_run_number(line: &str) -> Option<u32> {
    let rest = &line[line.find("Run number ")? + "Run number ".len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}
