// LaTeX 工作台 · Rust 内核入口
// 职责：编译引擎 / 模板引擎 / 项目管理 / 文件IO / 事件分发（见 docs/开发文档.md §3）
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // 基础设施（M0-1）
            commands::core::ping,
            // M0-2+ 逐步注册：
            // detect_tex_distribution, compile_project, cancel_compile, parse_tex_log,
            // list_templates, get_template, create_project, import_template,
            // scan_project, read_file, write_file, revert_file, clean_aux
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
