// Zotero 联动 · Phase 0：本地 API 只读客户端 + 能力探测
//
// 设计约束（见 docs/dev/Zotero联动/开发计划.md §2/§7）：
// - 所有请求**必须**从 Rust 发出：Zotero 10 会丢弃带 Origin / 浏览器 UA 的请求，
//   BBT CAYW 自 Zotero 5.0.71 起也禁止从浏览器访问；前端 fetch 不可用。
// - Host 固定为 localhost（由 reqwest 依据 URL 自动设置），**不要**手动覆盖 Host，
//   也不要接受任意 host：端口可由用户配置，主机绝不可配置（防 SSRF / 端口转发）。
// - 本期只读：不申请 local API key、不写回 Zotero，Zotero 7+ 即可用。
// - 本地读请求无需鉴权；403 = 用户没勾「Allow other applications ...」。
// - 参考：https://www.zotero.org/support/dev/web_api/v3/local_api
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::commands::fsdoc::{WriteOptions, write_file};
use crate::commands::project::{project_json_path, read_project_obj};
use crate::commands::zotero_watch::{BibChanged, ZoteroWatchState};

/// Zotero 本地 API 默认端口（Juris-M 为 24119，设置页可改）
pub const DEFAULT_PORT: u16 = 23119;
/// Rust → 前端的连接状态事件（与 src/ipc/events.ts RustEvents.zoteroStatus 对齐）
pub const STATUS_EVENT: &str = "zotero:status";
/// 本地服务应当毫秒级响应；超时给足但不让 UI 卡住
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(4);
/// 明确的非浏览器 UA：reqwest 默认不带 UA，但显式声明便于 Zotero 侧识别与排障
const USER_AGENT: &str = "Zetla/0.3.1 (local Zotero bridge)";

/// 连接状态。前端另有 "checking" / "disabled" 两种纯 UI 态（见 src/types/zotero.ts）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ZoteroState {
    Connected,
    /// 403：本地 API 未在 Zotero 设置里开启
    ApiDisabled,
    /// 400：请求被拒（Host / Origin / 参数异常）
    BadRequest,
    /// 连不上：Zotero 未启动或端口不对
    Offline,
    /// 连上了但超时
    Timeout,
    /// 其他非 2xx / 协议异常
    Unavailable,
}

/// 一次健康检查结果。所有字段都是「事实」，文案由前端 zoteroDiagnostics.ts 生成。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroHealth {
    pub state: ZoteroState,
    /// HTTP 状态码；连接都没建立时为 None
    pub http_status: Option<u16>,
    /// 固定为 3（本地 API 只支持 v3；未来版本须先读此头再决定后续请求）
    pub api_version: Option<String>,
    pub schema_version: Option<String>,
    /// Zotero 10+ 每个响应都有；按此分区缓存（本地 version 与 Web API 无关）
    pub server_id: Option<String>,
    /// 客户端版本（若响应头提供）
    pub zotero_version: Option<String>,
    /// 是否具备本地写能力（Zotero 10+）；本期不写回，仅供能力展示
    pub can_write: bool,
    /// Better BibTeX 是否在线（`/better-bibtex/cayw?probe=1` 返回 ready）
    pub bbt_available: bool,
    pub port: u16,
    /// ISO-8601 检查时刻
    pub checked_at: String,
    /// 简短技术说明（诊断正文仍由前端按 state 生成）
    pub message: String,
}

/// 端口归一化：0 / 保留值一律回落默认端口（主机固定 localhost，不接受自定义主机名）
pub fn normalize_port(port: u16) -> u16 {
    if port == 0 { DEFAULT_PORT } else { port }
}

/// 基址：固定 localhost，不带 /api 前缀（BBT 端点在根路径下）
pub fn base_url(port: u16) -> String {
    format!("http://localhost:{}", normalize_port(port))
}

pub fn api_root_url(port: u16) -> String {
    format!("{}/api/", base_url(port))
}

pub fn bbt_probe_url(port: u16) -> String {
    format!("{}/better-bibtex/cayw?probe=1", base_url(port))
}

/// 本地请求头：**不含 Origin**，UA 不以 Mozilla 开头。
/// 单测会断言这两点，防止后续有人「顺手」加浏览器头把 Zotero 10 打挂。
pub fn local_request_headers() -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT as UA};
    let mut h = HeaderMap::new();
    h.insert(ACCEPT, HeaderValue::from_static("*/*"));
    h.insert(UA, HeaderValue::from_static(USER_AGENT));
    h
}

