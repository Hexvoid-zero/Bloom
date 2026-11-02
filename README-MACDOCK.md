# Bloom Mac Dock

Custom local Windows build of Bloom 3.10.0, derived from GPL-3.0-only upstream commit `7c4f5fbfee6e1fc3ed42e002cc698a00c3e23467` at https://github.com/SehajveerSingh2005/bloom. This is a source build, not recovered native source or a binary patch.

## Voice and glass sidebar (November 1, 2026)

Bloom Voice is built into the notch. Tap **Ctrl+Z** for hands-free dictation or hold it while speaking and release to finish. Change the shortcut or choose Off in Voice settings to restore normal Undo. The local Whisper engine supports multilingual transcription, measured microphone feedback, editable text, insertion into the original writing window, optional local history, dictionary and snippet rules. Engine setup downloads about 150 MB with checksum validation; this PC is already provisioned. Audio stays on the PC and is discarded after processing. This independent implementation does not use Wispr's private AI service or claim identical recognition/rewriting quality.

The video-inspired sidebar expands from a glass icon rail to grouped navigation with a moving glass hover highlight, tooltips, project branches, Night mode and the actual Windows account. **Settings → Sidebar & Voice** selects Left/Right, Smart/Always/Auto-hide and expanded state. It contains real app search, agent activity, dated tasks, a local expense ledger, project folder shortcuts, Phone Link routing and reports from saved data. Move to the selected screen edge to reveal it when hidden. It reserves no screen work area and leaves existing dock/notch/Start preferences intact.

See [VOICE-AND-SIDEBAR.md](VOICE-AND-SIDEBAR.md) for behavior, privacy, reference extraction and verification limits.

## Workspace Start and agent notch (October 22, 2026)

Bloom now provides its own optional Start surface from the dock Start button and a lone Windows-key tap. Disable it in Settings → Start menu to use native Start; the Start footer also offers native Start. This does not patch or re-register Windows Explorer.

Settings → Start menu controls independent app pins (up to 65), pin order, hidden apps, overview sections and order, layout density, accent, welcome text, Phone Link panel, agent notch and companion. Start has app search, categories, recent launches, quick folder links, lock and power settings. Recent history is limited to apps launched from Bloom Start.

The Coucou-inspired notch adds the approved Bloom Fold mark, activity count and direct tabs for Agents, Calendar/Timer, Controls, Music and Shelf. Existing media, timer, calendar, file shelf, system controls, app audio, Wi-Fi/Bluetooth and temporary volume/brightness HUDs are retained.

Agent overview reads Codex, Claude Code and Gemini local session records automatically, with a 4-second UI refresh and 10-second file discovery. It never labels a process as working just because it is open. Working expires to idle after 120 seconds without updates; logs can omit permission events, so absence of a needs-attention badge is not proof no approval is pending. Fifteen named providers, including Antigravity and Cursor, are detected by exact process or canonical CLI wrapper. A running tool without readable activity is shown as App open, separately from Working. The help panel lists detection coverage and native live connections for Antigravity, Cursor and Gemini. Connect preserves existing hooks and saves a backup; Disconnect removes Bloom's entries. Restart the agent after connecting. Other tools can publish UTF-8 JSONL events to the local bridge shown by the overview help button. Approvals remain in the agent's own UI. See AGENT-COVERAGE.md for coverage and bounds.

Phone Link shortcuts open Windows Phone Link, which owns pairing, messages, calls, photos and file sharing. The panel's device observations come from Windows Bluetooth; Phone Link notification/message telemetry is unavailable to Bloom. Section shortcuts currently open the Phone Link home screen because Windows exposes no supported deep link for those sections.

Reference: Coucou source at commit `ddc1685709a9bc13dc0ff06ef1977b7acf50b0eb`. This implementation uses its interaction pattern as a reference; no Coucou/Mochi branding, character assets or sounds are redistributed.

The approved Fold identity is applied to the notch, Start, app/tray icons, About page and built-in logo choices. Its separate branding kit is in branding/fold next to the delivery. Widget tracks reserve space around the clock; tooltips float outside them, and narrow status tracks scroll.

Wi-Fi has a direct notch tab and hover shortcut. It supports radio on/off, network scans, saved-network connections, password entry for personal networks, disconnect and forget. Enterprise sign-ins and additional settings open Windows Settings. Radio failures are shown and roll back the switch; network scan errors are visible. Windows may require desktop location access to list nearby networks.

The notch accepts keyboard focus while Wi-Fi passwords or Voice fields are being edited. Closing it restores focus to the previous app when the notch still owns focus. Regular hover and media controls keep the overlay's non-activating behavior.

## Current behavior

Dock pins and their exact order are saved after every change to `%USERPROFILE%\.bloom-macdock\pinned_apps.json`, with `pinned_apps.backup.json` for recovery. Existing pins migrate from the previous app profile once. A saved empty dock stays empty. Windows taskbar import only seeds a new layout. Writes are serialized and flushed before replacing the old file; a damaged primary file is preserved when recovering its backup.

The notch's Controls panel also offers airplane mode, displays, screen projection, night light, mobile hotspot, sound devices, notifications, accessibility, power, Focus, VPN and Windows Settings. These open the corresponding Windows controls; Wi-Fi, Bluetooth, volume, brightness and app audio remain in the notch. The panel scrolls within its bounds, while the hover shortcuts use equal-width tracks. Transparent native and document backgrounds are set before the first styled frame to prevent a white fallback rectangle.

