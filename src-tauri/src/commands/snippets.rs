// M2-5a · 用户自定义快捷输入片段（Snippets）持久层
// 存储独立于 config.json（片段模板可能很大，避免 AppConfig 深拷贝/整写变重）：
// config_dir/Zetla/snippets.json = { schemaVersion, custom: SnippetDef[] }
// 内置默认片段在前端 `src/types/snippets.ts`（DEFAULT_SNIPPETS），此处只管用户层。
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

pub const SNIPPETS_FILE_NAME: &str = "snippets.json";
/// 片段 schema 版本
pub const SNIPPETS_SCHEMA_VERSION: u32 = 1;
/// 用户自定义片段数量上限（防呆）
pub const MAX_SNIPPETS: usize = 500;

/// 片段定义（与前端 src/types/snippets.ts 的 SnippetDef 一一对应，camelCase）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnippetDef {
    /// 稳定 id（自定义：s-<时间戳>-<随机>；由前端生成，缺失时 Rust 兜底 s-<trigger>）
    pub id: String,
    /// 触发词（非空、不含反斜杠与空白；与命令补全区分——命令都带 \ 前缀）
    pub trigger: String,
    /// 展开模板（含 ${n:占位} / $n / $0 CodeMirror snippet 语法；$SELECTION 由前端 M2-5b 处理）
    pub body: String,
    /// 描述（可选；弹窗/设置页展示）
    pub desc: Option<String>,
    /// 分类（如「结构」「浮动体」「数学」）
    pub category: String,
}

impl Default for SnippetDef {
    fn default() -> Self {
        SnippetDef {
            id: String::new(),
            trigger: String::new(),
            body: String::new(),
            desc: None,
            category: String::new(),
        }
    }
}

/// snippets.json 顶层结构（预留 schemaVersion 便于后续迁移）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SnippetsFile {
    pub schema_version: u32,
    pub custom: Vec<SnippetDef>,
}

impl Default for SnippetsFile {
    fn default() -> Self {
        SnippetsFile {
            schema_version: SNIPPETS_SCHEMA_VERSION,
            custom: Vec::new(),
        }
    }
}

/// 触发词合法性：非空、不含反斜杠（与 LaTeX 命令区分）、不含空白（保证「光标前是完整触发词」判定可靠）
fn valid_trigger(t: &str) -> bool {
    !t.is_empty() && !t.contains('\\') && !t.chars().any(|c| c.is_whitespace())
}

/// 归一化：去空白 + 必填校验（trigger/body/category 非空、trigger 合法）+
/// 按 trigger 去重（后者覆盖）+ 空位 id 兜底 s-<trigger> + 截断上限。
pub fn normalize_snippets(mut v: Vec<SnippetDef>) -> Vec<SnippetDef> {
    let mut by_trigger: std::collections::HashMap<String, SnippetDef> =
        std::collections::HashMap::new();
    for mut d in v.drain(..) {
        d.id = d.id.trim().to_string();
        d.trigger = d.trigger.trim().to_string();
        d.body = d.body.trim().to_string();
        d.category = d.category.trim().to_string();
        d.desc = d
            .desc
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string());
        if d.body.is_empty() || d.category.is_empty() || !valid_trigger(&d.trigger) {
            continue; // 必填/合法性不过 → 丢弃
        }
        if d.id.is_empty() {
            d.id = format!("s-{}", d.trigger);
        }
        by_trigger.insert(d.trigger.clone(), d);
    }
    let mut out: Vec<SnippetDef> = by_trigger.into_values().collect();
    // 稳定顺序：按 id 排序，避免 HashMap 迭代顺序抖动导致整文件 diff
    out.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| a.trigger.cmp(&b.trigger)));
    out.truncate(MAX_SNIPPETS);
    out
}

/// snippets.json 绝对路径（config_dir/Zetla/snippets.json，与 config.json 同目录）
pub fn snippets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .config_dir()
        .map_err(|e| format!("解析配置目录失败: {}", e))?
        .join(super::config::CONFIG_DIR_NAME);
    Ok(dir.join(SNIPPETS_FILE_NAME))
}

/// 读用户片段：文件缺失 / JSON 损坏 → 空列表（不自动回写，避免误覆盖用户手工编辑）
pub fn read_snippets(path: &std::path::Path) -> Vec<SnippetDef> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<SnippetsFile>(&text) {
        Ok(f) => normalize_snippets(f.custom),
        Err(_) => Vec::new(),
    }
}