/// 依次尝试多个候选响应头，取第一个非空值（不同 Zotero 版本头名不完全一致）
pub fn header_str(
    headers: &reqwest::header::HeaderMap,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(v) = headers.get(*key) {
            let s = v.to_str().unwrap_or("").trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn failed(
    state: ZoteroState,
    http_status: Option<u16>,
    port: u16,
    message: impl Into<String>,
) -> ZoteroHealth {
    ZoteroHealth {
        state,
        http_status,
        api_version: None,
        schema_version: None,
        server_id: None,
        zotero_version: None,
        can_write: false,
        bbt_available: false,
        port: normalize_port(port),
        checked_at: now_iso(),
        message: message.into(),
    }
}

/// 纯函数：状态码 + 响应头 → 健康结果。便于单测覆盖 7/10/403/400 等场景。
pub fn health_from_response(
    status: u16,
    headers: &reqwest::header::HeaderMap,
    bbt_available: bool,
    port: u16,
) -> ZoteroHealth {
    match status {
        403 => failed(
            ZoteroState::ApiDisabled,
            Some(status),
            port,
            "Zotero 本地 API 未开启（403）",
        ),
        400 => failed(
            ZoteroState::BadRequest,
            Some(status),
            port,
            "请求被 Zotero 拒绝（400）",
        ),
        200..=299 => {
            let server_id = header_str(headers, &["zotero-server-id", "Zotero-Server-ID"]);
            let api_version = header_str(headers, &["zotero-api-version", "Zotero-API-Version"]);
            let schema_version =
                header_str(headers, &["zotero-schema-version", "Zotero-Schema-Version"]);
            let zotero_version = header_str(
                headers,
                &[
                    "x-zotero-version",
                    "zotero-version",
                    "zotero-client-version",
                ],
            );
            // Server-ID 只在 Zotero 10+ 出现，是「本地可写」最可靠的判据；
            // 若某版本没给该头，再用客户端主版本兜底。
            let major = zotero_version
                .as_deref()
                .and_then(|v| v.split('.').next())
                .and_then(|v| v.trim().parse::<u32>().ok());
            let can_write = server_id.is_some() || major.is_some_and(|m| m >= 10);
            ZoteroHealth {
                state: ZoteroState::Connected,
                http_status: Some(status),
                api_version,
                schema_version,
                server_id,
                zotero_version,
                can_write,
                bbt_available,
                port: normalize_port(port),
                checked_at: now_iso(),
                message: "Zotero 本地 API 已连接（只读）".to_string(),
            }
        }
        other => failed(
            ZoteroState::Unavailable,
            Some(status),
            port,
            format!("Zotero 返回 HTTP {other}"),
        ),
    }
}

fn classify_transport_error(e: &reqwest::Error, port: u16) -> ZoteroHealth {
    if e.is_timeout() {
        failed(
            ZoteroState::Timeout,
            None,
            port,
            "连接 Zotero 超时（本地服务无响应）",
        )
    } else if e.is_connect() {
        failed(
            ZoteroState::Offline,
            None,
            port,
            "无法连接 Zotero 本地服务（Zotero 未启动或端口不对）",
        )
    } else {
        failed(
            ZoteroState::Unavailable,
            None,
            port,
            format!("连接 Zotero 失败：{e}"),
        )
    }
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        // 系统代理不应把 localhost:23119 转发出去
        .no_proxy()
        .build()
        .map_err(|e| format!("初始化 Zotero 客户端失败：{e}"))
}

/// 探测 Better BibTeX：`probe=1` 只返回 `ready`，不会弹出 Zotero 选择器。
/// 任何异常都视为「未安装」，绝不阻断主健康检查。
async fn probe_bbt(client: &reqwest::Client, port: u16) -> bool {
    let Ok(resp) = client
        .get(bbt_probe_url(port))
        .headers(local_request_headers())
        .send()
        .await
    else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    matches!(
        resp.text().await.as_deref().map(str::trim),
        Ok("ready")
    )
}

/// P0-3：连接自检。返回结构化事实，并把同一份结果广播为 `zotero:status` 事件。
#[tauri::command]
pub async fn zotero_health(app: AppHandle, port: u16) -> Result<ZoteroHealth, String> {
    let port = normalize_port(port);
    let client = build_client()?;
    let resp = match client
        .get(api_root_url(port))
        .headers(local_request_headers())
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let health = classify_transport_error(&e, port);
            let _ = app.emit(STATUS_EVENT, &health);
            return Ok(health);
        }
    };
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    let bbt = if (200..=299).contains(&status) {
        probe_bbt(&client, port).await
    } else {
        false
    };
    let health = health_from_response(status, &headers, bbt, port);
    let _ = app.emit(STATUS_EVENT, &health);
    Ok(health)
}

/// P0-3：单独探测 BBT（设置页「重新探测插件」按钮用；不依赖 /api/ 是否开启）
#[tauri::command]
pub async fn zotero_probe_bbt(port: u16) -> Result<bool, String> {
    let port = normalize_port(port);
    let client = build_client()?;
    Ok(probe_bbt(&client, port).await)
}

// ── P1 · 自动化同步（只读 HTTP + 受管 .bib 落盘） ───────────────────────────
//
// 分工：Rust 只负责「拿原始文本 / 原子写盘 / 发事件 / 配置与映射缓存 IO」；
// 所有解析、BibTeX 序列化、键映射与一致性诊断都是前端纯逻辑（zoteroSync.ts），
// 便于 Node 直测，也避免把业务判断散进两端。
// 铁律不变：不写 Zotero 库、不申请 local API key、主机固定 localhost。

/// Rust → 前端：受管 .bib 发生变化（P1）
pub const BIB_CHANGED_EVENT: &str = "zotero:bib-changed";
/// BBT pull export 端点前缀（collection 用 `?/0/<key>` 形式）
const BBT_EXPORT_BASE: &str = "/better-bibtex/collection?/0/";
/// 本地 API 默认不分页，大库会一次返回全量 → 强制 limit
const DEFAULT_ITEM_LIMIT: u32 = 500;
const MAX_ITEM_LIMIT: u32 = 1000;

/// Zotero itemKey / collectionKey 只接受字母数字（8 位），杜绝 URL 注入与路径穿越
pub fn safe_key(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(32)
        .collect()
}

