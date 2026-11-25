// 资源管理器 · 外部文件互操作（系统剪贴板 ↔ 项目树）
//
// read_clipboard_files：读出系统剪贴板里的文件列表（Windows CF_HDROP），同时判断这次复制是不是
//   「剪切」（"Preferred DropEffect" = DROPEFFECT_MOVE）—— 前端据此决定粘贴走 move 还是 copy，
//   与资源管理器的剪切/复制语义一致。
// write_clipboard_files：把项目条目写进系统剪贴板（CF_HDROP + Preferred DropEffect），
//   让「Zetla 内复制 → 资源管理器粘贴」成立；更重要的是让**应用内剪贴板与系统剪贴板保持同一份事实**，
//   否则「应用内复制过一次 → 再去资源管理器复制 → 回到树里粘贴」会用到旧的路径列表。
//
// 仅 Windows 有原生实现：读在其它平台返回空列表（前端静默回落应用内剪贴板），
// 写在其它平台返回错误（前端忽略）。拖入通道不依赖平台 API，跨平台可用。
use serde::Serialize;
use std::collections::HashSet;

/// 系统剪贴板里的文件（与 src/types/project.ts ClipboardFiles 对齐）
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
    /// 绝对路径列表（已去重、去空；不含校验，路径级防护由 copy_entry/rename_entry 兜底）
    pub paths: Vec<String>,
    /// 是否为「剪切」（粘贴后应移动而非复制）
    pub cut: bool,
}

/// DROPFILES 头长度：pFiles(4) + POINT(8) + fNC(4) + fWide(4)
const DROPFILES_HEADER: usize = 20;
/// DROPEFFECT_COPY / DROPEFFECT_MOVE（取值同 Windows DROPEFFECT 位标志）
const DROPEFFECT_COPY: u32 = 1;
const DROPEFFECT_MOVE: u32 = 2;

/// 去空 + 去重（Windows 路径不区分大小写，且 / 与 \ 等价）
pub(crate) fn clean_paths(paths: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for raw in paths {
        let p = raw.trim();
        if p.is_empty() {
            continue;
        }
        let key = p.replace('/', "\\").to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(p.to_string());
    }
    out
}

/// DROPFILES + 宽字符路径列表（每条以 \0 结尾，整表再多一个 \0）
pub(crate) fn build_dropfiles_bytes(paths: &[String]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(DROPFILES_HEADER + 64 * paths.len());
    out.extend_from_slice(&(DROPFILES_HEADER as u32).to_le_bytes()); // pFiles 偏移
    out.extend_from_slice(&[0u8; 12]); // pt = (0,0)，fNC = FALSE
    out.extend_from_slice(&1u32.to_le_bytes()); // fWide = TRUE（UTF-16 路径）
    for p in paths {
        for unit in p.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out.extend_from_slice(&[0, 0]);
    }
    out.extend_from_slice(&[0, 0]); // 列表结束标记
    out
}

/// Preferred DropEffect 的 4 字节小端负载
pub(crate) fn preferred_effect_bytes(cut: bool) -> [u8; 4] {
    (if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY }).to_le_bytes()
}

/// 读取系统剪贴板中的文件路径；无文件（纯文本/图片）时返回空列表
#[tauri::command]
pub async fn read_clipboard_files() -> Result<ClipboardFiles, String> {
    #[cfg(target_os = "windows")]
    {
        win::read()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(ClipboardFiles {
            paths: Vec::new(),
            cut: false,
        })
    }
}

