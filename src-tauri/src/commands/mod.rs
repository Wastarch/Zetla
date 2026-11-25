// Tauri 命令模块集合 —— 按域拆分（后续：compile / template / project / fsdoc / symbols / config）
// 资源管理器 · 外部文件互操作：系统剪贴板文件列表读写（Windows CF_HDROP）
pub mod clipboard_fs;
pub mod compile;
pub mod config;
pub mod placeholders;
pub mod core;
pub mod envsetup;
pub mod fsdoc;
pub mod image;
// M2 · 图片插入 TikZ · P2：暂存图 manifest / 转正 / 安静清理
pub mod image_staging;
pub mod logparse;
// macOS 原生菜单栏（M-macos-menu）：模块内全部代码 cfg(target_os="macos") 隔离
#[cfg(target_os = "macos")]
pub mod native_menu;
pub mod perl;
pub mod project_mgmt;
pub mod project;
pub mod snippets;
pub mod synctex;
pub mod template;
pub mod terminal;
pub mod tikz_export;
// M2 · 绘图模块：项目内 TikZ 来源扫描（v1：.tikz / .tex / .ltx）
pub mod tikz_source;
pub mod updater;
pub mod watch;
// Zotero 联动 · P0：本地 API 只读客户端 / 能力探测；P1：同步 HTTP / 受管 .bib 写盘
pub mod zotero;
// Zotero 联动 · P1：受管 .bib 多路径 watcher
pub mod zotero_watch;
