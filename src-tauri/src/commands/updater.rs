// M1-13 · 自动更新（轻量版：自下载安装包 + 拉起安装向导，无代码签名）
// - update_env_info：U1 新增。由 Rust 统一判定「本机平台 / 期望包类型 / 能否自更新」，
//   前端不再自行猜平台，避免两处逻辑漂移（见 docs/dev/自动更新-Linux-macOS设计.md §3.2）。
// - download_app_update：依次尝试 latest.json 里的多源 installer，流式下载到临时目录，
//   下载完算 sha256 与期望比对；不匹配/超时/非 200 换下一源。边下边 emit 进度。
// - launch_installer_and_exit：detached 拉起 Inno Setup 安装向导（不传静默参数），
//   随后退出 Zetla，释放文件句柄，由安装器接管覆盖安装。
// - cleanup_update_temp：启动清掉上次残留的临时安装包。
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

/// 安装包源（latest.json 的 installers 项）
#[derive(Debug, Clone, Deserialize)]
pub struct InstallerSrc {
    pub url: String,
    pub sha256: String,
}

/// 下载进度负载（与 src/modules/updater/types.ts UpdateProgress 对齐）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: u64,
    pub source: String,
}

const EV_UPDATE_PROGRESS: &str = "update-progress";
/// 下载总超时（单源）
const UPDATE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// 安装包最小体积（明显偏小视为失败，避免把错误页当安装包）
const MIN_SIZE: u64 = 1 * 1024 * 1024;

// ── U1 · 清单协议 v2：本机平台判定 + 包名安全化 ────────────────────────────

/// 本机更新环境（与 src/modules/updater/types.ts 的 UpdateEnv 对齐，camelCase）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEnv {
    /// "windows" | "macos" | "linux"
    pub os: String,
    /// "x86_64" | "aarch64"
    pub arch: String,
    /// 清单查找键，如 "darwin-aarch64"
    pub key: String,
    /// 期望的产物类型，与 latest.json platforms[*].kind 对齐
    pub kind: String,
    /// 能否在应用内完成换包（不能时只给「去发布页下载」）
    pub can_self_update: bool,
    /// 不能自更新的原因（直接展示给用户）
    pub reason: Option<String>,
    /// 当前可执行文件路径（诊断 / 日志用）
    pub install_path: Option<String>,
}

/// 包名安全化的兜底名（URL 末段不可用时）
#[allow(dead_code)] // U2 落盘目录化时接入；单测已先行覆盖
pub const PKG_FALLBACK_NAME: &str = "zetla-update.bin";
/// 包名长度上限（字符数，避免超长文件名在部分文件系统上失败）
#[allow(dead_code)] // 同上
const MAX_PKG_NAME_CHARS: usize = 120;

/// 从 URL / 路径末段取出安全文件名（U2 落盘目录化复用）：
/// 丢查询串与片段、只取最后一段、替换控制字符与 Windows 保留字符、去掉尾部点与空格；
/// 空 / `.` / `..` 一律回退兜底名，杜绝落到上层目录。
#[allow(dead_code)] // U2 落盘目录化时接入；单测已先行覆盖
pub fn sanitize_filename(raw: &str) -> String {
    let no_query = raw.split(['?', '#']).next().unwrap_or("");
    let leaf = no_query.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = leaf
        .chars()
        .map(|c| match c {
            c if c.is_control() => '_',
            ':' | '*' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    // 尾部点/空格在 Windows 上会被静默裁掉，先自己裁，保证前后端看到同一个名字
    let cleaned = cleaned.trim_end_matches(['.', ' ']).to_string();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return PKG_FALLBACK_NAME.to_string();
    }
    if cleaned.chars().count() > MAX_PKG_NAME_CHARS {
        return cleaned.chars().take(MAX_PKG_NAME_CHARS).collect();
    }
    cleaned
}

/// 清单查找键：`{manifest_os}-{arch}`（与 latest.json platforms 的键一致）
pub fn platform_key(os: &str, arch: &str) -> String {
    format!("{os}-{arch}")
}

/// latest.json 里的平台前缀：macOS 用 `darwin`（与 Tauri 官方 updater 的键名一致），
/// 而不是展示用的 `macos` —— 拼错会导致 macOS 永远取不到条目。
#[cfg(target_os = "windows")]
pub const fn manifest_os() -> &'static str {
    "windows"
}