/// 写用户片段：归一化 + 建目录 + 先写临时文件再替换（Windows 下 rename 目标存在需先移除）
pub fn write_snippets(path: &std::path::Path, snippets: Vec<SnippetDef>) -> Result<(), String> {
    let custom = normalize_snippets(snippets);
    let file = SnippetsFile {
        schema_version: SNIPPETS_SCHEMA_VERSION,
        custom,
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("序列化片段失败: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("写入片段失败: {}", e))?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("替换片段失败: {}", e))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("替换片段失败: {}", e))?;
    Ok(())
}

/// 读用户自定义片段（M2-5c 设置页 / M2-5b 编辑器接线调用；缺失/损坏回空列表）
#[tauri::command]
pub fn load_user_snippets(app: tauri::AppHandle) -> Result<Vec<SnippetDef>, String> {
    let path = snippets_path(&app)?;
    Ok(read_snippets(&path))
}

/// 保存用户自定义片段（整对象写入）；返回归一化后的列表供前端同步镜像
#[tauri::command]
pub fn save_user_snippets(
    app: tauri::AppHandle,
    snippets: Vec<SnippetDef>,
) -> Result<Vec<SnippetDef>, String> {
    let path = snippets_path(&app)?;
    write_snippets(&path, snippets)?;
    Ok(read_snippets(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试专用临时目录（与 config.rs 同款策略：进程 id + 计数避免并行冲突）
    fn tmp_dir(tag: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "zetla-snippets-tests-{}-{}-{}",
            tag,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn def(trigger: &str, body: &str) -> SnippetDef {
        SnippetDef {
            id: format!("s-{}", trigger),
            trigger: trigger.to_string(),
            body: body.to_string(),
            desc: None,
            category: "测试".to_string(),
        }
    }

    #[test]
    fn normalize_drops_invalid_and_keeps_valid() {
        let v = vec![
            def("fig", "\\begin{figure}"),
            SnippetDef::default(),                        // 全空 → 丢
            def("", "body"),                              // 空 trigger → 丢
            def("a b", "body"),                           // 含空白 → 丢
            def("bad\\trig", "body"),                     // 含反斜杠 → 丢
            SnippetDef {                                  // body 空 → 丢
                trigger: "x".into(),
                body: "  ".into(),
                ..def("x", "")
            },
        ];
        let out = normalize_snippets(v);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].trigger, "fig");
    }

    #[test]
    fn normalize_dedups_by_trigger_later_wins() {
        let mut later = def("fig", "v2");
        later.desc = Some("新".into());
        let out = normalize_snippets(vec![def("fig", "v1"), later]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].body, "v2");
    }

    #[test]
    fn normalize_fills_empty_id_and_sorts_stably() {
        let mut a = def("zeta", "1");
        a.id = "  ".into();
        let out = normalize_snippets(vec![def("alpha", "2"), a]);
        assert_eq!(out[0].id, "s-alpha");
        assert_eq!(out[1].id, "s-zeta"); // 空 id 兜底后按 id 排序
    }

    #[test]
    fn normalize_trims_fields_and_cleans_desc() {
        let mut d = def("  fig  ", "  body  ");
        d.category = " 浮动体 ".into();
        d.desc = Some("   ".into()); // 全空白 → None
        let out = normalize_snippets(vec![d]);
        assert_eq!(out[0].trigger, "fig");
        assert_eq!(out[0].body, "body");
        assert_eq!(out[0].category, "浮动体");
        assert_eq!(out[0].desc, None);
    }

    #[test]
    fn read_missing_and_corrupt_return_empty() {
        let p = tmp_dir("snip_missing").join(SNIPPETS_FILE_NAME);
        assert!(read_snippets(&p).is_empty());
        let p = tmp_dir("snip_corrupt").join(SNIPPETS_FILE_NAME);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "{not json").unwrap();
        assert!(read_snippets(&p).is_empty());
    }

    #[test]
    fn write_read_roundtrip_and_normalize_on_write() {
        let p = tmp_dir("snip_roundtrip").join(SNIPPETS_FILE_NAME);
        let v = vec![
            def("fig", "\\begin{figure}"),
            def("bad trig", "丢弃"),
            def("fig", "\\begin{figure}[htbp]"), // 覆盖前者
        ];
        write_snippets(&p, v).unwrap();
        let out = read_snippets(&p);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].body, "\\begin{figure}[htbp]");
        // 落盘为 SnippetsFile 结构（schemaVersion = 1）
        let text = std::fs::read_to_string(&p).unwrap();
        let f: SnippetsFile = serde_json::from_str(&text).unwrap();
        assert_eq!(f.schema_version, 1);
    }
}
