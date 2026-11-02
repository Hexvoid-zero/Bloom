//! Local, read-only agent activity. Never returns prompt, tool arguments or transcript text.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const TAIL_BYTES: u64 = 256 * 1024;
const MAX_LINE: usize = 128 * 1024;
const MAX_FILES: usize = 48;
const RECENT_SECONDS: u64 = 7 * 86400;
const WORKING_SECONDS: u64 = 120;

#[derive(Clone, Debug, Serialize)]
pub struct AgentSession {
    pub id: String,
    pub provider: String,
    pub agent: String,
    pub detail: String,
    pub path: String,
    pub project: String,
    pub title: String,
    pub status: String,
    pub activity: String,
    pub updated_at: u64,
    pub source: String,
}
#[derive(Serialize)]
pub struct AgentBridgeInfo {
    pub event_file: String,
    pub event_directory: String,
    pub schema_version: u32,
    pub example: Value,
    pub description: String,
    pub provider_coverage: Vec<AgentProviderCoverage>,
}
#[derive(Default)]
struct FileState {
    offset: u64,
    modified: u64,
    pending: Vec<u8>,
    session: Option<AgentSession>,
    events: HashMap<String, AgentSession>,
}
#[derive(Default)]
struct Cache {
    discovered_at: u64,
    paths: Vec<(PathBuf, &'static str)>,
    files: HashMap<PathBuf, FileState>,
    processes_at: u64,
    processes: Vec<String>,
}
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn clean(s: &str, max: usize) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}
fn field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn project_name(s: &str) -> String {
    clean(
        s.trim_end_matches(['/', '\\'])
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("Local project"),
        80,
    )
}
fn modified(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ISO UTC timestamps used by both transcript formats. Offsets other than UTC are rejected.
fn timestamp(v: &Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(if n > 10_000_000_000 { n / 1000 } else { n });
    }
    let s = v.as_str()?;
    if s.len() < 20 || !(s.ends_with('Z') || s.ends_with("+00:00")) || !s.is_ascii() {
        return None;
    }
    let number = |a, b| s.get(a..b)?.parse::<i64>().ok();
    let (mut y, m, d, h, min, sec) = (
        number(0, 4)?,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(14, 16)?,
        number(17, 19)?,
    );
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days_in_month = match m {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return None,
    };
    if !(1970..=9999).contains(&y)
        || !(1..=days_in_month).contains(&d)
        || !(0..24).contains(&h)
        || !(0..60).contains(&min)
        || !(0..60).contains(&sec)
    {
        return None;
    }
    y -= i64::from(m <= 2);
    let era = y / 400;
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + (153 * mp + 2) / 5 + d - 1 - 719468;
    u64::try_from(days * 86400 + h * 3600 + min * 60 + sec).ok()
}
fn set_activity(session: &mut AgentSession, status: &str, activity: &str, at: u64) {
    if at >= session.updated_at {
        session.status = status.into();
        session.activity = activity.into();
        session.updated_at = at;
    }
}
fn parse_line(state: &mut FileState, provider: &str, id: &str, line: &[u8], current: u64) {
    if line.len()
        > if provider == "Gemini" {
            1024 * 1024
        } else {
            MAX_LINE
        }
    {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    if provider == "Hook" {
        let Some(at) = v.get("updated_at").and_then(timestamp) else {
            return;
        };
        let status = field(&v, "status");
        if at > current + 60
            || current.saturating_sub(at) > RECENT_SECONDS
            || !matches!(status, "working" | "idle" | "needs-attention" | "completed")
        {
            return;
        }
        let event_id = clean(field(&v, "id"), 128);
        if event_id.is_empty() {
            return;
        }
        // Each file may hold multiple sessions, bounded independently of its byte length.
        let session = AgentSession {
            id: format!("hook:{event_id}"),
            provider: clean(field(&v, "provider"), 40),
            agent: String::new(),
            detail: String::new(),
            path: local_workspace(field(&v, "path")),
            project: clean(field(&v, "project"), 80),
            title: clean(field(&v, "title"), 120),
            status: status.into(),
            activity: clean(field(&v, "activity"), 160),
            updated_at: at,
            source: "event".into(),
        };
        if !state.events.contains_key(&session.id) && state.events.len() >= 64 {
            if let Some(oldest) = state
                .events
                .values()
                .min_by_key(|s| s.updated_at)
                .map(|s| s.id.clone())
            {
                state.events.remove(&oldest);
            }
        }
        if state
            .events
            .get(&session.id)
            .is_none_or(|s| at >= s.updated_at)
        {
            state.events.insert(session.id.clone(), session);
        }
        return;
    }
    if provider == "Gemini" {
        parse_gemini(state, id, &v, current);
        return;
    }
    let session = state.session.get_or_insert_with(|| AgentSession {
        id: format!("{}:{id}", provider.to_lowercase()),
        provider: provider.into(),
        agent: String::new(),
        detail: String::new(),
        path: String::new(),
        project: "Local project".into(),
        title: format!("{provider} session"),
        status: "idle".into(),
        activity: "No recent activity".into(),
        updated_at: 0,
        source: "transcript".into(),
    });
    let kind = field(&v, "type");
    let payload = &v["payload"];
    if matches!(kind, "session_meta" | "turn_context") {
        let cwd = field(payload, "cwd");
        if !cwd.is_empty() {
            session.project = project_name(cwd);
            session.path = local_workspace(cwd);
        }
    }
    if !field(&v, "cwd").is_empty() {
        session.project = project_name(field(&v, "cwd"));
        session.path = local_workspace(field(&v, "cwd"));
    }
    if matches!(kind, "custom-title" | "ai-title") {
        let title = if kind == "custom-title" {
            field(&v, "customTitle")
        } else {
            field(&v, "aiTitle")
        };
        if !title.is_empty() {
            session.title = clean(title, 120);
        }
    }
    let Some(at) = v.get("timestamp").and_then(timestamp) else {
        return;
    };
    if at > current + 60 || current.saturating_sub(at) > RECENT_SECONDS {
        return;
    }
    if provider == "Codex" {
        match (kind, field(payload, "type")) {
            ("event_msg", "task_started" | "turn_started" | "user_message") => {
                set_activity(session, "working", "Working on a turn", at)
            }
            ("event_msg", "task_complete" | "turn_complete") => {
                set_activity(session, "completed", "Turn completed", at)
            }
            ("event_msg", "turn_aborted") => set_activity(session, "idle", "Turn interrupted", at),
            ("event_msg", "approval_request" | "request_user_input") => {
                set_activity(session, "needs-attention", "Waiting for your input", at)
            }
            ("response_item", "function_call" | "custom_tool_call") => {
                set_activity(session, "working", "Using a tool", at)
            }
            ("response_item", "reasoning") => set_activity(session, "working", "Thinking", at),
            ("response_item", "message") if field(payload, "role") == "assistant" => {
                set_activity(session, "working", "Writing a response", at)
            }
            _ => {}
        }
    } else {
        match kind {
            "assistant" => {
                let stop = field(&v["message"], "stop_reason");
                let tools = v["message"]["content"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|c| field(c, "type") == "tool_use"));
                if stop == "end_turn" {
                    set_activity(session, "completed", "Turn completed", at);
                } else {
                    set_activity(
                        session,
                        "working",
                        if tools {
                            "Using a tool"
                        } else {
                            "Generating a response"
                        },
                        at,
                    );
                }
            }
            "user" if v.get("toolDenialKind").is_some_and(|x| !x.is_null()) => {
                set_activity(session, "needs-attention", "Tool permission needed", at)
            }
            "user" => set_activity(session, "working", "Processing input", at),
            "system" if matches!(field(&v, "subtype"), "turn_duration" | "stop_hook_summary") => {
                set_activity(session, "completed", "Turn completed", at)
            }
            _ => {}
        }
    }
}
fn discover(
    root: &Path,
    provider: &'static str,
    paths: &mut Vec<(PathBuf, &'static str)>,
    budget: &mut usize,
    depth: usize,
    current: u64,
) {
    if depth > 8 || *budget == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            discover(&path, provider, paths, budget, depth + 1, current);
        } else if kind.is_file()
            && path
                .extension()
                .is_some_and(|e| e == "jsonl" || (provider == "Gemini" && e == "json"))
            && (provider != "Gemini"
                || path
                    .parent()
                    .is_some_and(|p| p.file_name().is_some_and(|n| n == "chats")))
            && current.saturating_sub(modified(&path)) <= RECENT_SECONDS
        {
            paths.push((path, provider));
        }
    }
}
fn read_updates(path: &Path, provider: &str, state: &mut FileState, current: u64) {
    let Ok(mut file) = File::open(path) else {
        return;
    };
    let Ok(meta) = file.metadata() else {
        return;
    };
    let len = meta.len();
    let mtime = modified(path);
    if len == state.offset && mtime == state.modified {
        return;
    }
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("session");
    if len < state.offset || (len == state.offset && mtime != state.modified) {
        *state = FileState::default();
    }
    if provider == "Gemini" && path.extension().is_some_and(|e| e == "json") {
        if len > 1024 * 1024 {
            return;
        }
        let mut bytes = Vec::new();
        if file.take(1024 * 1024 + 1).read_to_end(&mut bytes).is_ok() {
            parse_line(state, provider, id, &bytes, current);
        }
        state.offset = len;
        state.modified = mtime;
        return;
    }
    if provider == "Gemini" && state.offset == 0 {
        if let Some(root) = path.parent().and_then(Path::parent) {
            if let Ok(meta) = fs::metadata(root.join(".project_root")) {
                if meta.len() <= 4096 {
                    if let Ok(project) = fs::read_to_string(root.join(".project_root")) {
                        let mut session = new_session("Gemini", id);
                        session.project = project_name(project.trim());
                        session.path = local_workspace(project.trim());
                        state.session = Some(session);
                    }
                }
            }
        }
    }
    if state.offset == 0 && len > TAIL_BYTES {
        // Metadata lives at the beginning even when the recent tail is far away.
        let mut header = Vec::new();
        let _ = (&mut file)
            .take(MAX_LINE as u64 + 1)
            .read_to_end(&mut header);
        for line in header.split(|b| *b == b'\n').take(2) {
            parse_line(state, provider, id, line, current);
        }
    }
    let start = state.offset.max(len.saturating_sub(TAIL_BYTES));
    if start > state.offset {
        state.pending.clear();
    }
    if file.seek(SeekFrom::Start(start)).is_err() {
        return;
    }
    let mut bytes = Vec::new();
    if file.take(TAIL_BYTES).read_to_end(&mut bytes).is_err() {
        return;
    }
    let read_len = bytes.len() as u64;
    if start > state.offset {
        if let Some(n) = bytes.iter().position(|b| *b == b'\n') {
            bytes.drain(..=n);
        } else {
            bytes.clear();
        }
    }
    let mut data = std::mem::take(&mut state.pending);
    data.extend(bytes);
    let mut consumed = 0;
    for (i, b) in data.iter().enumerate() {
        if *b == b'\n' {
            parse_line(state, provider, id, &data[consumed..i], current);
            consumed = i + 1;
        }
    }
    if data.len() - consumed <= MAX_LINE {
        state.pending.extend_from_slice(&data[consumed..]);
    }
    state.offset = start + read_len;
    state.modified = mtime;
}
fn expire(mut session: AgentSession, current: u64) -> AgentSession {
    session.agent = session.provider.clone();
    session.detail = session.activity.clone();
    if session.status == "working" && current.saturating_sub(session.updated_at) > WORKING_SECONDS {
        session.status = "idle".into();
        session.activity = "No recent activity (last seen over 2 minutes ago)".into();
    }
    session.detail = session.activity.clone();
    session
}