fn clamp_limit(limit: u32) -> u32 {
    if limit == 0 {
        DEFAULT_ITEM_LIMIT
    } else {
        limit.min(MAX_ITEM_LIMIT)
    }
}

pub fn collections_url(port: u16, limit: u32) -> String {
    format!(
        "{}/api/users/0/collections?limit={}",
        base_url(port),
        clamp_limit(limit)
    )
}

pub fn items_url(port: u16, collection_key: Option<&str>, limit: u32) -> String {
    let n = clamp_limit(limit);
    match collection_key.map(str::trim).filter(|s| !s.is_empty()) {
        Some(k) => format!(
            "{}/api/users/0/collections/{}/items/top?format=json&limit={}",
            base_url(port),
            safe_key(k),
            n
        ),
        None => format!(
            "{}/api/users/0/items/top?format=json&limit={}",
            base_url(port),
            n
        ),
    }
}

/// `format` 只允许 bibtex / biblatex，其余回落 bibtex
pub fn bbt_export_url(port: u16, collection_key: &str, format: &str) -> String {
    let ext = if format.eq_ignore_ascii_case("biblatex") {
        "biblatex"
    } else {
        "bibtex"
    };
    format!(
        "{}{}{}.{}",
        base_url(port),
        BBT_EXPORT_BASE,
        safe_key(collection_key),
        ext
    )
}

/// GET 纯文本；403/400 单独给出可读提示，其余非 2xx 带状态码。
/// 前端拿到 Err 只写诊断卡/日志，**不阻断编译**。
async fn fetch_text(
    client: &reqwest::Client,
    url: &str,
    what: &str,
) -> Result<String, String> {
    let resp = client
        .get(url)
        .headers(local_request_headers())
        .send()
        .await
        .map_err(|e| format!("{what}请求失败：{e}"))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("{what}读取响应失败：{e}"))?;
    match status {
        200..=299 => Ok(body),
        403 => Err(format!("{what}：Zotero 本地 API 未开启（403）")),
        400 => Err(format!("{what}：请求被 Zotero 拒绝（400）")),
        other => Err(format!("{what}：Zotero 返回 HTTP {other}")),
    }
}

/// 项目级绑定：collection → 项目内 .bib（存 .ltex/config.json 的 zoteroBindings）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ZoteroBinding {
    pub collection_key: String,
    pub collection_name: String,
    /// 相对项目根（推荐）或项目内绝对路径；Rust 写盘时会校验不越界
    pub bib_path: String,
    /// "bibtex" | "biblatex"（仅 BBT pull export 用）
    pub format: String,
    pub enabled: bool,
}

impl Default for ZoteroBinding {
    fn default() -> Self {
        Self {
            collection_key: String::new(),
            collection_name: String::new(),
            bib_path: "references.bib".into(),
            format: "bibtex".into(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroWriteResult {
    /// 最终绝对路径
    pub path: String,
    /// 内容 sha256（前端据此做变更去重）
    pub hash: String,
    /// false = 磁盘内容与待写内容一致，未触碰文件
    pub written: bool,
    pub bytes: usize,
    pub message: String,
}

pub fn content_hash(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    hex::encode(h.finalize())
}

/// 解析绑定数组（容忍单个坏条目；旧配置缺字段走 serde default）
pub fn parse_bindings(value: Option<&Value>) -> Vec<ZoteroBinding> {
    let Some(arr) = value.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|v| serde_json::from_value::<ZoteroBinding>(v.clone()).ok())
        .filter(|b| !b.bib_path.trim().is_empty())
        .collect()
}

/// 绑定路径的通用合法性（外部 .bib 也要过这关，但不需要位于项目根内）
pub fn validate_binding_path(raw: &str) -> Result<(), String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("绑定路径为空".into());
    }
    if !s.to_ascii_lowercase().ends_with(".bib") {
        return Err("绑定文件必须以 .bib 结尾".into());
    }
    if s.contains("..") {
        return Err("绑定路径不允许 .. 上跳".into());
    }
    Ok(())
}

/// 写盘路径必须在项目根内：拒绝 `..`、拒绝非 .bib、拒绝根目录外绝对路径。
/// Windows canonicalize 返回 `\\?\` verbatim，故两端都 canonicalize 后再比前缀。
pub fn resolve_bib_path(root: &Path, bib_path: &str) -> Result<PathBuf, String> {
    let raw = bib_path.trim();
    validate_binding_path(raw)?;
    let p = Path::new(raw);
    let joined = if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    };
    let parent = joined
        .parent()
        .ok_or_else(|| format!("绑定路径无父目录：{raw}"))?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建绑定目录失败：{e}"))?;
    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("解析绑定目录失败：{e}"))?;
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("解析项目根失败：{e}"))?;
    if !canon_parent.starts_with(&canon_root) {
        return Err("绑定路径必须位于项目根内".into());
    }
    Ok(joined)
}

fn write_project_obj(root: &Path, obj: &Map<String, Value>) -> Result<(), String> {
    let cfg_path = project_json_path(root);
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建 .ltex 失败：{e}"))?;
    }
    let out = serde_json::to_string_pretty(obj).map_err(|e| format!("序列化配置失败：{e}"))?;
    std::fs::write(&cfg_path, out).map_err(|e| format!("写入配置失败：{e}"))
}

fn map_json_path(root: &Path) -> PathBuf {
    root.join(".ltex").join("zotero").join("map.json")
}

