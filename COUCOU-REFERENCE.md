# Coucou reference and Bloom adaptation

Reference: https://github.com/Louis-CFM/coucou at commit ddc1685709a9bc13dc0ff06ef1977b7acf50b0eb, inspected October 22, 2026. This is source repository analysis, rather than binary decompilation.

Observed source patterns:

- windows/src/island/fsm.ts: compact, hover peek, expanded and pinned interactions.
- windows/src/island/hooks.ts and windows/hook/src/normalize.rs: normalized lifecycle and tool events across providers.
- windows/src/style.css: compact session pills, focused details and status colors.
- windows/src-tauri/src/pipe.rs: local event relay with terminal fallback and deadlines for decisions.

Bloom keeps its visible top-attached concave notch, clock, calendar, timer, music, shelf and controls. It adds explicit navigation, its own leaf companion and a compact activity count with an expanded local session overview. A separate focusable Start window provides app pins, search, categories, agents and phone shortcuts. Native Windows Start remains available.

Agent activity comes from local Codex and Claude Code session events and an optional file-based bridge. No agent configuration is changed. This is not a feature-complete Coucou port: decisions remain with the original tool, and process presence never establishes an active turn. Bounded discovery and freshness limits are documented in README-MACDOCK.md.

Phone Link owns messages, calls, photos and notifications. Bloom opens the Windows app and reports independently observed Bluetooth information only.

Coucou source is MIT. Its separate LICENSE-ASSETS.md reserves Coucou/Mochi branding, character artwork, sounds and media. This implementation copies no Coucou source or assets; it uses the interaction pattern as a reference.

Production and fixture screenshots are labeled separately in the delivered evidence gallery. Reproducible scripts are included in scripts/.
