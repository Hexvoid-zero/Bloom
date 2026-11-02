//! Local dictation. Audio never leaves this PC. No Wispr binaries or private endpoints.
use base64::Engine;
use serde::Serialize;
use std::{
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

static LAST: Mutex<(isize, u32)> = Mutex::new((0, 0));
static TARGET: Mutex<(u64, isize, u32)> = Mutex::new((0, 0, 0));
static SESSION: AtomicU64 = AtomicU64::new(0);
static CANCEL: AtomicU64 = AtomicU64::new(0);
static SETUP_BUSY: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();
static SHORTCUT: AtomicU64 = AtomicU64::new(1);
static PRESSED: Mutex<Option<Instant>> = Mutex::new(None);
fn directory() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join("com.sehaz.bloom/voice")
}
fn executable() -> PathBuf {
    directory().join("engine/Release/whisper-cli.exe")
}

#[derive(Serialize)]
pub struct VoiceStatus {
    pub ready: bool,
    pub engine: String,
    pub shortcut: String,
}
#[tauri::command]
pub fn voice_status() -> VoiceStatus {
    VoiceStatus {
        ready: executable().is_file()
            && directory()
                .join("ggml-base.bin")
                .metadata()
                .is_ok_and(|m| m.len() == 147951465),
        engine: "Whisper base · multilingual · on device".into(),
        shortcut: match SHORTCUT.load(Ordering::Relaxed) {
            0 => "off",
            2 => "ctrl-alt-space",
            _ => "ctrl-z",
        }
        .into(),
    }
}

#[tauri::command]
pub fn show_voice_panel(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
    }
    app.emit("show-voice-panel", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn setup_voice_engine() -> Result<(), String> {
    if SETUP_BUSY.swap(true, Ordering::SeqCst) {
        return Err("Voice setup is already running".into());
    }
    let result = tauri::async_runtime::spawn_blocking(|| {
        let dir = directory();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let script = include_str!("voice_setup.ps1");
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "Voice setup failed: {}",
                String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(1000)
                    .collect::<String>()
            ));
        }
        if !voice_status().ready {
            return Err("Speech engine did not finish installing".into());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string());
    SETUP_BUSY.store(false, Ordering::SeqCst);
    result?
}

#[derive(Serialize)]
pub struct VoiceTarget {
    pub session: u64,
    pub title: String,
}
#[tauri::command]
pub fn begin_voice_session() -> Result<VoiceTarget, String> {
    // Capture at the recording boundary, not just at the background poll tick.
    // A quick Alt+Tab followed by the shortcut must target the newly focused app.
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut class = [0u16; 128];
        let n = GetClassNameW(hwnd, &mut class);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        if pid != 0
            && pid != std::process::id()
            && !matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd")
        {
            *LAST.lock().map_err(|_| "Voice target unavailable")? = (hwnd.0 as isize, pid);
        }
    }
    let (hwnd, pid) = *LAST.lock().map_err(|_| "Voice target unavailable")?;
    let id = SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    *TARGET.lock().map_err(|_| "Voice target unavailable")? = (id, hwnd, pid);
    let mut title = [0u16; 256];
    let n = unsafe { GetWindowTextW(HWND(hwnd as *mut _), &mut title) };
    Ok(VoiceTarget {
        session: id,
        title: if n > 0 {
            String::from_utf16_lossy(&title[..n as usize])
        } else {
            "No writing window selected · copy text instead".into()
        },
    })
}
#[tauri::command]
pub fn cancel_voice(session: u64) {
    if TARGET.lock().is_ok_and(|t| t.0 == session) {
        CANCEL.fetch_max(session, Ordering::SeqCst);
    }
}

