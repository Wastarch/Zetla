// M1-13 · 自动更新（轻量版：自下载安装包 + 拉起安装向导，无代码签名）
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
