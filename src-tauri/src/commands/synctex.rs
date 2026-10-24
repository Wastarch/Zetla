// M1-4 · SyncTeX 双向跳转（开发文档 §3.2 synctex_view / synctex_edit）
// 自研 .synctex(.gz) 解析器：不依赖 synctex 二进制（MiKTeX 精简装可能没有）与 C 绑定，
// 格式依据 TeX Live xelatex 实测产物（夹具见 tests/fixtures/synctex/，含 \input 多文件场景）：
//   前置区：SyncTeX Version / Input:<tag>:<name> / Output / Magnification / Unit / X(Y) Offset / Content:
//   正文（记录间无分隔符，逐字符扫描）：
//     !<n>                                 字节数导航记录（忽略）
//     {<sheet>                             开始一页；  }<sheet> 结束一页（栈式，页码 = 栈顶）
//     [<tag>,<line>[,<col>]:<x>,<y>:<w>,<h>,<d>      盒子（完整几何）
//     (<tag>,<line>[,<col>]:<x>,<y>:<w>,<h>,<d>      void 盒子（随后由 ) 闭合）
//     <letter><tag>,<line>[,<col>]:<x>,<y>[:<w>[,<h>[,<d>]]]   叶子记录
//                                           （h=水平材料完整几何 / g=glue 仅坐标 /
//                                             k=kern 坐标+宽度；其余字母按同样数字布局兼容）
//     )                                    void 盒子闭合（忽略）
//     Input:<tag>:<name>                   可出现在正文中途（新文件被读入时）
//     Postamble / Post scriptum           结尾
//   坐标单位为 scaled points（65536 sp = 1 pt），y 自页顶向下 —— 与 pdf.js 视口同向，
//   即 pt 值可直接与 PDF 用户空间坐标比对（magnification 恒 1000 的常规文档无需缩放）。
//   编码：Input 路径在中文 Windows 下是系统 ANSI 代码页（GBK/936）字节而非 UTF-8
//   （实测 `D:/Users/Burce/Desktop/\xb2\xe2\xca\xd4/main.tex` = …/测试/main.tex），
//   需按 GBK 回退解码，否则路径乱码 → 正向匹配不上、反向打开失败。
//   索引按 (mtime, len) 缓存；重编译后 synctex 变更自动失效。
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

const SP_PER_PT: f64 = 65536.0;

/// 正/反向查询共用返回（与 src/types/synctex.ts SyncTexHit 对齐，camelCase）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTexHit {
    /// 源文件绝对路径（Input: 记录归一化结果）
    pub file: String,
    pub line: u32,
    pub column: u32,
    /// 1-based 页码
    pub page: u32,
    /// pt，距页顶（PDF 用户空间同尺度）
    pub x: f64,
    pub y: f64,
    /// 命中盒子几何（pt）：正向=行盒、反向=点中盒子
    pub width: f64,
    pub height: f64,
}

/// 解析出的一个同步节点（盒子/叶子记录）
#[derive(Debug, Clone)]
pub struct SyncTexNode {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub depth: f64,
}

impl SyncTexNode {
    /// 行盒类几何（有宽有高、高度在合理行高范围内）——正向跳转优先落到文本行上，
    /// 避免命中页面/段落级大盒子（h 数百 pt）
    fn is_text_line_like(&self) -> bool {
        self.width > 0.0 && self.height > 0.0 && self.height <= 40.0
    }

    /// 参与包含判定与面积排序的有效高度（0 高盒子按半个行高计，让字符级标记可被点中）
    fn eff_height(&self) -> f64 {
        (self.height + self.depth).max(0.5)
    }

    fn eff_area(&self) -> f64 {
        self.width * self.eff_height()
    }
}

// ─────────────────────────────────────────────────────────────
// 解析（纯函数）
// ─────────────────────────────────────────────────────────────

