import type { AppInfo } from "./dockApps";
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

// A focus result is not evidence that an app is closed: Windows may refuse
// foreground activation, or complete a minimize asynchronously. Never launch
// another tab/window as a fallback when a running window was selected.
export async function activateDockApp(app: AppInfo, invoke: Invoke) {
 if (app.path === "start") {
  await invoke("open_app", { appName: "start" });
 } else if (app.is_background && app.tray_ids?.length === 1) {
  await invoke("activate_tray_icon", { trayId: app.tray_ids[0] });
 } else if (app.all_hwnds && app.all_hwnds.length > 1) {
  await invoke("focus_app_windows", { hwnds: app.all_hwnds.map(([hwnd]) => hwnd) });
 } else if (app.hwnd || app.all_hwnds?.length) {
  await invoke("focus_window", { hwnd: app.hwnd || app.all_hwnds![0][0] });
 } else {
  await invoke("open_app", { appName: app.path, displayName: app.name });
 }
}
