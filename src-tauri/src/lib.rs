// LaTeX 工作台 · Rust 内核入口
// 职责：编译引擎 / 模板引擎 / 项目管理 / 文件IO / 事件分发（见 docs/开发文档.md §3）
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // M1-13：清掉上次残留的临时安装包
    commands::updater::cleanup_update_temp();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // M0-4：文件对话框（打开 .tex / 选项目文件夹）
        .plugin(tauri_plugin_dialog::init())
        // M0-9：编译任务状态（单并发 + 取消句柄）
        .manage(std::sync::Arc::new(
            commands::compile::CompileState::default(),
        ))
        // M0-15b：TeX 自动安装状态（单并发 + 取消句柄）
        .manage(std::sync::Arc::new(
            commands::envsetup::TexInstallState::default(),
        ))
        // M0-9a：项目目录监听（资源树自动刷新）
        .manage(std::sync::Arc::new(commands::watch::WatchState::default()))
        // M1-4：SyncTeX 索引缓存（正/反向跳转查询）
        .manage(std::sync::Arc::new(
            commands::synctex::SyncTexState::default(),
        ))
        .invoke_handler(tauri::generate_handler![
            // 基础设施（M0-1）
            commands::core::ping,
            // 应用配置/偏好设置（M0-14a）
            commands::config::load_app_config,
            commands::config::save_app_config,
            // 持久层（M0-2）
            commands::fsdoc::read_file,
            commands::fsdoc::write_file,
            commands::fsdoc::revert_file,
            // M1-9：清理 LaTeX 辅助文件
            commands::fsdoc::clean_aux,
            // 编译引擎（M0-3a）
            commands::compile::detect_tex_distribution,
            // TeX 自动安装（M0-15b/c）
            commands::envsetup::install_tex,
            commands::envsetup::cancel_tex_install,
            commands::envsetup::adopt_tex_install,
            // 多遍编译（M0-9）
            commands::compile::compile_project,
            commands::compile::cancel_compile,
            // 日志解析（M0-11）
            commands::logparse::parse_tex_log,
            // SyncTeX 双向跳转（M1-4）
            commands::synctex::synctex_view,
            commands::synctex::synctex_edit,
            // 模板引擎（M0-7）
            commands::template::list_templates,
            commands::template::get_template,
            commands::template::create_project,
            // M1-15e：模板库管理（另存为 / 导入）
            commands::template::save_as_template,
            commands::template::import_template,
            commands::template::delete_template,
            // 项目管理（M0-6）
            commands::project::scan_project,
            commands::project::create_entry,
            commands::project::remove_entry,
            commands::project::rename_entry,
            commands::project::copy_entry,
            // R5 图片目录设置（M1-7）
            commands::project::save_project_config,
            // M1-15c：项目配置读写（可视化设置面板）
            commands::project::get_project_config,
            commands::project::update_project_config,
            // M1-15d：项目生命周期（重命名 / 删除 / 导出 zip）
            commands::project::rename_project,
            commands::project::delete_project,
            commands::project::export_project,
            // M1-15a：项目注册表（最近/置顶/归档）
            commands::project_mgmt::register_recent_project,
            commands::project_mgmt::list_recent_projects,
            commands::project_mgmt::pin_project,
            commands::project_mgmt::archive_project,
            // R5 拖拽图片导入（M1-7）
            commands::image::import_image,
            commands::image::import_image_from_path,
            // 项目目录监听（M0-9a）
            commands::watch::watch_project,
            commands::watch::unwatch_project,
            // M1-13：自动更新（自下载安装包 + 拉起安装向导）
            commands::updater::download_app_update,
            commands::updater::fetch_latest_json,
            commands::updater::launch_installer_and_exit,
            // M0-2+ 逐步注册：
            // list_templates, get_template, create_project, import_template,
            // scan_project, read_file, write_file, revert_file
            // — clean_aux 已于 M1-9 注册
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
