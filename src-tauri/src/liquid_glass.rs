//! Desktop blur surfaces, clipped to the actual material bounds, below the WebViews.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Window};
use windows::{
    core::{s, w, BOOL},
    Win32::{
        Foundation::*, Graphics::Gdi::*, System::LibraryLoader::*, UI::WindowsAndMessaging::*,
    },
};
#[derive(Clone, Deserialize)]
pub struct GlassRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
    #[serde(default)]
    flat_top: bool,
}
#[derive(Clone)]
struct Report {
    owner: isize,
    scale: f64,
    rects: Vec<GlassRect>,
    seen: Instant,
}
static REPORTS: OnceLock<Mutex<HashMap<String, Report>>> = OnceLock::new();
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
fn reports() -> &'static Mutex<HashMap<String, Report>> {
    REPORTS.get_or_init(Default::default)
}
#[tauri::command]
pub fn set_liquid_glass_surfaces(window: Window, rects: Vec<GlassRect>) {
    if !["dock", "main", "start", "sidebar"].contains(&window.label()) {
        return;
    }
    let Ok(hwnd) = window.hwnd() else { return };
    // The dock must never acquire an opaque native backplane. Its center stays
    // genuinely transparent; app pixels supply only its refractive rim.
    let rects = if window.label() == "dock" {
        Vec::new()
    } else {
        rects
    };
    let valid = rects
        .into_iter()
        .take(4)
        .filter(|r| {
            [r.x, r.y, r.width, r.height, r.radius]
                .iter()
                .all(|v| v.is_finite())
                && r.x.abs() < 30000.0
                && r.y.abs() < 30000.0
                && r.radius >= 0.0
                && r.radius < 2000.0
                && r.width > 1.0
                && r.height > 1.0
                && r.width < 20000.0
                && r.height < 10000.0
        })
        .collect();
    if let Ok(mut m) = reports().lock() {
        m.insert(
            window.label().into(),
            Report {
                owner: hwnd.0 as isize,
                scale: window.scale_factor().unwrap_or(1.0),
                rects: valid,
                seen: Instant::now(),
            },
        );
    }
}
#[derive(Serialize)]
pub struct GlassStatus {
    surfaces: usize,
    backend: &'static str,
}
#[tauri::command]
pub fn liquid_glass_status() -> GlassStatus {
    GlassStatus {
        surfaces: ACTIVE.load(Ordering::Relaxed),
        backend:
            "Transparent dock with local app refraction; clipped desktop blur for other surfaces",
    }
}
#[repr(C)]
struct Accent {
    state: i32,
    flags: u32,
    color: u32,
    animation: u32,
}
#[repr(C)]
struct Composition {
    attribute: u32,
    data: *mut core::ffi::c_void,
    size: usize,
}
unsafe fn blur(hwnd: HWND) -> bool {
    // An undrawn Win32 client area is otherwise opaque black. Extend the
    // composited glass frame through the client before applying desktop blur.
    let _ = windows::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea(
        hwnd,
        &windows::Win32::UI::Controls::MARGINS {
            cxLeftWidth: -1,
            cxRightWidth: -1,
            cyTopHeight: -1,
            cyBottomHeight: -1,
        },
    );
    let Ok(module) = GetModuleHandleW(w!("user32.dll")) else {
        return false;
    };
    let Some(f) = GetProcAddress(module, s!("SetWindowCompositionAttribute")) else {
        return false;
    };
    let apply: unsafe extern "system" fn(HWND, *mut Composition) -> BOOL = std::mem::transmute(f);
    let mut accent = Accent {
        state: 3,
        flags: 2,
        color: 0x16ffffff,
        animation: 0,
    };
    let mut data = Composition {
        attribute: 19,
        data: &mut accent as *mut _ as *mut _,
        size: std::mem::size_of::<Accent>(),
    };
    apply(hwnd, &mut data).as_bool()
}
unsafe extern "system" fn proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_NCHITTEST => return LRESULT(HTTRANSPARENT as isize),
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_ERASEBKGND => return LRESULT(1),
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let _ = BeginPaint(hwnd, &mut ps);
            let _ = EndPaint(hwnd, &ps);
            return LRESULT(0);
        }
        _ => {}
    }
    DefWindowProcW(hwnd, msg, w, l)
}
pub fn setup(_app: AppHandle) {
    std::thread::spawn(move || unsafe {
        let module = GetModuleHandleW(None).unwrap_or_default();
        let instance = HINSTANCE(module.0);
        let class = WNDCLASSW {
            lpfnWndProc: Some(proc),
            hInstance: instance,
            lpszClassName: w!("BloomLiquidMaterial"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return;
        }
        let mut surfaces: HashMap<(String, usize), (HWND, (i32, i32, i32, bool))> = HashMap::new();
        while !crate::state::SHUTTING_DOWN.load(Ordering::Relaxed) {
            let snapshot = reports().lock().map(|m| m.clone()).unwrap_or_default();
            let mut wanted = std::collections::HashSet::new();
            for (label, report) in snapshot {
                let owner = HWND(report.owner as *mut _);
                if report.seen.elapsed() > Duration::from_secs(8)
                    || !IsWindow(Some(owner)).as_bool()
                    || !IsWindowVisible(owner).as_bool()
                    || IsIconic(owner).as_bool()
                {
                    continue;
                }
                let mut origin = RECT::default();
                if GetWindowRect(owner, &mut origin).is_err() {
                    continue;
                }
                for (i, r) in report.rects.iter().enumerate() {
                    let key = (label.clone(), i);
                    let width = (r.width * report.scale).round() as i32;
                    let height = (r.height * report.scale).round() as i32;
                    let radius = (r.radius * report.scale).round() as i32;
                    if width < 2 || height < 2 {
                        continue;
                    }
                    let left = origin.left + (r.x * report.scale).round() as i32;
                    let top = origin.top + (r.y * report.scale).round() as i32;
                    if !surfaces.contains_key(&key) {
                        let Ok(hwnd) = CreateWindowExW(
                            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_TOPMOST,
                            w!("BloomLiquidMaterial"),
                            w!("Bloom Liquid Glass"),
                            WS_POPUP | WS_DISABLED,
                            left,
                            top,
                            width,
                            height,
                            None,
                            None,
                            Some(instance),
                            None,
                        ) else {
                            continue;
                        };
                        if !blur(hwnd) {
                            let _ = DestroyWindow(hwnd);
                            continue;
                        }
                        surfaces.insert(key.clone(), (hwnd, (0, 0, 0, false)));
                    }
                    let (hwnd, last) = surfaces.get_mut(&key).unwrap();
                    let shape = (width, height, radius, r.flat_top);
                    if *last != shape {
                        let region =
                            CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);
                        if r.flat_top {
                            let part = CreateRectRgn(0, 0, width, height / 2);
                            let _ = CombineRgn(Some(region), Some(region), Some(part), RGN_OR);
                            let _ = DeleteObject(part.into());
                        }
                        if SetWindowRgn(*hwnd, Some(region), false) == 0 {
                            let _ = DeleteObject(region.into());
                        }
                        *last = shape;
                    }
                    // Insertion after the owning WebView keeps icons and controls above the material.
                    let _ = SetWindowPos(
                        *hwnd,
                        Some(owner),
                        left,
                        top,
                        width,
                        height,
                        SWP_NOACTIVATE | SWP_SHOWWINDOW,
                    );
                    wanted.insert(key);
                }
            }
            surfaces.retain(|key, (hwnd, _)| {
                if !wanted.contains(key) {
                    let _ = DestroyWindow(*hwnd);
                    false
                } else {
                    true
                }
            });
            ACTIVE.store(surfaces.len(), Ordering::Relaxed);
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        for (_, (hwnd, _)) in surfaces {
            let _ = DestroyWindow(hwnd);
        }
        ACTIVE.store(0, Ordering::Relaxed);
    });
}

static CAPTURE_BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct CaptureSlot;
impl Drop for CaptureSlot {
    fn drop(&mut self) {
        CAPTURE_BUSY.store(false, Ordering::Relaxed);
    }
}
#[derive(Serialize)]
pub struct RefractionScene {
    image: String,
    windows: usize,
}
/// A narrow local-only scene behind the dock, composited without Bloom surfaces.
#[tauri::command]
pub async fn dock_refraction_scene(
    window: Window,
    app: AppHandle,
    rect: GlassRect,
) -> Option<RefractionScene> {
    if window.label() != "dock"
        || ![rect.x, rect.y, rect.width, rect.height]
            .iter()
            .all(|v| v.is_finite())
        || rect.width < 1.0
        || rect.width > 16000.0
        || rect.height < 1.0
        || rect.height > 300.0
        || rect.x.abs() > 30000.0
        || rect.y.abs() > 30000.0
    {
        return None;
    }
    if CAPTURE_BUSY
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        return None;
    }
    let slot = CaptureSlot;
    let _ = app;
    let owner = window.hwnd().ok()?.0 as isize;
    let scale = window.scale_factor().ok()?;
    let work = tauri::async_runtime::spawn_blocking(move || unsafe {
        let _slot = slot;
        let mut caller = RECT::default();
        GetWindowRect(HWND(owner as *mut _), &mut caller).ok()?;
        let left = caller.left + ((rect.x - 12.0) * scale).floor() as i32;
        let top = caller.top + ((rect.y - 12.0) * scale).floor() as i32;
        let right = left + ((rect.width + 24.0) * scale).ceil() as i32;
        let bottom = top + ((rect.height + 24.0) * scale).ceil() as i32;
        crate::desktop_scene::capture(RECT{left,top,right,bottom},HWND(owner as *mut _))
            .map(|(image,windows)|RefractionScene{image,windows})
    });
    // A nonresponsive app never stalls Bloom or starts overlapping capture jobs.
    tokio::time::timeout(Duration::from_millis(700), work)
        .await
        .ok()?
        .ok()
        .flatten()
}