fn new_session(provider: &str, id: &str) -> AgentSession {
    AgentSession {
        id: format!("{}:{id}", provider.to_lowercase()),
        provider: provider.into(),
        agent: provider.into(),
        detail: String::new(),
        path: String::new(),
        project: "Local project".into(),
        title: format!("{provider} session"),
        status: "idle".into(),
        activity: "Recorded session; live activity unavailable".into(),
        updated_at: 0,
        source: "transcript".into(),
    }
}
fn parse_gemini(state: &mut FileState, id: &str, value: &Value, current: u64) {
    // Gemini CLI supports a JSON session document and the newer JSONL $set journal.
    let value = value.get("$set").unwrap_or(value);
    let at = value
        .get("lastUpdated")
        .and_then(timestamp)
        .or_else(|| value.get("timestamp").and_then(timestamp));
    let session = state
        .session
        .get_or_insert_with(|| new_session("Gemini", id));
    if let Some(at) =
        at.filter(|at| *at <= current + 60 && current.saturating_sub(*at) <= RECENT_SECONDS)
    {
        // A saved timestamp proves a recorded event, not a currently running turn.
        set_activity(
            session,
            "idle",
            "Session updated; live turn status unavailable",
            at,
        );
    }
    if let Some(messages) = value.get("messages").and_then(Value::as_array) {
        for message in messages {
            let Some(at) = message.get("timestamp").and_then(timestamp) else {
                continue;
            };
            if at > current + 60 || current.saturating_sub(at) > RECENT_SECONDS {
                continue;
            }
            match field(message, "type") {
                "gemini" | "model" | "assistant" => {
                    set_activity(session, "completed", "Response recorded", at)
                }
                "user" => set_activity(
                    session,
                    "idle",
                    "Input recorded; live turn status unavailable",
                    at,
                ),
                _ => {}
            }
        }
    }
}
fn diverse_files(paths: Vec<(PathBuf, &'static str)>) -> Vec<(PathBuf, &'static str)> {
    let mut chosen = Vec::new();
    // Reserve slots per transcript source so one busy Codex history cannot starve Gemini/Claude/hooks.
    for provider in ["Hook", "Codex", "Claude", "Gemini"] {
        chosen.extend(
            paths
                .iter()
                .filter(|(_, p)| *p == provider)
                .take(8)
                .cloned(),
        );
    }
    for item in paths {
        if chosen.len() >= MAX_FILES {
            break;
        }
        if !chosen.iter().any(|(p, _)| p == &item.0) {
            chosen.push(item);
        }
    }
    chosen
}
fn canonical_provider(name: &str) -> String {
    match name.trim().to_ascii_lowercase().as_str() {
        "claude" | "claude code" => "claude code".into(),
        "gemini cli" | "gemini" => "gemini".into(),
        "github copilot" | "copilot" => "github copilot".into(),
        other => other.to_string(),
    }
}
fn provider_for_executable(executable: &str) -> Option<&'static str> {
    let leaf = executable.rsplit(['\\', '/']).next()?.to_ascii_lowercase();
    match leaf.as_str() {
        "codex.exe" | "codex" => Some("Codex"),
        "claude.exe" | "claude" => Some("Claude Code"),
        "antigravity.exe" | "antigravity" => Some("Antigravity"),
        "cursor.exe" | "cursor-agent.exe" | "cursor-agent" => Some("Cursor"),
        "gemini.exe" | "gemini" => Some("Gemini"),
        "opencode.exe" | "opencode" => Some("OpenCode"),
        "copilot.exe" | "copilot" => Some("GitHub Copilot"),
        "amp.exe" | "amp" => Some("Amp"),
        "aider.exe" | "aider" => Some("Aider"),
        "goose.exe" | "goose" => Some("Goose"),
        "windsurf.exe" => Some("Windsurf"),
        "trae.exe" => Some("Trae"),
        "qwen.exe" | "qwen" => Some("Qwen Code"),
        "qoder.exe" | "qoder" => Some("Qoder"),
        "droid.exe" | "droid" => Some("Droid"),
        _ => None,
    }
}

