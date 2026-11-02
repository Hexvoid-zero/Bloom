import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsSync } from "./hooks/useSettingsSync";
export interface SidebarPreferences {
	enabled: boolean;
	side: "left" | "right";
	mode: "smart" | "always" | "auto";
	expanded: boolean;
	night: boolean;
}
export const SIDEBAR_DEFAULTS: SidebarPreferences = {
	enabled: true,
	side: "left",
	mode: "smart",
	expanded: false,
	night: false
};
export function parseSidebarPreferences(raw: unknown): SidebarPreferences {
	let v: Partial<SidebarPreferences> = {};
	try {
		v = typeof raw === "string" ? JSON.parse(raw) : (raw as Partial<SidebarPreferences>);
	} catch {}
	if (!v || typeof v !== "object") v = {};
	return {
		enabled: typeof v.enabled === "boolean" ? v.enabled : true,
		side: v.side === "right" ? "right" : "left",
		mode: v.mode === "always" || v.mode === "auto" ? v.mode : "smart",
		expanded: v.expanded === true,
		night: v.night === true
	};
}
export function useSidebarPreferences() {
	const [preferences, set] = useState(SIDEBAR_DEFAULTS),
		[loaded, setLoaded] = useState(false),
		[error, setError] = useState("");
	const accept = (v: unknown) => set(parseSidebarPreferences(v));
	useSettingsSync({ "bloom-sidebar-preferences": accept });
	useEffect(() => {
		let alive = true;
		invoke<Record<string, string>>("load_settings")
			.then((s) => {
				if (alive) {
					accept(s["bloom-sidebar-preferences"]);
					setLoaded(true);
				}
			})
			.catch((e) => {
				if (alive) setError(String(e));
			});
		return () => {
			alive = false;
		};
	}, []);
	const save = async (next: SidebarPreferences) => {
		try {
			await invoke("save_setting", {
				key: "bloom-sidebar-preferences",
				value: JSON.stringify(next)
			});
			set(next);
			setError("");
		} catch (e) {
			setError(String(e));
		}
	};
	return { preferences, save, loaded, error };
}
export interface WorkspaceTask {
	id: string;
	title: string;
	due: string;
	done: boolean;
}
export interface WorkspaceProject {
	id: string;
	name: string;
	path: string;
	color: string;
}
export interface WorkspaceExpense {
	id: string;
	title: string;
	cents: number;
	currency: string;
	at: number;
}
export interface WorkspaceData {
	tasks: WorkspaceTask[];
	projects: WorkspaceProject[];
	expenses: WorkspaceExpense[];
}
export function parseWorkspace(raw: unknown): WorkspaceData {
	let v: Partial<WorkspaceData> = {};
	try {
		v = typeof raw === "string" ? JSON.parse(raw) : (raw as Partial<WorkspaceData>);
	} catch {}
	if (!v || typeof v !== "object") v = {};
	return {
		tasks: Array.isArray(v.tasks)
			? v.tasks
					.filter(
						(t) =>
							t &&
							typeof t.id === "string" &&
							typeof t.title === "string" &&
							typeof t.due === "string" &&
							typeof t.done === "boolean"
					)
					.slice(0, 300)
			: [],
		projects: Array.isArray(v.projects)
			? v.projects
					.filter(
						(p) =>
							p &&
							typeof p.id === "string" &&
							typeof p.name === "string" &&
							typeof p.path === "string"
					)
					.map((p) => ({ ...p, color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#37cda9" }))
					.slice(0, 100)
			: [],
		expenses: Array.isArray(v.expenses)
			? v.expenses
					.filter(
						(e) =>
							e &&
							typeof e.id === "string" &&
							typeof e.title === "string" &&
							Number.isSafeInteger(e.cents) &&
							Math.abs(e.cents) < 1e12 &&
							/^[A-Z]{3}$/.test(e.currency) &&
							Number.isFinite(e.at)
					)
					.slice(0, 1000)
			: []
	};
}
export function sidebarShouldHide(
	mode: SidebarPreferences["mode"],
	overlap: boolean,
	engaged: boolean
) {
	return !engaged && (mode === "auto" || (mode === "smart" && overlap));
}