/// P1-1：拉取 collection 列表（原始 JSON 文本，解析放前端纯逻辑）
#[tauri::command]
pub async fn zotero_fetch_collections(port: u16) -> Result<String, String> {
    let client = build_client()?;
    fetch_text(
        &client,
        &collections_url(port, 100),
        "读取 Zotero 分类",
    )
    .await
}

/// P1-6 / P1-9：拉取题录（原始 JSON 文本）。collection_key 为空 = 全库 top-level。
#[tauri::command]
pub async fn zotero_fetch_items(
    port: u16,
    collection_key: Option<String>,
    limit: Option<u32>,
) -> Result<String, String> {
    let client = build_client()?;
    let url = items_url(port, collection_key.as_deref(), limit.unwrap_or(0));
    fetch_text(&client, &url, "读取 Zotero 题录").await
}

/// P1-8：BBT pull export 主动拉取（不依赖用户在 Zotero 侧配 Keep updated）
#[tauri::command]
pub async fn zotero_fetch_bbt_export(
    port: u16,
    collection_key: String,
    format: Option<String>,
) -> Result<String, String> {
    let client = build_client()?;
    let key = safe_key(&collection_key);
    if key.is_empty() {
        return Err("collection key 为空".into());
    }
    let url = bbt_export_url(port, &key, format.as_deref().unwrap_or("bibtex"));
    fetch_text(&client, &url, "BBT 导出").await
}

/// P1-3/4：把同步得到的 BibTeX 原子写入项目内 .bib。
/// 内容未变则不写盘（避免无谓 reindex）；写盘前登记 selfWrite，watcher 收到的回显会被抑制。
#[tauri::command]
pub fn zotero_write_bib(
    app: AppHandle,
    state: State<'_, Arc<ZoteroWatchState>>,
    root: String,
    bib_path: String,
    content: String,
) -> Result<ZoteroWriteResult, String> {
    let root_p = Path::new(&root);
    if !root_p.is_dir() {
        return Err(format!("项目根不存在：{root}"));
    }
    let target = resolve_bib_path(root_p, &bib_path)?;
    let hash = content_hash(&content);
    let old = std::fs::read_to_string(&target).ok();
    let written = old.as_deref() != Some(content.as_str());
    if written {
        // 先登记再写：watcher 的 rename 事件到达时按 hash 精确抑制
        state.note_self_write(&hash);
        state.set_last_hash(&target, &hash);
        write_file(
            target.to_string_lossy().into_owned(),
            content.clone(),
            Some(WriteOptions {
                // 受管 .bib 恒定 UTF-8 + LF：中文项目配 biber 才不会乱码
                encoding: Some("utf-8".into()),
                eol: Some("\n".into()),
            }),
        )?;
        let payload = BibChanged {
            path: target.to_string_lossy().into_owned(),
            hash: hash.clone(),
            reason: "sync".into(),
        };
        let _ = app.emit(BIB_CHANGED_EVENT, &payload);
    }
    Ok(ZoteroWriteResult {
        path: target.to_string_lossy().into_owned(),
        hash,
        written,
        bytes: content.len(),
        message: if written {
            "已写入受管 .bib".into()
        } else {
            "内容未变化，未写盘".into()
        },
    })
}

/// P1-1：读项目级绑定
#[tauri::command]
pub fn zotero_get_bindings(root: String) -> Result<Vec<ZoteroBinding>, String> {
    let obj = read_project_obj(Path::new(&root));
    Ok(parse_bindings(obj.get("zoteroBindings")))
}

/// P1-1：写项目级绑定（读改写，保留 engine/modules 等其它键）
#[tauri::command]
pub fn zotero_set_bindings(root: String, bindings: Vec<ZoteroBinding>) -> Result<(), String> {
    let root_p = Path::new(&root);
    if !root_p.is_dir() {
        return Err(format!("项目根不存在：{root}"));
    }
    // 只校验格式：外部 .bib 允许「仅监听 + 索引」（由 BBT Keep updated 写盘），
    // 真正写盘时 zotero_write_bib 会用 resolve_bib_path 再校验必须位于项目内。
    for b in &bindings {
        validate_binding_path(&b.bib_path)?;
    }
    let mut obj = read_project_obj(root_p);
    if bindings.is_empty() {
        obj.remove("zoteroBindings");
    } else {
        let v = serde_json::to_value(&bindings).map_err(|e| format!("序列化绑定失败：{e}"))?;
        obj.insert("zoteroBindings".into(), v);
    }
    write_project_obj(root_p, &obj)
}

/// P1-6：读 citekey ↔ itemKey 映射缓存（.ltex/zotero/map.json）
#[tauri::command]
pub fn zotero_load_map(root: String) -> Result<Option<String>, String> {
    let p = map_json_path(Path::new(&root));
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取键映射缓存失败：{e}")),
    }
}

/// P1-6：写映射缓存（校验 JSON 合法性；.ltex 被项目 watcher 忽略，不会引发树刷新风暴）
#[tauri::command]
pub fn zotero_save_map(root: String, json: String) -> Result<(), String> {
    let root_p = Path::new(&root);
    if !root_p.is_dir() {
        return Err(format!("项目根不存在：{root}"));
    }
    serde_json::from_str::<Value>(&json).map_err(|e| format!("键映射不是合法 JSON：{e}"))?;
    let p = map_json_path(root_p);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    }
    write_file(
        p.to_string_lossy().into_owned(),
        json,
        Some(WriteOptions {
            encoding: Some("utf-8".into()),
            eol: Some("\n".into()),
        }),
    )
}

