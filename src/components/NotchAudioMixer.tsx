import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTrailingThrottle } from "../hooks/useTrailingThrottle";

interface AudioSession {
	pid: number;
	name: string;
	volume: number;
	is_muted: boolean;
}

export function NotchAudioMixer({ expanded, onExpandedChange }: {
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
}) {
	const [sessions, setSessions] = useState<AudioSession[]>([]);
	const [error, setError] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const pendingUntil = useRef(new Map<number, number>());
	useEffect(() => {
		if (!expanded) return;
		let cancelled = false;
		const refresh = () => invoke<AudioSession[]>("get_audio_sessions").then((list) => {
			if (cancelled) return;
			setSessions((previous) => list.map((session) => {
				const local = previous.find((item) => item.pid === session.pid);
				return local && Date.now() < (pendingUntil.current.get(session.pid) ?? 0) ? local : session;
			}));
			setLoaded(true);
			setError(false);
		}).catch(() => { if (!cancelled) { setError(true); setLoaded(true); } });
		void refresh();
		const timer = setInterval(refresh, 2000);
		return () => { cancelled = true; clearInterval(timer); };
	}, [expanded]);
	const sendVolume = useTrailingThrottle((pid: number, volume: number) => {
		invoke("set_app_volume", { pid, volume }).catch(() => setError(true));
	}, 50);
	const changeVolume = (pid: number, volume: number) => {
		pendingUntil.current.set(pid, Date.now() + 1500);
		setSessions((list) => list.map((s) => s.pid === pid ? { ...s, volume, is_muted: volume > 0 ? false : s.is_muted } : s));
		sendVolume(pid, volume);
	};
	const toggleMute = (session: AudioSession) => {
		const muted = !session.is_muted;
		pendingUntil.current.set(session.pid, Date.now() + 1500);
		setSessions((list) => list.map((s) => s.pid === session.pid ? { ...s, is_muted: muted } : s));
		invoke("set_app_mute", { pid: session.pid, muted }).catch(() => setError(true));
	};
	return <div className="notch-mixer" onClick={(event) => event.stopPropagation()}>
		<button className="notch-mixer-toggle" aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}>
			<span>App volumes</span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
		</button>
		{expanded && <div className="notch-mixer-list">
			{error && <p role="status">Unable to refresh audio apps. Retrying…</p>}
			{!loaded && <p>Loading audio apps…</p>}
			{loaded && !error && sessions.length === 0 && <p>Apps playing audio appear here.</p>}
			{sessions.map((session) => <div className="notch-mixer-row" key={session.pid}>
				<button className="notch-mixer-mute" aria-label={`${session.is_muted ? "Unmute" : "Mute"} ${session.name}`} aria-pressed={session.is_muted} onClick={() => toggleMute(session)} title={session.name}>{session.name}</button>
				<input aria-label={`${session.name} volume`} type="range" min="0" max="100" value={Math.round((session.is_muted ? 0 : session.volume) * 100)} onChange={(event) => changeVolume(session.pid, Number(event.target.value) / 100)} />
				<span>{Math.round((session.is_muted ? 0 : session.volume) * 100)}%</span>
			</div>)}
		</div>}
	</div>;
}
