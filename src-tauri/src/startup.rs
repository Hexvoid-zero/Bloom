use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

const PREFERENCE: &str = "bloom-launch-at-login";
const MARKER: &str = "bloom-startup-configured-v2";

fn startup_preference(saved: Option<&str>, configured: bool, registered: bool) -> bool {
    match saved {
        Some("true") => true,
        Some("false") => false,
        _ => !configured || registered,
    }
}

pub fn configure(app: &AppHandle) -> Result<(), String> {
    let saved = crate::utils::get_setting_str(app, PREFERENCE);
    let configured = crate::utils::get_setting_str(app, MARKER).as_deref() == Some("true");
    let registered = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    let enabled = startup_preference(saved.as_deref(), configured, registered);
    set_launch_at_login(app.clone(), enabled)
}

#[tauri::command]
pub fn get_launch_at_login(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        register(&app)?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    crate::commands::save_setting(
        app.clone(),
        PREFERENCE.into(),
        serde_json::json!(enabled.to_string()),
    )?;
    crate::commands::save_setting(app, MARKER.into(), serde_json::json!("true"))?;
    Ok(())
}

fn register(app: &AppHandle) -> Result<(), String> {
    app.autolaunch().enable().map_err(|e| e.to_string())?;
    // An explicitly quoted executable works from the installed directory, which contains spaces.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let value = format!("\"{}\" --autostart", exe.display());
    let reg = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").ok_or("Windows folder unavailable")?,
    )
    .join("System32/reg.exe");
    use std::os::windows::process::CommandExt;
    let result = std::process::Command::new(reg)
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "Bloom Mac Dock",
            "/t",
            "REG_SZ",
            "/d",
            &value,
            "/f",
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err("Windows could not register Bloom at sign-in".into());
    }
    crate::diagnostics::record(
        "startup_registration",
        "enabled: quoted installed executable with --autostart",
    );
    Ok(())
}
pub fn wait_for_shell() {
    if !std::env::args_os().any(|a| a == "--autostart") {
        return;
    }
    for _ in 0..60 {
        if unsafe {
            windows::Win32::UI::WindowsAndMessaging::FindWindowW(
                windows::core::w!("Shell_TrayWnd"),
                None,
            )
        }
        .is_ok()
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

#[cfg(test)]
mod tests {
    use super::startup_preference;
    #[test]
    fn saved_enabled_repairs_missing_registration() {
        assert!(startup_preference(Some("true"), true, false));
    }
    #[test]
    fn saved_opt_out_survives_launches() {
        assert!(!startup_preference(Some("false"), true, true));
        assert!(!startup_preference(Some("false"), false, false));
    }
    #[test]
    fn legacy_preference_migrates_without_losing_opt_out() {
        assert!(startup_preference(None, false, false));
        assert!(startup_preference(None, true, true));
        assert!(!startup_preference(None, true, false));
    }
}