fn leading_arguments(command_line: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut arg = String::new();
    let mut quoted = false;
    for c in command_line.chars().take(8192) {
        if c == '"' {
            quoted = !quoted;
        } else if c.is_whitespace() && !quoted {
            if !arg.is_empty() {
                args.push(std::mem::take(&mut arg));
                if args.len() == 3 {
                    return args;
                }
            }
        } else {
            arg.push(c);
        }
    }
    if !arg.is_empty() {
        args.push(arg);
    }
    args.truncate(3);
    args
}
fn provider_for_wrapper(command_line: &str) -> Option<&'static str> {
    let args = leading_arguments(command_line);
    let runner = args
        .first()?
        .rsplit(['\\', '/'])
        .next()?
        .to_ascii_lowercase();
    let script = args.get(1)?.replace('\\', "/").to_ascii_lowercase();
    if matches!(
        runner.as_str(),
        "python.exe" | "python3.exe" | "python" | "python3" | "py.exe"
    ) {
        return if script == "-m" && args.get(2).is_some_and(|m| m == "aider") {
            Some("Aider")
        } else {
            None
        };
    }
    if !matches!(runner.as_str(), "node.exe" | "node" | "bun.exe" | "bun") {
        return None;
    }
    // Match canonical package path components, not prompt text or arbitrary project names.
    [
        ("/@google/gemini-cli/", "Gemini"),
        ("/@anthropic-ai/claude-code/", "Claude Code"),
        ("/@openai/codex/", "Codex"),
        ("/@sourcegraph/amp/", "Amp"),
        ("/@github/copilot/", "GitHub Copilot"),
        ("/opencode-ai/", "OpenCode"),
        ("/@qwen-code/qwen-code/", "Qwen Code"),
    ]
    .into_iter()
    .find_map(|(marker, provider)| script.contains(marker).then_some(provider))
}
fn running_providers() -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct ProcessName {
        name: Option<String>,
    }
    // Query names only: no command lines, prompts, environment values, or window titles.
    let com = wmi::COMLibrary::new().map_err(|e| e.to_string())?;
    let connection = wmi::WMIConnection::new(com).map_err(|e| e.to_string())?;
    let rows: Vec<ProcessName> = connection
        .raw_query("SELECT Name FROM Win32_Process")
        .map_err(|e| e.to_string())?;
    let mut providers: Vec<String> = rows
        .into_iter()
        .filter_map(|row| {
            row.name
                .and_then(|n| provider_for_executable(&n).map(str::to_owned))
        })
        .collect();
    #[derive(Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct WrapperProcess {
        command_line: Option<String>,
    }
    // Only interpreter processes need their leading script/module arguments inspected.
    // Raw command lines are discarded, never returned or logged; prompt arguments are ignored.
    if let Ok(wrappers)=connection.raw_query::<WrapperProcess>("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe' OR Name='bun.exe' OR Name='python.exe' OR Name='python3.exe' OR Name='py.exe'") {
        providers.extend(wrappers.into_iter().filter_map(|row| row.command_line.and_then(|line|provider_for_wrapper(&line).map(str::to_owned))));
    }
    providers.sort();
    providers.dedup();
    Ok(providers)
}
fn merge_processes(
    mut sessions: Vec<AgentSession>,
    providers: &[String],
    current: u64,
) -> Vec<AgentSession> {
    for provider in providers {
        let canonical = canonical_provider(provider);
        if sessions.iter().any(|s| {
            canonical_provider(&s.provider) == canonical
                && current.saturating_sub(s.updated_at) <= WORKING_SECONDS
        }) {
            continue;
        }
        let mut s = new_session(provider, &format!("process-{canonical}"));
        s.source = "process".into();
        s.status = "app-open".into();
        s.project = provider.clone();
        s.title = format!("{provider} is open");
        s.updated_at = current;
        s.activity = "App running; activity unavailable".into();
        s.detail = s.activity.clone();
        sessions.push(s);
    }
    let rank = |s: &AgentSession| match s.status.as_str() {
        "working" => 0,
        "needs-attention" => 1,
        "app-open" => 2,
        _ => 3,
    };
    sessions.sort_by_key(|s| (rank(s), std::cmp::Reverse(s.updated_at)));
    let mut selected = Vec::new();
    let mut represented = HashSet::new();
    let mut ids = HashSet::new();
    for s in &sessions {
        if represented.insert(canonical_provider(&s.provider)) && selected.len() < 32 {
            ids.insert(s.id.clone());
            selected.push(s.clone());
        }
    }
    for s in sessions {
        if selected.len() >= 32 {
            break;
        }
        if ids.insert(s.id.clone()) {
            selected.push(s);
        }
    }
    selected.sort_by_key(|s| (rank(s), std::cmp::Reverse(s.updated_at)));
    selected
}
#[derive(Serialize)]
pub struct AgentProviderCoverage {
    pub provider: String,
    pub detected_locally: bool,
    pub running: bool,
    pub activity_source: String,
}
fn provider_coverage() -> Vec<AgentProviderCoverage> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default());
    let roaming = PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default());
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default());
    let running = running_providers().unwrap_or_default();
    [
        (
            "Codex",
            vec![home.join(".codex")],
            "Codex transcript + process + hook",
        ),
        (
            "Claude Code",
            vec![home.join(".claude")],
            "Claude transcript + process + hook",
        ),
        (
            "Gemini",
            vec![home.join(".gemini")],
            "Gemini session journal (recorded state) + process + hook",
        ),
        (
            "Antigravity",
            vec![
                roaming.join("Antigravity"),
                home.join(".gemini/antigravity"),
            ],
            "Process + hook; binary conversations are not decoded",
        ),
        (
            "Cursor",
            vec![roaming.join("Cursor"), home.join(".cursor")],
            "Process + hook; transcript timestamps are unavailable",
        ),
        (
            "OpenCode",
            vec![
                home.join(".local/share/opencode"),
                home.join(".config/opencode"),
            ],
            "Process + hook",
        ),
        (
            "GitHub Copilot",
            vec![home.join(".copilot")],
            "Dedicated CLI process + hook; VS Code alone is not evidence",
        ),
        (
            "Amp",
            vec![home.join(".amp"), home.join(".config/amp")],
            "Process + hook",
        ),
        ("Aider", vec![home.join(".aider")], "Process + hook"),
        ("Goose", vec![home.join(".config/goose")], "Process + hook"),
        (
            "Windsurf",
            vec![roaming.join("Windsurf"), local.join("Programs/Windsurf")],
            "Process + hook",
        ),
        ("Trae", vec![roaming.join("Trae")], "Process + hook"),
        ("Qwen Code", vec![home.join(".qwen")], "Process + hook"),
        (
            "Qoder",
            vec![roaming.join("Qoder"), home.join(".qoder")],
            "Process + hook",
        ),
        ("Droid", vec![home.join(".factory")], "Process + hook"),
    ]
    .into_iter()
    .map(|(provider, paths, source)| {
        let is_running = running.iter().any(|p| p == provider);
        AgentProviderCoverage {
            provider: provider.into(),
            detected_locally: is_running || paths.iter().any(|p| p.is_dir()),
            running: is_running,
            activity_source: source.into(),
        }
    })
    .collect()
}