// ── P2 · 沉浸式插入（Citation Picker 的只读搜索出口） ─────────────────────
//
// Zotero 本地 API 不施加默认/最大 limit，省略会一次返回全库；Total-Results
// 响应头给出匹配总数供前端分页。所有查询参数经 reqwest::Url 编码（中文/空格/&），
// 主机仍固定 localhost；本期依旧零写请求、零 local API key。

const PICKER_DEFAULT_LIMIT: u32 = 30;
const PICKER_MAX_LIMIT: u32 = 100;
const PICKER_MAX_START: u32 = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroSearchResult {
    /// 本地 API 返回的 items JSON 原文（解析放前端 zoteroPicker.ts 纯逻辑）
    pub items: String,
    /// Total-Results 响应头；缺失 / 非法为 None
    pub total: Option<u32>,
}

fn clamp_picker_limit(limit: u32) -> u32 {
    if limit == 0 {
        PICKER_DEFAULT_LIMIT
    } else {
        limit.min(PICKER_MAX_LIMIT)
    }
}

/// qmode 只允许官方两个取值，其余回落 titleCreatorYear，避免把任意串拼进 URL
pub fn search_url(port: u16, q: &str, qmode: &str, limit: u32, start: u32) -> String {
    let mut url = reqwest::Url::parse(&format!(
        "{}/api/users/0/items/top",
        base_url(port)
    ))
    .expect("base_url 恒为合法 URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("format", "json");
        pairs.append_pair("q", q.trim());
        pairs.append_pair(
            "qmode",
            if qmode.eq_ignore_ascii_case("everything") {
                "everything"
            } else {
                "titleCreatorYear"
            },
        );
        pairs.append_pair("limit", &clamp_picker_limit(limit).to_string());
        pairs.append_pair("start", &start.min(PICKER_MAX_START).to_string());
    }
    url.to_string()
}

/// 与 fetch_text 同样的 403/400 归一，额外透传 Total-Results 头。
async fn fetch_search(
    client: &reqwest::Client,
    url: &str,
) -> Result<ZoteroSearchResult, String> {
    let resp = client
        .get(url)
        .headers(local_request_headers())
        .send()
        .await
        .map_err(|e| format!("搜索 Zotero 题录请求失败：{e}"))?;
    let status = resp.status().as_u16();
    let total = resp
        .headers()
        .get("total-results")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u32>().ok());
    let items = resp
        .text()
        .await
        .map_err(|e| format!("搜索 Zotero 题录读取响应失败：{e}"))?;
    match status {
        200..=299 => Ok(ZoteroSearchResult { items, total }),
        403 => Err("搜索 Zotero 题录：Zotero 本地 API 未开启（403）".into()),
        400 => Err("搜索 Zotero 题录：请求被 Zotero 拒绝（400）".into()),
        other => Err(format!("搜索 Zotero 题录：Zotero 返回 HTTP {other}")),
    }
}

/// P2-2：Picker 的全库搜索。离线 / 403 由前端吞掉并回落到本地 .bib 索引。
#[tauri::command]
pub async fn zotero_search(
    port: u16,
    q: String,
    qmode: Option<String>,
    limit: Option<u32>,
    start: Option<u32>,
) -> Result<ZoteroSearchResult, String> {
    if q.trim().is_empty() {
        return Err("搜索词为空".into());
    }
    let client = build_client()?;
    let url = search_url(
        port,
        &q,
        qmode.as_deref().unwrap_or("everything"),
        limit.unwrap_or(0),
        start.unwrap_or(0),
    );
    fetch_search(&client, &url).await
}

// ── P3-1b · 附件清单（只读，供 zotero://open-pdf 定位 PDF 附件） ──────────────
//
// open-pdf 协议需要「附件」itemKey，而 map.json 里存的是父条目 itemKey；
// 因此先查本地 API 的 /children 拿子项列表（纯 GET、零写、无需 API key），
// 由前端纯逻辑筛出 PDF 附件。仍然只允许 localhost + 8 位 itemKey。
const CHILDREN_DEFAULT_LIMIT: u32 = 50;
const CHILDREN_MAX_LIMIT: u32 = 100;

fn clamp_children_limit(limit: u32) -> u32 {
    if limit == 0 {
        CHILDREN_DEFAULT_LIMIT
    } else {
        limit.min(CHILDREN_MAX_LIMIT)
    }
}

