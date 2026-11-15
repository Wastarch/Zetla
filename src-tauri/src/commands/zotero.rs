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
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

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
}
