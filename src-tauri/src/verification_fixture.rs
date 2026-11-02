//! Task-owned visual test window. It never modifies user applications.
use windows::{
    core::w,
    Win32::{
        Foundation::*, Graphics::Gdi::*, System::LibraryLoader::GetModuleHandleW,
        UI::Input::KeyboardAndMouse::SetFocus, UI::WindowsAndMessaging::*,
    },
};
unsafe extern "system" fn proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == WM_DESTROY {
        PostQuitMessage(0);
        return LRESULT(0);
    }
    if msg == WM_PAINT || msg == WM_PRINTCLIENT {
        let mut ps = PAINTSTRUCT::default();
        let dc = if msg == WM_PAINT {
            BeginPaint(hwnd, &mut ps)
        } else {
            HDC(w.0 as *mut _)
        };
        let mut r = RECT::default();
        let _ = GetClientRect(hwnd, &mut r);
        let colors = [
            0x004d53e8u32,
            0x00ed923a,
            0x0084c02f,
            0x00edcf42,
            0x009649c9,
            0x0033a9f1,
        ];
        for x in 0..((r.right + 119) / 120) {
            let rect = RECT {
                left: x * 120,
                top: 0,
                right: (x + 1) * 120,
                bottom: r.bottom,
            };
            let b = CreateSolidBrush(COLORREF(colors[x as usize % colors.len()]));
            let _ = FillRect(dc, &rect, b);
            let _ = DeleteObject(b.into());
        }
        let pen = CreatePen(PS_SOLID, 3, COLORREF(0x00ffffff));
        let old = SelectObject(dc, pen.into());
        for y in (0..r.bottom).step_by(32) {
            let _ = MoveToEx(dc, 0, y, None);
            let _ = LineTo(dc, r.right, y);
        }
        let _ = SelectObject(dc, old);
        let _ = DeleteObject(pen.into());
        let _ = SetBkMode(dc, TRANSPARENT);
        let _ = SetTextColor(dc, COLORREF(0x00ffffff));
        let text: Vec<u16> =
            "Bloom glass verification · colored content continues beneath the dock"
                .encode_utf16()
                .collect();
        let _ = TextOutW(dc, 32, 38, &text);
        if msg == WM_PAINT {
            let _ = EndPaint(hwnd, &ps);
        }
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, w, l)
}
pub fn run_if_fixture() -> bool {
    if !std::env::args_os().any(|a| {
        a == "--material-fixture"
            || a == "--window-controls-fixture"
            || a == "--voice-writing-fixture"
    }) {
        return false;
    }
    unsafe {
        let module = GetModuleHandleW(None).unwrap_or_default();
        let instance = HINSTANCE(module.0);
        let class = WNDCLASSW {
            lpfnWndProc: Some(proc),
            hInstance: instance,
            lpszClassName: w!("BloomMaterialFixture"),
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            ..Default::default()
        };
        let _ = RegisterClassW(&class);
        if let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("BloomMaterialFixture"),
            w!("Bloom material verification"),
            WS_OVERLAPPEDWINDOW,
            240,
            180,
            1000,
            620,
            None,
            None,
            Some(instance),
            None,
        ) {
            if std::env::args_os().any(|a| a == "--voice-writing-fixture") {
                let _ = SetWindowTextW(hwnd, w!("Bloom voice writing verification"));
                if let Ok(edit) = CreateWindowExW(
                    WS_EX_CLIENTEDGE,
                    w!("EDIT"),
                    w!(""),
                    WS_CHILD
                        | WS_VISIBLE
                        | WS_TABSTOP
                        | WS_VSCROLL
                        | WINDOW_STYLE(ES_MULTILINE as u32 | ES_AUTOVSCROLL as u32),
                    40,
                    90,
                    860,
                    400,
                    Some(hwnd),
                    None,
                    Some(instance),
                    None,
                ) {
                    let _ = SetFocus(Some(edit));
                }
            }
            let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
    true
}
