//! Native agent hooks: metadata-only stdin adapter plus reversible configuration merges.
//! The early CLI branch must run before single-instance enforcement or any taskbar work.
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_INPUT: u64 = 1024 * 1024;
const MAX_CONFIG: u64 = 2 * 1024 * 1024;
const PROFILE: &str = "com.sehaz.bloom.macdock";
static INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Antigravity,
    Cursor,
    Gemini,
}
impl Provider {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "antigravity" => Ok(Self::Antigravity),
            "cursor" => Ok(Self::Cursor),
            "gemini" | "gemini cli" => Ok(Self::Gemini),
            _ => Err("Unsupported agent hook provider".into()),
        }
    }
    fn slug(self) -> &'static str {
        match self {
            Self::Antigravity => "antigravity",
            Self::Cursor => "cursor",
            Self::Gemini => "gemini",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Antigravity => "Antigravity",
            Self::Cursor => "Cursor",
            Self::Gemini => "Gemini",
        }
    }
    fn config(self, home: &Path) -> PathBuf {
        match self {
            Self::Antigravity => home.join(".gemini/config/hooks.json"),
            Self::Cursor => home.join(".cursor/hooks.json"),
            Self::Gemini => home.join(".gemini/settings.json"),
        }
    }
    fn events(self) -> &'static [(&'static str, &'static str)] {
        match self {
            // Deliberately no PreToolUse: observational hooks never become an approval gate.
            Self::Antigravity => &[
                ("PreInvocation", "UserPromptSubmit"),
                ("PostToolUse", "PostToolUse"),
                ("PostInvocation", "PostToolUse"),
                ("Stop", "Stop"),
            ],
            Self::Cursor => &[
                ("sessionStart", "SessionStart"),
                ("sessionEnd", "SessionEnd"),
                ("beforeSubmitPrompt", "UserPromptSubmit"),
                ("preToolUse", "PreToolUse"),
                ("postToolUse", "PostToolUse"),
                ("postToolUseFailure", "PostToolUseFailure"),
                ("stop", "Stop"),
            ],
            Self::Gemini => &[
                ("SessionStart", "SessionStart"),
                ("SessionEnd", "SessionEnd"),
                ("BeforeTool", "PreToolUse"),
                ("AfterTool", "PostToolUse"),
                ("BeforeAgent", "UserPromptSubmit"),
                ("AfterAgent", "Stop"),
            ],
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct HookIntegration {
    pub provider: String,
    pub detected: bool,
    pub connected: bool,
    pub detail: String,
    pub config_path: String,
    pub backup_path: Option<String>,
}
fn home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "User home is unavailable".into())
}
fn profile_dir() -> Result<PathBuf, String> {
    std::env::var_os("APPDATA")
        .map(|p| PathBuf::from(p).join(PROFILE))
        .ok_or_else(|| "App profile is unavailable".into())
}
fn helper_path() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("BloomMacDock/bin/bloom-agent-hook.exe"))
        .ok_or_else(|| "Local app directory is unavailable".into())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn clean(raw: &str, max: usize) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}
