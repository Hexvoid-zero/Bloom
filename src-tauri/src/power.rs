use serde::Deserialize;
use tauri::AppHandle;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PowerAction {
    Lock,
    Sleep,
    Shutdown,
    Restart,
}
fn system_program(name: &str) -> Result<std::path::PathBuf, String> {
    Ok(std::path::PathBuf::from(
        std::env::var_os("SystemRoot").ok_or("Windows folder unavailable")?,
    )
    .join("System32")
    .join(name))
}
#[tauri::command]
pub async fn power_action(app: AppHandle, action: PowerAction) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    match action {
        PowerAction::Sleep => tauri::async_runtime::spawn_blocking(|| {
            if unsafe { windows::Win32::System::Power::SetSuspendState(false, false, false) } {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error().to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())?,
        PowerAction::Lock => {
            std::process::Command::new(system_program("rundll32.exe")?)
                .arg("user32.dll,LockWorkStation")
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        PowerAction::Shutdown | PowerAction::Restart => {
            // No /f: Windows must preserve applications' normal unsaved-work handling.
            let flag = if matches!(action, PowerAction::Shutdown) {
                "/s"
            } else {
                "/r"
            };
            std::process::Command::new(system_program("shutdown.exe")?)
                .args([flag, "/t", "0"])
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|e| e.to_string())?;
            crate::commands::quit_bloom(app).await;
            Ok(())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_four_known_power_actions_are_accepted() {
        for a in ["lock", "sleep", "shutdown", "restart"] {
            assert!(serde_json::from_value::<PowerAction>(serde_json::json!(a)).is_ok());
        }
        for a in ["hibernate", "shutdown /f", "restart & calc", ""] {
            assert!(serde_json::from_value::<PowerAction>(serde_json::json!(a)).is_err());
        }
    }
}
