// Tauri 命令模块集合 —— 按域拆分（后续：compile / template / project / fsdoc / symbols / config）
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
pub mod perl;
pub mod project_mgmt;
pub mod project;
pub mod snippets;
pub mod synctex;
pub mod template;
pub mod tikz_export;
pub mod updater;
pub mod watch;
