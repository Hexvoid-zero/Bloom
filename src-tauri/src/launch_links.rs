//! Keep Bloom-owned copies of launch shortcuts, independent of Explorer taskbar pins.
use crate::types::AppInfo;
use std::path::{Path, PathBuf};
fn folder() -> Option<PathBuf> {
    Some(
        PathBuf::from(std::env::var_os("USERPROFILE")?)
            .join(".bloom-macdock")
            .join("shortcuts"),
    )
}
fn hash(text: &str) -> u64 {
    text.as_bytes().iter().fold(0xcbf29ce484222325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}
pub fn keep_link(app: &mut AppInfo) -> Result<(), String> {
    let source = Path::new(&app.path);
    if !app.path.to_lowercase().ends_with(".lnk") || !source.is_file() {
        return Ok(());
    }
    let root = folder().ok_or("User profile unavailable")?;
    if source.starts_with(&root) {
        return Ok(());
    }
    if std::fs::metadata(source).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Err("Launch shortcut is unexpectedly large".into());
    }
    let dir = root.join(format!("{:016x}", hash(&app.path.to_lowercase())));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(source.file_name().ok_or("Shortcut filename missing")?);
    let bytes = std::fs::read(source).map_err(|e| e.to_string())?;
    if std::fs::read(&dest).ok().as_deref() != Some(bytes.as_slice()) {
        crate::utils::atomic_write_file(&dest, &bytes)?;
    }
    app.path = dest.to_string_lossy().into_owned();
    Ok(())
}
pub fn owned_shortcuts() -> Vec<PathBuf> {
    let Some(root) = folder() else {
        return vec![];
    };
    let mut files = Vec::new();
    if let Ok(dirs) = std::fs::read_dir(root) {
        for dir in dirs.flatten() {
            if let Ok(children) = std::fs::read_dir(dir.path()) {
                for file in children.flatten() {
                    if file
                        .path()
                        .extension()
                        .is_some_and(|x| x.eq_ignore_ascii_case("lnk"))
                    {
                        files.push(file.path());
                    }
                }
            }
        }
    }
    files
}
pub fn repair_missing(app: &mut AppInfo, catalog: &[AppInfo]) {
    if Path::new(&app.path).exists() || (!app.path.contains('\\') && !app.path.contains('/')) {
        return;
    }
    let found: Vec<_> = catalog
        .iter()
        .filter(|a| a.name.eq_ignore_ascii_case(&app.name) && a.path != app.path)
        .collect();
    if found.len() == 1 {
        app.path = found[0].path.clone();
        app.executable = found[0].executable.clone();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn app(name: &str, path: &str) -> AppInfo {
        serde_json::from_value(serde_json::json!({"name":name,"path":path,"is_running":false}))
            .unwrap()
    }
    #[test]
    fn missing_link_uses_only_an_unambiguous_installed_app() {
        let mut pin = app("Editor", "C:\\missing.lnk");
        repair_missing(&mut pin, &[app("Editor", "Vendor.Editor!App")]);
        assert_eq!(pin.path, "Vendor.Editor!App");
        let mut ambiguous = app("Editor", "C:\\missing.lnk");
        repair_missing(
            &mut ambiguous,
            &[app("Editor", "A!App"), app("Editor", "B!App")],
        );
        assert_eq!(ambiguous.path, "C:\\missing.lnk");
    }
}
