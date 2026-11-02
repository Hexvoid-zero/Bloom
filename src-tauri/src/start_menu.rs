//! Bloom's optional Start surface. This changes no Windows shell registration:
//! the native Start menu remains available from an explicit fallback action.
use serde::Serialize;
use std::sync::atomic::{AtomicI64, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use windows::core::PCWSTR;
static LAST_BLUR_MS: AtomicI64 = AtomicI64::new(0);

pub fn enabled(app: &AppHandle) -> bool {
    crate::utils::get_setting_str(app, "bloom-start-preferences")
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("enabled").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

fn menu_geometry(width: f64, height: f64) -> (f64, f64, f64, f64) {
    let menu_width = (width - 32.0).clamp(240.0, 1120.0).min(width);
    let menu_height = (height - 120.0).clamp(240.0, 790.0).min(height);
    (
        (width - menu_width) / 2.0,
        (height - menu_height - 88.0).max(0.0),
        menu_width,
        menu_height,
    )
}

fn mac_menu_geometry(width: f64, height: f64) -> (f64, f64, f64, f64) {
    let w = 440.0_f64.min((width - 20.0).max(240.0)).min(width);
    let h = 548.0_f64.min((height - 100.0).max(240.0)).min(height);
    ((width - w) / 2.0, (height - h - 82.0).max(0.0), w, h)
}

#[tauri::command]
pub fn layout_bloom_start(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("start").ok_or("Start window is unavailable")?;
    if let Some(monitor) = window.primary_monitor().map_err(|e| e.to_string())? {
        let scale = monitor.scale_factor();
        let sw = f64::from(monitor.size().width) / scale;
        let sh = f64::from(monitor.size().height) / scale;
        let mac = crate::utils::get_setting_str(&app, "bloom-start-preferences")
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .is_some_and(|v| v.get("style").and_then(|v| v.as_str()) == Some("macos"));
        let (x, y, width, height) = if mac { mac_menu_geometry(sw, sh) } else { menu_geometry(sw, sh) };
        window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        window.set_position(tauri::PhysicalPosition::new(monitor.position().x + (x * scale).round() as i32, monitor.position().y + (y * scale).round() as i32)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Called by the dock command and by the physical Win-key hook.
pub fn toggle(app: &AppHandle) -> Result<(), String> {
    if crate::utils::get_now_ms().saturating_sub(LAST_BLUR_MS.load(Ordering::Relaxed)) < 180 {
        return Ok(());
    }
    if !enabled(app) {
        return open_native_start(app.clone());
    }
    let window = app
        .get_webview_window("start")
        .ok_or("Start window is unavailable")?;
    if window.is_visible().map_err(|e| e.to_string())? {
        return window.hide().map_err(|e| e.to_string());
    }
    layout_bloom_start(app.clone())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    let _ = app.emit("bloom-start-opened", ());
    Ok(())
}

pub fn install_lifecycle(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("start") {
        let handle = window.clone();
        window.on_window_event(move |event| match event {
            tauri::WindowEvent::Focused(false) => {
                LAST_BLUR_MS.store(crate::utils::get_now_ms(), Ordering::Relaxed);
                let _ = handle.hide();
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = handle.hide();
            }
            _ => {}
        });
    }
}

#[tauri::command]
pub fn toggle_bloom_start(app: AppHandle) -> Result<(), String> {
    toggle(&app)
}

#[tauri::command]
pub fn hide_bloom_start(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("start") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_native_start(app: AppHandle) -> Result<(), String> {
    hide_bloom_start(app)?;
    // Ctrl+Escape opens Windows Start without re-entering Bloom's physical Win
    // tap hook. Send all four events together so no modifier is left held.
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
        VK_ESCAPE,
    };
    let inputs = [
        (VK_CONTROL, false),
        (VK_ESCAPE, false),
        (VK_ESCAPE, true),
        (VK_CONTROL, true),
    ]
    .map(|(key, up)| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    });
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 {
        Ok(())
    } else {
        Err("Windows could not open native Start".into())
    }
}

#[derive(Serialize)]
pub struct StartContext {
    pub username: String,
}

#[tauri::command]
pub fn get_start_context() -> StartContext {
    StartContext {
        username: std::env::var("USERNAME").unwrap_or_else(|_| "Your account".into()),
    }
}

#[derive(Serialize)]
pub struct PhoneSummary {
    pub name: String,
    pub connected: bool,
    pub battery: Option<u8>,
}

#[derive(Serialize)]
pub struct PhoneLinkStatus {
    pub installed: bool,
    pub status: &'static str,
    pub phones: Vec<PhoneSummary>,
    pub detail: String,
}

fn phone_handler_registered() -> bool {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ,
    };
    let path: Vec<u16> = "ms-phone".encode_utf16().chain(Some(0)).collect();
    let mut key = HKEY::default();
    unsafe {
        if RegOpenKeyExW(
            HKEY_CLASSES_ROOT,
            PCWSTR(path.as_ptr()),
            Some(0),
            KEY_READ,
            &mut key,
        )
        .is_ok()
        {
            let _ = RegCloseKey(key);
            true
        } else {
            false
        }
    }
}

#[tauri::command]
pub async fn get_phone_link_status() -> PhoneLinkStatus {
    let installed = phone_handler_registered();
    let devices = crate::bluetooth::bluetooth_list_devices().await;
    let bluetooth_available = devices.is_ok();
    let phones = devices
        .unwrap_or_default()
        .into_iter()
        .filter(|device| device.kind == "phone")
        .map(|device| PhoneSummary {
            name: device.name,
            connected: device.connected,
            battery: device.battery,
        })
        .collect();
    PhoneLinkStatus {
        installed,
        status: if installed { "available" } else { "unknown" },
        phones,
        detail: format!("{}. {} Phone Link messages, notifications and connection state are managed in the Phone Link app.",
            if installed { "Phone Link's launch handler is registered" } else { "Phone Link availability could not be confirmed" },
            if bluetooth_available { "Device status below comes from Windows Bluetooth." } else { "Bluetooth device status is unavailable." }),
    }
}

fn phone_uri(action: &str) -> Option<&'static str> {
    match action {
        "open" | "messages" | "calls" | "photos" | "files" => Some("ms-phone:"),
        "settings" => Some("ms-settings:mobile-devices"),
        _ => None,
    }
}

fn launch_uri(uri: &str) -> Result<(), String> {
    use windows::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let uri: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR::null(),
            PCWSTR(uri.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("Windows could not open this destination".into())
    }
}

#[tauri::command]
pub fn phone_link_action(app: AppHandle, action: String) -> Result<(), String> {
    let uri = phone_uri(&action).ok_or("Unknown Phone Link action")?;
    launch_uri(uri)?;
    hide_bloom_start(app)
}

fn system_uri(action: &str) -> Option<&'static str> {
    match action {
        "settings" => Some("ms-settings:"),
        "power-settings" => Some("ms-settings:powersleep"),
        "bluetooth" => Some("ms-settings:bluetooth"),
        "display" => Some("ms-settings:display"),
        "network" => Some("ms-settings:network"),
        "airplane-mode" => Some("ms-settings:network-airplanemode"),
        "night-light" => Some("ms-settings:nightlight"),
        "hotspot" => Some("ms-settings:network-mobilehotspot"),
        "sound" => Some("ms-settings:sound-devices"),
        "notifications" => Some("ms-settings:notifications"),
        "accessibility" => Some("ms-settings:easeofaccess-display"),
        "focus" => Some("ms-settings:quiethours"),
        "vpn" => Some("ms-settings:network-vpn"),
        "personalization" => Some("ms-settings:personalization"),
        "explorer" => Some("shell:MyComputerFolder"),
        "documents" => Some("shell:Personal"),
        "downloads" => Some("shell:Downloads"),
        _ => None,
    }
}

#[tauri::command]
pub fn start_system_action(app: AppHandle, action: String) -> Result<(), String> {
    if action == "projection" {
        use std::os::windows::process::CommandExt;
        let root = std::env::var_os("SystemRoot").ok_or("Windows folder unavailable")?;
        std::process::Command::new(
            std::path::PathBuf::from(root).join("System32/DisplaySwitch.exe"),
        )
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| e.to_string())?;
        return hide_bloom_start(app);
    }
    if action == "lock" {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .arg("user32.dll,LockWorkStation")
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        return hide_bloom_start(app);
    }
    if action == "native-start" {
        return open_native_start(app);
    }
    if action == "phone-link" {
        return phone_link_action(app, "open".into());
    }
    let uri = system_uri(&action).ok_or("Unknown Start action")?;
    launch_uri(uri)?;
    hide_bloom_start(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn geometry_fits_small_scaled_displays() {
        for (width, height) in [
            (2560.0, 1440.0),
            (1280.0, 720.0),
            (853.0, 480.0),
            (200.0, 180.0),
        ] {
            let (x, y, w, h) = menu_geometry(width, height);
            assert!(x >= 0.0 && y >= 0.0 && x + w <= width && y + h <= height);
            assert!(w <= 1120.0 && h <= 790.0);
        }
    }
    #[test]
    fn phone_actions_only_launch_fixed_destinations() {
        for action in ["open", "messages", "calls", "photos", "files"] {
            assert_eq!(phone_uri(action), Some("ms-phone:"));
        }
        assert_eq!(phone_uri("settings"), Some("ms-settings:mobile-devices"));
        assert_eq!(phone_uri("ms-phone:;calc.exe"), None);
    }
    #[test]
    fn system_actions_reject_arbitrary_commands_and_power_actions() {
        for action in [
            "shutdown",
            "restart",
            "cmd.exe",
            "https://example.com",
            "C:\\Windows",
        ] {
            assert!(system_uri(action).is_none());
        }
        assert_eq!(system_uri("downloads"), Some("shell:Downloads"));
    }
}

#[cfg(test)]mod mac_tests{
 use super::mac_menu_geometry;
 #[test]fn mac_panel_matches_reference_size(){let (x,y,w,h)=mac_menu_geometry(1920.,1080.);assert_eq!((w,h),(440.,548.));assert_eq!(x,740.);assert!(y+h<1080.);}
 #[test]fn mac_panel_stays_inside_small_displays(){for (sw,sh) in [(320.,480.),(640.,480.),(2560.,1440.)]{let(x,y,w,h)=mac_menu_geometry(sw,sh);assert!(x>=0.&&y>=0.&&x+w<=sw&&y+h<=sh);}}
}
