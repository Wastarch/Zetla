// 基础设施命令（M0-1 IPC 往返验证）
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingReply {
    pub msg: String,
    /// Unix 毫秒时间戳
    pub ts: u64,
}

/// 验证前端 ↔ 内核 IPC 往返
#[tauri::command]
pub fn ping() -> PingReply {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    PingReply {
        msg: "pong from Rust kernel".to_string(),
        ts,
    }
}
