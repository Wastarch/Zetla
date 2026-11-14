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
pub const PKG_FALLBACK_NAME: &str = "zetla-update.bin";
/// 包名长度上限（字符数，避免超长文件名在部分文件系统上失败）
const MAX_PKG_NAME_CHARS: usize = 120;

/// 从 URL / 路径末段取出安全文件名（U2 落盘目录化复用）：
/// 丢查询串与片段、只取最后一段、替换控制字符与 Windows 保留字符、去掉尾部点与空格；
/// 空 / `.` / `..` 一律回退兜底名，杜绝落到上层目录。
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

/// 本次更新的落盘目录名：`zetla-update-<纳秒戳>`（U2 起一个更新一个目录）
pub fn staging_dir_name(ts: u128) -> String {
    format!("zetla-update-{ts}")
}

/// 落盘目录内的包文件名：取 URL 末段并安全化（保留真实扩展名，供 U3/U5 按后缀分派）
pub fn pkg_file_name(url: &str) -> String {
    sanitize_filename(url)
}

/// 启动清理的命中规则：旧版扁平包（`zetla-update-<ts>.exe`）、
/// U2 的落盘目录（`zetla-update-<ts>`）、Linux 原地替换的暂存件（`.zetla-{new,old}-*`）
pub fn is_stale_artifact(name: &str) -> bool {
    name.starts_with("zetla-update-")
        || name.starts_with(".zetla-new-")
        || name.starts_with(".zetla-old-")
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

/// 纳秒时间戳（落盘目录 / 暂存件命名）
fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// `$APPIMAGE` 解析（空串 / 空白视为未设置）。单测在任意平台可跑。
#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // 仅 Linux 运行时调用
pub fn appimage_from_env(raw: Option<&str>) -> Option<PathBuf> {
    let v = raw?.trim();
    if v.is_empty() {
        return None;
    }
    Some(PathBuf::from(v))
}

/// AppImage 解压运行形态的痕迹：`/tmp/.mount_ZetlaXXXX/usr/bin/zetla`
#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // 仅 Linux 运行时调用
pub fn looks_like_appimage_mount(exe: &str) -> bool {
    exe.contains(".mount_")
}

/// AppImage 原地替换的三条路径（纯计算，可跨平台单测）
#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // 仅 Linux 运行时构造
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinuxSwapPlan {
    /// 目标 AppImage（符号链接已解析到真实文件）
    pub target: PathBuf,
    /// 同目录暂存的新版本；rename 覆盖后消失
    pub new: PathBuf,
    /// 同目录备份的旧版本；成功后删除，回滚时 rename 回来
    pub backup: PathBuf,
    /// 目标所在目录（可写性探测 + 错误提示用）
    pub dir: PathBuf,
}

/// 生成原地替换计划：暂存件必须与目标同目录，否则 rename 跨设备会 EXDEV
#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // 仅 Linux 运行时调用
pub fn linux_swap_plan(target: &std::path::Path, ts: u128) -> Option<LinuxSwapPlan> {
    let dir = target.parent()?;
    // 裸文件名（parent 为空）不可信：$APPIMAGE 正常是绝对路径，解析不出目录就让调用方报错
    if dir.as_os_str().is_empty() {
        return None;
    }
    let dir = dir.to_path_buf();
    Some(LinuxSwapPlan {
        target: target.to_path_buf(),
        new: dir.join(format!(".zetla-new-{ts}.AppImage")),
        backup: dir.join(format!(".zetla-old-{ts}.AppImage")),
        dir,
    })
}

/// 实测目录可写（建临时文件再删），不靠权限位猜 —— 只读挂载 / root 安装都能识别
#[cfg_attr(not(target_os = "linux"), allow(dead_code))] // 仅 Linux 运行时调用
pub fn probe_write(dir: &std::path::Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(format!(".zetla-wtest-{}-{}", std::process::id(), nanos()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 能力判定（纯函数，便于单测）：返回 (能否自更新, 不能时的原因)。
/// 这里只判「操作系统 + 包型」这一层；Linux AppImage 的目录可写性属运行期条件，
/// 由 `resolve_capability` 在本机再实测一次（见 U3）。
fn capability(os: &str, kind: &str) -> (bool, Option<String>) {
    match (os, kind) {
        ("windows", "exe") => (true, None),
        ("linux", "appimage") => (true, None),
        ("linux", _) => (
            false,
            Some("当前为系统包安装版本（deb/rpm），请用系统包管理器更新，或前往发布页下载安装包。".to_string()),
        ),
        ("macos", _) => (
            false,
            Some("macOS 的应用内换包尚未提供，请前往发布页下载安装包手动安装。".to_string()),
        ),
        _ => (
            false,
            Some("当前平台暂不支持应用内安装，请前往发布页下载安装包。".to_string()),
        ),
    }
}

/// 本机能力：Linux 追加「$APPIMAGE 能否定位 + 所在目录是否真的可写」的实测
#[cfg(target_os = "linux")]
fn resolve_capability(_os: &str, _kind: &str) -> (bool, Option<String>) {
    let Some(target) = appimage_from_env(std::env::var("APPIMAGE").ok().as_deref()) else {
        // $APPIMAGE 为空但有 .mount_ 痕迹：AppImage 形态却定位不到文件（被包装器清过环境变量）
        if std::env::current_exe()
            .map(|e| looks_like_appimage_mount(&e.to_string_lossy()))
            .unwrap_or(false)
        {
            return (
                false,
                Some("检测到 AppImage 运行形态，但无法定位文件（$APPIMAGE 为空），请手动下载安装包。".to_string()),
            );
        }
        return capability("linux", "none");
    };
    let dir = target.parent().map(|d| d.to_path_buf());
    match dir {
        Some(d) if probe_write(&d) => (true, None),
        Some(d) => (
            false,
            Some(format!(
                "AppImage 所在目录不可写（{}），无法自动替换。请把它移到用户可写目录，或从发布页手动下载。",
                d.display()
            )),
        ),
        None => (
            false,
            Some("无法定位 AppImage 所在目录，请从发布页手动下载安装包。".to_string()),
        ),
    }
}

#[cfg(not(target_os = "linux"))]
fn resolve_capability(os: &str, kind: &str) -> (bool, Option<String>) {
    capability(os, kind)
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
    let (can_self_update, reason) = resolve_capability(os, kind);
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

    // 落盘目录：<temp>/zetla-update-<纳秒戳>/<URL 末段文件名>
    // 目录化便于 macOS 解压出 .app 与临时脚本；文件名保留真实扩展名，供平台分支判别。
    // 启动时 cleanup_update_temp 会清掉上次残留（目录或旧版扁平 exe 都清）。
    let dir = std::env::temp_dir().join(staging_dir_name(nanos()));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("创建临时目录失败：{e}"))?;

    let mut last_err = String::new();
    for (idx, src) in installers.iter().enumerate() {
        let source = format!("源 {}/{}", idx + 1, installers.len());
        // 每个源各自成文件：换源时不与上一源残缺文件混在一起
        let dest = dir.join(pkg_file_name(&src.url));
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
    // 全部源失败：把本次落盘目录也清掉，不留半截文件
    let _ = std::fs::remove_dir_all(&dir);
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

/// 应用更新并退出 Zetla（U3 起三平台统一入口，内部按平台分派）：
/// - windows：detached 拉起 Inno 向导，退出后由安装器接管覆盖安装；
/// - linux：原地替换 `$APPIMAGE` 再拉起新版本（U3）；
/// - macos：换包逻辑 U5 落地，当前返回错误让前端引导去发布页。
/// 预检/换包/拉起任一步失败都返回 Err —— 进程继续活着，前端能显示原因，
/// 绝不出现「更新失败但应用已退出」。
#[tauri::command]
pub fn apply_update_and_exit(path: String) -> Result<(), String> {
    let pkg = PathBuf::from(path.trim());
    if !pkg.is_file() {
        return Err(format!("更新包不存在：{}", pkg.display()));
    }
    spawn_update(&pkg)?;
    // 走到这里说明新版本/安装器已成功拉起，释放自身
    std::process::exit(0);
}

#[cfg(target_os = "windows")]
fn spawn_update(pkg: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // 不传静默参数 → 启动 Inno Setup 向导（非 /SILENT）
    let mut cmd = std::process::Command::new(pkg);
    // 0x00000008 = DETACHED_PROCESS：子进程不随父进程退出而死
    cmd.creation_flags(0x0000_0008);
    cmd.spawn().map_err(|e| format!("启动安装程序失败：{e}"))?;
    Ok(())
}

/// U3 · AppImage 原地替换：
/// 同目录 copy → chmod 755 → 备份旧文件 → rename 原子覆盖 → 新进程独立进程组拉起。
/// 只有全部成功才返回 Ok；拉起失败会把旧文件 rename 回来再报错。
#[cfg(target_os = "linux")]
fn spawn_update(pkg: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::CommandExt;

    let target = appimage_from_env(std::env::var("APPIMAGE").ok().as_deref()).ok_or_else(|| {
        "未检测到 AppImage 运行环境（$APPIMAGE 为空），请从发布页手动下载安装包。".to_string()
    })?;
    // 软链场景替换真实文件，别把链接本身换掉
    let target = std::fs::canonicalize(&target).unwrap_or(target);
    if !target.is_file() {
        return Err(format!("找不到当前 AppImage：{}", target.display()));
    }
    let plan = linux_swap_plan(&target, nanos())
        .ok_or_else(|| "无法定位 AppImage 所在目录，请手动下载安装包。".to_string())?;
    // 只读目录（/opt 下 root 安装）不尝试提权，直接给出可操作提示
    if !probe_write(&plan.dir) {
        return Err(format!(
            "AppImage 所在目录不可写（{}），请把它移到用户可写目录，或从发布页手动下载。",
            plan.dir.display()
        ));
    }

    // 1) 先拷到同目录：/tmp 常是 tmpfs，跨设备 rename 会 EXDEV
    if let Err(e) = std::fs::copy(pkg, &plan.new) {
        let _ = std::fs::remove_file(&plan.new);
        return Err(format!("写入新版本失败：{e}"));
    }
    // 2) 可执行位必做：下载文件的 umask 可能给成 644，不 chmod 会「双击无反应」
    if let Err(e) = std::fs::set_permissions(&plan.new, std::fs::Permissions::from_mode(0o755)) {
        let _ = std::fs::remove_file(&plan.new);
        return Err(format!("设置可执行权限失败：{e}"));
    }
    // 3) 备份旧文件：rename 覆盖后原内容就没了（备份失败不阻断，只是失去回滚能力）
    let _ = std::fs::copy(&plan.target, &plan.backup);
    // 4) 原子覆盖：rename 换目录项，运行中的旧 inode 仍被本进程持有
    if let Err(e) = std::fs::rename(&plan.new, &plan.target) {
        let _ = std::fs::remove_file(&plan.new);
        let _ = std::fs::remove_file(&plan.backup);
        return Err(format!("替换 AppImage 失败：{e}"));
    }
    // 5) 新进程自成进程组：父进程退出不把它带走
    let mut cmd = std::process::Command::new(&plan.target);
    cmd.process_group(0);
    match cmd.spawn() {
        Ok(_) => {
            let _ = std::fs::remove_file(&plan.backup);
            Ok(())
        }
        Err(e) => {
            // 拉不起来就回滚，别让用户既没新版本也没旧版本
            let _ = std::fs::remove_file(&plan.target);
            let _ = std::fs::rename(&plan.backup, &plan.target);
            Err(format!("启动新版本失败：{e}（已回滚到原版本）"))
        }
    }
}

#[cfg(target_os = "macos")]
fn spawn_update(_pkg: &std::path::Path) -> Result<(), String> {
    Err("macOS 的应用内换包尚未提供，请前往发布页下载安装包手动安装。".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn spawn_update(_pkg: &std::path::Path) -> Result<(), String> {
    Err("当前平台暂不支持应用内安装，请前往发布页下载安装包。".to_string())
}

/// U4 · 打开已下载的系统安装包（deb/rpm 引导通道）。
/// 不自行提权（绝不调 sudo/pkexec），交给系统安装器弹授权框；
/// 不改动应用本体、不退出进程 —— 用户可能在软件中心里取消安装。
#[tauri::command]
pub async fn open_downloaded_package(path: String) -> Result<(), String> {
    let pkg = PathBuf::from(path.trim());
    if !pkg.is_file() {
        return Err(format!("安装包不存在：{}", pkg.display()));
    }
    let (program, args) = open_package_command(os_label(), &pkg.to_string_lossy());
    let mut cmd = tokio::process::Command::new(&program);
    cmd.args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|e| {
        format!("无法调用 {program}：{e}（当前环境可能没有图形界面，请手动安装）")
    })?;
    // 只等一小会儿：xdg-open 正常立刻返回；某些安装器会一直挂到用户关窗口，
    // 超时即视为「已交给系统」—— 不阻塞前端，也不杀子进程。
    match tokio::time::timeout(Duration::from_secs(8), child.wait()).await {
        Ok(Ok(st)) if st.success() => Ok(()),
        Ok(Ok(st)) => Err(format!(
            "{program} 退出码 {}：系统可能没有关联安装器。请手动双击安装包，或复制路径后在终端安装。",
            st.code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "未知".to_string())
        )),
        Ok(Err(e)) => Err(format!("等待 {program} 失败：{e}")),
        Err(_) => Ok(()),
    }
}

/// 打开安装包要执行的命令（纯函数，便于单测）：
/// - linux：`xdg-open`（GNOME Software / Discover / GDebi 自带提权）
/// - macos：`open`
/// - windows：`cmd /C start ""`——`start` 的第一个参数会被当作窗口标题，必须给空串，
///   否则路径被当成标题吞掉
pub fn open_package_command(os: &str, path: &str) -> (String, Vec<String>) {
    match os {
        "macos" => ("open".to_string(), vec![path.to_string()]),
        "windows" => (
            "cmd".to_string(),
            vec![
                "/C".to_string(),
                "start".to_string(),
                String::new(),
                path.to_string(),
            ],
        ),
        _ => ("xdg-open".to_string(), vec![path.to_string()]),
    }
}

/// 启动清掉上次残留（Zetla 退出时安装器已自行清理，这里兜底）：
/// - `<temp>/zetla-update-*`：U2 起是目录，0.2.x~0.3.x 是扁平 `.exe`，两种都清；
/// - 平台残留：Linux 原地替换的 `.zetla-{new,old}-*`、macOS 换包失败留下的 `<bundle>.old`。
pub fn cleanup_update_temp() {
    sweep_dir(&std::env::temp_dir());
    cleanup_platform_leftovers();
}

/// 扫一个目录，删掉所有命中 `is_stale_artifact` 的文件/目录（可单测）
fn sweep_dir(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_stale_artifact(&name) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(target_os = "linux")]
fn cleanup_platform_leftovers() {
    // AppImage 原地替换的暂存件在 $APPIMAGE 同目录（U3 写入，这里先兜底清）
    let Some(appimage) = std::env::var_os("APPIMAGE") else {
        return;
    };
    let Some(dir) = std::path::Path::new(&appimage).parent() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(".zetla-new-") || name.starts_with(".zetla-old-") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(target_os = "macos")]
fn cleanup_platform_leftovers() {
    // …/Zetla.app/Contents/MacOS/zetla → 上溯 3 级得到 bundle 根，清同级 Zetla.app.old
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut cur: &std::path::Path = &exe;
    for _ in 0..3 {
        match cur.parent() {
            Some(p) => cur = p,
            None => return,
        }
    }
    if cur.extension().and_then(|e| e.to_str()) != Some("app") {
        return;
    }
    let Some(name) = cur.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    let backup = cur.with_file_name(format!("{name}.old"));
    if backup.is_dir() {
        let _ = std::fs::remove_dir_all(&backup);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn cleanup_platform_leftovers() {}

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
    fn capability_linux_appimage_ready_at_os_level() {
        // OS 层放行；目录可写性由 resolve_capability 在运行期实测
        let (ok, reason) = capability("linux", "appimage");
        assert!(ok);
        assert!(reason.is_none());
    }

    #[test]
    fn capability_linux_system_package_never_self_updates() {
        let (ok, reason) = capability("linux", "none");
        assert!(!ok);
        assert!(reason.unwrap().contains("deb/rpm"));
    }

    #[test]
    fn capability_macos_still_pending() {
        let (ok, reason) = capability("macos", "app-tar-gz");
        assert!(!ok, "macOS 换包要到 U5，U3 不应宣称可自更新");
        assert!(reason.unwrap().contains("尚未提供"));
    }

    #[test]
    fn capability_unknown_platform_is_safe() {
        let (ok, reason) = capability("freebsd", "exe");
        assert!(!ok);
        assert!(reason.unwrap().contains("暂不支持"));
    }

    // ── U2 落盘目录命名 / 清理命中规则 ───────────────────────────────────

    #[test]
    fn staging_dir_name_is_timestamped() {
        assert_eq!(staging_dir_name(1_700_000_000_000_000_000), "zetla-update-1700000000000000000");
        // 目录名必须能被清理规则命中，否则重启后残留清不掉
        assert!(is_stale_artifact(&staging_dir_name(1)));
    }

    #[test]
    fn pkg_file_name_keeps_real_extension() {
        assert_eq!(
            pkg_file_name("https://gitee.com/a/Zetla_0.3.1_x64-setup.exe?token=abc"),
            "Zetla_0.3.1_x64-setup.exe"
        );
        assert_eq!(
            pkg_file_name("https://cdn.example.com/Zetla_0.4.0_aarch64.app.tar.gz"),
            "Zetla_0.4.0_aarch64.app.tar.gz"
        );
        assert_eq!(pkg_file_name("https://example.com/dir/"), PKG_FALLBACK_NAME);
    }

    #[test]
    fn stale_artifact_matches_dirs_files_and_staging() {
        assert!(is_stale_artifact("zetla-update-1700000000"));
        assert!(is_stale_artifact("zetla-update-1700000000.exe"));
        assert!(is_stale_artifact(".zetla-new-1700000000.AppImage"));
        assert!(is_stale_artifact(".zetla-old-1700000000.AppImage"));
        // 不能误伤
        assert!(!is_stale_artifact("zetla-update"));
        assert!(!is_stale_artifact("zetla-updater.exe"));
        assert!(!is_stale_artifact("my-zetla-update-1"));
        assert!(!is_stale_artifact("zetla.log"));
    }

    #[test]
    fn sweep_removes_staging_dirs_and_legacy_files() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("zetla-sweep-{}-{ts}", std::process::id()));
        std::fs::create_dir_all(root.join("zetla-update-123")).unwrap();
        std::fs::write(root.join("zetla-update-123/pkg.exe"), b"x").unwrap();
        std::fs::write(root.join("zetla-update-456.exe"), b"x").unwrap();
        std::fs::write(root.join(".zetla-new-789.AppImage"), b"x").unwrap();
        std::fs::write(root.join("keep.txt"), b"x").unwrap();

        sweep_dir(&root);

        assert!(!root.join("zetla-update-123").exists(), "落盘目录应被整目录删除");
        assert!(!root.join("zetla-update-456.exe").exists(), "旧版扁平 exe 应被删除");
        assert!(!root.join(".zetla-new-789.AppImage").exists(), "Linux 暂存件应被删除");
        assert!(root.join("keep.txt").exists(), "无关文件不能被误删");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sweep_tolerates_missing_dir() {
        sweep_dir(&std::env::temp_dir().join("zetla-sweep-not-exist-xyz"));
    }

    #[test]
    fn env_info_is_self_consistent() {
        let env = update_env_info();
        assert_eq!(env.key, platform_key(manifest_os(), &env.arch));
        // macOS 的清单前缀是 darwin，不是展示用的 macos
        assert!(!env.key.starts_with("macos-"));
        assert!(!env.os.is_empty() && !env.arch.is_empty());
        let (expect_ok, _) = resolve_capability(&env.os, &env.kind);
        assert_eq!(env.can_self_update, expect_ok);
        // 只有 Windows 会拿到 exe
        if env.os != "windows" {
            assert_ne!(env.kind, "exe");
        }
    }

    // ── U3 AppImage 原地替换的纯逻辑 ─────────────────────────────────────

    #[test]
    fn appimage_env_parsing() {
        assert_eq!(
            appimage_from_env(Some("/home/u/Apps/Zetla.AppImage")),
            Some(PathBuf::from("/home/u/Apps/Zetla.AppImage"))
        );
        // 环境变量被清成空白时按未设置处理，避免把 "" 当路径
        assert_eq!(appimage_from_env(Some("   ")), None);
        assert_eq!(appimage_from_env(Some("")), None);
        assert_eq!(appimage_from_env(None), None);
    }

    #[test]
    fn appimage_mount_form_is_detected() {
        assert!(looks_like_appimage_mount(
            "/tmp/.mount_ZetlaAbc123/usr/bin/zetla"
        ));
        assert!(!looks_like_appimage_mount("/usr/bin/zetla"));
        assert!(!looks_like_appimage_mount("/home/u/Apps/Zetla.AppImage"));
    }

    #[test]
    fn swap_plan_stays_in_same_directory() {
        let plan = linux_swap_plan(std::path::Path::new("/home/u/Apps/Zetla.AppImage"), 7)
            .expect("有父目录就该有计划");
        assert_eq!(plan.dir.file_name().unwrap(), "Apps");
        assert_eq!(plan.new.file_name().unwrap(), ".zetla-new-7.AppImage");
        assert_eq!(plan.backup.file_name().unwrap(), ".zetla-old-7.AppImage");
        // 暂存件必须与目标同目录，否则 rename 跨设备会 EXDEV
        assert_eq!(plan.new.parent(), plan.target.parent());
        assert_eq!(plan.backup.parent(), plan.target.parent());
        // 暂存件要被启动清理命中，失败残留才不会越攒越多
        assert!(is_stale_artifact(
            &plan.new.file_name().unwrap().to_string_lossy()
        ));
        assert!(is_stale_artifact(
            &plan.backup.file_name().unwrap().to_string_lossy()
        ));
    }

    #[test]
    fn swap_plan_needs_parent() {
        assert!(linux_swap_plan(std::path::Path::new("Zetla.AppImage"), 1).is_none());
    }

    #[test]
    fn probe_write_reflects_reality() {
        let dir = std::env::temp_dir().join(format!("zetla-wtest-{}-{}", std::process::id(), nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(probe_write(&dir), "自建临时目录应可写");
        assert!(
            !probe_write(&dir.join("nope")),
            "不存在的目录不能被判为可写"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── U4 deb/rpm 引导：打开安装包的命令映射 ────────────────────────────

    #[test]
    fn open_package_command_linux_uses_xdg_open() {
        let (prog, args) = open_package_command("linux", "/tmp/zetla-update-1/Zetla_0.4.0_amd64.deb");
        assert_eq!(prog, "xdg-open");
        // 路径必须原样作为唯一参数，不能被拆成多个或加引号
        assert_eq!(args, vec!["/tmp/zetla-update-1/Zetla_0.4.0_amd64.deb"]);
    }

    #[test]
    fn open_package_command_macos_uses_open() {
        let (prog, args) = open_package_command("macos", "/tmp/Zetla_0.4.0.dmg");
        assert_eq!(prog, "open");
        assert_eq!(args, vec!["/tmp/Zetla_0.4.0.dmg"]);
    }

    #[test]
    fn open_package_command_windows_fills_start_title() {
        let (prog, args) = open_package_command("windows", r"C:\Temp\zetla-update-1\Zetla_0.4.0_x64-setup.exe");
        assert_eq!(prog, "cmd");
        // start 的第一个参数会被当窗口标题，空串占位少了就会把路径当标题吞掉
        assert_eq!(args.len(), 4);
        assert_eq!(args[0], "/C");
        assert_eq!(args[1], "start");
        assert_eq!(args[2], "");
        assert_eq!(args[3], r"C:\Temp\zetla-update-1\Zetla_0.4.0_x64-setup.exe");
    }

    #[test]
    fn open_package_command_unknown_os_falls_back_to_xdg_open() {
        let (prog, args) = open_package_command("freebsd", "/tmp/a.deb");
        assert_eq!(prog, "xdg-open");
        assert_eq!(args, vec!["/tmp/a.deb"]);
    }
}
