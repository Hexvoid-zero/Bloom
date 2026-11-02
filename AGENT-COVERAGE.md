# Local agent detection

Bloom distinguishes actual recorded agent activity from an application merely being open. Nothing is sent to a server. Native live connections merge Bloom hooks into the selected agent's configuration, with a backup and a Disconnect control.

| Provider | Automatic evidence | Meaning |
| --- | --- | --- |
| Codex | `.codex/sessions` JSONL events | Recent turn/tool/thinking events, completion, interruption and explicit input requests |
| Claude Code | `.claude/projects` JSONL events | Recent assistant/tool events, completed turns and explicit tool denials |
| Gemini CLI | `.gemini/tmp/*/chats` JSON or JSONL `$set` journals | Recorded input/response and explicit event timestamps; saved input alone never counts as working |
| Antigravity | Known executable; native hooks when connected | **App open** without hooks; turn/tool/completion events with hooks. Binary conversation protobuf files are not decoded. |
| Cursor | Known executable; native hooks when connected | **App open** without hooks; session/turn/tool/completion events with hooks. Timestamp-free transcripts are not treated as live activity. |
| OpenCode, GitHub Copilot CLI, Amp, Aider, Goose, Windsurf, Trae, Qwen Code, Qoder, Droid | Known running executable | **App open**; live turn state requires hook events |
| Other tools | Local hook event file | The explicit status supplied by that tool |

Known Node/Bun wrappers are recognized from the leading script path inside canonical Gemini, Claude Code, Codex, Amp, Copilot, OpenCode and Qwen package directories. Python `-m aider` is recognized. Prompt arguments are ignored, and raw process command lines are never returned or logged. Browsers, VS Code alone and arbitrary scripts named after a product are not evidence of an active agent.

`app-open` means **App running; activity unavailable**, with `source: process`. It is never counted as `working`. An unknown interpreter wrapper may need a hook. A local data directory in provider coverage is a detection hint, not proof that a product remains installed.

## Freshness and bounds

A working event becomes idle after 120 seconds without a new activity event. A transcript cannot prove that a process is still executing, particularly during a silent long-running tool call. Completion and attention states reflect the latest explicit event.

Discovery runs at most every 10 seconds; process detection at most every 5 seconds. Transcript/event files are selected from the last 7 days, with at most 48 files. Changed JSONL files are read incrementally with a 256 KiB tail bound. Gemini JSON documents must be at most 1 MiB. Invalid or oversized records are ignored. At most 32 sessions are returned, with provider diversity preserved so a busy history from one provider does not hide another detected provider.

The overview contains session identifiers, provider, project name, activity category, timestamps and available workspace paths. It does not return prompt text, model response text, tool arguments or tool output.

## Other agents and precise live state

The integration help panel has Connect / Disconnect controls for Antigravity, Cursor and Gemini. Restart the agent after connecting. Existing configuration is preserved and backed up beside the original JSON file before a change. Invalid or conflicting configuration is left untouched. Disconnect removes Bloom's own entries. Agent permissions remain in the original tool; Bloom does not approve tool calls. Antigravity's decision-gating PreToolUse hook is deliberately not installed.

The metadata relay is `%LOCALAPPDATA%\BloomMacDock\bin\bloom-agent-hook.exe`. It takes bounded JSON on stdin, emits provider-compatible neutral output, and appends only normalized metadata to Bloom's local event journal. Its early CLI branch does not start the dock, WebView, watchdog or taskbar logic. The relay remains available after Bloom closes; launch Bloom again to view captured activity.

Use **Agent integration help → Open hook guide** to open Bloom's own profile `agent-events` folder. No network listener or agent configuration edits are needed. Append one UTF-8 JSON object plus a newline to a `.jsonl` file in that folder, or to the sibling `agent-events.jsonl` file. Multiple stable agent IDs are supported in a file.

```json
{"id":"my-agent","provider":"My tool","project":"My project","title":"Build","status":"working","activity":"Running checks","updated_at":1792672496}
```

Replace `updated_at` with current Unix seconds on every event. Accepted statuses are `working`, `idle`, `needs-attention` and `completed`. Send periodic events within 120 seconds while work remains active. Optional `path` must refer to an existing local absolute workspace directory. **Open workspace** validates the known session and opens that directory in Explorer; it does not resume or send messages to an agent.
