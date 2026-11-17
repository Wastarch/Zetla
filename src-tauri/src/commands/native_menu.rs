// macOS 原生菜单栏（M-macos-menu）：把窗口自绘的 文件/编辑/插入/构建/查看/模板/设置/帮助
// 菜单迁移到屏幕左上角的系统菜单栏（Zetla / 文件 / 编辑 / 插入 / 构建 / 查看 / 模板 / 设置 /
// 窗口 / 帮助），窗口内自绘菜单栏随之隐藏（前端 darwin 分支，见 zetla.css）。
//
// 事件桥：菜单项点击 → emit("menu-action", id) → 前端 src/ui/nativeMenuBridge.ts 查
// src/ui/menuActions.ts 的共享动作表分发（与 Windows 自绘菜单同一份 handler）。
// 原生菜单不随前端状态刷新置灰（静态构建），点击时由动作表 enabled() 兜底拦截。
//
// 仅 macOS：全部代码 #[cfg(target_os = "macos")] 隔离，Windows/Linux 构建不编译本文件。
// 注意：本文件无法在 Windows 本机编译验证，全部签名已按 docs.rs tauri 2 核对
// （Submenu::with_items / MenuItem::with_id / PredefinedMenuItem::* / MenuId(pub String) /
//   AppHandle::set_menu / AppHandle::on_menu_event）。
#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Wry,
};

#[cfg(target_os = "macos")]
type App = AppHandle<Wry>;

#[cfg(target_os = "macos")]
fn mi(app: &App, id: &str, label: &str, accel: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, id, label, true, accel)
}

#[cfg(target_os = "macos")]
fn sep(app: &App) -> tauri::Result<PredefinedMenuItem<Wry>> {
    PredefinedMenuItem::separator(app)
}

