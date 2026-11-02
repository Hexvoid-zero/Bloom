import type { AppInfo } from "./dockApps";

/** Snapshot at the interaction, then write in order so a slower old save cannot win. */
export function createPinWriter(write: (apps: AppInfo[]) => Promise<void>) {
 let pending: Promise<void> = Promise.resolve();
 return (apps: AppInfo[]) => {
  const snapshot = structuredClone(apps);
  const result = pending.catch(() => {}).then(() => write(snapshot));
  pending = result;
  return result;
 };
}
