// 资源管理器 · 从项目树拖出到系统（Windows 原生 OLE 拖放源）
//
// 背景：项目树内部的拖拽排序是**指针事件**模拟的（Tauri 在 Windows 接管了窗口级拖放，
// webview 内的 HTML5 dragstart 不可用），所以「拖出窗口到资源管理器」必须自己当拖放源。
// 这里用最少的 COM 实现造一个只用 CF_HDROP 的 IDataObject + IDropSource，交给 DoDragDrop：
//   - 资源管理器 / 桌面 / 其它 OLE 目标收到的是标准的文件列表，落盘行为与在资源管理器里拖一致；
//   - 落地效果由目标决定（同盘移动、跨盘复制、按住 Ctrl 复制），DoDragDrop 返回后
//     前端据此刷新树（move 之后源文件已经不在项目里了）。
//
// 仅 Windows 有原生实现；其它平台命令返回错误，前端静默降级（不阻塞树内拖拽）。
use serde::Serialize;

/// 拖出结束事件名（与 src/ipc/events.ts RustEvents.dragOutDone 一致）
pub const EV_DRAG_OUT_DONE: &str = "drag_out_done";

const DROPEFFECT_COPY_BIT: u32 = 1;
const DROPEFFECT_MOVE_BIT: u32 = 2;

/// 本次拖拽允许的落地效果：按住复制修饰键 → 只允许复制；
/// 否则复制/移动都允许，由目标按「同盘=移动、跨盘=复制、Ctrl=复制」自行决定。
pub fn allowed_effects(copy: bool) -> u32 {
    if copy {
        DROPEFFECT_COPY_BIT
    } else {
        DROPEFFECT_COPY_BIT | DROPEFFECT_MOVE_BIT
    }
}

/// DROPEFFECT 位标志 → 前端可读的落地结果
pub fn effect_name(effect: u32) -> &'static str {
    if effect & DROPEFFECT_MOVE_BIT != 0 && effect & DROPEFFECT_COPY_BIT == 0 {
        "move"
    } else if effect & DROPEFFECT_COPY_BIT != 0 {
        "copy"
    } else {
        "none"
    }
}

/// 拖出结束的回执（与 src/types/project.ts DragOutResult 对齐）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragOutResult {
    /// "copy" | "move" | "none"
    pub effect: String,
    /// 本次拖出的条目（绝对路径，顺序与请求一致）
    pub paths: Vec<String>,
}

