# Bloom Voice and the glass sidebar

Built from the user-supplied Wispr installer reference and the 14.273-second Glassy SideBar V5 recording. The installer was inventoried, not installed or repackaged. No Wispr code, assets, credentials, private APIs or service endpoints are included.

## Voice

Open Dictation in the notch, or Settings → Sidebar & Voice → Open Voice settings. Ctrl+Z taps toggle hands-free dictation; holding for at least 300 ms records until release. This replaces normal Undo while enabled. Voice settings offer Ctrl+Alt+Space or Off, which restores Undo. Shortcut auto-repeat is ignored. Accessibility-generated keyboard events work too.

The engine is whisper.cpp v1.8.3 with the multilingual Whisper base model. It runs locally on the CPU. The first setup downloads approximately 150 MB and validates SHA-256 for both archives/model. This PC was provisioned during verification. Other PCs can use the setup button in Voice. Engine files remain outside the repository and installer; an Internet connection is required only for this setup. See `src-tauri/src/voice_setup.ps1` for pinned URLs and hashes. Model/engine MIT licensing belongs to their respective upstream projects.

Recording opens the selected/default Windows microphone only on a recording action. The waveform represents measured input amplitude. Recordings are bounded to five minutes, resampled to 16 kHz mono PCM, transcribed locally and discarded. Cancel releases microphone tracks and stops the transcription worker. Generation tokens prevent late microphone or transcription promises from affecting a newer recording. Active recording locks other notch panels and keeps Stop/Cancel visible.

Text is inserted into the original external writing window using Windows Unicode input after checking that its HWND and PID still match and that Windows grants focus. No new app is launched to repair a closed target. If the target closes, loses focus, runs elevated, or blocks input, the transcript remains available for Copy. The clipboard changes only when Copy is chosen. Bloom does not press Enter to submit a message.

The transcript is editable. Local history is optional and can be cleared. Dictionary/snippet rules use literal `spoken phrase => replacement` lines and also prime the recognizer. Basic cleanup removes fillers and supports spoken new lines/paragraphs. This is an independent local dictation implementation: it does not claim Wispr's proprietary contextual AI rewrite, account syncing, Command Mode or identical recognition quality. No audio is uploaded to Wispr or another cloud provider.

## Sidebar

The video and two generated standalone references establish the tall glass capsule, warm translucent surface, thin rim, white protruding expand button, icon rail, grouped rows, moving spring glass highlight, tooltips, project branches, theme toggle and profile footer. Bloom's approved logo and actual Windows account replace the demonstration brand/avatar.

Settings → Sidebar & Voice controls enabled state, Left/Right placement, Smart/Always/Auto-hide visibility, expanded navigation and Night mode. Smart hides on overlap with an external foreground window and reveals after a short screen-edge dwell. Controls remain reachable while hovered or used. The drawer closes on focus loss; form drafts remain in memory. Native input regions follow only the visible components, so the unused transparent portion cannot swallow app clicks. The sidebar reserves no desktop work area and is independent of the dock/notch.

- Dashboard searches installed apps and launches their actual targets.
- Activity uses Bloom's existing real agent sessions and integration support.
- Wallet is a local expense ledger with descriptions, amounts, currencies and removal. It is not a banking/payment connection.
- Schedule saves dated tasks and completion state. Its badge is the number of unfinished tasks; no fabricated notification counts are shown.
- Messages opens Windows Phone Link, displaying available actual device status. Windows supplies the message/call/photo/file interfaces; public deep links do not expose each subpage separately.
- Projects chooses real folders and opens them. Saved folders also appear in the navigation tree.
- Reports derives counts and currency-separated expense totals from saved data and can copy a JSON workspace report.
- Settings opens Bloom settings. Night mode changes the sidebar material and persists. Profile shows the actual Windows username and opens Windows account settings.

Preferences and workspace records use separate `bloom-sidebar-*` settings. Existing dock pins/order, Start style, notch features, startup preferences and glass switches are preserved.

## Reference extraction

Expanded reference: approximately 288 × 780 CSS pixels, 40–44 pixel navigation tracks, 20 pixel line icons, 15 pixel labels, 10 pixel section labels and 28–30 pixel outer radius. Collapsed reference: 68 pixels wide, circular selection and tooltip outside the rail. The material combines a low-alpha warm tint, native blur clipped to its actual bounds and a bright inset rim. Responsive scroll preserves access on smaller displays. Generated references are design inputs, never claimed as runtime screenshots.

## Verification scope

Unit tests cover PCM conversion, literal dictionary rules, Unicode preservation, settings migration, malformed records and smart visibility. Browser tests use controlled IPC and generated microphone input to exercise capture/cleanup, tap versus hold, insertion requests, error states, persistence and sidebar actions. The real local engine transcribes the upstream JFK sample separately. Installed-app screenshots and native insertion checks are recorded in the evidence report. No tests submit messages, change radios, issue power commands or record the user's real microphone.
