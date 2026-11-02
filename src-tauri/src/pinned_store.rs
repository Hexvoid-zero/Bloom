//! Ordered dock layout on disk. A valid empty array is an intentional layout.
use crate::types::AppInfo;
use std::path::{Path, PathBuf};

pub fn layout_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE").ok_or("User profile is unavailable")?;
    Ok(PathBuf::from(home).join(".bloom-macdock/pinned_apps.json"))
}
pub fn load_migrating(path: &Path, legacy: &Path) -> Result<Option<Vec<AppInfo>>, String> {
    if let Some(apps) = load(path)? {
        return Ok(Some(apps));
    }
    if let Some(apps) = load(legacy)? {
        save(path, &apps)?;
        return Ok(Some(apps));
    }
    Ok(None)
}

fn backup(path: &Path) -> PathBuf {
    path.with_file_name("pinned_apps.backup.json")
}
fn read(path: &Path) -> Result<Option<(Vec<AppInfo>, Vec<u8>)>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not read dock layout: {e}")),
    };
    let apps = serde_json::from_slice(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes))
        .map_err(|e| format!("Saved dock layout is invalid: {e}"))?;
    Ok(Some((apps, bytes)))
}
pub fn load(path: &Path) -> Result<Option<Vec<AppInfo>>, String> {
    let _guard = crate::state::PINNED_FILE_LOCK
        .lock()
        .map_err(|e| e.to_string())?;
    match read(path) {
        Ok(Some((apps, bytes))) => {
            if !backup(path).exists() {
                crate::utils::atomic_write_file(&backup(path), &bytes)?;
            }
            Ok(Some(apps))
        }
        current => {
            if let Ok(Some((apps, bytes))) = read(&backup(path)) {
                if path.exists() {
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos();
                    let preserved = path.with_file_name(format!(
                        "pinned_apps.corrupt-{stamp}-{}.json",
                        std::process::id()
                    ));
                    std::fs::copy(path, preserved)
                        .map_err(|e| format!("Could not preserve damaged dock layout: {e}"))?;
                }
                crate::utils::atomic_write_file(path, &bytes)?;
                Ok(Some(apps))
            } else {
                current.map(|_| None)
            }
        }
    }
}
pub fn save(path: &Path, apps: &[AppInfo]) -> Result<(), String> {
    let _guard = crate::state::PINNED_FILE_LOCK
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec(apps).map_err(|e| e.to_string())?;
    if let Some((_, previous)) = read(path)? {
        if previous == bytes {
            return Ok(());
        }
        crate::utils::atomic_write_file(&backup(path), &previous)?;
    }
    crate::utils::atomic_write_file(path, &bytes)?;
    // The initial layout also has a recovery copy before the first edit.
    if !backup(path).exists() {
        crate::utils::atomic_write_file(&backup(path), &bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("bloom-pin-store-{stamp}-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        dir.join("pinned_apps.json")
    }
    fn pin(name: &str) -> AppInfo {
        serde_json::from_value(
            serde_json::json!({"name":name,"path":"C:\\Chrome\\chrome.exe","is_running":false}),
        )
        .unwrap()
    }
    fn names(apps: Vec<AppInfo>) -> Vec<String> {
        apps.into_iter().map(|a| a.name).collect()
    }
    #[test]
    fn ordered_pwas_survive_fresh_disk_load() {
        let p = fixture();
        save(&p, &[pin("B"), pin("A")]).unwrap();
        assert_eq!(names(load(&p).unwrap().unwrap()), vec!["B", "A"]);
    }
    #[test]
    fn empty_is_a_saved_layout() {
        let p = fixture();
        save(&p, &[]).unwrap();
        assert!(load(&p).unwrap().unwrap().is_empty());
    }
    #[test]
    fn missing_layout_is_distinct_from_empty() {
        assert!(load(&fixture()).unwrap().is_none());
    }
    #[test]
    fn corrupt_main_recovers_previous_order_and_preserves_damage() {
        let p = fixture();
        save(&p, &[pin("A"), pin("B")]).unwrap();
        save(&p, &[pin("B"), pin("A")]).unwrap();
        std::fs::write(&p, b"{broken").unwrap();
        assert_eq!(names(load(&p).unwrap().unwrap()), vec!["A", "B"]);
        assert!(std::fs::read_dir(p.parent().unwrap()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("corrupt-")));
    }
    #[test]
    fn missing_main_recovers_backup() {
        let p = fixture();
        save(&p, &[pin("A")]).unwrap();
        std::fs::remove_file(&p).unwrap();
        assert_eq!(names(load(&p).unwrap().unwrap()), vec!["A"]);
        assert!(p.exists());
    }
    #[test]
    fn invalid_file_without_backup_is_never_overwritten() {
        let p = fixture();
        std::fs::write(&p, b"broken").unwrap();
        assert!(load(&p).is_err());
        assert!(save(&p, &[]).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"broken");
    }
    #[test]
    fn bom_layout_preserves_order() {
        let p = fixture();
        let mut b = vec![0xef, 0xbb, 0xbf];
        b.extend(serde_json::to_vec(&vec![pin("B"), pin("A")]).unwrap());
        std::fs::write(&p, b).unwrap();
        assert_eq!(names(load(&p).unwrap().unwrap()), vec!["B", "A"]);
    }
    #[test]
    fn migration_keeps_exact_order_and_does_not_replace_a_newer_layout() {
        let legacy = fixture();
        let stable = fixture();
        save(&legacy, &[pin("B"), pin("A")]).unwrap();
        assert_eq!(
            names(load_migrating(&stable, &legacy).unwrap().unwrap()),
            vec!["B", "A"]
        );
        save(&stable, &[]).unwrap();
        assert!(load_migrating(&stable, &legacy)
            .unwrap()
            .unwrap()
            .is_empty());
    }
}
