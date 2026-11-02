use serde::Serialize;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
};

#[derive(Clone, Serialize)]
pub struct ActiveApp {
    pub name: String,
    pub hwnd: isize,
    pub color: [u8; 3],
}

fn median_color(mut samples: Vec<[u8; 3]>) -> [u8; 3] {
    if samples.is_empty() {
        return [30, 32, 38];
    }
    // A median resists text, selection highlights and small status icons.
    samples.sort_by_key(|rgb| {
        u32::from(rgb[0]) * 299 + u32::from(rgb[1]) * 587 + u32::from(rgb[2]) * 114
    });
    samples[samples.len() / 2]
}

fn inspect_foreground(app: &tauri::AppHandle) -> Option<ActiveApp> {
    unsafe {
        let mut hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            // Opening a Bloom menu must not replace the real application's tint.
            let focus = crate::state::FOCUS_TIMESTAMPS.get()?.lock().ok()?;
            hwnd = HWND(*focus.iter().max_by_key(|(_, at)| **at)?.0 as *mut _);
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        let mut class = [0u16; 128];
        let len = GetClassNameW(hwnd, &mut class);
        let class = String::from_utf16_lossy(&class[..len.max(0) as usize]);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return None;
        }
        let path = crate::commands::process_image_path(pid)?;
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        if rect.right - rect.left < 100 || rect.bottom - rect.top < 80 {
            return None;
        }
        let monitor = app.primary_monitor().ok().flatten()?;
        let size = monitor.size();
        let origin = monitor.position();
        // Sample the application's visible bottom edge, above Bloom's reserved strip.
        let reserve = (72.0 * crate::utils::get_bloom_scale(app) * monitor.scale_factor()) as i32;
        let y = (rect.bottom - 18)
            .min(origin.y + size.height as i32 - reserve - 8)
            .max(origin.y);
        let dc = GetDC(None);
        let mut samples = Vec::new();
        for part in [1, 2, 3, 4, 5, 6, 7, 8, 9] {
            let x = (rect.left + (rect.right - rect.left) * part / 10)
                .clamp(origin.x, origin.x + size.width as i32 - 1);
            let value = GetPixel(dc, x, y).0;
            if value != u32::MAX {
                samples.push([
                    (value & 255) as u8,
                    ((value >> 8) & 255) as u8,
                    ((value >> 16) & 255) as u8,
                ]);
            }
        }
        ReleaseDC(None, dc);
        let mut title = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title);
        let title = String::from_utf16_lossy(&title[..title_len.max(0) as usize]);
        let aumid = crate::utils::get_window_app_user_model_id(hwnd);
        let shortcut_name =
            crate::commands::browser_shortcut_for_window(hwnd, &path).and_then(|p| {
                std::path::Path::new(&p)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
            });
        let name = if let Some(name) = shortcut_name {
            name
        } else if aumid
            .as_deref()
            .is_some_and(crate::commands::is_browser_pwa_aumid)
        {
            title
                .split(" - ")
                .next()
                .unwrap_or(&title)
                .trim()
                .to_string()
        } else {
            crate::commands::app_display_name(&path, aumid.as_deref())
        };
        Some(ActiveApp {
            name,
            hwnd: hwnd.0 as isize,
            color: median_color(samples),
        })
    }
}

#[tauri::command]
pub async fn get_active_app_appearance(app: tauri::AppHandle) -> Option<ActiveApp> {
    tauri::async_runtime::spawn_blocking(move || {
        let initialized = unsafe {
            windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            )
            .is_ok()
        };
        let active = inspect_foreground(&app);
        if initialized {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
        active
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    #[test]
    fn edge_color_ignores_isolated_text_and_highlights() {
        assert_eq!(
            super::median_color(vec![
                [255, 255, 255],
                [24, 26, 30],
                [24, 26, 30],
                [0, 120, 255],
                [24, 26, 30]
            ]),
            [24, 26, 30]
        );
    }
}
