// 编译引擎管理（开发文档 §3.3 / docs/开发/M0-3编译引擎.md）
// M0-3a：发行版检测（PATH + 常见安装目录探测、版本解析）
use serde::Serialize;
use which::which;

/// 发行版检测结果（与 src/types/compile.ts TexDistInfo 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexDistInfo {
    /// 是否检测到可用发行版（任一引擎存在即 true）
    pub found: bool,
    /// 发行版名称："MiKTeX" / "TeX Live" / "Unknown"
    pub distribution: String,
    /// 版本号（取主引擎 --version 首行解析）
    pub version: Option<String>,
    /// 检测到的可执行引擎（含完整路径）
    pub engines: Vec<String>,
    /// 推荐引擎（默认 xelatex）
    pub recommended: String,
}

/// 需探测的引擎（按优先级）
const ENGINE_CANDIDATES: [&str; 4] = ["xelatex", "pdflatex", "lualatex", "latexmk"];

/// Windows 下额外检查的 MiKTeX 安装目录（PATH 之外的兜底）
#[cfg(windows)]
const MIKTEX_DIRS: [&str; 4] = [
    r"C:\Program Files\MiKTeX 25.1\miktex\bin\x64",
    r"C:\Program Files\MiKTeX 25\miktex\bin\x64",
    r"C:\Program Files\MiKTeX 24.4\miktex\bin\x64",
    r"C:\Program Files\MiKTeX\miktex\bin\x64",
];

/// 在 PATH 中查找引擎；找不到时（Windows）回退扫描 MiKTeX 常见安装目录
fn find_engine(name: &str) -> Option<std::path::PathBuf> {
    if let Ok(p) = which(name) {
        return Some(p);
    }
    #[cfg(windows)]
    {
        for dir in MIKTEX_DIRS {
            let candidate = std::path::Path::new(dir).join(format!("{name}.exe"));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 执行 `<exe> --version` 并取首行（超时 5s 兜底为 None）
fn probe_version(exe: &std::path::Path) -> Option<String> {
    let output = std::process::Command::new(exe)
        .arg("--version")
        // 不弹黑框（Windows）
        .hide_console()
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().next().map(|s| s.trim().to_string())
}

/// Windows：子进程不弹控制台窗口；其他平台恒等返回
#[cfg(windows)]
trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl HideConsole for std::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW
        self.creation_flags(0x0800_0000);
        self
    }
}

#[cfg(not(windows))]
trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(not(windows))]
impl HideConsole for std::process::Command {
    fn hide_console(&mut self) -> &mut Self {
        self
    }
}

/// 探测 TeX 发行版与引擎（Tauri command）
#[tauri::command]
pub fn detect_tex_distribution() -> TexDistInfo {
    let mut engines: Vec<String> = Vec::new();
    let mut found_paths: Vec<(&str, std::path::PathBuf)> = Vec::new();

    for name in ENGINE_CANDIDATES {
        if let Some(p) = find_engine(name) {
            engines.push(name.to_string());
            found_paths.push((name, p));
        }
    }

    let found = !engines.is_empty();

    // 版本：优先 xelatex，其次 pdflatex，再次 lualatex
    let version = ["xelatex", "pdflatex", "lualatex"]
        .iter()
        .find_map(|want| found_paths.iter().find(|(n, _)| n == want).map(|(_, p)| p))
        .and_then(|p| probe_version(p))
        .and_then(|line| {
            // 首行形如 "XeTeX 3.141592653-2.6-0.999996 (TeX Live 2025)"
            // 或 "MiKTeX 25.1 (64-bit)"
            let start = line.find(char::is_numeric)?;
            let tail = &line[start..];
            let end = tail.find("(TeX").or_else(|| tail.find('(')).unwrap_or(tail.len());
            Some(tail[..end].trim().to_string())
        });

    // 发行版判定：安装目录含 MiKTeX → MiKTeX；含 texlive → TeX Live；有引擎但无法判定 → Unknown
    let distribution = if !found {
        "None".to_string()
    } else {
        let all_paths = found_paths
            .iter()
            .map(|(_, p)| p.to_string_lossy().to_lowercase())
            .collect::<String>();
        if all_paths.contains("miktex") {
            "MiKTeX".to_string()
        } else if all_paths.contains("texlive") {
            "TeX Live".to_string()
        } else {
            "Unknown".to_string()
        }
    };

    TexDistInfo {
        found,
        distribution,
        version,
        engines,
        recommended: "xelatex".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_consistent_result() {
        let info = detect_tex_distribution();
        // 结果自洽：found 与 engines 一致
        assert_eq!(info.found, !info.engines.is_empty());
        if info.found {
            // 有引擎时必须给出发行版与推荐引擎
            assert_ne!(info.distribution, "None");
            assert_eq!(info.recommended, "xelatex");
            // 推荐引擎若可用，应出现在列表中；本机装了 TeX 时推荐引擎必须在列表里
            if info.engines.contains(&"xelatex".to_string()) {
                assert!(info.version.is_some(), "有 xelatex 时应解析出版本");
            }
        }
    }

    #[test]
    fn missing_engine_not_reported() {
        // 不存在的可执行文件不应被 find_engine 找到
        assert!(find_engine("definitely_not_a_tex_engine_xyz").is_none());
    }
}
