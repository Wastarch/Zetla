// LaTeX 工作台 · Rust 内核入口
// 职责：编译引擎 / 模板引擎 / 项目管理 / 文件IO / 事件分发（见 docs/开发文档.md §3）
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // M0-4：文件对话框（打开 .tex / 选项目文件夹）
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // 基础设施（M0-1）
            commands::core::ping,
            // 持久层（M0-2）
            commands::fsdoc::read_file,
            commands::fsdoc::write_file,
            commands::fsdoc::revert_file,
            // 编译引擎（M0-3a）
            commands::compile::detect_tex_distribution,
            // 项目管理（M0-6）
            commands::project::scan_project,
            commands::project::create_entry,
            commands::project::remove_entry,
            commands::project::rename_entry,
            commands::project::copy_entry,
            // M0-2+ 逐步注册：
            // detect_tex_distribution, compile_project, cancel_compile, parse_tex_log,
            // list_templates, get_template, create_project, import_template,
            // scan_project, read_file, write_file, revert_file, clean_aux
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