fn valid_wav(bytes: &[u8]) -> bool {
    bytes.len() >= 44
        && bytes.len() <= 10_000_000
        && &bytes[0..4] == b"RIFF"
        && &bytes[8..12] == b"WAVE"
        && &bytes[12..16] == b"fmt "
        && u16::from_le_bytes([bytes[20], bytes[21]]) == 1
        && u16::from_le_bytes([bytes[22], bytes[23]]) == 1
        && u32::from_le_bytes(bytes[24..28].try_into().unwrap()) == 16000
        && u16::from_le_bytes([bytes[34], bytes[35]]) == 16
}

#[tauri::command]
pub async fn transcribe_voice(
    session: u64,
    audio: String,
    language: String,
    prompt: String,
) -> Result<String, String> {
    if audio.len() > 14_000_000 {
        return Err("Recording exceeds the five-minute limit".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|_| "Invalid audio")?;
    if !valid_wav(&bytes) {
        return Err("Expected 16 kHz mono PCM audio".into());
    }
    if language != "auto"
        && (!language.chars().all(|c| c.is_ascii_lowercase()) || language.len() != 2)
    {
        return Err("Invalid language".into());
    }
    if TARGET.lock().map_err(|_| "Voice session unavailable")?.0 != session {
        return Err("This voice session has expired".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if !voice_status().ready {
            return Err("Set up the local speech engine first".into());
        }
        let file = directory().join(format!("recording-{session}.wav"));
        let out = directory().join(format!("transcript-{session}"));
        let txt = out.with_extension("txt");
        std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut child = Command::new(executable())
                .arg("-m")
                .arg(directory().join("ggml-base.bin"))
                .arg("-f")
                .arg(&file)
                .args(["-l", &language, "-otxt", "-of"])
                .arg(&out)
                .args(["-nt", "-np", "-ng", "-t", "2", "--prompt"])
                .arg(prompt.chars().take(2000).collect::<String>())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|e| format!("Could not start local speech engine: {e}"))?;
            let started = Instant::now();
            loop {
                if CANCEL.load(Ordering::SeqCst) >= session
                    || started.elapsed() > Duration::from_secs(180)
                {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Dictation cancelled or timed out".into());
                }
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if !status.success() {
                            return Err(
                                "The local speech engine could not transcribe this recording"
                                    .into(),
                            );
                        }
                        break;
                    }
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                    Err(e) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(e.to_string());
                    }
                }
            }
            let text = std::fs::read_to_string(&txt).map_err(|e| e.to_string())?;
            Ok(text.trim().to_string())
        })();
        let _ = std::fs::remove_file(file);
        let _ = std::fs::remove_file(txt);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn insert_voice_text(
    window: tauri::Window,
    session: u64,
    text: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Dictation insertion is only available in the notch".into());
    }
    if text.is_empty() || text.len() > 50000 {
        return Err("No text to insert, or text is too long".into());
    }
    let (id, handle, pid) = *TARGET.lock().map_err(|_| "Writing window unavailable")?;
    if id != session || handle == 0 {
        return Err("Choose a writing window and record again, or copy the text".into());
    }
    tauri::async_runtime::spawn_blocking(move || unsafe {
        let hwnd = HWND(handle as *mut _);
        let mut current_pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut current_pid));
        if !IsWindow(Some(hwnd)).as_bool() || current_pid != pid || pid == std::process::id() {
            return Err("The original writing window has closed. Copy the text instead".into());
        }
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
        std::thread::sleep(Duration::from_millis(150));
        if GetForegroundWindow() != hwnd {
            return Err("Windows did not focus the writing window. Copy the text instead".into());
        }
        // Wait for the user's shortcut modifiers to be released before injecting text.
        for _ in 0..30 {
            if GetAsyncKeyState(VK_CONTROL.0 as i32) >= 0 && GetAsyncKeyState(VK_MENU.0 as i32) >= 0
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        if GetAsyncKeyState(VK_CONTROL.0 as i32) < 0 || GetAsyncKeyState(VK_MENU.0 as i32) < 0 {
            return Err("Release the shortcut keys, then try Insert again".into());
        }
        for chunk in text.encode_utf16().collect::<Vec<_>>().chunks(64) {
            if GetForegroundWindow() != hwnd {
                return Err(
                    "Typing stopped because focus moved. The transcript remains available".into(),
                );
            }
            let mut inputs = Vec::with_capacity(chunk.len() * 2);
            for unit in chunk {
                for flags in [KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP] {
                    inputs.push(INPUT {
                        r#type: INPUT_KEYBOARD,
                        Anonymous: INPUT_0 {
                            ki: KEYBDINPUT {
                                wScan: *unit,
                                dwFlags: flags,
                                ..Default::default()
                            },
                        },
                    });
                }
            }
            if SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) != inputs.len() as u32 {
                return Err(
                    "Windows blocked typing into this app. Copy the transcript instead".into(),
                );
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

unsafe extern "system" fn keyboard(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let key = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if key.vkCode != VK_PACKET.0 as u32 {
            let binding = SHORTCUT.load(Ordering::Relaxed);
            let matches = match binding {
                1 => {
                    key.vkCode == 0x5A
                        && GetAsyncKeyState(VK_CONTROL.0 as i32) < 0
                        && GetAsyncKeyState(VK_MENU.0 as i32) >= 0
                        && GetAsyncKeyState(VK_SHIFT.0 as i32) >= 0
                }
                2 => {
                    key.vkCode == VK_SPACE.0 as u32
                        && GetAsyncKeyState(VK_CONTROL.0 as i32) < 0
                        && GetAsyncKeyState(VK_MENU.0 as i32) < 0
                }
                _ => false,
            };
            let down = wparam.0 == WM_KEYDOWN as usize || wparam.0 == WM_SYSKEYDOWN as usize;
            let up = wparam.0 == WM_KEYUP as usize || wparam.0 == WM_SYSKEYUP as usize;
            if let Ok(mut held) = PRESSED.lock() {
                let release_key = match binding {
                    1 => key.vkCode == 0x5A,
                    2 => key.vkCode == VK_SPACE.0 as u32,
                    _ => false,
                };
                if down && matches {
                    if held.is_none() {
                        *held = Some(Instant::now());
                        if let Some(app) = APP.get() {
                            let _ = app.emit("voice-shortcut", "down");
                        }
                    }
                    return LRESULT(1);
                }
                if up && release_key {
                    if let Some(since) = held.take() {
                        if let Some(app) = APP.get() {
                            let _ = app.emit(
                                "voice-shortcut",
                                if since.elapsed() >= Duration::from_millis(300) {
                                    "hold-up"
                                } else {
                                    "tap-up"
                                },
                            );
                        }
                        return LRESULT(1);
                    }
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn initialize(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let app = app.clone();
    std::thread::spawn(move || {
        let handle = app.clone();
        std::thread::spawn(move || loop {
            let binding = crate::utils::get_setting_str(&handle, "bloom-voice-shortcut")
                .unwrap_or_else(|| "ctrl-z".into());
            SHORTCUT.store(
                match binding.as_str() {
                    "off" => 0,
                    "ctrl-alt-space" => 2,
                    _ => 1,
                },
                Ordering::Relaxed,
            );
            unsafe {
                let hwnd = GetForegroundWindow();
                let mut pid = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                let mut class = [0u16; 128];
                let n = GetClassNameW(hwnd, &mut class);
                let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
                if pid != 0
                    && pid != std::process::id()
                    && !matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd")
                {
                    if let Ok(mut last) = LAST.lock() {
                        *last = (hwnd.0 as isize, pid);
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        });
        unsafe {
            if let Ok(hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), None, 0) {
                let mut message = MSG::default();
                while GetMessageW(&mut message, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                let _ = UnhookWindowsHookEx(hook);
            } else {
                SHORTCUT.store(0, Ordering::Relaxed);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_audio() {
        assert!(!valid_wav(b"not a wav"));
        assert!(!valid_wav(&[0; 45]));
    }
}
