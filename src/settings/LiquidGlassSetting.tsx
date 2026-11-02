import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Droplets } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { useSettingsSync } from "../hooks/useSettingsSync";

export function LiquidGlassSetting() {
 const [dock, setDock] = useState(() => localStorage.getItem("bloom-liquid-glass-dock") !== "false");
 const [notch, setNotch] = useState(() => localStorage.getItem("bloom-liquid-glass-notch") === "true");
 const [error, setError] = useState("");
 useSettingsSync({ "bloom-liquid-glass-dock": setDock, "bloom-liquid-glass-notch": setNotch });
 useEffect(() => {
  let alive = true;
  invoke<Record<string, string>>("load_settings").then(s => {
   if (alive) {
    setDock(s["bloom-liquid-glass-dock"] !== "false");
    setNotch(s["bloom-liquid-glass-notch"] === "true");
   }
  }).catch(() => {});
  return () => { alive = false; };
 }, []);
 const save = async (surface: "dock" | "notch", enabled: boolean) => {
  const key = `bloom-liquid-glass-${surface}`;
  const previous = surface === "dock" ? dock : notch;
  const update = surface === "dock" ? setDock : setNotch;
  update(enabled);
  localStorage.setItem(key, String(enabled));
  setError("");
  try {
   await invoke("save_setting", { key, value: String(enabled) });
  } catch {
   update(previous);
   localStorage.setItem(key, String(previous));
   setError("Could not save glass appearance.");
  }
 };
 return <>
  <div className="setting-group-label">Glass materials</div>
  <div className="setting-group">
   <SettingRow icon={Droplets} label="Dock Liquid Glass" desc="Clear glass with refractive edges. Turn off for the standard dock appearance.">
    <label className="toggle-switch"><input type="checkbox" aria-label="Dock Liquid Glass" checked={dock} onChange={e => void save("dock", e.target.checked)} /><span className="slider" /></label>
   </SettingRow>
   <SettingRow icon={Droplets} label="Notch Liquid Glass" desc="Optional clear glass for the notch. All existing features remain.">
    <label className="toggle-switch"><input type="checkbox" aria-label="Notch Liquid Glass" checked={notch} onChange={e => void save("notch", e.target.checked)} /><span className="slider" /></label>
   </SettingRow>
   <SettingRow icon={Droplets} label="Start Glassmorphism" desc="Frosted translucent panels with a soft blur. No liquid lens distortion." />
  </div>
  {error && <p role="alert">{error}</p>}
 </>;
}