/// 安装 macOS 原生应用菜单（替换 Tauri 默认英文菜单）。lib.rs setup 中调用。
#[cfg(target_os = "macos")]
pub fn install(app: &App) -> tauri::Result<()> {
    // ── Zetla 应用菜单（macOS 惯例：关于 / 偏好设置 / 退出） ──
    // 退出走自定义项（事件桥 → 前端 getCurrentWindow().close()）：确保触发窗口
    // close-requested 的未保存确认；PredefinedMenuItem::quit 的系统 terminate 可能绕过。
    let i_about = mi(app, "app.about", "关于 Zetla", None)?;
    let i_prefs = mi(app, "app.preferences", "偏好设置…", Some("CmdOrCtrl+,"))?;
    let i_quit = mi(app, "app.quit", "退出 Zetla", Some("CmdOrCtrl+Q"))?;
    let s_about = sep(app)?;
    let s_prefs = sep(app)?;
    let app_menu = Submenu::with_items(
        app,
        "Zetla",
        true,
        &[&i_about, &s_about, &i_prefs, &s_prefs, &i_quit],
    )?;

    // ── 文件 ──
    let f_new = mi(
        app,
        "file.new_project",
        "新建项目…",
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let f_open = mi(
        app,
        "file.open_project",
        "打开项目…",
        Some("CmdOrCtrl+Shift+O"),
    )?;
    let f_switch = mi(app, "file.switch_project", "切换项目…", Some("CmdOrCtrl+R"))?;
    let f_media = mi(app, "file.open_media", "打开图片 / PDF…", None)?;
    let f_close_proj = mi(app, "file.close_project", "关闭项目", None)?;
    let f_export = mi(app, "file.export_zip", "导出当前项目为 zip…", None)?;
    let f_sep1 = sep(app)?;
    let f_save = mi(app, "file.save", "保存", Some("CmdOrCtrl+S"))?;
    let f_save_all = mi(
        app,
        "file.save_all",
        "全部保存",
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let f_sep2 = sep(app)?;
    let f_close_tab = mi(app, "file.close_tab", "关闭标签", Some("CmdOrCtrl+W"))?;
    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &f_new,
            &f_open,
            &f_switch,
            &f_media,
            &f_close_proj,
            &f_export,
            &f_sep1,
            &f_save,
            &f_save_all,
            &f_sep2,
            &f_close_tab,
        ],
    )?;

    // ── 编辑 ──
    // 撤销/重做走自定义项（事件桥 → CM6 undo/redo）：PredefinedMenuItem::undo/redo
    // 触发的是 WebView 原生文本撤销，与 CM6 历史栈冲突，不能用。
    let e_undo = mi(app, "edit.undo", "撤销", Some("CmdOrCtrl+Z"))?;
    let e_redo = mi(app, "edit.redo", "重做", Some("CmdOrCtrl+Shift+Z"))?;
    let e_sep1 = sep(app)?;
    // 剪贴板四项为系统 Predefined（作用于 WebView 文本系统），label 显式给中文。
    let e_cut = PredefinedMenuItem::cut(app, Some("剪切"))?;
    let e_copy = PredefinedMenuItem::copy(app, Some("复制"))?;
    let e_paste = PredefinedMenuItem::paste(app, Some("粘贴"))?;
    let e_select_all = PredefinedMenuItem::select_all(app, Some("全选"))?;
    let e_sep2 = sep(app)?;
    let e_comment = mi(app, "edit.toggle_comment", "切换注释", Some("CmdOrCtrl+/"))?;
    let e_sep3 = sep(app)?;
    let e_snippet = mi(
        app,
        "edit.insert_snippet",
        "插入代码片段…",
        Some("CmdOrCtrl+Shift+Space"),
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &e_undo,
            &e_redo,
            &e_sep1,
            &e_cut,
            &e_copy,
            &e_paste,
            &e_select_all,
            &e_sep2,
            &e_comment,
            &e_sep3,
            &e_snippet,
        ],
    )?;

    // ── 插入 ──
    let ins_image = mi(app, "insert.image", "插入图片…", None)?;
    let ins_table = mi(app, "insert.table_editor", "表格编辑器…", None)?;
    let insert_menu = Submenu::with_items(app, "插入", true, &[&ins_image, &ins_table])?;

    // ── 构建 ──
    let b_start = mi(app, "build.start", "开始编译", Some("CmdOrCtrl+B"))?;
    let b_cancel = mi(app, "build.cancel", "终止编译", None)?;
    let b_sep = sep(app)?;
    let b_clean = mi(app, "build.clean_aux", "清理辅助文件", None)?;
    let b_preview = mi(app, "build.compile_preview", "编译并查看 PDF", None)?;
    let build_menu = Submenu::with_items(
        app,
        "构建",
        true,
        &[&b_start, &b_cancel, &b_sep, &b_clean, &b_preview],
    )?;

    // ── 查看 ──
    // 注意：原生菜单 accelerator 不支持 chord（Ctrl+B 0/1/… 编号键），切视图走本菜单项。
    let v_sidebar = mi(app, "view.toggle_sidebar", "切换侧栏", None)?;
    let v_explorer = mi(app, "view.explorer", "资源管理器", None)?;
    let v_outline = mi(app, "view.outline", "大纲", None)?;
    let v_math = mi(app, "view.math", "公式", None)?;
    let v_refs = mi(app, "view.references", "引用", None)?;
    let v_preview = mi(app, "view.toggle_preview", "切换 PDF 预览", None)?;
    let v_log = mi(app, "view.toggle_log", "切换日志面板", None)?;
    let v_sep1 = sep(app)?;
    let v_fwd = mi(app, "view.forward_sync", "跳到 PDF 中的位置", None)?;
    let v_sep2 = sep(app)?;
    let v_theme_auto = mi(app, "view.theme_auto", "主题跟随系统", None)?;
    let v_theme_toggle = mi(app, "view.theme_toggle", "切换明暗主题", None)?;
    let view_menu = Submenu::with_items(
        app,
        "查看",
        true,
        &[
            &v_sidebar,
            &v_explorer,
            &v_outline,
            &v_math,
            &v_refs,
            &v_preview,
            &v_log,
            &v_sep1,
            &v_fwd,
            &v_sep2,
            &v_theme_auto,
            &v_theme_toggle,
        ],
    )?;

    // ── 模板 ──
    let t_lib = mi(app, "template.library", "模板库", None)?;
    let t_sep = sep(app)?;
    let t_save = mi(app, "template.save_as", "另存当前项目为模板…", None)?;
    let template_menu = Submenu::with_items(app, "模板", true, &[&t_lib, &t_sep, &t_save])?;

    // ── 设置 ──（偏好设置在应用菜单；此处仅项目设置）
    let st_proj = mi(app, "project.settings", "项目设置…", None)?;
    let settings_menu = Submenu::with_items(app, "设置", true, &[&st_proj])?;

    // ── 窗口（系统 Predefined；关闭窗口走自定义项以复用未保存确认） ──
    let w_min = PredefinedMenuItem::minimize(app, Some("最小化"))?;
    let w_zoom = PredefinedMenuItem::maximize(app, Some("缩放"))?;
    let w_full = PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?;
    let w_close = mi(app, "app.close_window", "关闭窗口", Some("CmdOrCtrl+Shift+W"))?;
    let w_sep = sep(app)?;
    let w_bring = PredefinedMenuItem::bring_all_to_front(app, Some("前置全部窗口"))?;
    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[&w_min, &w_zoom, &w_full, &w_close, &w_sep, &w_bring],
    )?;

    // ── 帮助 ──
    let h_updates = mi(app, "help.check_updates", "检查更新", None)?;
    let h_env = mi(app, "help.env_check", "TeX 环境检测…", None)?;
    let h_log = mi(app, "help.open_log", "查看日志文件", None)?;
    let help_menu = Submenu::with_items(app, "帮助", true, &[&h_updates, &h_env, &h_log])?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &insert_menu,
            &build_menu,
            &view_menu,
            &template_menu,
            &settings_menu,
            &window_menu,
            &help_menu,
        ],
    )?;
    app.set_menu(menu)?;

    // 事件桥：菜单点击 → 前端（nativeMenuBridge.ts 查 menuActions 分发）
    app.on_menu_event(|app, event| {
        let _ = app.emit("menu-action", event.id().0.clone());
    });

    Ok(())
}