/// 把文件路径写入系统剪贴板（cut=true 时标记为移动，资源管理器粘贴后会删除源）；
/// 传空列表 = 只清空剪贴板（剪切粘贴落地后清理，避免重复粘贴已移动的源）
#[tauri::command]
pub async fn write_clipboard_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win::write(&paths, cut)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (paths, cut);
        Err("当前平台暂不支持写入系统剪贴板文件列表".into())
    }
}

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
        SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

    /// 剪贴板打开失败（被其它程序短暂占用）时重试次数与间隔
    const OPEN_RETRIES: u32 = 4;
    const OPEN_RETRY_MS: u64 = 8;

    /// 打开剪贴板；Drop 时自动 CloseClipboard（所有失败分支都必须关上）
    struct ClipGuard;

    impl Drop for ClipGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn open() -> Result<ClipGuard, String> {
        for _ in 0..OPEN_RETRIES {
            // HWND 传 null：剪贴板归属于当前线程
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return Ok(ClipGuard);
            }
            std::thread::sleep(std::time::Duration::from_millis(OPEN_RETRY_MS));
        }
        Err("剪贴板正被其它程序占用，请稍后重试".into())
    }

    /// "Preferred DropEffect"：Explorer 用它在剪贴板里区分复制与剪切
    fn preferred_effect_format() -> u32 {
        let name = wide("Preferred DropEffect");
        unsafe { RegisterClipboardFormatW(name.as_ptr()) }
    }

    fn read_cut_flag() -> bool {
        let fmt = preferred_effect_format();
        if fmt == 0 {
            return false;
        }
        unsafe {
            let h: HANDLE = GetClipboardData(fmt);
            if h.is_null() {
                return false;
            }
            let p = GlobalLock(h as HGLOBAL);
            if p.is_null() {
                return false;
            }
            let effect = std::ptr::read_unaligned(p as *const u32);
            GlobalUnlock(h as HGLOBAL);
            // 同时带 COPY 位（Ctrl+右键拖拽之类）时按复制处理，避免误删源
            effect & DROPEFFECT_MOVE != 0 && effect & DROPEFFECT_COPY == 0
        }
    }

    fn read_paths() -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        unsafe {
            let h: HANDLE = GetClipboardData(CF_HDROP as u32);
            if h.is_null() {
                return out;
            }
            let hdrop = h as HDROP;
            // 0xFFFFFFFF = 取文件个数
            let count = DragQueryFileW(hdrop, u32::MAX, std::ptr::null_mut(), 0);
            for i in 0..count {
                let len = DragQueryFileW(hdrop, i, std::ptr::null_mut(), 0) as usize;
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; len + 1];
                let got =
                    DragQueryFileW(hdrop, i, buf.as_mut_ptr(), buf.len() as u32) as usize;
                if got == 0 {
                    continue;
                }
                out.push(String::from_utf16_lossy(&buf[..got]));
            }
        }
        out
    }

    pub fn read() -> Result<ClipboardFiles, String> {
        let _guard = open()?;
        let paths = clean_paths(&read_paths());
        let cut = !paths.is_empty() && read_cut_flag();
        Ok(ClipboardFiles { paths, cut })
    }

    /// 把一段字节放进全局内存并交给剪贴板（成功即所有权转移，不能再 GlobalFree）
    fn set_bytes(fmt: u32, bytes: &[u8], what: &str) -> Result<(), String> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
            if h.is_null() {
                return Err(format!("为剪贴板分配内存失败（{}）", what));
            }
            let p = GlobalLock(h);
            if p.is_null() {
                GlobalFree(h);
                return Err(format!("锁定剪贴板内存失败（{}）", what));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p as *mut u8, bytes.len());
            GlobalUnlock(h);
            if SetClipboardData(fmt, h).is_null() {
                GlobalFree(h);
                return Err(format!("写入剪贴板失败（{}）", what));
            }
        }
        Ok(())
    }

    pub fn write(paths: &[String], cut: bool) -> Result<(), String> {
        let list = clean_paths(paths);
        let _guard = open()?;
        unsafe {
            if EmptyClipboard() == 0 {
                return Err("清空剪贴板失败".into());
            }
            // 空列表 = 只清空（剪切粘贴落地后清一次，避免资源管理器再粘贴已移动的源）
            if list.is_empty() {
                return Ok(());
            }
            set_bytes(CF_HDROP as u32, &build_dropfiles_bytes(&list), "文件列表")?;
            let fmt = preferred_effect_format();
            if fmt != 0 {
                // 非致命：缺了它资源管理器仍可粘贴（会按复制处理）
                let _ = set_bytes(fmt, &preferred_effect_bytes(cut), "拖放效果");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> Vec<String> {
        vec![
            r"C:\proj\main.tex".to_string(),
            r"C:\proj\figures\图 1.png".to_string(),
        ]
    }

    #[test]
    fn dropfiles_header_is_20_bytes_with_wide_flag() {
        let bytes = build_dropfiles_bytes(&paths());
        assert_eq!(bytes.len() % 2, 0, "宽字符列表必须按 2 字节对齐");
        // pFiles 偏移 = 20
        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 20);
        // 头部共 20 字节，fWide 在最后 4 字节且为 1
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 1);
        // 第一个路径从偏移 20 开始
        let first: Vec<u16> = bytes[20..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let text: String = String::from_utf16_lossy(&first);
        assert!(text.starts_with(r"C:\proj\main.tex"), "首条路径应从偏移 20 开始: {text:?}");
    }

    #[test]
    fn dropfiles_list_is_double_null_terminated() {
        let bytes = build_dropfiles_bytes(&paths());
        assert_eq!(&bytes[bytes.len() - 4..], &[0, 0, 0, 0], "结尾需连续两个空宽字符");
        // 中间那条（非末尾）只有一个 \0
        let body = &bytes[20..];
        let units: Vec<u16> = body
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let nu = units.iter().filter(|u| **u == 0).count();
        assert_eq!(nu, paths().len() + 1, "N 条路径应有 N+1 个空字符");
    }

    #[test]
    fn dropfiles_supports_non_ascii_paths() {
        let bytes = build_dropfiles_bytes(&["C:\\论文\\参考文献.bib".to_string()]);
        let text = String::from_utf16_lossy(
            &bytes[20..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect::<Vec<u16>>(),
        );
        assert!(text.starts_with("C:\\论文\\参考文献.bib"), "{text:?}");
    }

    #[test]
    fn clean_paths_trims_dedupes_and_normalizes_separators() {
        let got = clean_paths(&[
            r"C:\proj\a.tex".to_string(),
            "  ".to_string(),
            r"c:/proj/A.TEX".to_string(), // 同一条（大小写 + 分隔符差异）
            r"C:\proj\b.tex".to_string(),
        ]);
        assert_eq!(got, vec![r"C:\proj\a.tex", r"C:\proj\b.tex"]);
    }

    #[test]
    fn preferred_effect_bytes_maps_copy_and_move() {
        assert_eq!(u32::from_le_bytes(preferred_effect_bytes(false)), 1);
        assert_eq!(u32::from_le_bytes(preferred_effect_bytes(true)), 2);
    }

    #[test]
    fn empty_input_produces_header_only_buffer() {
        let bytes = build_dropfiles_bytes(&[]);
        assert_eq!(bytes.len(), DROPFILES_HEADER + 2, "空列表也应带结束标记");
    }
}
