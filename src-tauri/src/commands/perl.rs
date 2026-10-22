// M0-15b/c · Perl 运行时检测（TeX Live 自带 Perl）
// 只检测，不再自动安装。TeX Live 的 perl 在 <TEXDIR>/tlpkg/tlperl/bin/perl.exe
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::commands::compile::HideConsole;

/// Perl 检测结果（与 src/types/compile.ts PerlInfo 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerlInfo {
    pub found: bool,
    pub version: Option<String>,
    pub bin_dir: Option<String>,
    /// texlive / path / none
    pub source: String,
}

impl PerlInfo {
    pub fn missing() -> Self {
        Self {
            found: false,
            version: None,
            bin_dir: None,
            source: "none".to_string(),
        }
    }
}

/// 检测当前可用 Perl（检测顺序：TeX Live 自带 → 手工配置 → 系统 PATH）
pub fn detect_perl(app: Option<&AppHandle>) -> PerlInfo {
    // 1) 从 config.tex.install_dir 推导 TeX Live 的 perl 路径
    if let Some(app) = app {
        let cfg_path = crate::commands::config::config_path(app).ok();
        if let Some(cfg_path) = cfg_path {
            let cfg = crate::commands::config::read_config(&cfg_path);
            let mut candidates: Vec<PathBuf> = Vec::new();
            if let Some(install_dir) = cfg.tex.install_dir.filter(|s| !s.trim().is_empty()) {
                let texlive_dir = PathBuf::from(&install_dir);
                // TeX Live 布局：<TEXDIR>/tlpkg/tlperl/bin/perl.exe
                candidates.push(texlive_dir.join("tlpkg").join("tlperl").join("bin"));
                // 兼容旧版布局
                candidates.push(texlive_dir.join("bin").join("windows"));
            }
            if let Some(dir) = cfg.perl.install_dir.filter(|s| !s.trim().is_empty()) {
                candidates.push(PathBuf::from(dir));
            }
            for bin_dir in candidates {
                if let Some(perl) = probe_perl_in_dir(&bin_dir) {
                    return PerlInfo {
                        found: true,
                        version: Some(perl),
                        bin_dir: Some(bin_dir.to_string_lossy().to_string()),
                        source: "texlive".to_string(),
                    };
                }
            }
        }
    }

    // 2) 系统 PATH 兜底
    if let Ok(exe) = which::which("perl") {
        if let Some(version) = probe_perl(&exe) {
            return PerlInfo {
                found: true,
                version: Some(version),
                bin_dir: exe.parent().map(|p| p.to_string_lossy().to_string()),
                source: "path".to_string(),
            };
        }
    }

    PerlInfo::missing()
}

/// 在指定目录中找 perl.exe 并验证
fn probe_perl_in_dir(dir: &Path) -> Option<String> {
    let exe_name = if cfg!(windows) { "perl.exe" } else { "perl" };
    let exe = dir.join(exe_name);
    if exe.is_file() {
        probe_perl(&exe)
    } else {
        None
    }
}

/// 在给定目录中找可用 Perl（用于编译时判断能否用 latexmk）
pub fn find_working_perl_in(dirs: &[PathBuf]) -> Option<(PathBuf, String)> {
    for dir in dirs {
        if let Some(version) = probe_perl_in_dir(dir) {
            let exe_name = if cfg!(windows) { "perl.exe" } else { "perl" };
            return Some((dir.join(exe_name), version));
        }
    }
    // 兜底：系统 PATH
    if let Ok(exe) = which::which("perl") {
        if let Some(version) = probe_perl(&exe) {
            return Some((exe, version));
        }
    }
    None
}

/// probe 时的 PATH：先注入 TeX Live 目录，再保留进程 PATH
fn probe_path(exe: &Path) -> Option<OsString> {
    let mut dirs = Vec::new();
    if let Some(bin) = exe.parent() {
        dirs.push(bin.to_path_buf());
    }
    if let Some(old) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&old));
    }
    let mut unique: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    std::env::join_paths(unique).ok()
}

/// 跑一小段核心模块 smoke test，成功时返回版本号
pub fn probe_perl(exe: &Path) -> Option<String> {
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "-e",
        "use File::Copy; use File::Basename; use Getopt::Long; print $^V",
    ]);
    if let Some(path) = probe_path(exe) {
        cmd.env("PATH", path);
    }
    cmd.hide_console();
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let text = if stdout.trim().is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        stdout.to_string()
    };
    parse_perl_version(&text)
}

/// 解析 `perl` 版本：优先 `v5.x.y`，否则保留首行
pub fn parse_perl_version(text: &str) -> Option<String> {
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return None;
    }
    for token in line.split(|c: char| c == '(' || c == ')' || c == ',' || c.is_whitespace()) {
        let t = token.trim_matches(|c: char| c == ',' || c == ';');
        if let Some(rest) = t.strip_prefix('v') {
            if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return Some(rest.to_string());
            }
        }
    }
    Some(line.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_perl_versions() {
        assert_eq!(
            parse_perl_version(
                "This is perl 5, version 42, subversion 3 (v5.42.3) built for MSWin32-x64-multi-thread"
            ),
            Some("5.42.3".to_string())
        );
        assert_eq!(parse_perl_version("v5.40.2"), Some("5.40.2".to_string()));
        assert_eq!(parse_perl_version("  "), None);
    }
}
