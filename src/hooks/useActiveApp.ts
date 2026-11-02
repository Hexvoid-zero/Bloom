import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ActiveApp {
	name: string;
	hwnd: number;
	color: [number, number, number];
}

export function activeAppStyle(app: ActiveApp | null): CSSProperties {
	if (!app) return {};
	const [r, g, b] = app.color;
	return {
		"--active-app-color": `rgb(${r}, ${g}, ${b})`,
		"--active-app-logo-filter":
			r * 0.299 + g * 0.587 + b * 0.114 > 170 ? "brightness(.15)" : "none",
		"--active-app-ink": r * 0.299 + g * 0.587 + b * 0.114 > 170 ? "#1c1c1e" : "#f5f5f7"
	} as CSSProperties;
}

export function useActiveApp(enabled = true) {
	const [active, setActive] = useState<ActiveApp | null>(null);
	useEffect(() => {
		if (!enabled) return;
		let stopped = false;
		let pending = false;
		const poll = async () => {
			if (pending) return;
			pending = true;
			try {
				const next = await invoke<ActiveApp | null>("get_active_app_appearance");
				if (!stopped)
					setActive((previous) =>
						JSON.stringify(previous) === JSON.stringify(next) ? previous : next
					);
			} catch {
				/* A temporarily unavailable foreground keeps its last appearance. */
			} finally {
				pending = false;
			}
		};
		void poll();
		const interval = setInterval(poll, 800);
		return () => {
			stopped = true;
			clearInterval(interval);
		};
	}, [enabled]);
	return active;
}