#[cfg(target_os = "macos")]
pub const fn manifest_os() -> &'static str {
    "darwin"
}

#[cfg(target_os = "linux")]
pub const fn manifest_os() -> &'static str {
    "linux"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub const fn manifest_os() -> &'static str {
    "unknown"
}

/// Linux 包型判定：`$APPIMAGE` 有值才是 AppImage 形态，否则视为 deb/rpm 系统包安装
#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // 仅 Linux 构建会实际调用
pub fn linux_package_kind(appimage: Option<&str>) -> &'static str {
    match appimage.map(str::trim) {
        Some(p) if !p.is_empty() => "appimage",
        _ => "none",
    }
}

/// U1 只接入了 Windows 的「下载 → 拉起安装向导 → 退出」闭环；
/// macOS 换包在 U5、Linux AppImage 替换在 U3，接入前绝不宣称可自更新。
const SELF_UPDATE_READY_OS: &[&str] = &["windows"];

/// 能力判定（纯函数，便于单测）：返回 (能否自更新, 不能时的原因)
fn capability(os: &str, kind: &str) -> (bool, Option<String>) {
    if kind == "none" {
        return (
            false,
            Some("当前为系统包安装版本（deb/rpm），请用系统包管理器更新，或前往发布页下载安装包。".to_string()),
        );
    }
    if SELF_UPDATE_READY_OS.contains(&os) {
        return (true, None);
    }
    (
        false,
        Some("当前平台的应用内更新尚未开放，请前往发布页下载安装包手动安装。".to_string()),
    )
}

#[cfg(target_os = "windows")]
pub const fn os_label() -> &'static str {
    "windows"
}

#[cfg(target_os = "macos")]
pub const fn os_label() -> &'static str {
    "macos"
}

#[cfg(target_os = "linux")]
pub const fn os_label() -> &'static str {
    "linux"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub const fn os_label() -> &'static str {
    "unknown"
}

pub fn arch_label() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "x86" => "i686",
        other => other,
    }
}

#[cfg(target_os = "windows")]
fn expected_kind() -> &'static str {
    "exe"
}

#[cfg(target_os = "macos")]
fn expected_kind() -> &'static str {
    "app-tar-gz"
}

#[cfg(target_os = "linux")]
fn expected_kind() -> &'static str {
    linux_package_kind(std::env::var("APPIMAGE").ok().as_deref())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn expected_kind() -> &'static str {
    "none"
}

