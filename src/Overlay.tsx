import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { initTheme } from "./theme";
import "./Overlay.css";

// This window only hosts startup/update screens. Volume, brightness and the
// per-app mixer live in the top notch, so the screen edges remain clear.
function OverlayApp() {
	const [mode, setMode] = useState<"idle" | "splash" | "updating">("idle");
	const [update, setUpdate] = useState({ status: "checking", progress: 0 });
	useEffect(() => { initTheme(); }, []);
	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		getVersion().then((version) => {
			if (cancelled) return;
			if (localStorage.getItem("bloom-first-run") && localStorage.getItem("bloom-app-version") === version) {
				void emit("splash-done");
				return;
			}
			setMode("splash");
			void invoke("set_splash_fullscreen", { fullscreen: true });
			timer = setTimeout(() => {
				localStorage.setItem("bloom-first-run", "done");
				localStorage.setItem("bloom-app-version", version);
				setMode("idle");
				void invoke("set_splash_fullscreen", { fullscreen: false });
				void emit("splash-done");
			}, 3000);
		}).catch(() => { if (!cancelled) void emit("splash-done"); });
		return () => { cancelled = true; clearTimeout(timer); };
	}, []);
	useEffect(() => {
		const unlisten = listen<{ status: string; progress?: number }>("auto-update-status", ({ payload }) => {
			setUpdate({ status: payload.status, progress: payload.progress ?? 0 });
			const active = ["checking", "downloading", "installing"].includes(payload.status);
			setMode(active ? "updating" : "idle");
			void invoke("set_splash_fullscreen", { fullscreen: active });
		});
		return () => { void unlisten.then((fn) => fn()); };
	}, []);
	useEffect(() => {
		void invoke("set_window_region", { rects: mode === "idle" ? [] : [{ x: 0, y: 0, width: innerWidth, height: innerHeight }] });
	}, [mode]);
	return <div className="overlay-container"><AnimatePresence>
		{mode === "splash" && <motion.div className="splash-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.img src="/bloom.png" className="splash-logo" alt="Bloom" initial={{ scale: .7 }} animate={{ scale: 1 }} /></motion.div>}
		{mode === "updating" && <div className="update-splash"><img src="/bloom.png" className="update-splash-logo" alt="Bloom" /><p className="update-splash-text">{update.status === "downloading" ? `Downloading update… ${update.progress}%` : update.status === "installing" ? "Installing update…" : "Checking for updates…"}</p></div>}
	</AnimatePresence></div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><OverlayApp /></StrictMode>);