fn stable_hash(raw: &str) -> u64 {
    raw.as_bytes().iter().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
    })
}
fn canonical_event(event: &str) -> &str {
    match event {
        "PreInvocation"
        | "beforeSubmitPrompt"
        | "BeforeAgent"
        | "userPromptSubmitted"
        | "user_prompt_submit" => "UserPromptSubmit",
        "PostInvocation" | "postToolUse" | "AfterTool" | "post_tool_use" => "PostToolUse",
        "preToolUse" | "BeforeTool" | "pre_tool_use" => "PreToolUse",
        "sessionStart" | "startup" | "session_start" => "SessionStart",
        "sessionEnd" | "exit" | "session_end" => "SessionEnd",
        "stop" | "AfterAgent" | "agentStop" => "Stop",
        "postToolUseFailure" => "PostToolUseFailure",
        "permissionRequest" => "PermissionRequest",
        other => other,
    }
}
fn payload_workspace(v: &Value, fallback: &str) -> String {
    let raw = ["cwd", "workdir"]
        .into_iter()
        .map(|k| text(v, k))
        .find(|s| !s.is_empty())
        .or_else(|| {
            ["workspacePaths", "workspace_roots"]
                .into_iter()
                .find_map(|k| v.get(k)?.as_array()?.first()?.as_str())
        })
        .unwrap_or(fallback);
    clean(raw, 4096)
}
fn normalized_event(
    provider: Provider,
    event: &str,
    payload: &Value,
    current: u64,
    cwd: &str,
) -> Option<Value> {
    if !payload.is_object() {
        return None;
    }
    let event = canonical_event(event);
    let tool = text(payload, "tool_name");
    let tool = if tool.is_empty() {
        text(&payload["toolCall"], "name")
    } else {
        tool
    };
    let (status, activity) = match event {
        "SessionStart" => ("idle", "Session started"),
        "UserPromptSubmit" => ("working", "Working on a turn"),
        "PreToolUse" if tool == "AskUserQuestion" => ("needs-attention", "Waiting for your input"),
        "PreToolUse" | "PostToolUse" => ("working", "Using a tool"),
        "PostToolUseFailure" => ("working", "Tool reported an error; agent may retry"),
        "PermissionRequest" => ("needs-attention", "Tool permission requested"),
        "Notification"
            if matches!(
                text(payload, "notification_type"),
                "permission_prompt" | "idle_prompt"
            ) =>
        {
            ("needs-attention", "Waiting for your input")
        }
        "Stop" if text(payload, "status") == "error" => {
            ("needs-attention", "Turn stopped with an error")
        }
        "Stop" | "SessionEnd" => ("completed", "Turn completed"),
        "StopFailure" => ("needs-attention", "Turn stopped with an error"),
        "Interrupt" | "turn_aborted" => ("idle", "Turn interrupted"),
        _ => return None,
    };
    let workspace = payload_workspace(payload, cwd);
    let session = [
        "session_id",
        "conversationId",
        "conversation_id",
        "sessionId",
    ]
    .into_iter()
    .map(|k| text(payload, k))
    .find(|s| !s.is_empty())
    .map(|s| clean(s, 256))
    .unwrap_or_else(|| format!("workspace-{:016x}", stable_hash(&workspace)));
    let project = workspace
        .trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| clean(s, 80))
        .unwrap_or_else(|| "Local project".into());
    Some(
        json!({"id":format!("{}:{session}",provider.slug()),"provider":provider.name(),"project":project,"title":format!("{} session",provider.name()),"status":status,"activity":activity,"updated_at":current,"path":workspace}),
    )
}
fn stdout_reply(provider: Provider, event: &str) -> Option<&'static str> {
    match provider {
        Provider::Antigravity if canonical_event(event) == "PreToolUse" => {
            Some(r#"{"decision":"ask"}"#)
        }
        Provider::Antigravity | Provider::Gemini => Some("{}"),
        Provider::Cursor => None,
    }
}
fn write_event(directory: &Path, event: &Value) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let id = text(event, "id");
    let filename = format!("native-{:016x}.jsonl", stable_hash(id));
    let mut bytes = serde_json::to_vec(event).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    // Append to match the overview's incremental reader. Rotate only this metadata
    // journal at 64 KiB; a size decrease makes the reader safely restart its cursor.
    let path = directory.join(filename);
    if fs::metadata(&path).is_ok_and(|m| m.len() > 64 * 1024) {
        return crate::utils::atomic_write_file(&path, &bytes);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())
}
/// True only for the dedicated stdin adapter branch. Always fail open and return normally.
/// No app, WebView, mutex, taskbar, watchdog or agent process is started here.
pub fn run_if_hook() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--agent-hook") {
        return false;
    }
    let Some(provider) = args.next().and_then(|p| Provider::parse(&p).ok()) else {
        return true;
    };
    let explicit = args.next().unwrap_or_default();
    let mut raw = Vec::new();
    let _ = std::io::stdin().take(MAX_INPUT + 1).read_to_end(&mut raw);
    let value = if raw.len() as u64 <= MAX_INPUT {
        serde_json::from_slice::<Value>(raw.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&raw)).ok()
    } else {
        None
    };
    let supplied = value
        .as_ref()
        .map(|v| {
            ["hook_event_name", "event_name", "event"]
                .into_iter()
                .map(|k| text(v, k))
                .find(|s| !s.is_empty())
                .unwrap_or("")
        })
        .unwrap_or("");
    let event = if explicit.is_empty() {
        supplied
    } else {
        &explicit
    };
    if let Some(value) = value.as_ref() {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        if let Some(event) = normalized_event(provider, event, value, now(), &cwd) {
            if let Ok(profile) = profile_dir() {
                let _ = write_event(&profile.join("agent-events"), &event);
            }
        }
    }
    if let Some(reply) = stdout_reply(provider, event) {
        let _ = std::io::stdout().write_all(reply.as_bytes());
        let _ = std::io::stdout().flush();
    }
    true
}
fn owned_command(value: &Value, provider: Provider) -> bool {
    value.as_str().is_some_and(|s| {
        s.contains("bloom-agent-hook.exe")
            && s.contains(&format!("--agent-hook {}", provider.slug()))
    })
}
fn owned_entry(entry: &Value, provider: Provider) -> bool {
    owned_command(&entry["command"], provider)
        || entry
            .get("hooks")
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().any(|v| owned_command(&v["command"], provider)))
}
fn exclusively_owned_entry(entry: &Value, provider: Provider) -> bool {
    if let Some(command) = entry.get("command") {
        return owned_command(command, provider);
    }
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            !hooks.is_empty()
                && hooks
                    .iter()
                    .all(|hook| owned_command(&hook["command"], provider))
        })
}
fn remove_owned(entries: &[Value], provider: Provider) -> Vec<Value> {
    entries
        .iter()
        .filter_map(|entry| {
            if owned_command(&entry["command"], provider) {
                return None;
            }
            let Some(inner) = entry.get("hooks").and_then(Value::as_array) else {
                return Some(entry.clone());
            };
            let kept: Vec<_> = inner
                .iter()
                .filter(|v| !owned_command(&v["command"], provider))
                .cloned()
                .collect();
            if kept.len() == inner.len() {
                Some(entry.clone())
            } else if kept.is_empty() {
                None
            } else {
                let mut copy = entry.clone();
                copy["hooks"] = Value::Array(kept);
                Some(copy)
            }
        })
        .collect()
}
fn command(helper: &Path, provider: Provider, event: &str) -> Result<String, String> {
    let helper = helper.to_str().ok_or("Hook path is not valid Unicode")?;
    if helper.chars().any(char::is_control) || helper.contains('"') {
        return Err("Hook path contains unsupported characters".into());
    }
    if provider == Provider::Gemini {
        Ok(format!(
            "& '{}' --agent-hook {} {event}",
            helper.replace('\'', "''"),
            provider.slug()
        ))
    } else {
        if helper.contains(['%', '!']) {
            return Err("Hook path contains shell expansion characters".into());
        }
        Ok(format!(
            "\"{helper}\" --agent-hook {} {event}",
            provider.slug()
        ))
    }
}
fn object(value: &Value, label: &str) -> Result<Map<String, Value>, String> {
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("Existing {label} must be a JSON object; nothing was changed"))
}
fn merge_config(
    root: &Value,
    provider: Provider,
    helper: &Path,
    install: bool,
) -> Result<Value, String> {
    let mut root = object(root, "configuration")?;
    if provider == Provider::Antigravity {
        if let Some(group) = root.get("bloom") {
            let group = object(group, "bloom hook group")?;
            if group.is_empty()
                || !group.values().all(|entries| {
                    entries.as_array().is_some_and(|a| {
                        !a.is_empty() && a.iter().all(|v| exclusively_owned_entry(v, provider))
                    })
                })
            {
                return Err(
                    "An existing bloom hook group is not owned by Bloom; nothing was changed"
                        .into(),
                );
            }
        }
        if install {
            let mut group = Map::new();
            for (native, event) in provider.events() {
                let handler =
                    json!({"type":"command","command":command(helper,provider,event)?,"timeout":5});
                group.insert(
                    (*native).into(),
                    if *native == "PostToolUse" {
                        json!([{"matcher":"*","hooks":[handler]}])
                    } else {
                        json!([handler])
                    },
                );
            }
            root.insert("bloom".into(), Value::Object(group));
        } else {
            root.remove("bloom");
        }
        return Ok(Value::Object(root));
    }
    let mut hooks = match root.get("hooks") {
        None => Map::new(),
        Some(v) => object(v, "hooks")?,
    };
    for (native, event) in provider.events() {
        let existing = match hooks.get(*native) {
            None => Vec::new(),
            Some(v) => v.as_array().cloned().ok_or_else(|| {
                format!("Existing hooks.{native} must be an array; nothing was changed")
            })?,
        };
        let mut entries = remove_owned(&existing, provider);
        if install {
            let cmd = command(helper, provider, event)?;
            entries.push(if provider == Provider::Cursor {
                json!({"command":cmd})
            } else {
                json!({"matcher":"*","hooks":[{"type":"command","command":cmd,"timeout":5000}]})
            });
        }
        if entries.is_empty() {
            hooks.remove(*native);
        } else {
            hooks.insert((*native).into(), Value::Array(entries));
        }
    }
    if hooks.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(hooks));
    }
    if install && provider == Provider::Cursor {
        match root.get("version") {
            None => {
                root.insert("version".into(), json!(1));
            }
            Some(v) if v.as_u64().is_some() => {}
            Some(_) => {
                return Err(
                    "Existing Cursor hook version must be a number; nothing was changed".into(),
                )
            }
        }
    }
    Ok(Value::Object(root))
}
fn read_config(path: &Path) -> Result<(Option<Vec<u8>>, Value), String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((None, json!({}))),
        Err(e) => Err(format!("Cannot inspect agent configuration: {e}")),
        Ok(meta) if !meta.is_file() || meta.len() > MAX_CONFIG => {
            Err("Agent configuration is not a regular file under 2 MiB; nothing was changed".into())
        }
        Ok(_) => {
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            let v = serde_json::from_slice(
                bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes),
            )
            .map_err(|_| "Existing agent configuration is invalid JSON; nothing was changed")?;
            let _ = object(&v, "configuration")?;
            Ok((Some(bytes), v))
        }
    }
}
fn backup_and_write(
    path: &Path,
    before: Option<&[u8]>,
    after: &Value,
) -> Result<Option<PathBuf>, String> {
    // Refuse concurrent external edits instead of replacing somebody else's newer settings.
    let current = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    if current.as_deref() != before {
        return Err(
            "Agent configuration changed while connecting; retry to preserve the latest version"
                .into(),
        );
    }
    if before.is_none() && after == &json!({}) {
        return Ok(None);
    }
    if let Some(bytes) = before {
        if serde_json::from_slice::<Value>(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes))
            .ok()
            .as_ref()
            == Some(after)
        {
            return Ok(None);
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let backup = if let Some(bytes) = before {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let mut saved = None;
        for n in 0..100 {
            let name = format!(
                "{}.bloom-backup-{millis}-{}-{n}",
                path.file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("settings.json"),
                std::process::id()
            );
            let candidate = path.with_file_name(name);
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(mut file) => {
                    file.write_all(bytes)
                        .and_then(|()| file.sync_all())
                        .map_err(|e| format!("Backup failed; configuration unchanged: {e}"))?;
                    saved = Some(candidate);
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Backup failed; configuration unchanged: {e}")),
            }
        }
        Some(saved.ok_or("Could not create a unique configuration backup; nothing was changed")?)
    } else {
        None
    };
    let mut bytes = serde_json::to_vec_pretty(after).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    crate::utils::atomic_write_file(path, &bytes)?;
    Ok(backup)
}
fn ensure_helper() -> Result<PathBuf, String> {
    let source = std::env::current_exe().map_err(|e| e.to_string())?;
    let destination = helper_path()?;
    if source == destination {
        return Err("Connect hooks from the main Bloom app, not its relay".into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    let same = fs::metadata(&destination).is_ok_and(|m| m.len() == bytes.len() as u64)
        && fs::read(&destination).is_ok_and(|old| old == bytes);
    if !same {
        crate::utils::atomic_write_file(&destination, &bytes)?;
    }
    Ok(destination)
}
fn detected(provider: Provider, home: &Path) -> bool {
    let roaming = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_default();
    provider.config(home).exists()
        || match provider {
            Provider::Antigravity => {
                home.join(".gemini/antigravity").is_dir() || roaming.join("Antigravity").is_dir()
            }
            Provider::Cursor => home.join(".cursor").is_dir() || roaming.join("Cursor").is_dir(),
            Provider::Gemini => home.join(".gemini/tmp").is_dir(),
        }
}
fn connected(root: &Value, provider: Provider) -> bool {
    provider.events().iter().all(|(native, _)| {
        let entries = if provider == Provider::Antigravity {
            &root["bloom"][*native]
        } else {
            &root["hooks"][*native]
        };
        entries
            .as_array()
            .is_some_and(|entries| entries.iter().any(|entry| owned_entry(entry, provider)))
    })
}
fn integration(provider: Provider, backup: Option<PathBuf>) -> HookIntegration {
    let home = home().unwrap_or_default();
    let path = provider.config(&home);
    let parsed = read_config(&path);
    let config_connected = parsed.as_ref().is_ok_and(|(_, v)| connected(v, provider));
    let helper_ready = helper_path().is_ok_and(|p| p.is_file());
    let connected = config_connected && helper_ready;
    let detail = if connected {
        "Native live hooks connected. Existing agent permissions stay in the agent."
    } else if parsed.is_err() {
        "Existing configuration needs attention; Bloom has not overwritten it."
    } else if config_connected {
        "Hook configuration exists, but the relay needs reconnecting."
    } else {
        "Native live hooks are not connected. Connect to show real turn and tool activity."
    };
    HookIntegration {
        provider: provider.name().into(),
        detected: detected(provider, &home),
        connected,
        detail: detail.into(),
        config_path: path.to_string_lossy().into_owned(),
        backup_path: backup.map(|p| p.to_string_lossy().into_owned()),
    }
}
#[tauri::command]
pub fn get_agent_hook_integrations() -> Vec<HookIntegration> {
    [Provider::Antigravity, Provider::Cursor, Provider::Gemini]
        .into_iter()
        .map(|p| integration(p, None))
        .collect()
}
#[tauri::command]
pub async fn connect_agent_hooks(provider: String) -> Result<HookIntegration, String> {
    tauri::async_runtime::spawn_blocking(move || change_hooks(&provider, true))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn disconnect_agent_hooks(provider: String) -> Result<HookIntegration, String> {
    tauri::async_runtime::spawn_blocking(move || change_hooks(&provider, false))
        .await
        .map_err(|e| e.to_string())?
}
fn change_hooks(provider: &str, install: bool) -> Result<HookIntegration, String> {
    let provider = Provider::parse(provider)?;
    let _guard = INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|e| e.to_string())?;
    let path = provider.config(&home()?);
    let (before, root) = read_config(&path)?;
    let helper = helper_path()?;
    let after = merge_config(&root, provider, &helper, install)?;
    if install {
        let _ = ensure_helper()?;
    }
    let backup = backup_and_write(&path, before.as_deref(), &after)?;
    Ok(integration(provider, backup))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn helper() -> PathBuf {
        PathBuf::from(r"C:\Program Files\Bloom\bloom-agent-hook.exe")
    }
    #[test]
    fn providers_are_strict() {
        assert_eq!(
            Provider::parse("Antigravity").unwrap(),
            Provider::Antigravity
        );
        assert_eq!(Provider::parse("Gemini CLI").unwrap(), Provider::Gemini);
        for p in ["claude", "cursor --x", "../cursor", "unknown"] {
            assert!(Provider::parse(p).is_err());
        }
    }
    #[test]
    fn antigravity_merge_is_observational_and_preserves_others() {
        let original =
            json!({"other":{"PreToolUse":[{"command":"user-agent-hook"}]},"preference":42});
        let merged = merge_config(&original, Provider::Antigravity, &helper(), true).unwrap();
        assert_eq!(merged["other"], original["other"]);
        assert_eq!(merged["preference"], 42);
        assert!(merged["bloom"].get("PreToolUse").is_none());
        assert!(connected(&merged, Provider::Antigravity));
        assert_eq!(
            merge_config(&merged, Provider::Antigravity, &helper(), true).unwrap(),
            merged
        );
        assert_eq!(
            merge_config(&merged, Provider::Antigravity, &helper(), false).unwrap(),
            original
        );
    }
    #[test]
    fn unknown_bloom_group_and_invalid_types_are_preserved() {
        assert!(merge_config(
            &json!({"bloom":{"Stop":[{"command":"user-hook"}]}}),
            Provider::Antigravity,
            &helper(),
            true
        )
        .is_err());
        for root in [json!([]), json!({"hooks":42}), json!({"hooks":{"stop":42}})] {
            assert!(merge_config(&root, Provider::Cursor, &helper(), true).is_err());
        }
    }
    #[test]
    fn cursor_and_gemini_preserve_hooks_and_are_idempotent() {
        for provider in [Provider::Cursor, Provider::Gemini] {
            let event = provider.events()[0].0;
            let original = json!({"custom":"keep","hooks":{event:[{"command":"existing-user-hook"}],"anotherEvent":[{"command":"keep"}]}});
            let merged = merge_config(&original, provider, &helper(), true).unwrap();
            assert_eq!(merged["hooks"][event][0]["command"], "existing-user-hook");
            assert_eq!(
                merged["hooks"]["anotherEvent"],
                original["hooks"]["anotherEvent"]
            );
            assert!(connected(&merged, provider));
            assert_eq!(
                merge_config(&merged, provider, &helper(), true).unwrap(),
                merged
            );
            let removed = merge_config(&merged, provider, &helper(), false).unwrap();
            assert_eq!(removed["hooks"], original["hooks"]);
            assert_eq!(removed["custom"], "keep");
        }
    }
    #[test]
    fn normalized_events_exclude_prompts_arguments_and_response_text() {
        let payload = json!({"conversationId":"abc","workspacePaths":[r"C:\Work\Demo"],"prompt":"SECRET","toolCall":{"name":"run_command","args":{"command":"SECRET"}},"response":"SECRET"});
        let event =
            normalized_event(Provider::Antigravity, "PreInvocation", &payload, 1000, "").unwrap();
        assert_eq!(event["status"], "working");
        assert_eq!(event["project"], "Demo");
        assert_eq!(event["id"], "antigravity:abc");
        assert!(!event.to_string().contains("SECRET"));
        assert_eq!(
            normalized_event(Provider::Antigravity, "Stop", &payload, 1001, "").unwrap()["status"],
            "completed"
        );
        let cursor =
            json!({"conversation_id":"c","workspace_roots":[r"C:\Project"],"status":"error"});
        assert_eq!(
            normalized_event(Provider::Cursor, "stop", &cursor, 1000, "").unwrap()["status"],
            "needs-attention"
        );
        assert_eq!(
            normalized_event(Provider::Cursor, "beforeSubmitPrompt", &cursor, 1000, "").unwrap()
                ["id"],
            "cursor:c"
        );
    }
    #[test]
    fn relay_never_automatically_allows_or_denies_tools() {
        for provider in [Provider::Antigravity, Provider::Cursor, Provider::Gemini] {
            for event in ["PreToolUse", "PermissionRequest", "Stop", "bad"] {
                let reply = stdout_reply(provider, event).unwrap_or("");
                assert!(!reply.contains("allow"));
                assert!(!reply.contains("deny"));
            }
        }
        assert_eq!(
            stdout_reply(Provider::Antigravity, "PreToolUse"),
            Some(r#"{"decision":"ask"}"#)
        );
        assert_eq!(stdout_reply(Provider::Cursor, "PreToolUse"), None);
    }
    #[test]
    fn shell_commands_quote_spaces_without_user_arguments() {
        assert_eq!(
            command(&helper(), Provider::Cursor, "Stop").unwrap(),
            r#""C:\Program Files\Bloom\bloom-agent-hook.exe" --agent-hook cursor Stop"#
        );
        assert!(command(&helper(), Provider::Gemini, "Stop")
            .unwrap()
            .starts_with("& 'C:"));
        assert!(command(
            Path::new("C:/bad%PATH%/bloom-agent-hook.exe"),
            Provider::Cursor,
            "Stop"
        )
        .is_err());
    }
    #[test]
    fn backup_preserves_exact_original_and_idempotence_does_not_backup_again() {
        let directory = std::env::temp_dir().join(format!(
            "bloom-hook-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("hooks.json");
        let original = b"\xef\xbb\xbf{\"custom\": \"keep\"}\r\n";
        fs::write(&path, original).unwrap();
        let (_, root) = read_config(&path).unwrap();
        let after = merge_config(&root, Provider::Cursor, &helper(), true).unwrap();
        let backup = backup_and_write(&path, Some(original), &after)
            .unwrap()
            .unwrap();
        assert_eq!(fs::read(&backup).unwrap(), original);
        let updated = fs::read(&path).unwrap();
        assert!(backup_and_write(&path, Some(&updated), &after)
            .unwrap()
            .is_none());
        fs::write(&path, b"{}").unwrap();
        assert!(backup_and_write(&path, Some(&updated), &after).is_err());
        fs::remove_file(&backup).unwrap();
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn spool_records_bounded_metadata_without_prompt_content() {
        let directory = std::env::temp_dir().join(format!(
            "bloom-spool-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first = normalized_event(
            Provider::Cursor,
            "beforeSubmitPrompt",
            &json!({"conversation_id":"one"}),
            1000,
            "",
        )
        .unwrap();
        write_event(&directory, &first).unwrap();
        let last = normalized_event(
            Provider::Cursor,
            "stop",
            &json!({"conversation_id":"one"}),
            1001,
            "",
        )
        .unwrap();
        write_event(&directory, &last).unwrap();
        let files: Vec<_> = fs::read_dir(&directory)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(files.len(), 1);
        let data = fs::read_to_string(&files[0]).unwrap();
        assert_eq!(data.lines().count(), 2);
        let read: Value = serde_json::from_str(data.lines().last().unwrap()).unwrap();
        assert_eq!(read["status"], "completed");
        fs::remove_file(&files[0]).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
    #[test]
    fn mixed_foreign_hook_in_bloom_group_is_never_replaced() {
        let ours = command(&helper(), Provider::Antigravity, "PostToolUse").unwrap();
        let root = json!({"bloom":{"PostToolUse":[{"matcher":"*","hooks":[{"command":ours},{"command":"keep-my-user-hook"}]}]}});
        for install in [true, false] {
            assert!(merge_config(&root, Provider::Antigravity, &helper(), install).is_err());
        }
        assert_eq!(
            root["bloom"]["PostToolUse"][0]["hooks"][1]["command"],
            "keep-my-user-hook"
        );
    }
}