/// 读无符号整数：返回 (值, 新下标)；首位非数字时下标不变
fn read_uint(b: &[u8], i: usize) -> (u64, usize) {
    let mut j = i;
    while j < b.len() && b[j].is_ascii_digit() {
        j += 1;
    }
    if j == i {
        return (0, i);
    }
    let v = std::str::from_utf8(&b[i..j])
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    (v, j)
}

/// 读有符号整数（坐标/宽度可为负）：首位非数字/符号时下标不变
fn read_int(b: &[u8], i: usize) -> (i64, usize) {
    let mut j = i;
    if j < b.len() && (b[j] == b'-' || b[j] == b'+') {
        j += 1;
    }
    let ds = j;
    while j < b.len() && b[j].is_ascii_digit() {
        j += 1;
    }
    if j == ds {
        return (0, i);
    }
    let v = std::str::from_utf8(&b[i..j])
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    (v, j)
}

/// Input: 记录名 → Windows 风格规范路径（正斜杠转反斜杠、折叠 ./ 与 ../）
/// 例：`C:/proj/two/./main.tex` → `C:\proj\two\main.tex`
pub fn normalize_tex_path(name: &str) -> String {
    let s = name.trim().trim_matches('"').replace('/', "\\");
    let has_drive = s.len() >= 2 && s.as_bytes()[1] == b':';
    let mut parts: Vec<&str> = Vec::new();
    for seg in s.split('\\') {
        match seg {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    let body = parts.join("\\");
    if has_drive {
        body
    } else if s.starts_with('\\') {
        format!("\\{body}")
    } else {
        body
    }
}

/// 文件路径等价比较（Windows 大小写不敏感；synctex 记录名与前端传来的路径均已归一化）
fn same_file(a: &str, b: &str) -> bool {
    #[cfg(windows)]
    {
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// 取路径末段（文件名，小写）
fn file_basename(p: &str) -> String {
    p.rsplit(['\\', '/'])
        .find(|s| !s.is_empty())
        .unwrap_or(p)
        .to_lowercase()
}

/// 索引内与 `want` 同名的文件（唯一时返回其路径，用于路径对不上时的兜底）
fn unique_file_by_name(index: &[SyncTexNode], want: &str) -> Option<String> {
    let bn = file_basename(want);
    let mut hit: Option<&str> = None;
    for n in index {
        if file_basename(&n.file) != bn {
            continue;
        }
        match hit {
            None => hit = Some(&n.file),
            Some(cur) if !same_file(cur, &n.file) => return None, // 多个同名文件：不猜
            _ => {}
        }
    }
    hit.map(|s| s.to_string())
}

/// 索引内出现过的源文件（去重，最多 `max` 个；仅用于诊断输出）
fn sample_files(index: &[SyncTexNode], max: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for n in index {
        if out.iter().any(|f| same_file(f, &n.file)) {
            continue;
        }
        out.push(n.file.clone());
        if out.len() >= max {
            break;
        }
    }
    out
}

/// 解析 `tag,line[,col]:x,y[:w[,h[,d]]]`（start 指向 tag 首位）
/// 返回 Some((节点, 消费后下标))：tag 未登记/页码未知时节点为 None（仍消耗，保证扫描前进）；
/// 格式不符返回 None（下标不变，由调用方步进）
fn parse_node_record(
    b: &[u8],
    start: usize,
    inputs: &HashMap<u32, String>,
    page: u32,
) -> Option<(Option<SyncTexNode>, usize)> {
    let (tag, mut i) = read_uint(b, start);
    if tag == 0 || i >= b.len() || b[i] != b',' {
        return None;
    }
    i += 1;
    let (line, j) = read_uint(b, i);
    i = j;
    let mut column: u32 = 0;
    // 可选 column（多列文档才出现；多数文件省略，直接是 ':'）
    if i < b.len() && b[i] == b',' {
        let (c, j) = read_uint(b, i + 1);
        if j > i + 1 {
            column = c as u32;
            i = j;
        }
    }
    if i >= b.len() || b[i] != b':' {
        return None;
    }
    i += 1;
    let (x, j) = read_int(b, i);
    i = j;
    if i >= b.len() || b[i] != b',' {
        return None;
    }
    i += 1;
    let (y, j) = read_int(b, i);
    i = j;
    // 可选几何：:w[,h[,d]]（h/g 记录只有 :x,y；k 有 :x,y:w）
    let mut rest: Vec<i64> = Vec::new();
    if i < b.len() && b[i] == b':' {
        i += 1;
        loop {
            let (n, j) = read_int(b, i);
            if j == i {
                break;
            }
            rest.push(n);
            i = j;
            if i < b.len() && b[i] == b',' {
                i += 1;
                continue;
            }
            break;
        }
    }
    let (w, h, d) = (
        rest.first().copied().unwrap_or(0),
        rest.get(1).copied().unwrap_or(0),
        rest.get(2).copied().unwrap_or(0),
    );
    // tag 未登记（Input 记录缺失/乱序）或不在任何页内：丢弃但仍消耗
    let file = match inputs.get(&(tag as u32)) {
        Some(f) => f.clone(),
        None => return Some((None, i)),
    };
    if page == 0 || line == 0 {
        return Some((None, i));
    }
    Some((
        Some(SyncTexNode {
            file,
            line: line as u32,
            column,
            page,
            x: x as f64 / SP_PER_PT,
            y: y as f64 / SP_PER_PT,
            width: w as f64 / SP_PER_PT,
            height: h as f64 / SP_PER_PT,
            depth: d as f64 / SP_PER_PT,
        }),
        i,
    ))
}

/// 解析 synctex 文本为节点表（纯函数；顺序 = 文件内出现顺序）
pub fn parse_synctex_text(text: &str) -> Vec<SyncTexNode> {
    let b = text.as_bytes();
    let mut inputs: HashMap<u32, String> = HashMap::new();
    let mut out: Vec<SyncTexNode> = Vec::new();
    let mut page: u32 = 0;
    let mut sheet_stack: Vec<u32> = Vec::new();
    let mut i = 0usize;

    while i < b.len() {
        let c = b[i] as char;
        match c {
            // 字节数导航记录：跳过数字
            '!' => {
                i += 1;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
            }
            // {<sheet> 开始一页（数字为页码）
            '{' => {
                i += 1;
                let (n, j) = read_uint(b, i);
                i = j;
                if n > 0 {
                    page = n as u32;
                    sheet_stack.push(page);
                }
            }
            // }<sheet> 结束一页（数字为被闭合的页码）
            '}' => {
                i += 1;
                let (_n, j) = read_uint(b, i);
                i = j;
                sheet_stack.pop();
                page = sheet_stack.last().copied().unwrap_or(0);
            }
            // 盒子记录：[/void(
            '[' | '(' => {
                i += 1;
                match parse_node_record(b, i, &inputs, page) {
                    Some((node, j)) => {
                        i = j;
                        if let Some(n) = node {
                            out.push(n);
                        }
                    }
                    None => {}
                }
            }
            // void 盒子闭合
            ')' => i += 1,
            // Input:<tag>:<name>（正文中途也可能出现）
            'I' if text[i..].starts_with("Input:") => {
                i += "Input:".len();
                let (tag, j) = read_uint(b, i);
                i = j;
                if i < b.len() && b[i] == b':' {
                    i += 1;
                }
                let mut j = i;
                while j < b.len() && b[j] != b'\n' && b[j] != b'\r' {
                    j += 1;
                }
                let name = text[i..j].trim();
                if tag > 0 && !name.is_empty() {
                    inputs.insert(tag as u32, normalize_tex_path(name));
                }
                i = j;
            }
            // 叶子记录：<letter><tag>,<line>...
            // （前置区各头 "Output:"/"Magnification:" 等字母后紧跟非数字，解析失败自然跳过）
            c if c.is_ascii_alphabetic() => {
                i += 1;
                if let Some((node, j)) = parse_node_record(b, i, &inputs, page) {
                    i = j;
                    if let Some(n) = node {
                        out.push(n);
                    }
                }
            }
            _ => i += 1,
        }
    }
    out
}

/// 解压 synctex 字节（.gz 魔数 → gzip）+ 解码文本。
/// 编码口径（实测）：XeTeX 在中文 Windows 上把 Input 路径按系统 ANSI 代码页（GBK）写入，
/// 文件其余内容均为 ASCII。整体按 UTF-8 有损解码会把中文路径变成一串 U+FFFD（乱码）：
/// 正向查不到文件（点行提示「没有同步数据」）、反向拿到不存在的路径（os error 3）。
pub fn decode_synctex_bytes(bytes: &[u8]) -> String {
    let raw: Vec<u8> = if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut d = flate2::read::GzDecoder::new(bytes);
        let mut buf: Vec<u8> = Vec::new();
        match d.read_to_end(&mut buf) {
            Ok(_) => buf,
            Err(_) => bytes.to_vec(),
        }
    } else {
        bytes.to_vec()
    };
    decode_text(&raw)
}

/// BOM → 严格 UTF-8 → 逐行 GBK 回退（GBK 双字节不含 0x0A，按行切分安全）
fn decode_text(raw: &[u8]) -> String {
    if let Some((enc, bom_len)) = encoding_rs::Encoding::for_bom(raw) {
        let (text, _) = enc.decode_without_bom_handling(&raw[bom_len..]);
        return text.into_owned();
    }
    if let Ok(s) = std::str::from_utf8(raw) {
        return s.to_string();
    }
    eprintln!(
        "[synctex] 文本非 UTF-8（{} 字节）→ 按 GBK 逐行回退解码（中文 Windows 的 ANSI 路径）",
        raw.len()
    );
    let mut out = String::with_capacity(raw.len() + raw.len() / 3);
    for (i, line) in raw.split(|&b| b == b'\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        match std::str::from_utf8(line) {
            Ok(s) => out.push_str(s),
            Err(_) => {
                let (cow, _, _) = encoding_rs::GBK.decode(line);
                out.push_str(&cow);
            }
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────
// 查询
// ─────────────────────────────────────────────────────────────

/// 正向：源码 (file, line, column) → PDF 位置。
/// 选样口径：同行优先 → 行盒类几何优先 → 宽者优先（列距离仅作次要次序）。
/// 目标行无记录时回退为全文件最近行（编译后增删行的常见场景）；
/// 文件路径对不上时（编码差异/项目搬迁/相对路径）回退为「同名文件唯一」匹配。
pub fn forward(
    index: &[SyncTexNode],
    file: &str,
    line: u32,
    column: u32,
) -> Option<SyncTexHit> {
    let want = normalize_tex_path(file);
    let mut cands: Vec<&SyncTexNode> = index.iter().filter(|n| same_file(&n.file, &want)).collect();
    if cands.is_empty() {
        match unique_file_by_name(index, &want) {
            Some(resolved) => {
                eprintln!("[synctex] 正向：路径未直接匹配，按同名文件兜底 {want} → {resolved}");
                cands = index
                    .iter()
                    .filter(|n| same_file(&n.file, &resolved))
                    .collect();
            }
            None => {
                eprintln!(
                    "[synctex] 正向未命中文件：want={want}；索引内文件示例={:?}",
                    sample_files(index, 4)
                );
                return None;
            }
        }
    }
    let on_line: Vec<&SyncTexNode> = cands.iter().copied().filter(|n| n.line == line).collect();
    let pool: &[&SyncTexNode] = if on_line.is_empty() { &cands } else { &on_line };

    let mut best: &SyncTexNode = pool[0];
    for n in &pool[1..] {
        let key_n = (
            (n.line as i64 - line as i64).abs(),
            (n.column as i64 - column as i64).abs(),
            if n.is_text_line_like() { 0 } else { 1 },
            -n.width,
        );
        let key_b = (
            (best.line as i64 - line as i64).abs(),
            (best.column as i64 - column as i64).abs(),
            if best.is_text_line_like() { 0 } else { 1 },
            -best.width,
        );
        if key_n < key_b {
            best = n;
        }
    }
    Some(hit_of(best))
}

/// 反向：PDF (page, x, y) → 源码位置。
/// 选样口径：点中盒子中取有效面积最小者（≈最内层）；零高盒子按半行高参与，
/// 让字符级标记可被点中；无包含时回退为最近盒子。
pub fn backward(index: &[SyncTexNode], page: u32, x: f64, y: f64) -> Option<SyncTexHit> {
    let pool: Vec<&SyncTexNode> = index.iter().filter(|n| n.page == page).collect();
    if pool.is_empty() {
        return None;
    }
    // 包含判定（x ±1pt、y ±4pt 容差；无几何的记录不参与）
    let mut hit: Option<&SyncTexNode> = None;
    for n in &pool {
        if n.width <= 0.0 && n.height + n.depth <= 0.0 {
            continue;
        }
        let inside = x >= n.x - 1.0
            && x <= n.x + n.width + 1.0
            && y >= n.y - 4.0
            && y <= n.y + n.eff_height() + 4.0;
        if !inside {
            continue;
        }
        hit = Some(match hit {
            None => n,
            Some(cur) if n.eff_area() < cur.eff_area() => n,
            Some(cur) => cur,
        });
    }
    // 回退：到盒子矩形的钳距
    let best = hit.unwrap_or_else(|| {
        let mut b = pool[0];
        for n in &pool[1..] {
            if rect_dist(n, x, y) < rect_dist(b, x, y) {
                b = n;
            }
        }
        b
    });
    Some(hit_of(best))
}

/// 点到盒子矩形的钳距（外部为到边距离，内部为 0）
fn rect_dist(n: &SyncTexNode, x: f64, y: f64) -> f64 {
    let dx = (n.x - x).max(x - (n.x + n.width)).max(0.0);
    let dy = (n.y - y).max(y - (n.y + n.eff_height())).max(0.0);
    (dx * dx + dy * dy).sqrt()
}

fn hit_of(n: &SyncTexNode) -> SyncTexHit {
    SyncTexHit {
        file: n.file.clone(),
        line: n.line,
        column: n.column,
        page: n.page,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
    }
}

/// 命中路径在磁盘上不可用时，按项目根重新定位同一文件：
/// 1) 取路径尾部若干段与 root 拼接（从长到短，取最具体者）——覆盖盘符/上级目录变化；
/// 2) 仍未命中则按同名文件在 root 内受限深度搜索（唯一命中才采用）。
fn reanchor(root: &str, file: &str) -> Option<String> {
    let segs: Vec<&str> = file
        .split(['\\', '/'])
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    for k in (1..=segs.len().min(8)).rev() {
        let mut p = PathBuf::from(root);
        for s in &segs[segs.len() - k..] {
            p.push(s);
        }
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    let bn = segs.last()?.to_lowercase();
    let mut found: Vec<PathBuf> = Vec::new();
    walk_find(Path::new(root), &bn, 0, 6, &mut found);
    if found.len() == 1 {
        return Some(found.remove(0).to_string_lossy().to_string());
    }
    None
}

fn walk_find(dir: &Path, bn: &str, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth || out.len() > 1 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "target" || name == "node_modules" {
            continue;
        }
        if p.is_dir() {
            walk_find(&p, bn, depth + 1, max_depth, out);
        } else if name.to_lowercase() == bn {
            out.push(p);
        }
        if out.len() > 1 {
            return;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// 缓存 + Tauri 命令
// ─────────────────────────────────────────────────────────────

struct CacheEntry {
    mtime: SystemTime,
    len: u64,
    index: std::sync::Arc<Vec<SyncTexNode>>,
}

/// synctex 索引缓存（按文件 mtime+len 失效；重编译自动刷新）
#[derive(Default)]
pub struct SyncTexState {
    cache: Mutex<HashMap<String, CacheEntry>>,
}

/// pdf 路径 → 同目录同主名的 .synctex.gz / .synctex（输出目录与主文件同目录，见 §3.3）
fn synctex_path_for(pdf: &str) -> Option<PathBuf> {
    let p = Path::new(pdf);
    let dir = p.parent()?;
    let stem = p.file_stem()?.to_string_lossy().to_string();
    let gz = dir.join(format!("{stem}.synctex.gz"));
    if gz.is_file() {
        return Some(gz);
    }
    let plain = dir.join(format!("{stem}.synctex"));
    if plain.is_file() {
        return Some(plain);
    }
    None
}

/// 取索引（缓存命中直接返回；否则读盘解析并写入缓存）
fn load_index(state: &SyncTexState, pdf: &str) -> Option<std::sync::Arc<Vec<SyncTexNode>>> {
    let path = synctex_path_for(pdf)?;
    let meta = std::fs::metadata(&path).ok()?;
    let mtime = meta.modified().ok()?;
    let len = meta.len();
    let key = path.to_string_lossy().to_string();

    {
        let guard = state.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(hit) = guard.get(&key) {
            if hit.mtime == mtime && hit.len == len {
                return Some(std::sync::Arc::clone(&hit.index));
            }
        }
    }
    let bytes = std::fs::read(&path).ok()?;
    let text = decode_synctex_bytes(&bytes);
    let index = std::sync::Arc::new(parse_synctex_text(&text));
    eprintln!(
        "[synctex] 载入 {}：{} 节点 / 源文件示例 {:?}",
        path.display(),
        index.len(),
        sample_files(&index, 3)
    );
    {
        let mut guard = state.cache.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(
            key,
            CacheEntry {
                mtime,
                len,
                index: std::sync::Arc::clone(&index),
            },
        );
    }
    Some(index)
}

/// 正向跳转查询（编辑器 Ctrl+点击 / 视图菜单）
#[tauri::command]
pub fn synctex_view(
    input_file: String,
    line: u32,
    column: u32,
    pdf: String,
    state: tauri::State<'_, std::sync::Arc<SyncTexState>>,
) -> Result<Option<SyncTexHit>, String> {
    let index = load_index(state.inner(), &pdf).ok_or_else(|| {
        "未找到 SyncTeX 数据（.synctex.gz），请先编译生成".to_string()
    })?;
    Ok(forward(&index, &input_file, line, column))
}

/// 反向跳转查询（PDF 中 Ctrl+点击；x/y 为 pt，距页顶向下）。
/// `root` 为项目根：命中路径在磁盘上不存在时（项目搬迁/路径编码差异）用于重锚。
#[tauri::command]
pub fn synctex_edit(
    pdf: String,
    page: u32,
    x: f64,
    y: f64,
    root: Option<String>,
    state: tauri::State<'_, std::sync::Arc<SyncTexState>>,
) -> Result<Option<SyncTexHit>, String> {
    let index = load_index(state.inner(), &pdf).ok_or_else(|| {
        "未找到 SyncTeX 数据（.synctex.gz），请先编译生成".to_string()
    })?;
    let mut hit = backward(&index, page, x, y);
    if let Some(h) = hit.as_mut() {
        if !Path::new(&h.file).is_file() {
            match root.as_deref().filter(|r| !r.trim().is_empty()) {
                Some(r) => match reanchor(r, &h.file) {
                    Some(fixed) => {
                        eprintln!("[synctex] 反向：源码路径不可用，已重锚 {} → {}", h.file, fixed);
                        h.file = fixed;
                    }
                    None => eprintln!("[synctex] 反向：源码路径不可用且无法重锚：{}", h.file),
                },
                None => eprintln!("[synctex] 反向：源码路径不可用（未提供项目根）：{}", h.file),
            }
        }
    }
    Ok(hit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_text(name: &str) -> String {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/synctex")
            .join(name);
        std::fs::read_to_string(p).unwrap()
    }

    fn fixture_bytes(name: &str) -> Vec<u8> {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/synctex")
            .join(name);
        std::fs::read(p).unwrap()
    }

    #[test]
    fn normalizes_tex_paths() {
        assert_eq!(
            normalize_tex_path("C:/proj/two/./main.tex"),
            r"C:\proj\two\main.tex"
        );
        assert_eq!(
            normalize_tex_path("C:\\proj\\two\\chapters\\..\\main.tex"),
            r"C:\proj\two\main.tex"
        );
        assert_eq!(normalize_tex_path("  ./a.tex  "), r"a.tex");
    }

    #[test]
    fn parses_two_page_fixture() {
        // 夹具：两页文档；第 3 行 \section{Intro}（页1顶部）、第 9 行页1末行、
        // 第 10 行页2首行（\end{document} 在 11 行）
        let nodes = parse_synctex_text(&fixture_text("two-page.synctex"));
        assert!(nodes.len() > 30, "节点数 {}", nodes.len());
        // 页码只出现 1/2
        assert!(nodes.iter().all(|n| n.page == 1 || n.page == 2));
        // 源文件均归一化到 C:\proj\two\main.tex
        assert!(nodes
            .iter()
            .all(|n| n.file == r"C:\proj\two\main.tex"));
        // y 自页顶向下：第 3 行在页面上部（≈135pt），第 9 行在页面下部（≈705pt）
        let l3 = nodes.iter().find(|n| n.line == 3).unwrap();
        assert_eq!(l3.page, 1);
        assert!((l3.y - 135.2).abs() < 1.0, "l3.y={}", l3.y);
        let l9 = nodes.iter().filter(|n| n.line == 9).count();
        assert!(l9 >= 2);
        let l10 = nodes.iter().find(|n| n.line == 10).unwrap();
        assert_eq!(l10.page, 2, "第 10 行应在第 2 页");
        assert!((l10.y - 135.2).abs() < 1.0, "l10.y={}", l10.y);
    }

    #[test]
    fn decodes_gzipped_fixture() {
        // .gz 与明文解析结果一致（覆盖解压路径）
        let plain = parse_synctex_text(&fixture_text("two-page.synctex"));
        let text = decode_synctex_bytes(&fixture_bytes("two-page.synctex.gz"));
        let gz = parse_synctex_text(&text);
        assert_eq!(gz.len(), plain.len());
        assert_eq!(gz[0].file, plain[0].file);
        assert_eq!(gz[0].line, plain[0].line);
        assert_eq!(gz[0].page, plain[0].page);
    }

    #[test]
    fn parses_three_page_fixture() {
        let nodes = parse_synctex_text(&decode_synctex_bytes(&fixture_bytes(
            "three-page.synctex.gz",
        )));
        assert_eq!(
            nodes.iter().map(|n| n.page).collect::<std::collections::HashSet<_>>(),
            [1u32, 2, 3].into_iter().collect()
        );
        // 每页各一行（第 4/6/8 行）
        for (page, line) in [(1u32, 4u32), (2, 6), (3, 8)] {
            assert!(
                nodes.iter().any(|n| n.page == page && n.line == line),
                "页 {page} 应有行 {line} 的记录"
            );
        }
    }

    #[test]
    fn forward_maps_line_to_page_position() {
        let nodes = parse_synctex_text(&fixture_text("two-page.synctex"));
        let hit = forward(&nodes, r"C:\proj\two\main.tex", 3, 1).expect("行 3 应命中");
        assert_eq!(hit.page, 1);
        assert!((hit.y - 135.2).abs() < 2.0, "hit.y={}", hit.y);
        assert!(hit.width > 100.0, "行盒宽度 {}", hit.width);

        let hit = forward(&nodes, r"C:\proj\two\main.tex", 10, 1).expect("行 10 应命中");
        assert_eq!(hit.page, 2);

        // 目标行无记录（文档被改短）→ 回退最近行，不返回 None
        let hit = forward(&nodes, r"C:\proj\two\main.tex", 99, 1).expect("应回退");
        assert_eq!(hit.line, 11);

        // 文件不匹配 → None
        assert!(forward(&nodes, r"C:\proj\two\other.tex", 3, 1).is_none());
    }

    #[test]
    fn backward_maps_point_to_source_line() {
        let nodes = parse_synctex_text(&fixture_text("two-page.synctex"));
        // 页1顶部（章节标题行）
        let hit = backward(&nodes, 1, 140.0, 137.0).expect("应命中");
        assert_eq!(hit.line, 3);
        // 页1下部（第 9 行文本带）
        let hit = backward(&nodes, 1, 140.0, 700.0).expect("应命中");
        assert_eq!(hit.line, 9);
        // 页2首行：点中字符级标记 → 第 10 行（而非外层 \end{document} 的 11 行）
        let hit = backward(&nodes, 2, 140.0, 137.0).expect("应命中");
        assert_eq!(hit.line, 10, "反向应取最内层记录");
        // 不存在的页 → None
        assert!(backward(&nodes, 9, 100.0, 100.0).is_none());
    }

    #[test]
    fn decodes_gbk_input_paths() {
        // 中文 Windows 实测：Input 路径是 GBK 字节（\xb2\xe2\xca\xd4 = 测试），
        // 整体按 UTF-8 有损解码会变成乱码路径 → 正向匹配不上、反向打开失败。
        let mut raw: Vec<u8> = Vec::new();
        raw.extend_from_slice(b"SyncTeX Version:1\nInput:1:");
        raw.extend_from_slice(b"D:/Users/Burce/Desktop/\xb2\xe2\xca\xd4/./main.tex\n");
        raw.extend_from_slice(b"Output:pdf\n{1\nh1,3:9175040,8781824:393216,655360,0\n}1\n");
        let text = decode_synctex_bytes(&raw);
        assert!(text.contains("测试"), "GBK 路径未正确解码：{text}");
        let nodes = parse_synctex_text(&text);
        assert_eq!(nodes[0].file, r"D:\Users\Burce\Desktop\测试\main.tex");
        // 正/反向都能用真实中文路径命中
        assert!(forward(&nodes, r"D:\Users\Burce\Desktop\测试\main.tex", 3, 1).is_some());
        assert!(forward(&nodes, "D:/Users/Burce/Desktop/测试/main.tex", 3, 1).is_some());
        assert_eq!(backward(&nodes, 1, 140.0, 137.0).unwrap().line, 3);
    }

    #[test]
    fn forward_falls_back_to_unique_basename() {
        let nodes = parse_synctex_text(&fixture_text("two-page.synctex"));
        // 盘符/前缀不同但文件名在索引内唯一 → 兜底命中
        let hit = forward(&nodes, r"Z:\副本\main.tex", 3, 1).expect("同名兜底应命中");
        assert_eq!(hit.page, 1);
        // 文件名对不上 → None
        assert!(forward(&nodes, r"Z:\副本\other.tex", 3, 1).is_none());
    }

    #[test]
    fn reanchors_missing_source_under_root() {
        let root = std::env::temp_dir().join(format!("zetla-reanchor-{}", std::process::id()));
        let sub = root.join("chap");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("a.tex"), "x").unwrap();
        let root_s = root.to_string_lossy().to_string();

        // 尾部片段命中（盘符/上级目录变了）
        let fixed = reanchor(&root_s, r"Z:\旧项目\chap\a.tex").expect("应按尾段重锚");
        assert!(fixed.ends_with(r"chap\a.tex"), "{fixed}");
        // 尾段对不上 → 同名唯一搜索
        let fixed = reanchor(&root_s, r"Z:\完全\不同\a.tex").expect("应按同名重锚");
        assert!(fixed.ends_with("a.tex"), "{fixed}");
        // 找不到 → None
        assert!(reanchor(&root_s, r"Z:\x\nope.tex").is_none());

        std::fs::remove_dir_all(&root).ok();
    }
}