/// U1 · 报告本机更新环境：平台键 / 期望包类型 / 能否自更新 / 不能的原因
#[tauri::command]
pub fn update_env_info() -> UpdateEnv {
    let os = os_label();
    let arch = arch_label();
    let kind = expected_kind();
    let (can_self_update, reason) = capability(os, kind);
    UpdateEnv {
        os: os.to_string(),
        arch: arch.to_string(),
        key: platform_key(manifest_os(), arch),
        kind: kind.to_string(),
        can_self_update,
        reason,
        install_path: std::env::current_exe()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub async fn download_app_update(
    app: AppHandle,
    installers: Vec<InstallerSrc>,
) -> Result<String, String> {
    if installers.is_empty() {
        return Err("没有可用的安装包源，请在 latest.json 填 installers".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(UPDATE_TIMEOUT)
        .build()
        .map_err(|e| format!("初始化下载客户端失败：{e}"))?;

    // 临时文件：%TEMP%/zetla-update-<纳秒戳>.exe（启动时 cleanup 会清旧文件）
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dest = std::env::temp_dir().join(format!("zetla-update-{ts}.exe"));

    let mut last_err = String::new();
    for (idx, src) in installers.iter().enumerate() {
        let source = format!("源 {}/{}", idx + 1, installers.len());
        emit_progress(&app, 0, 0, &source);
        match try_download(&client, &app, &src.url, &dest, &source).await {
            Ok(()) => {
                match sha256_of(&dest) {
                    Ok(hash) if hash.eq_ignore_ascii_case(src.sha256.trim()) => {
                        return Ok(dest.to_string_lossy().to_string());
                    }
                    Ok(hash) => {
                        let _ = std::fs::remove_file(&dest);
                        last_err = format!(
                            "安装包校验失败（{}）：期望 {}，实际 {hash}",
                            source, src.sha256
                        );
                    }
                    Err(e) => {
                        let _ = std::fs::remove_file(&dest);
                        last_err = format!("计算校验和失败（{source}）：{e}");
                    }
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&dest);
                last_err = format!("下载失败（{source}）：{e}");
            }
        }
    }
    Err(format!("所有安装包源均不可用：{last_err}"))
}

/// 单源下载：流式写盘 + 增量算 sha256 + 进度事件
async fn try_download(
    client: &reqwest::Client,
    app: &AppHandle,
    url: &str,
    dest: &std::path::Path,
    source: &str,
) -> Result<(), String> {
    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("连接失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    // 容错：覆盖可能残留的同名文件
    let _ = std::fs::remove_file(dest);
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("创建临时文件失败：{e}"))?;

    let mut downloaded: u64 = 0;
    let mut hasher = Sha256::new();
    loop {
        let chunk = resp
            .chunk()
            .await
            .map_err(|e| format!("下载中断：{e}"))?;
        let Some(bytes) = chunk else { break };
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("写入临时文件失败：{e}"))?;
        hasher.update(&bytes);
        downloaded += bytes.len() as u64;
        emit_progress(app, downloaded, total, source);
    }
    file.flush().await.map_err(|e| format!("保存失败：{e}"))?;

    if downloaded < MIN_SIZE {
        return Err(format!("安装包不完整（仅 {downloaded} 字节），请重试"));
    }
    Ok(())
}

/// 读文件算 sha256（安装包通常几十 MB，整读足够）
fn sha256_of(path: &std::path::Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("读取安装包失败：{e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 拉起安装向导并退出 Zetla：detached 脱离父进程，Zetla 退出后安装器继续运行接管覆盖安装。
#[tauri::command]
pub fn launch_installer_and_exit(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.is_file() {
        return Err(format!("安装包不存在：{}", p.display()));
    }
    let mut cmd = std::process::Command::new(&p);
    // 不传静默参数 → 启动 Inno Setup 向导（非 /SILENT）
    #[cfg(windows)]
    {
        // 0x00000008 = DETACHED_PROCESS：子进程不随父进程退出而死
        cmd.creation_flags(0x0000_0008);
    }
    cmd.spawn().map_err(|e| format!("启动安装程序失败：{e}"))?;
    // 退出主进程，释放文件句柄，安装器接管
    std::process::exit(0);
}

/// 启动清掉上次残留的临时安装包（Zetla 退出时 NSIS/Inno 已自行清理，这里兜底）
pub fn cleanup_update_temp() {
    let temp = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&temp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("zetla-update-") && name.ends_with(".exe") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// 通过 Rust 侧拉取 latest.json，绕过 WebView 的 CORS 限制
/// （Gitee raw 不返回 Access-Control-Allow-Origin，浏览器 fetch 必被拦）。
/// 依次尝试 urls，任一成功即返回文本；全部失败返回错误。
#[tauri::command]
pub async fn fetch_latest_json(urls: Vec<String>) -> Result<String, String> {
    if urls.is_empty() {
        return Err("没有可用的更新源".to_string());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;

    let mut last_err = String::new();
    for url in urls {
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => return Ok(text),
                Err(e) => last_err = format!("读取响应失败（{url}）：{e}"),
            },
            Ok(resp) => last_err = format!("HTTP {}（{url}）", resp.status()),
            Err(e) => last_err = format!("请求失败（{url}）：{e}"),
        }
    }
    Err(format!("所有更新源均不可用：{last_err}"))
}

fn emit_progress(app: &AppHandle, downloaded: u64, total: u64, source: &str) {
    let _ = app.emit(
        EV_UPDATE_PROGRESS,
        UpdateProgress {
            downloaded,
            total,
            source: source.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── sanitize_filename ────────────────────────────────────────────────

    #[test]
    fn sanitize_keeps_installer_name() {
        assert_eq!(
            sanitize_filename("https://gitee.com/Wastarch/Zetla/releases/download/v0.3.1/Zetla_0.3.1_x64-setup.exe"),
            "Zetla_0.3.1_x64-setup.exe"
        );
    }

    #[test]
    fn sanitize_strips_query_and_fragment() {
        assert_eq!(
            sanitize_filename("https://example.com/f/Zetla_0.3.1_amd64.AppImage?download=1#x"),
            "Zetla_0.3.1_amd64.AppImage"
        );
    }

    #[test]
    fn sanitize_accepts_backslash_path() {
        assert_eq!(sanitize_filename(r"E:\temp\Zetla.app.tar.gz"), "Zetla.app.tar.gz");
    }

    #[test]
    fn sanitize_rejects_parent_reference() {
        assert_eq!(sanitize_filename(".."), PKG_FALLBACK_NAME);
        assert_eq!(sanitize_filename("https://example.com/a/../.."), PKG_FALLBACK_NAME);
        assert_eq!(sanitize_filename("."), PKG_FALLBACK_NAME);
    }

    #[test]
    fn sanitize_empty_falls_back() {
        assert_eq!(sanitize_filename(""), PKG_FALLBACK_NAME);
        assert_eq!(sanitize_filename("   "), PKG_FALLBACK_NAME);
        assert_eq!(sanitize_filename("https://example.com/dir/"), PKG_FALLBACK_NAME);
    }

    #[test]
    fn sanitize_replaces_reserved_chars() {
        assert_eq!(sanitize_filename("a:b*c\"d<e>f|g.exe"), "a_b_c_d_e_f_g.exe");
    }

    #[test]
    fn sanitize_trims_trailing_dots_and_spaces() {
        assert_eq!(sanitize_filename("Zetla_0.3.1.exe..."), "Zetla_0.3.1.exe");
        assert_eq!(sanitize_filename("Zetla_0.3.1.exe   "), "Zetla_0.3.1.exe");
    }

    #[test]
    fn sanitize_truncates_overlong_name() {
        let long = format!("{}.exe", "a".repeat(300));
        let out = sanitize_filename(&long);
        assert_eq!(out.chars().count(), MAX_PKG_NAME_CHARS);
    }

    // ── 平台键 / 包型 / 能力判定 ──────────────────────────────────────────

    #[test]
    fn platform_key_joins_os_and_arch() {
        assert_eq!(platform_key("windows", "x86_64"), "windows-x86_64");
        assert_eq!(platform_key("darwin", "aarch64"), "darwin-aarch64");
        assert_eq!(platform_key("linux", "x86_64"), "linux-x86_64");
    }

    #[test]
    fn linux_kind_requires_appimage_env() {
        assert_eq!(linux_package_kind(Some("/home/u/Apps/Zetla.AppImage")), "appimage");
        assert_eq!(linux_package_kind(None), "none");
        assert_eq!(linux_package_kind(Some("   ")), "none");
    }

    #[test]
    fn capability_windows_exe_can_self_update() {
        let (ok, reason) = capability("windows", "exe");
        assert!(ok);
        assert!(reason.is_none());
    }

    #[test]
    fn capability_none_never_self_updates() {
        let (ok, reason) = capability("linux", "none");
        assert!(!ok);
        assert!(reason.unwrap().contains("deb/rpm"));
    }

    #[test]
    fn capability_other_platforms_pending() {
        for (os, kind) in [("macos", "app-tar-gz"), ("linux", "appimage")] {
            let (ok, reason) = capability(os, kind);
            assert!(!ok, "{os}/{kind} 在 U1 不应宣称可自更新");
            assert!(reason.unwrap().contains("尚未开放"));
        }
    }

    #[test]
    fn env_info_is_self_consistent() {
        let env = update_env_info();
        assert_eq!(env.key, platform_key(manifest_os(), &env.arch));
        // macOS 的清单前缀是 darwin，不是展示用的 macos
        assert!(!env.key.starts_with("macos-"));
        assert!(!env.os.is_empty() && !env.arch.is_empty());
        let (expect_ok, _) = capability(&env.os, &env.kind);
        assert_eq!(env.can_self_update, expect_ok);
        // 只有 Windows 会拿到 exe；其余平台要么待接入、要么 none
        if env.os != "windows" {
            assert_ne!(env.kind, "exe");
        }
    }
}
