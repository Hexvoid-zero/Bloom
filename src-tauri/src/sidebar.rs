//! Independent edge surface. No AppBar reservation and no interception outside its region.
use serde::Serialize;
use tauri::{AppHandle, Manager};
use windows::Win32::{
    Foundation::{POINT, RECT},
    UI::WindowsAndMessaging::*,
};

#[derive(Serialize)]
pub struct Environment {
    pub overlap: bool,
    pub edge: bool,
    pub own_focus: bool,
}

#[tauri::command]
pub fn sidebar_environment(
    app: AppHandle,
    right: bool,
    panel_width: f64,
) -> Result<Environment, String> {
    let w = app
        .get_webview_window("sidebar")
        .ok_or("Sidebar unavailable")?;
    let m = w
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Monitor unavailable")?;
    let s = m.scale_factor();
    let origin = m.position();
    let size = m.size();
    let width = (800.0 * s).round().min(size.width as f64) as u32;
    let top = origin.y + (48.0 * s) as i32;
    let height = size.height.saturating_sub((140.0 * s) as u32).max(180);
    let x = if right {
        origin.x + size.width as i32 - width as i32
    } else {
        origin.x
    };
    let desired = tauri::PhysicalPosition::new(x, top);
    if w.outer_position().ok() != Some(desired) {
        let _ = w.set_position(desired);
    }
    let dimensions = tauri::PhysicalSize::new(width, height);
    if w.inner_size().ok() != Some(dimensions) {
        let _ = w.set_size(dimensions);
    }
    let enabled = crate::utils::get_setting_str(&app, "bloom-sidebar-preferences")
        .and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok())
        .and_then(|v| v.get("enabled").and_then(|v| v.as_bool()))
        .unwrap_or(true);
    if enabled {
        if !w.is_visible().unwrap_or(false) {
            let _ = w.show();
        }
    } else {
        let _ = w.hide();
    }
    unsafe {
        let mut p = POINT::default();
        let _ = GetCursorPos(&mut p);
        let edge = if right {
            p.x >= origin.x + size.width as i32 - 4
        } else {
            p.x <= origin.x + 3
        };
        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let own_focus = pid == std::process::id();
        let mut r = RECT::default();
        let mut class = [0u16; 128];
        let len = GetClassNameW(hwnd, &mut class);
        let shell = matches!(
            String::from_utf16_lossy(&class[..len.max(0) as usize]).as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd"
        );
        let pw = (panel_width.clamp(50.0, 760.0) * s) as i32;
        let (left, right_edge) = if right {
            (
                origin.x + size.width as i32 - pw,
                origin.x + size.width as i32,
            )
        } else {
            (origin.x, origin.x + pw)
        };
        let overlap = !own_focus
            && !shell
            && !IsIconic(hwnd).as_bool()
            && GetWindowRect(hwnd, &mut r).is_ok()
            && r.left < right_edge
            && r.right > left
            && r.bottom > top
            && r.top < top + height as i32;
        Ok(Environment {
            overlap,
            edge: edge && p.y >= top && p.y < top + height as i32,
            own_focus,
        })
    }
}

pub fn initialize(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("sidebar") {
        let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
        if let Ok(h) = w.hwnd() {
            crate::utils::set_click_through(h, false);
        }
    }
}
