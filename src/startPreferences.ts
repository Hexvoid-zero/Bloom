import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsSync } from "./hooks/useSettingsSync";

export interface LauncherApp { name: string; path: string; icon?: string | null; is_running?: boolean }
export type StartSection = "pinned" | "agents" | "recent" | "all";
export interface StartPreferences {
 style: "bloom" | "macos"; enabled: boolean; density: "comfortable" | "compact"; accent: string;
 greeting: string; phone: boolean; agentNotch: boolean; companion: boolean;
 sections: StartSection[]; pins: LauncherApp[] | null; hidden: string[];
}
export const START_DEFAULTS: StartPreferences = {
 style: "bloom", enabled: true, density: "comfortable", accent: "violet", greeting: "Your workspace, together.",
 phone: true, agentNotch: true, companion: true,
 sections: ["pinned", "agents", "recent", "all"], pins: null, hidden: []
};
export function parseStartPreferences(raw: unknown): StartPreferences {
 let v: Partial<StartPreferences> = {};
 try { v = typeof raw === "string" ? JSON.parse(raw) : (raw || {}); } catch { /* recover defaults */ }
 if (!v || typeof v !== "object") v = {};
 const sections = Array.isArray(v.sections) ? [...new Set(v.sections.filter(s => ["pinned","agents","recent","all"].includes(s)))] : START_DEFAULTS.sections;
 return { ...START_DEFAULTS, ...v,
  style: v.style === "macos" ? "macos" : "bloom",
  enabled: typeof v.enabled === "boolean" ? v.enabled : true,
  density: v.density === "compact" ? "compact" : "comfortable",
  accent: ["violet","blue","mint","rose"].includes(v.accent || "") ? v.accent! : "violet",
  greeting: typeof v.greeting === "string" ? v.greeting.slice(0,80) : START_DEFAULTS.greeting,
  phone: typeof v.phone === "boolean" ? v.phone : true,
  agentNotch: typeof v.agentNotch === "boolean" ? v.agentNotch : true,
  companion: typeof v.companion === "boolean" ? v.companion : true,
  sections, pins: Array.isArray(v.pins) ? v.pins.filter(a => typeof a?.path === "string" && typeof a?.name === "string").slice(0,65) : null,
  hidden: Array.isArray(v.hidden) ? v.hidden.filter(s => typeof s === "string") : []
 };
}
const KEY = "bloom-start-preferences";
export function useStartPreferences() {
 const [preferences, setPreferences] = useState(() => parseStartPreferences(localStorage.getItem(KEY)));
 const [error, setError] = useState("");
 const [saving, setSaving] = useState(false);
 const apply = useCallback((v: unknown) => { const p=parseStartPreferences(v); localStorage.setItem(KEY,JSON.stringify(p)); setPreferences(p); },[]);
 useEffect(() => { invoke<Record<string,string>>("load_settings").then(s => apply(s[KEY] ?? localStorage.getItem(KEY))).catch(() => setError("Could not load saved customization.")); },[apply]);
 useSettingsSync({ [KEY]: apply });
 const save = async (next: StartPreferences) => {
  setSaving(true); setError("");
  try { await invoke("save_setting", {key:KEY,value:JSON.stringify(next)}); apply(next); }
  catch { setError("Could not save. Your previous customization is still in use."); }
  finally { setSaving(false); }
 };
 return { preferences, save, saving, error };
}
export function appCategory(app: LauncherApp): string {
 const n=app.name.toLowerCase();
 if (/code|codex|cursor|claude|terminal|python|git|studio|antigravity|docker/.test(n)) return "Development";
 if (/music|spotify|video|photo|player|paint|camera|youtube/.test(n)) return "Creative & media";
 if (/word|excel|powerpoint|office|notion|outlook|calendar|mail|docs|sheets/.test(n)) return "Productivity";
 if (/chrome|edge|firefox|browser|opera|brave/.test(n)) return "Browsers";
 return "Apps & utilities";
}
