use serde::Serialize;
use tauri::AppHandle;
#[derive(Serialize)]
pub struct PinLaunchCheck {
    pub name: String,
    pub path: String,
    pub ready: bool,
    pub kind: &'static str,
    pub app_id: Option<String>,
    pub detail: String,
}
#[tauri::command]
pub async fn audit_pinned_launches(app: AppHandle) -> Result<Vec<PinLaunchCheck>, String> {
    let catalog = crate::commands::get_installed_apps().await;
    let pins = crate::commands::load_pinned_apps(app).await?;
    Ok(pins.into_iter().map(|pin|{
        let path=std::path::Path::new(&pin.path);
        let (kind,ready,detail)=if pin.path=="bloom-settings"{("internal",true,"Bloom settings".into())}
        else if pin.path.to_lowercase().ends_with(".lnk"){("shortcut",path.is_file(),"Windows Shell shortcut; embedded arguments and advertised-install identities are preserved".into())}
        else if pin.path.contains('!')&&!pin.path.contains(":\\"){let ready=catalog.iter().any(|a|a.path.eq_ignore_ascii_case(&pin.path));("packaged-app",ready,"Stable Windows app identity rather than a versioned installation folder".into())}
        else{("file",path.exists(),"Executable or Shell target".into())};
        PinLaunchCheck{name:pin.name,path:pin.path,app_id:pin.app_id,ready,kind,detail}
    }).collect())
}