- The compact clock notch is attached to the top screen edge with curved flares. It remains visible over apps and reserves no top work area. Hover to reveal shortcuts, click the clock for the calendar, or right-click for controls.
- The full-width top menu bar and both side HUDs have been removed. Volume and brightness controls are in the notch. Media-key changes briefly show a slider inside the notch.
- The expanded controls include per-app audio sliders and mute buttons. The calendar, timer, media controls, shelf and settings remain available.
- The bottom dock imports Windows taskbar pins, keeps installed browser apps' own icons, and supports 65 pinned apps. Logo images occupy 86% of their slots; only the hovered icon enlarges. The background strip follows the foreground app color.
- The native input surface refreshes whenever its window size changes, so wide monitors keep every dock icon clickable. Lifted icons remain in its hit area.

## Run and build

Use `release/Bloom-MacDock.exe` or the accompanying installer. This variant uses `com.sehaz.bloom.macdock` and a separate profile from upstream Bloom. Quit via the tray menu to restore Windows' taskbar. It does not automatically register at Windows login, and upstream auto-installation is disabled for this custom identifier.

Build on Windows with Bun, Rust stable, Visual Studio C++ Build Tools and Windows SDK:

```powershell
bun install --frozen-lockfile
bun run build
bun test scripts
bun run tauri build --config src-tauri/tauri.macdock.conf.json --bundles nsis
```

Rust application tests are in the binary target: run `cargo test --release --locked --bin bloom` from `src-tauri`. The library entry point is an empty stub.

## Verification

The `evidence` folder and `evidence/review.html` distinguish browser fixtures from the packaged native WebView and desktop captures. `scripts/verifyNotch.mjs` checks the notch, system sliders, app audio/mute, key indicators and removal of side/top bars. `scripts/verifyDock.mjs` checks capacity, scrolling, end-of-row clicks and restrained hover using mocked IPC; these tests launch no user apps. Browser checks use the production bundle served on port 4173 and Playwright from `BLOOM_TEST_TOOLS`.

The source, license, reverse-engineering report and limitations are included. Original project attribution is retained in `LICENSE` and source files.


## Current material and window behavior

Liquid Glass is enabled by default for the dock. Settings → Appearance → Dock Liquid Glass turns it off or on, with the choice saved across restarts. When enabled, the dock stays clear over both wallpaper and application content. It has no opaque app-color strip or opaque theme fallback. One WebGL2 lens samples an in-memory scene of the desktop wallpaper and overlapping application windows. It combines background transmission, subtle magnification, edge refraction, diffusion, reflected color and pointer/press highlights. The real compositor remains visible beneath it. The strip is never saved or uploaded. Unavailable, blank, protected or nonresponsive captures leave the compositor's real transparent background visible.

Start uses glassmorphism: frosted translucent main and phone panels, soft blur and readable content. It does not use liquid lens distortion. Appearance settings retains an optional Liquid Glass switch for the notch; existing notch features are preserved.

The added global macOS traffic-light buttons have been removed entirely; the MacOS Start option has its own local titlebar controls. Applications retain their normal Windows close, maximize and minimize controls.

The `github` folder in the delivery contains complete source, a README, GPL license, build configuration and a Windows CI workflow. It excludes dependencies, build outputs, user profiles, credentials, session records and verification logs. No remote repository is published automatically.

## Launch and persistence

The installed executable is registered at Windows sign-in with a quoted path and `--autostart`. General settings can disable this. Ordered pins and their backup live in `%USERPROFILE%\.bloom-macdock`. Bloom-owned shortcut copies preserve Chrome profiles, arguments and logos independently of Explorer taskbar pins. Stable app identities distinguish installed web apps from ordinary Chrome windows; running dots require a live window. Start includes Lock, Sleep, Shut down and Restart.

## Verification boundaries

Browser fixtures exercise production UI with mocked native IPC. Native scripts use the installed app and real IPC. Power actions are mocked instead of locking or shutting down the PC. Startup is checked through registration and fresh process launches rather than a forced PC reboot. This is a Windows material implementation inspired by Apple's optical appearance, not Apple's proprietary rendering runtime.

### Dock activation and sign-in

Clicking a running dock item only focuses or toggles its existing window; Windows foreground restrictions never trigger a duplicate launch. Middle-click and New instance remain explicit launch actions. Settings > General > Launch at Login saves the startup preference. At Windows sign-in Bloom loads the existing dock, notch and Start integration settings, pins and order; the Start panel opens on request.

### MacOS Start and GPU dock optics

Settings > Start menu > Start menu style offers Bloom Start and MacOS Start. The latter follows the supplied compact launcher reference with working search, application launches, pinned/recent lists, agent activity, Windows shortcuts and power options. Preview Start menu opens the selected style. Both styles use the same app catalog and saved customization.

The optional dock glass now uses one GPU optical surface backed by a local desktop/window scene. Wallpaper formats and layout modes are handled natively; capture excludes Bloom and cloaked windows. See `APPLE-LIQUID-GLASS.md` for all five reviewed Apple sources, implementation details and the distinction from Apple's proprietary renderer.