fn collect(config: PathBuf) -> Result<Vec<AgentSession>, String> {
    let current = now();
    let mut cache = CACHE
        .get_or_init(|| Mutex::new(Cache::default()))
        .lock()
        .map_err(|e| e.to_string())?;
    if current.saturating_sub(cache.discovered_at) >= 10 {
        let mut paths = Vec::new();
        let mut budget = 4096;
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            let home = PathBuf::from(home);
            discover(
                &home.join(".codex/sessions"),
                "Codex",
                &mut paths,
                &mut budget,
                0,
                current,
            );
            budget = 4096;
            discover(
                &home.join(".claude/projects"),
                "Claude",
                &mut paths,
                &mut budget,
                0,
                current,
            );
            budget = 4096;
            discover(
                &home.join(".gemini/tmp"),
                "Gemini",
                &mut paths,
                &mut budget,
                0,
                current,
            );
        }
        budget = 512;
        discover(
            &config.join("agent-events"),
            "Hook",
            &mut paths,
            &mut budget,
            0,
            current,
        );
        let event_file = config.join("agent-events.jsonl");
        if event_file.is_file() {
            paths.push((event_file, "Hook"));
        }
        let freshness: HashMap<_, _> = paths
            .iter()
            .map(|(p, _)| (p.clone(), modified(p)))
            .collect();
        paths.sort_by_key(|(p, _)| std::cmp::Reverse(freshness[p]));
        paths = diverse_files(paths);
        cache
            .files
            .retain(|p, _| paths.iter().any(|(candidate, _)| candidate == p));
        cache.paths = paths;
        cache.discovered_at = current;
    }
    for (path, provider) in cache.paths.clone() {
        read_updates(
            &path,
            provider,
            cache.files.entry(path.clone()).or_default(),
            current,
        );
    }
    let mut result: Vec<_> = cache
        .files
        .values()
        .flat_map(|s| s.session.iter().chain(s.events.values()).cloned())
        .filter(|s| s.updated_at > 0 && current.saturating_sub(s.updated_at) <= RECENT_SECONDS)
        .map(|s| expire(s, current))
        .collect();
    result.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    let mut seen = HashSet::new();
    result.retain(|s| seen.insert(s.id.clone()));
    if current.saturating_sub(cache.processes_at) >= 5 {
        if let Ok(processes) = running_providers() {
            cache.processes = processes;
            cache.processes_at = current;
        } else {
            cache.processes.clear();
            cache.processes_at = current;
        }
    }
    Ok(merge_processes(result, &cache.processes, current))
}
#[tauri::command]
pub async fn get_agent_sessions(app: tauri::AppHandle) -> Result<Vec<AgentSession>, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || collect(config))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn agent_bridge_info(app: tauri::AppHandle) -> Result<AgentBridgeInfo, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let directory = config.join("agent-events");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(AgentBridgeInfo { event_file:config.join("agent-events.jsonl").to_string_lossy().into_owned(), event_directory:directory.to_string_lossy().into_owned(), schema_version:1, provider_coverage: provider_coverage(), example:serde_json::json!({"id":"my-agent","provider":"Local agent","project":"My project","title":"Build","status":"working","activity":"Running checks","updated_at":now()}), description:"Append one JSON object per line. The event file or .jsonl files in agent-events can contain multiple stable agent IDs. Status: working, idle, needs-attention or completed. updated_at is Unix seconds. Working expires after 120 seconds without a new event. Only local files are read; no network listener or configuration changes.".into() })
}