/// 开始一次系统拖出。立即返回：真正的拖放循环跑在独立线程上（DoDragDrop 会阻塞到松手），
/// 结束后由 EV_DRAG_OUT_DONE 事件把落地效果推回前端。
#[tauri::command]
pub async fn start_drag_out(
    app: tauri::AppHandle,
    paths: Vec<String>,
    copy: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri::Emitter;

        let list = crate::commands::clipboard_fs::clean_paths(&paths);
        if list.is_empty() {
            return Err("没有可拖出的条目".into());
        }
        std::thread::spawn(move || {
            let effect = win::drag(&list, copy).unwrap_or_else(|e| {
                eprintln!("[drag_out] {e}");
                0
            });
            let _ = app.emit(
                EV_DRAG_OUT_DONE,
                DragOutResult {
                    effect: effect_name(effect).to_string(),
                    paths: list,
                },
            );
        });
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, paths, copy);
        Err("当前平台暂不支持从应用内拖出到系统".into())
    }
}

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use windows::core::{implement, BOOL, HRESULT, Result as WinResult};
    use windows::Win32::Foundation::{
        DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC,
        E_NOTIMPL, OLE_E_ADVISENOTSUPPORTED, S_OK,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, IAdviseSink, IDataObject, IDataObject_Impl,
        IEnumFORMATETC, IEnumSTATDATA, DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM,
        STGMEDIUM_0, TYMED_HGLOBAL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{
        DoDragDrop, IDropSource, IDropSource_Impl, CF_HDROP, DROPEFFECT, DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
    use windows::Win32::UI::Shell::SHCreateStdEnumFmtEtc;

    /// MK_LBUTTON | MK_RBUTTON：两者都松开即视为「松手」
    const MK_BUTTONS: u32 = 0x0003;

    /// 只用 CF_HDROP（+ Preferred DropEffect）的数据对象：
    /// 资源管理器 / 桌面认这两种格式，别的一律 DV_E_FORMATETC。
    ///
    /// 不持有个数不定的 COM 指针，只存字节与格式号 —— 每次 GetData 现场分配 HGLOBAL
    /// （所有权随 STGMEDIUM 交给目标，由目标 ReleaseStgMedium 释放）。
    #[implement(IDataObject)]
    struct FileDataObject {
        /// DROPFILES + UTF-16 双 \0 路径表
        hdrop: Vec<u8>,
        /// Preferred DropEffect 的 4 字节负载
        effect: Vec<u8>,
        /// "Preferred DropEffect" 的注册剪贴板格式号（0 = 注册失败，则不提供该格式）
        effect_cf: u16,
    }

    impl FileDataObject {
        fn new(paths: &[String], copy: bool) -> Self {
            let effect_cf = unsafe {
                RegisterClipboardFormatW(windows::core::w!("Preferred DropEffect"))
            } as u16;
            Self {
                hdrop: crate::commands::clipboard_fs::build_dropfiles_bytes(paths),
                effect: crate::commands::clipboard_fs::preferred_effect_bytes(copy).to_vec(),
                effect_cf,
            }
        }

        fn hdrop_format(&self) -> FORMATETC {
            FORMATETC {
                cfFormat: CF_HDROP.0,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            }
        }

        fn effect_format(&self) -> FORMATETC {
            FORMATETC {
                cfFormat: self.effect_cf,
                ..self.hdrop_format()
            }
        }
    }

    /// 把一段字节复制进可移交给 COM 的全局内存
    fn medium_from_bytes(bytes: &[u8]) -> WinResult<STGMEDIUM> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
            let p = GlobalLock(h);
            if p.is_null() {
                return Err(windows::core::Error::from_thread());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p as *mut u8, bytes.len());
            let _ = GlobalUnlock(h);
            Ok(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: h },
                pUnkForRelease: core::mem::ManuallyDrop::new(None),
            })
        }
    }

    #[allow(non_snake_case)]
    impl IDataObject_Impl for FileDataObject_Impl {
        fn GetData(&self, pformatetc: *const FORMATETC) -> WinResult<STGMEDIUM> {
            if pformatetc.is_null() {
                return Err(windows::core::Error::from_hresult(DV_E_FORMATETC));
            }
            let fmt = unsafe { *pformatetc };
            let bytes: &[u8] = if fmt.cfFormat == CF_HDROP.0 {
                &self.hdrop
            } else if self.effect_cf != 0 && fmt.cfFormat == self.effect_cf {
                &self.effect
            } else {
                return Err(windows::core::Error::from_hresult(DV_E_FORMATETC));
            };
            medium_from_bytes(bytes)
        }

        fn GetDataHere(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *mut STGMEDIUM,
        ) -> WinResult<()> {
            // 我们只提供 HGLOBAL 形态，GetDataHere 不支持（标准做法）
            Err(windows::core::Error::from_hresult(DV_E_FORMATETC))
        }

        fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
            if pformatetc.is_null() {
                return DV_E_FORMATETC;
            }
            let fmt = unsafe { *pformatetc };
            let ok = fmt.cfFormat == CF_HDROP.0
                || (self.effect_cf != 0 && fmt.cfFormat == self.effect_cf);
            if ok {
                S_OK
            } else {
                DV_E_FORMATETC
            }
        }

        fn GetCanonicalFormatEtc(
            &self,
            _pformatectin: *const FORMATETC,
            _pformatetcout: *mut FORMATETC,
        ) -> HRESULT {
            E_NOTIMPL
        }

        fn SetData(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *const STGMEDIUM,
            _frelease: BOOL,
        ) -> WinResult<()> {
            Err(windows::core::Error::from_hresult(E_NOTIMPL))
        }

        fn EnumFormatEtc(&self, dwdirection: u32) -> WinResult<IEnumFORMATETC> {
            if dwdirection != DATADIR_GET.0 as u32 {
                return Err(windows::core::Error::from_hresult(E_NOTIMPL));
            }
            let mut fmts = vec![self.hdrop_format()];
            if self.effect_cf != 0 {
                fmts.push(self.effect_format());
            }
            unsafe { SHCreateStdEnumFmtEtc(&fmts) }
        }

        fn DAdvise(
            &self,
            _pformatetc: *const FORMATETC,
            _advf: u32,
            _padvsink: windows::core::Ref<IAdviseSink>,
        ) -> WinResult<u32> {
            Err(windows::core::Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _dwconnection: u32) -> WinResult<()> {
            Err(windows::core::Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> WinResult<IEnumSTATDATA> {
            Err(windows::core::Error::from_hresult(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    /// 拖放源：松手 → DROP，Esc → CANCEL，其余交给系统默认光标
    #[implement(IDropSource)]
    struct FileDropSource;

    #[allow(non_snake_case)]
    impl IDropSource_Impl for FileDropSource_Impl {
        fn QueryContinueDrag(
            &self,
            fescapepressed: BOOL,
            grfkeystate: MODIFIERKEYS_FLAGS,
        ) -> HRESULT {
            if fescapepressed.as_bool() {
                return DRAGDROP_S_CANCEL;
            }
            if grfkeystate.0 & MK_BUTTONS == 0 {
                return DRAGDROP_S_DROP;
            }
            S_OK
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
            // 让系统用目标（资源管理器）提供的默认光标与缩略图
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    /// 跑一次原生拖放循环，返回落地效果位标志（0 = 取消/失败）
    pub fn drag(paths: &[String], copy: bool) -> Result<u32, String> {
        unsafe {
            // OLE 拖放源要求 STA；S_FALSE 表示本线程已初始化（同样需要配对 CoUninitialize）
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if hr.is_err() {
                return Err(format!("初始化 COM 失败: 0x{:08X}", hr.0 as u32));
            }
            let result = run_drag(paths, copy);
            CoUninitialize();
            result
        }
    }

    fn run_drag(paths: &[String], copy: bool) -> Result<u32, String> {
        unsafe {
            let data: IDataObject = FileDataObject::new(paths, copy).into();
            let source: IDropSource = FileDropSource.into();
            let mut effect = DROPEFFECT_NONE;
            let hr = DoDragDrop(
                &data,
                &source,
                DROPEFFECT(allowed_effects(copy)),
                &mut effect,
            );
            // DRAGDROP_S_DROP / DRAGDROP_S_CANCEL 也是成功码，故只看 is_err
            if hr.is_err() {
                return Err(format!("拖出失败: 0x{:08X}", hr.0 as u32));
            }
            Ok(effect.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_drag_only_allows_copy() {
        assert_eq!(allowed_effects(true), 1);
        assert_eq!(allowed_effects(false), 3);
    }

    #[test]
    fn effect_name_maps_bit_flags() {
        assert_eq!(effect_name(0), "none");
        assert_eq!(effect_name(1), "copy");
        assert_eq!(effect_name(2), "move");
        // 同时带两位（目标「复制 + 移动」）按复制处理：绝不误删源
        assert_eq!(effect_name(3), "copy");
    }
}
