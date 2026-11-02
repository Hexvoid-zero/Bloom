import { useSidebarPreferences } from "../sidebarPreferences";
import { invoke } from "@tauri-apps/api/core";
export function SidebarTab() {
	const { preferences: p, save, loaded, error } = useSidebarPreferences();
	return (
		<div className="start-settings">
			<h2>Glassy sidebar</h2>
			<p className="start-settings-hint">
				A collapsible workspace at either screen edge. Search apps, follow agents, plan tasks and
				open project folders.
			</p>
			<fieldset disabled={!loaded}>
				<label className="start-setting-line">
					<span>
						<strong>Enable sidebar</strong>
						<small>Independent from the dock and notch.</small>
					</span>
					<input
						type="checkbox"
						checked={p.enabled}
						onChange={(e) => void save({ ...p, enabled: e.target.checked })}
					/>
				</label>
				<label className="start-setting-line">
					<span>
						<strong>Screen edge</strong>
					</span>
					<select
						aria-label="Sidebar side"
						value={p.side}
						onChange={(e) => void save({ ...p, side: e.target.value as typeof p.side })}
					>
						<option value="left">Left</option>
						<option value="right">Right</option>
					</select>
				</label>
				<label className="start-setting-line">
					<span>
						<strong>Visibility</strong>
						<small>
							Smart hides when another app overlaps. Move to the screen edge to reveal it.
						</small>
					</span>
					<select
						aria-label="Sidebar visibility"
						value={p.mode}
						onChange={(e) => void save({ ...p, mode: e.target.value as typeof p.mode })}
					>
						<option value="smart">Smart</option>
						<option value="always">Always visible</option>
						<option value="auto">Auto-hide</option>
					</select>
				</label>
				<label className="start-setting-line">
					<span>
						<strong>Expanded navigation</strong>
					</span>
					<input
						type="checkbox"
						checked={p.expanded}
						onChange={(e) => void save({ ...p, expanded: e.target.checked })}
					/>
				</label>
				<label className="start-setting-line">
					<span>
						<strong>Night mode</strong>
					</span>
					<input
						type="checkbox"
						checked={p.night}
						onChange={(e) => void save({ ...p, night: e.target.checked })}
					/>
				</label>
			</fieldset>
			{error && <p role="alert">{error}</p>}
			<h3>Bloom Voice</h3>
			<p className="start-settings-hint">
				Ctrl+Z: tap for hands-free dictation, or hold while speaking and release to finish. This
				replaces Undo while enabled. Change or disable the shortcut in Voice settings.
			</p>
			<button className="start-setting-secondary" onClick={() => void invoke("show_voice_panel")}>
				Open Voice settings in the notch
			</button>
		</div>
	);
}
