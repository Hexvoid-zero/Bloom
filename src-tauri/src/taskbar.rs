use crate::types::AppInfo;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

static IMPORT_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn shortcut_directory() -> Option<PathBuf> {
    Some(
        PathBuf::from(std::env::var_os("APPDATA")?)
            .join("Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar"),
    )
}

pub(crate) fn browser_executable(name: &str) -> String {
    name.to_lowercase().replace("_proxy.exe", ".exe")
}

pub(crate) fn pinned_shortcuts() -> Vec<PathBuf> {
    let Some(dir) = shortcut_directory() else {
        return vec![];
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut paths: Vec<_> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")))
        .collect();
    paths.sort_by_key(|p| p.file_name().map(|s| s.to_string_lossy().to_lowercase()));
    paths
}

fn pin_key(pin: &AppInfo) -> String {
    let path = pin.path.replace('/', "\\").to_lowercase();
    if path.ends_with(".lnk") {
        if let Some((target, args)) = crate::utils::resolve_shortcut(&pin.path) {
            return format!(
                "{}|{}",
                target.replace('/', "\\").to_lowercase(),
                args.trim()
            );
        }
        if pin.name.eq_ignore_ascii_case("File Explorer") {
            return format!(
                "{}\\explorer.exe|",
                std::env::var("WINDIR")
                    .unwrap_or_else(|_| "C:\\Windows".into())
                    .to_lowercase()
            );
        }
    }
    format!("{path}|")
}

fn merge_pins(mut existing: Vec<AppInfo>, incoming: Vec<AppInfo>) -> Vec<AppInfo> {
    let mut keys: std::collections::HashSet<_> = existing.iter().map(pin_key).collect();
    for pin in incoming {
        if keys.insert(pin_key(&pin)) {
            existing.push(pin);
        }
    }
    existing
}

pub(crate) fn import_once(app: &tauri::AppHandle, existing: Vec<AppInfo>) -> Vec<AppInfo> {
    let Ok(_lock) = IMPORT_LOCK.lock() else {
        return existing;
    };
    let Ok(dir) = app.path().app_config_dir() else {
        return existing;
    };
    let marker = dir.join("taskbar-import-v1.json");
    if marker.exists() {
        return existing;
    }
    let initialized = unsafe {
        windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        )
        .is_ok()
    };
    let incoming: Vec<_> = pinned_shortcuts()
        .into_iter()
        .map(|path| {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let path = path.to_string_lossy().to_string();
            let executable = crate::utils::resolve_shortcut(&path)
                .and_then(|(target, _)| {
                    std::path::Path::new(&target)
                        .file_name()
                        .map(|n| browser_executable(&n.to_string_lossy()))
                })
                .or_else(|| (name == "File Explorer").then(|| "explorer.exe".into()));
            AppInfo {
                name,
                path,
                icon: None,
                executable,
                is_running: false,
                hwnd: None,
                all_hwnds: None,
                app_id: None,
            }
        })
        .collect();
    let count = incoming.len();
    let merged = merge_pins(existing.clone(), incoming);
    if initialized {
        unsafe {
            windows::Win32::System::Com::CoUninitialize();
        }
    }
    if count == 0 {
        return existing;
    }
    match crate::commands::save_pinned_apps(app.clone(), merged.clone()) {
        Ok(()) => {
            let _ = crate::utils::atomic_write_file(
                &marker,
                format!(
                    "{{\"taskbarShortcuts\":{count},\"totalPins\":{}}}",
                    merged.len()
                )
                .as_bytes(),
            );
            merged
        }
        Err(error) => {
            crate::diagnostics::record("taskbar_import", &error);
            existing
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pin(path: &str) -> AppInfo {
        AppInfo {
            name: path.into(),
            path: path.into(),
            icon: None,
            is_running: false,
            hwnd: None,
            executable: None,
            all_hwnds: None,
            app_id: None,
        }
    }
    #[test]
    fn import_preserves_pins_and_deduplicates_only_matching_targets() {
        let pins = merge_pins(
            vec![pin("C:\\Apps\\A.exe")],
            vec![pin("c:/apps/a.exe"), pin("C:\\Apps\\B.exe")],
        );
        assert_eq!(pins.len(), 2);
        assert_eq!(pins[0].path, "C:\\Apps\\A.exe");
    }
    #[test]
    fn proxy_executables_match_the_browser_without_losing_shortcut_arguments() {
        assert_eq!(browser_executable("chrome_proxy.exe"), "chrome.exe");
        assert_eq!(browser_executable("msedge_proxy.exe"), "msedge.exe");
    }
}