fn local_workspace(raw: &str) -> String {
    // Only local absolute drive paths; never URLs, shell syntax, UNC/network shares or files.
    let bytes = raw.as_bytes();
    if raw.chars().any(char::is_control)
        || bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !matches!(bytes[2], b'\\' | b'/')
    {
        return String::new();
    }
    if Path::new(raw).is_dir() {
        raw.to_string()
    } else {
        String::new()
    }
}
#[tauri::command]
pub async fn open_agent_session(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    if session_id.len() > 256 {
        return Err("Invalid session ID".into());
    }
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let session = tauri::async_runtime::spawn_blocking(move || collect(config))
        .await
        .map_err(|e| e.to_string())??
        .into_iter()
        .find(|s| s.id == session_id)
        .ok_or("Session is no longer available")?;
    let path = local_workspace(&session.path);
    if path.is_empty() {
        return Err("This session has no available local workspace".into());
    }
    std::process::Command::new(
        PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
            .join("explorer.exe"),
    )
    .arg(path)
    .spawn()
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn open_agent_integration_folder(app: tauri::AppHandle) -> Result<(), String> {
    let info = agent_bridge_info(app)?;
    let directory = PathBuf::from(info.event_directory);
    let guide = directory.join("README.txt");
    if !guide.exists() {
        let text = format!("Bloom local agent bridge\r\n\r\nCodex and Claude transcripts and Gemini CLI session journals are detected automatically and read locally. Antigravity, Cursor, OpenCode, Copilot CLI, Amp, Aider, Goose, Windsurf, Trae, Qwen Code, Qoder and Droid are detected by known running executable names; common Node/Python wrappers are recognized by their leading package/module path. App running does not mean an agent is working. Antigravity protobuf and Cursor timestamp-free transcripts are not decoded as live activity. No prompt or tool contents are returned. Working means a recent activity event, not a process guarantee; after 120 seconds without updates it becomes idle.\r\n\r\nFor other tools, append UTF-8 JSON plus a newline to {} or to a .jsonl file in this folder. Multiple IDs are supported. Use a stable ID, Unix seconds updated_at, and status working / idle / needs-attention / completed. Send new working events at least every 120 seconds while active. Optional path must be an existing local absolute workspace directory.\r\n\r\nExample (replace updated_at with current Unix seconds):\r\n{}\r\n\r\nOnly the last 256 KiB per changed file is read, at most 48 recent files and 32 sessions. Discovery refreshes every 10 seconds. Oversized, invalid and future events are ignored. This folder is a local spool, not a network server. Bloom never changes your agent configuration.\r\n", info.event_file, serde_json::to_string(&info.example).map_err(|e|e.to_string())?);
        fs::write(guide, text).map_err(|e| e.to_string())?;
    }
    std::process::Command::new(
        PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
            .join("explorer.exe"),
    )
    .arg(directory)
    .spawn()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(s: &str, provider: &str, at: u64) -> Option<AgentSession> {
        let mut state = FileState::default();
        parse_line(&mut state, provider, "fixture", s.as_bytes(), at);
        state.session.or_else(|| state.events.into_values().next())
    }
    #[test]
    fn utc_dates_are_exact_and_validated() {
        assert_eq!(
            timestamp(&Value::String("2026-10-22T12:34:56.123Z".into())),
            Some(1792672496)
        );
        assert_eq!(
            timestamp(&Value::String("2024-02-29T00:00:00Z".into())),
            Some(1709164800)
        );
        assert_eq!(
            timestamp(&Value::String("2025-02-29T00:00:00Z".into())),
            None
        );
    }
    #[test]
    fn hook_rejects_unknown_status_future_and_missing_id() {
        for data in [
            r#"{"id":"x","status":"busy","updated_at":1000}"#,
            r#"{"id":"x","status":"working","updated_at":2000}"#,
            r#"{"status":"working","updated_at":1000}"#,
        ] {
            assert!(parse(data, "Hook", 1000).is_none());
        }
    }
    #[test]
    fn hooks_are_sanitized_and_bounded() {
        let s=parse(r#"{"id":"a","provider":"Test","status":"needs-attention","updated_at":1000,"title":"Hello\nworld","activity":"Approval"}"#,"Hook",1000).unwrap();
        assert_eq!(s.title, "Helloworld");
        assert_eq!(s.status, "needs-attention");
        assert_eq!(s.source, "event");
    }
    #[test]
    fn codex_completion_and_interrupt_are_not_working() {
        let s=parse(r#"{"timestamp":1000,"type":"event_msg","payload":{"type":"task_complete","last_agent_message":"SECRET"}}"#,"Codex",1000).unwrap();
        assert_eq!(s.status, "completed");
        assert!(!serde_json::to_string(&s).unwrap().contains("SECRET"));
        let s = parse(
            r#"{"timestamp":1000,"type":"event_msg","payload":{"type":"turn_aborted"}}"#,
            "Codex",
            1000,
        )
        .unwrap();
        assert_eq!(s.status, "idle");
    }
    #[test]
    fn claude_end_turn_and_tool_activity() {
        let s=parse(r#"{"timestamp":1000,"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"SECRET"}]}}"#,"Claude",1000).unwrap();
        assert_eq!(s.status, "completed");
        assert!(!serde_json::to_string(&s).unwrap().contains("SECRET"));
    }
    #[test]
    fn old_events_do_not_resurrect_work() {
        let s = parse(
            r#"{"timestamp":1,"type":"event_msg","payload":{"type":"task_started"}}"#,
            "Codex",
            RECENT_SECONDS + 20,
        )
        .unwrap();
        assert_eq!(s.updated_at, 0);
    }
    #[test]
    fn older_events_do_not_override_completion() {
        let mut s = AgentSession {
            id: "a".into(),
            provider: "Test".into(),
            agent: String::new(),
            detail: String::new(),
            path: String::new(),
            project: "".into(),
            title: "".into(),
            status: "completed".into(),
            activity: "Done".into(),
            updated_at: 1000,
            source: "event".into(),
        };
        set_activity(&mut s, "working", "Thinking", 999);
        assert_eq!(s.status, "completed");
    }
    #[test]
    fn working_expires_but_completed_does_not() {
        let s=parse(r#"{"id":"a","provider":"Custom","status":"working","updated_at":1000,"activity":"Build"}"#,"Hook",1000).unwrap();
        assert_eq!(expire(s.clone(), 1120).status, "working");
        let stale = expire(s, 1121);
        assert_eq!(stale.status, "idle");
        assert_eq!(stale.agent, "Custom");
        assert!(stale.detail.contains("No recent"));
        let done = parse(
            r#"{"id":"a","status":"completed","updated_at":1000}"#,
            "Hook",
            1000,
        )
        .unwrap();
        assert_eq!(expire(done, 9999).status, "completed");
    }
    #[test]
    fn incremental_reader_preserves_partial_lines_and_multiple_agents() {
        use std::io::Write;
        let file = std::env::temp_dir().join(format!(
            "bloom-agent-test-{}-{}.jsonl",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(
            &file,
            b"{\"id\":\"a\",\"status\":\"working\",\"updated_at\":1000}",
        )
        .unwrap();
        let mut state = FileState::default();
        read_updates(&file, "Hook", &mut state, 1000);
        assert!(state.events.is_empty());
        let mut stream = fs::OpenOptions::new().append(true).open(&file).unwrap();
        stream
            .write_all(b"\n{\"id\":\"b\",\"status\":\"completed\",\"updated_at\":1000}\n")
            .unwrap();
        drop(stream);
        read_updates(&file, "Hook", &mut state, 1000);
        assert_eq!(state.events.len(), 2);
        assert_eq!(state.events["hook:a"].status, "working");
        let old_offset = state.offset;
        read_updates(&file, "Hook", &mut state, 1000);
        assert_eq!(state.offset, old_offset);
        fs::write(
            &file,
            b"{\"id\":\"a\",\"status\":\"idle\",\"updated_at\":1001}\n",
        )
        .unwrap();
        read_updates(&file, "Hook", &mut state, 1001);
        assert_eq!(state.events.len(), 1);
        assert_eq!(state.events["hook:a"].status, "idle");
        fs::remove_file(&file).unwrap();
    }
    #[test]
    fn hook_event_map_and_fields_have_limits() {
        let mut state = FileState::default();
        for n in 0..100 {
            let v = serde_json::json!({"id":format!("agent-{n}"),"status":"working","updated_at":1000+n,"activity":"x".repeat(1000)});
            parse_line(
                &mut state,
                "Hook",
                "fixture",
                v.to_string().as_bytes(),
                1100,
            );
        }
        assert_eq!(state.events.len(), 64);
        assert!(state.events.values().all(|s| s.activity.len() == 160));
        assert!(local_workspace("https://example.com").is_empty());
        assert!(local_workspace("\\\\server\\share").is_empty());
        assert!(local_workspace("C:\\bad\npath").is_empty());
    }
    #[test]
    fn executable_provider_detection_is_exact_and_case_insensitive() {
        for (exe, expected) in [
            ("C:\\Apps\\Antigravity.exe", "Antigravity"),
            ("CURSOR.EXE", "Cursor"),
            ("claude.exe", "Claude Code"),
            ("codex.exe", "Codex"),
            ("opencode.exe", "OpenCode"),
            ("copilot.exe", "GitHub Copilot"),
            ("amp.exe", "Amp"),
        ] {
            assert_eq!(provider_for_executable(exe), Some(expected));
        }
        for exe in [
            "chrome.exe",
            "Code.exe",
            "my-codex-tool.exe",
            "not-antigravity.exe",
            "python.exe",
        ] {
            assert_eq!(provider_for_executable(exe), None);
        }
    }
    #[test]
    fn wrappers_match_script_package_not_prompt_arguments() {
        assert_eq!(
            provider_for_wrapper(
                r#""C:\Program Files\nodejs\node.exe" "C:\npm\node_modules\@google\gemini-cli\dist\index.js" --prompt-secret"#
            ),
            Some("Gemini")
        );
        assert_eq!(
            provider_for_wrapper("python.exe -m aider --secret"),
            Some("Aider")
        );
        assert_eq!(
            provider_for_wrapper("node.exe C:/project/app.js @google/gemini-cli/secret"),
            None
        );
        assert_eq!(
            provider_for_wrapper("chrome.exe C:/node_modules/@google/gemini-cli/index.js"),
            None
        );
    }
    #[test]
    fn process_fallback_is_distinct_from_working_and_dedupes_recent_activity() {
        let p = vec!["Antigravity".into(), "Codex".into()];
        let mut active = new_session("Codex", "fixture");
        active.status = "working".into();
        active.updated_at = 1000;
        let result = merge_processes(vec![active], &p, 1000);
        assert_eq!(result.len(), 2);
        let app = result.iter().find(|s| s.provider == "Antigravity").unwrap();
        assert_eq!(app.status, "app-open");
        assert_eq!(app.source, "process");
        assert_eq!(app.detail, "App running; activity unavailable");
        assert_eq!(result.iter().filter(|s| s.status == "working").count(), 1);
    }
    #[test]
    fn crowded_history_cannot_hide_another_running_provider() {
        let history = (0..100)
            .map(|n| {
                let mut s = new_session("Codex", &n.to_string());
                s.updated_at = 1000 - n;
                s
            })
            .collect();
        let result = merge_processes(history, &["Antigravity".into(), "Claude Code".into()], 1100);
        assert_eq!(result.len(), 32);
        assert!(result.iter().any(|s| s.provider == "Antigravity"));
        assert!(result.iter().any(|s| s.provider == "Claude Code"));
        let files = (0..100)
            .map(|n| (PathBuf::from(n.to_string()), "Codex"))
            .chain(std::iter::once((PathBuf::from("gemini"), "Gemini")))
            .collect();
        let selected = diverse_files(files);
        assert_eq!(selected.len(), MAX_FILES);
        assert!(selected.iter().any(|(_, p)| *p == "Gemini"));
    }
    #[test]
    fn gemini_journal_uses_event_timestamps_without_inventing_working_status() {
        let s=parse(r#"{"$set":{"messages":[{"timestamp":1000,"type":"user","content":"PRIVATE"}],"lastUpdated":1000}}"#,"Gemini",1000).unwrap();
        assert_eq!(s.status, "idle");
        assert_eq!(s.updated_at, 1000);
        assert!(!serde_json::to_string(&s).unwrap().contains("PRIVATE"));
        let s=parse(r#"{"messages":[{"timestamp":1000,"type":"gemini","content":"PRIVATE"}],"lastUpdated":1000}"#,"Gemini",1000).unwrap();
        assert_eq!(s.status, "completed");
        let s = parse(r#"{"lastUpdated":9999}"#, "Gemini", 1000).unwrap();
        assert_eq!(s.updated_at, 0);
    }
}