/// 与前端 isItemKey 同口径：8 位字母数字，杜绝把 citekey 拼进 API 路径
pub fn is_item_key(raw: &str) -> bool {
    let s = raw.trim();
    s.len() == 8 && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// /children 固定个人库 + 显式 limit（本地 API 省略 limit 会返回全量子项）
pub fn children_url(port: u16, parent_key: &str, limit: u32) -> String {
    format!(
        "{}/api/users/0/items/{}/children?format=json&limit={}",
        base_url(port),
        safe_key(parent_key),
        clamp_children_limit(limit)
    )
}

/// P3-1b：读取某个父条目的子项原始 JSON（附件 / 笔记），解析放前端纯逻辑。
#[tauri::command]
pub async fn zotero_fetch_children(
    port: u16,
    parent_key: String,
    limit: Option<u32>,
) -> Result<String, String> {
    let key = parent_key.trim();
    if !is_item_key(key) {
        return Err("父条目 itemKey 非法（必须是 8 位字母数字）".into());
    }
    let client = build_client()?;
    let url = children_url(port, key, limit.unwrap_or(0));
    fetch_text(&client, &url, "读取 Zotero 附件清单").await
}

/// P3-2：`/file/view/url` 固定个人库 + 附件 key，返回 file:// URL 文本。
fn attachment_file_url(port: u16, attachment_key: &str) -> String {
    format!(
        "{}/api/users/0/items/{}/file/view/url",
        base_url(port),
        attachment_key
    )
}

/// 把 Zotero 返回的 file:// URL 转成 asset 协议可读取的本地路径（不做存在性检查，便于单测）。
fn file_url_to_path(raw: &str) -> Result<String, String> {
    let s = raw.trim().trim_matches('"').trim();
    if s.is_empty() {
        return Err("Zotero 附件路径为空".into());
    }
    let u = reqwest::Url::parse(s).map_err(|e| format!("Zotero 附件路径不是合法 URL：{e}"))?;
    if u.scheme() != "file" {
        return Err(format!("Zotero 附件路径不是 file:// 协议（{}）", u.scheme()));
    }
    let p = u
        .to_file_path()
        .map_err(|_| "Zotero 附件 file:// URL 无法转为本地路径".to_string())?;
    Ok(p.to_string_lossy().to_string())
}

/// P3-2：读取附件本地路径（只读 GET + 路径归一 + 存在性检查），供前端 asset 协议内嵌预览。
#[tauri::command]
pub async fn zotero_attachment_path(
    port: u16,
    attachment_key: String,
) -> Result<String, String> {
    let key = attachment_key.trim();
    if !is_item_key(key) {
        return Err("附件 itemKey 非法（必须是 8 位字母数字）".into());
    }
    let client = build_client()?;
    let raw = fetch_text(
        &client,
        &attachment_file_url(port, key),
        "读取 Zotero 附件路径",
    )
    .await?;
    let path = file_url_to_path(&raw)?;
    if !Path::new(&path).is_file() {
        return Err(format!("Zotero 附件文件不存在：{path}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            // 测试夹具的 key 是短生命周期 &str；insert 要求 IntoHeaderName: 'static，
            // 故先构造拥有所有权的 HeaderName
            let name = reqwest::header::HeaderName::from_bytes(k.as_bytes()).unwrap();
            h.insert(name, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn port_zero_falls_back_to_default() {
        assert_eq!(normalize_port(0), DEFAULT_PORT);
        assert_eq!(normalize_port(23119), 23119);
        assert_eq!(normalize_port(24119), 24119);
    }

    #[test]
    fn urls_always_pin_localhost() {
        assert_eq!(base_url(0), "http://localhost:23119");
        assert_eq!(api_root_url(0), "http://localhost:23119/api/");
        assert_eq!(
            bbt_probe_url(24119),
            "http://localhost:24119/better-bibtex/cayw?probe=1"
        );
        // 不接受任意主机：函数签名只有端口，URL 里不可能出现别的 host
        assert!(!api_root_url(23119).contains("127.0.0.1"));
    }

    #[test]
    fn request_headers_have_no_origin_or_browser_ua() {
        let h = local_request_headers();
        assert!(h.get("origin").is_none());
        assert!(h.get("referer").is_none());
        let ua = h
            .get(reqwest::header::USER_AGENT)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(!ua.starts_with("Mozilla"));
        assert!(ua.starts_with("Zetla/"));
    }

    #[test]
    fn header_str_tries_candidates_and_skips_blank() {
        let h = headers(&[
            ("zotero-api-version", "3"),
            ("x-zotero-version", "  "),
            ("zotero-version", "7.0.11"),
            ("zotero-server-id", "sPMHtLD6HHBd"),
        ]);
        assert_eq!(header_str(&h, &["zotero-api-version"]).as_deref(), Some("3"));
        assert_eq!(
            header_str(&h, &["missing", "zotero-version"]).as_deref(),
            Some("7.0.11")
        );
        assert_eq!(header_str(&h, &["missing"]), None);
        assert_eq!(
            header_str(&h, &["zotero-server-id"]).as_deref(),
            Some("sPMHtLD6HHBd")
        );
    }

    #[test]
    fn zotero_10_response_has_server_id_and_write_capability() {
        let h = headers(&[
            ("zotero-api-version", "3"),
            ("zotero-schema-version", "2026-01-01"),
            ("zotero-server-id", "sPMHtLD6HHBd"),
            ("x-zotero-version", "10.0.8"),
        ]);
        let got = health_from_response(200, &h, true, 23119);
        assert_eq!(got.state, ZoteroState::Connected);
        assert_eq!(got.http_status, Some(200));
        assert_eq!(got.api_version.as_deref(), Some("3"));
        assert_eq!(got.schema_version.as_deref(), Some("2026-01-01"));
        assert_eq!(got.server_id.as_deref(), Some("sPMHtLD6HHBd"));
        assert_eq!(got.zotero_version.as_deref(), Some("10.0.8"));
        assert!(got.can_write);
        assert!(got.bbt_available);
        assert_eq!(got.port, 23119);
        assert!(!got.checked_at.is_empty());
    }

    #[test]
    fn zotero_7_response_is_readonly_without_server_id() {
        let h = headers(&[
            ("zotero-api-version", "3"),
            ("x-zotero-version", "7.0.11"),
        ]);
        let got = health_from_response(204, &h, false, 23119);
        assert_eq!(got.state, ZoteroState::Connected);
        assert!(got.server_id.is_none());
        assert!(!got.can_write);
        assert!(!got.bbt_available);
    }

    #[test]
    fn major_version_alone_can_mark_write_capability() {
        let h = headers(&[("x-zotero-version", "10.0.0-beta.1")]);
        assert!(health_from_response(200, &h, false, 0).can_write);
        let h7 = headers(&[("x-zotero-version", "9.1")]);
        assert!(!health_from_response(200, &h7, false, 0).can_write);
    }

    #[test]
    fn error_status_are_classified() {
        assert_eq!(
            health_from_response(403, &HeaderMap::new(), false, 0).state,
            ZoteroState::ApiDisabled
        );
        assert_eq!(
            health_from_response(400, &HeaderMap::new(), false, 0).state,
            ZoteroState::BadRequest
        );
        assert_eq!(
            health_from_response(500, &HeaderMap::new(), false, 0).state,
            ZoteroState::Unavailable
        );
        let api_off = health_from_response(403, &HeaderMap::new(), true, 0);
        assert!(!api_off.bbt_available); // 失败态一律不宣称 BBT 在线
        assert_eq!(api_off.http_status, Some(403));
    }

    #[test]
    fn health_serializes_to_camel_case() {
        let h = health_from_response(200, &HeaderMap::new(), false, 0);
        let json = serde_json::to_value(&h).unwrap();
        assert_eq!(json["state"], "connected");
        assert!(json.get("httpStatus").is_some());
        assert!(json.get("serverId").is_some());
        assert!(json.get("bbtAvailable").is_some());
        assert!(json.get("canWrite").is_some());
        assert!(json.get("checkedAt").is_some());
        assert!(json.get("http_status").is_none());
        assert_eq!(
            serde_json::to_value(ZoteroState::ApiDisabled).unwrap(),
            "api-disabled"
        );
    }

    // ── P1 纯逻辑 ──────────────────────────────────────────────
    #[test]
    fn p1_urls_pin_localhost_and_limit() {
        assert_eq!(
            collections_url(0, 100),
            "http://localhost:23119/api/users/0/collections?limit=100"
        );
        assert_eq!(
            collections_url(0, 0),
            "http://localhost:23119/api/users/0/collections?limit=500"
        );
        assert_eq!(
            items_url(23119, None, 0),
            "http://localhost:23119/api/users/0/items/top?format=json&limit=500"
        );
        assert_eq!(
            items_url(23119, Some("ABCD1234"), 50),
            "http://localhost:23119/api/users/0/collections/ABCD1234/items/top?format=json&limit=50"
        );
        assert_eq!(
            items_url(23119, Some("  "), 0),
            "http://localhost:23119/api/users/0/items/top?format=json&limit=500"
        );
        assert!(items_url(23119, None, 99999).contains("limit=1000"));
        assert_eq!(
            bbt_export_url(23119, "ABCD1234", "biblatex"),
            "http://localhost:23119/better-bibtex/collection?/0/ABCD1234.biblatex"
        );
        assert_eq!(
            bbt_export_url(23119, "ABCD1234", "other"),
            "http://localhost:23119/better-bibtex/collection?/0/ABCD1234.bibtex"
        );
    }

    #[test]
    fn safe_key_strips_injection_and_traversal() {
        assert_eq!(safe_key("AB12CD34"), "AB12CD34");
        assert_eq!(safe_key("../etc/passwd"), "etcpasswd");
        assert_eq!(safe_key("AB12?&x=1"), "AB12x1");
        assert_eq!(safe_key("中文KEY"), "KEY");
        assert_eq!(safe_key(""), "");
    }

    #[test]
    fn content_hash_is_stable_and_sensitive() {
        assert_eq!(content_hash("@article{a,title={x}}"), content_hash("@article{a,title={x}}"));
        assert_ne!(content_hash("a"), content_hash("b"));
        assert_eq!(content_hash("a").len(), 64);
    }

    #[test]
    fn parse_bindings_tolerates_bad_entries_and_uses_defaults() {
        let v = serde_json::json!([
            {"collectionKey": "AB12CD34", "collectionName": "论文", "bibPath": "refs.bib"},
            {"collectionKey": "BAD", "bibPath": ""},
            "not-an-object",
            {"bibPath": "fallback.bib"}
        ]);
        let b = parse_bindings(Some(&v));
        assert_eq!(b.len(), 2); // 空路径与坏类型被丢弃
        assert_eq!(b[0].collection_key, "AB12CD34");
        assert_eq!(b[0].collection_name, "论文");
        assert_eq!(b[0].bib_path, "refs.bib");
        assert_eq!(b[0].format, "bibtex"); // serde default
        assert!(b[0].enabled);
        assert_eq!(b[1].bib_path, "fallback.bib");
        assert!(parse_bindings(None).is_empty());
        assert!(parse_bindings(Some(&serde_json::json!({"a": 1}))).is_empty());
    }

    #[test]
    fn bindings_serialize_to_camel_case() {
        let b = ZoteroBinding::default();
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["collectionKey"], "");
        assert_eq!(v["bibPath"], "references.bib");
        assert_eq!(v["format"], "bibtex");
        assert_eq!(v["enabled"], true);
        assert!(v.get("collection_key").is_none());
    }

    #[test]
    fn resolve_bib_path_rejects_unsafe_and_accepts_in_root() {
        let dir = std::env::temp_dir().join(format!(
            "zetla_zotero_p1_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // 相对路径：允许并创建父目录
        let ok = resolve_bib_path(&dir, "refs/references.bib").unwrap();
        assert!(ok.starts_with(&dir));
        assert!(ok.parent().unwrap().is_dir());
        // 绝对且在项目内：允许
        let inside = dir.join("absolute.bib");
        assert!(resolve_bib_path(&dir, &inside.to_string_lossy()).is_ok());
        // 越界绝对路径：拒绝
        let outside = std::env::temp_dir().join("zetla_zotero_outside.bib");
        assert!(resolve_bib_path(&dir, &outside.to_string_lossy()).is_err());
        // 非法输入
        assert!(resolve_bib_path(&dir, "").is_err());
        assert!(resolve_bib_path(&dir, "refs.bibtex").is_err());
        assert!(resolve_bib_path(&dir, "../escape.bib").is_err());
        assert!(resolve_bib_path(&dir, "refs/../escape.bib").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn event_name_matches_watcher_module() {
        assert_eq!(
            BIB_CHANGED_EVENT,
            crate::commands::zotero_watch::BIB_CHANGED_EVENT
        );
    }

    #[test]
    fn picker_search_url_pins_localhost_and_encodes_query() {
        let u = search_url(0, "深度学习 & 综述", "everything", 0, 0);
        assert!(u.starts_with("http://localhost:23119/api/users/0/items/top?"));
        assert!(u.contains("format=json"));
        assert!(u.contains("qmode=everything"));
        assert!(u.contains("limit=30"));
        assert!(u.contains("start=0"));
        // 中文与 & 必须被百分号编码，不能原样拼进 URL；主机绝不出现 127.0.0.1
        assert!(!u.contains("深度学习"));
        assert!(!u.contains("&综述"));
        assert!(!u.contains("127.0.0.1"));
        assert!(u.contains("%"));
    }

    #[test]
    fn picker_search_url_clamps_limit_start_and_qmode() {
        let u = search_url(24119, "  Doe  ", "bogus", 999, 999_999);
        assert!(u.contains("localhost:24119"));
        assert!(u.contains("q=Doe"));
        assert!(u.contains("qmode=titleCreatorYear"));
        assert!(u.contains("limit=100"));
        assert!(u.contains("start=100000"));
        assert_eq!(clamp_picker_limit(0), PICKER_DEFAULT_LIMIT);
        assert_eq!(clamp_picker_limit(1), 1);
        assert_eq!(clamp_picker_limit(101), PICKER_MAX_LIMIT);
    }

    // ── P3-1b · 附件清单端点 ────────────────────────────────────────────
    #[test]
    fn children_url_pins_localhost_and_clamps_limit() {
        assert_eq!(
            children_url(0, "AB12CD34", 0),
            "http://localhost:23119/api/users/0/items/AB12CD34/children?format=json&limit=50"
        );
        let u = children_url(24119, "AB12CD34", 999);
        assert!(u.starts_with("http://localhost:24119/api/users/0/items/AB12CD34/children?"));
        assert!(u.contains("limit=100"));
        assert!(!u.contains("127.0.0.1"));
    }

    #[test]
    fn children_url_strips_injected_key_and_query() {
        // safe_key 只保留字母数字并截断，路径穿越 / &limit= 注入都不可能生效
        assert_eq!(
            children_url(23119, "../../etc/passwd", 10),
            "http://localhost:23119/api/users/0/items/etcpasswd/children?format=json&limit=10"
        );
        assert_eq!(
            children_url(23119, "AB12CD34&limit=99999", 10),
            "http://localhost:23119/api/users/0/items/AB12CD34limit99999/children?format=json&limit=10"
        );
    }

    #[test]
    fn item_key_gate_rejects_citekeys() {
        assert!(is_item_key("AB12CD34"));
        assert!(is_item_key("abcdefgh"));
        assert!(!is_item_key("doe2020deep"));
        assert!(!is_item_key("AB12CD3"));
        assert!(!is_item_key("AB12CD345"));
        assert!(!is_item_key("AB12-D34"));
        assert!(!is_item_key(""));
        // 命令入口用的是 trim 后的 gate：前后空白不算非法
        assert!(is_item_key("  AB12CD34  "));
    }

    #[test]
    fn attachment_file_url_pins_localhost_and_attachment_key() {
        assert_eq!(
            attachment_file_url(0, "AB12CD34"),
            "http://localhost:23119/api/users/0/items/AB12CD34/file/view/url"
        );
        assert_eq!(
            attachment_file_url(24119, "EF56GH78"),
            "http://localhost:24119/api/users/0/items/EF56GH78/file/view/url"
        );
    }

    #[test]
    fn file_url_to_path_decodes_and_rejects_non_file() {
        let p = file_url_to_path("  \"file:///C:/Zotero/storage/AB12CD34/paper%20one.pdf\"  ")
            .unwrap();
        assert!(p.contains("paper one.pdf"), "URL 编码应还原为空格");
        assert!(!p.contains("file://"), "返回的是本地路径而不是 URL");
        assert!(file_url_to_path("").is_err());
        assert!(file_url_to_path("https://example.org/x.pdf").is_err());
        assert!(file_url_to_path("not a url").is_err());
    }
}
