import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Mic, Square, X, Copy, ArrowUpRight, History, Settings2, Download } from "lucide-react";
import { formatDictation, parseVoiceRules, pcmWav, audioBase64 } from "../voiceProcessing";
import "./VoicePanel.css";
type Phase = "idle" | "requesting" | "recording" | "transcribing" | "ready" | "error";
interface Entry {
	text: string;
	at: number;
}
interface Capture {
	stream: MediaStream;
	context: AudioContext;
	source: MediaStreamAudioSourceNode;
	processor: ScriptProcessorNode;
	sink: GainNode;
	chunks: Float32Array[];
	rate: number;
}
export function VoicePanel({
	visible,
	onBusy,
	onPin
}: {
	visible: boolean;
	onBusy: (busy: boolean) => void;
	onPin: (pinned: boolean) => void;
}) {
	const [phase, setPhase] = useState<Phase>("idle"),
		[ready, setReady] = useState(false),
		[text, setText] = useState(""),
		[error, setError] = useState(""),
		[elapsed, setElapsed] = useState(0),
		[level, setLevel] = useState(0),
		[target, setTarget] = useState(""),
		[language, setLanguage] = useState("auto"),
		[clean, setClean] = useState(true),
		[rules, setRules] = useState(""),
		[history, setHistory] = useState<Entry[]>([]),
		[tab, setTab] = useState<"record" | "history" | "settings">("record"),
		[installing, setInstalling] = useState(false),
		[shortcut, setShortcut] = useState("ctrl-z"),
		[saveHistory, setSaveHistory] = useState(true),
		[focusWithin, setFocusWithin] = useState(false);
	const phaseRef = useRef<Phase>("idle"),
		capture = useRef<Capture | null>(null),
		session = useRef(0),
		queuedStop = useRef(false),
		cancelled = useRef(false),
		started = useRef(0),
		downAction = useRef(""),
		epoch = useRef(0),
		alive = useRef(true),
		busyCallback = useRef(onBusy);
	busyCallback.current = onBusy;
	const change = useCallback((p: Phase) => {
		phaseRef.current = p;
		if (alive.current) setPhase(p);
	}, []);
	const busy = phase === "requesting" || phase === "recording" || phase === "transcribing";
	useEffect(() => {
		onBusy(busy);
		return () => onBusy(false);
	}, [busy, onBusy]);
	useEffect(() => {
		onPin(focusWithin);
		return () => onPin(false);
	}, [focusWithin, onPin]);
	useEffect(() => {
		if (!visible) {
			setFocusWithin(false);
			return;
		}
		return () => {
			void invoke("set_notch_keyboard_input", { enabled: false }).catch(() => {});
		};
	}, [visible]);
	const save = async (key: string, value: string) => {
		try {
			await invoke("save_setting", { key, value });
			localStorage.setItem(key, value);
		} catch (e) {
			setError(String(e));
		}
	};
	useEffect(() => {
		alive.current = true;
		void invoke<{ ready: boolean; shortcut: string }>("voice_status")
			.then((s) => {
				setReady(s.ready);
				setShortcut(s.shortcut);
			})
			.catch((e) => setError(String(e)));
		void invoke<Record<string, string>>("load_settings")
			.then((s) => {
				setLanguage(s["bloom-voice-language"] || "auto");
				setClean(s["bloom-voice-clean"] !== "false");
				setRules(s["bloom-voice-rules"] || "");
				setSaveHistory(s["bloom-voice-history-enabled"] !== "false");
				try {
					const list = JSON.parse(s["bloom-voice-history"] || "[]");
					setHistory(
						Array.isArray(list)
							? list
									.filter((x) => typeof x.text === "string" && typeof x.at === "number")
									.slice(0, 30)
							: []
					);
				} catch {}
			})
			.catch((e) => setError(String(e)));
		return () => {
			alive.current = false;
			epoch.current++;
			cancelled.current = true;
			queuedStop.current = true;
			const c = capture.current;
			capture.current = null;
			if (c) {
				c.processor.disconnect();
				c.source.disconnect();
				c.sink.disconnect();
				c.stream.getTracks().forEach((t) => t.stop());
				void c.context.close();
			}
			if (session.current)
				void invoke("cancel_voice", { session: session.current }).catch(() => {});
			busyCallback.current(false);
		};
	}, []);
	const stopRef = useRef<() => Promise<void>>(async () => {}),
		startRef = useRef<() => Promise<void>>(async () => {});
	const endCapture = () => {
		const c = capture.current;
		capture.current = null;
		if (c) {
			c.processor.onaudioprocess = null;
			c.processor.disconnect();
			c.source.disconnect();
			c.sink.disconnect();
			c.stream.getTracks().forEach((t) => t.stop());
			void c.context.close();
		}
		setLevel(0);
		return c;
	};
	const insert = async (value = text, id = session.current) => {
		try {
			await invoke("insert_voice_text", { session: id, text: value });
			if (session.current === id) setError("");
		} catch (e) {
			if (session.current === id) setError(String(e));
		}
	};
	const stop = async () => {
		if (phaseRef.current === "requesting") {
			queuedStop.current = true;
			return;
		}
		if (phaseRef.current !== "recording") return;
		const token = epoch.current,
			id = session.current;
		change("transcribing");
		const c = endCapture();
		if (!c) {
			change("idle");
			return;
		}
		if (Date.now() - started.current < 450) {
			change("idle");
			setError("Hold a little longer and speak before finishing.");
			return;
		}
		try {
			const wav = pcmWav(c.chunks, c.rate);
			const result = await invoke<string>("transcribe_voice", {
				session: id,
				audio: audioBase64(wav),
				language,
				prompt: parseVoiceRules(rules)
					.map((r) => r.to)
					.join(", ")
			});
			if (cancelled.current || !alive.current || epoch.current !== token) return;
			const formatted = formatDictation(result, clean, parseVoiceRules(rules));
			if (!formatted) throw new Error("No speech detected. Try again closer to your microphone.");
			setText(formatted);
			if (saveHistory) {
				const entries = [{ text: formatted, at: Date.now() }, ...history].slice(0, 30);
				setHistory(entries);
				await save("bloom-voice-history", JSON.stringify(entries));
			}
			if (epoch.current !== token || cancelled.current) return;
			await insert(formatted, id);
			if (epoch.current === token) change("ready");
		} catch (e) {
			if (!cancelled.current && epoch.current === token) {
				setError(String(e));
				change("error");
			}
		}
	};
	stopRef.current = stop;
	const start = async () => {
		if (["requesting", "recording", "transcribing"].includes(phaseRef.current)) return;
		const token = ++epoch.current;
		setTab("record");
		setError("");
		setText("");
		setElapsed(0);
		queuedStop.current = false;
		cancelled.current = false;
		change("requesting");
		try {
			const status = await invoke<{ ready: boolean }>("voice_status");
			if (epoch.current !== token || cancelled.current) return;
			setReady(status.ready);
			if (!status.ready) throw new Error("Set up the local speech engine below before recording.");
			const t = await invoke<{ session: number; title: string }>("begin_voice_session");
			if (epoch.current !== token || cancelled.current) return;
			session.current = t.session;
			setTarget(t.title);
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
				video: false
			});
			if (cancelled.current || !alive.current || epoch.current !== token) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}
			let openingContext: AudioContext | null = null;
			try {
				const context = new AudioContext();
				openingContext = context;
				const source = context.createMediaStreamSource(stream),
					processor = context.createScriptProcessor(4096, 1, 1),
					sink = context.createGain();
				sink.gain.value = 0;
				const chunks: Float32Array[] = [];
				processor.onaudioprocess = (e) => {
					if (capture.current === null) return;
					const data = new Float32Array(e.inputBuffer.getChannelData(0));
					chunks.push(data);
					let sum = 0;
					for (const n of data) sum += n * n;
					setLevel(Math.min(1, Math.sqrt(sum / data.length) * 8));
				};
				capture.current = {
					stream,
					context,
					source,
					processor,
					sink,
					chunks,
					rate: context.sampleRate
				};
				source.connect(processor);
				processor.connect(sink);
				sink.connect(context.destination);
				await context.resume();
				if (epoch.current !== token || cancelled.current) {
					if (capture.current?.context === context) endCapture();
					return;
				}
				started.current = Date.now();
				change("recording");
				if (queuedStop.current) void stopRef.current();
			} catch (e) {
				stream.getTracks().forEach((t) => t.stop());
				if (openingContext && openingContext.state !== "closed") void openingContext.close();
				throw e;
			}
		} catch (e) {
			if (!cancelled.current && epoch.current === token) {
				endCapture();
				setError(String(e));
				change("error");
			}
		}
	};
	startRef.current = start;
	const cancel = () => {
		epoch.current++;
		cancelled.current = true;
		queuedStop.current = true;
		endCapture();
		void invoke("cancel_voice", { session: session.current }).catch(() => {});
		change("idle");
		setError("");
	};
	useEffect(() => {
		if (phase !== "recording") return;
		const id = setInterval(() => {
			const s = Math.floor((Date.now() - started.current) / 1000);
			setElapsed(s);
			if (s >= 300) void stopRef.current();
		}, 200);
		return () => clearInterval(id);
	}, [phase]);
	useEffect(() => {
		const unlisten = listen<string>("voice-shortcut", (e) => {
			if (e.payload === "down") {
				if (phaseRef.current === "recording" || phaseRef.current === "requesting") {
					downAction.current = "stopped";
					void stopRef.current();
				} else if (phaseRef.current !== "transcribing") {
					downAction.current = "started";
					void startRef.current();
				}
			} else if (e.payload === "hold-up" && downAction.current === "started")
				void stopRef.current();
		});
		return () => {
			void unlisten.then((fn) => fn());
		};
	}, []);
	useEffect(() => {
		if (!visible) return;
		const key = (e: KeyboardEvent) => {
			if (
				e.key === "Escape" &&
				["recording", "requesting", "transcribing"].includes(phaseRef.current)
			) {
				e.preventDefault();
				e.stopImmediatePropagation();
				cancel();
			}
		};
		window.addEventListener("keydown", key, true);
		return () => window.removeEventListener("keydown", key, true);
	}, [visible]);
	const install = async () => {
		setInstalling(true);
		setError("");
		try {
			await invoke("setup_voice_engine");
			setReady(true);
		} catch (e) {
			setError(String(e));
		} finally {
			setInstalling(false);
		}
	};
	return (
		<section
			className="voice-panel"
			hidden={!visible}
			onFocusCapture={() => {
				setFocusWithin(true);
				void invoke("set_notch_keyboard_input", { enabled: true }).catch(() => {});
			}}
			onBlurCapture={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node)) {
					setFocusWithin(false);
					void invoke("set_notch_keyboard_input", { enabled: false }).catch(() => {});
				}
			}}
			onClick={(e) => e.stopPropagation()}
			aria-label="Bloom Voice"
		>
			<header>
				<div>
					<Mic size={17} />
					<strong>Bloom Voice</strong>
					<small>On device</small>
				</div>
				<div>
					{(["record", "history", "settings"] as const).map((id, i) => {
						const Icon = [Mic, History, Settings2][i];
						return (
							<button
								key={id}
								title={id}
								aria-label={`Voice ${id}`}
								aria-pressed={tab === id}
								disabled={busy && id !== "record"}
								onClick={() => setTab(id)}
							>
								<Icon size={15} />
							</button>
						);
					})}
				</div>
			</header>
			{tab === "record" && (
				<>
					<div
						className={`voice-wave ${phase === "recording" ? "live" : ""}`}
						aria-label={phase === "recording" ? "Microphone active" : "Microphone off"}
					>
						{Array.from({ length: 24 }, (_, i) => (
							<i
								key={i}
								style={{
									height:
										phase === "recording"
											? `${5 + level * 48 * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7)))}px`
											: "5px"
								}}
							/>
						))}
					</div>
					<div className="voice-status" role="status">
						{
							(
								{
									idle: "Speak naturally.",
									requesting: "Preparing microphone…",
									recording: "Listening…",
									transcribing: "Transcribing locally…",
									ready: "Ready to use",
									error: "Let’s try that again"
								} as const
							)[phase]
						}
						{phase === "recording" && (
							<time>
								{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
							</time>
						)}
					</div>
					{text && (
						<textarea
							aria-label="Dictation transcript"
							value={text}
							maxLength={50000}
							onChange={(e) => setText(e.target.value)}
						/>
					)}
					<div className="voice-actions">
						{phase === "recording" || phase === "requesting" ? (
							<button className="primary" onClick={() => void stop()}>
								<Square size={14} />
								Finish
							</button>
						) : phase !== "transcribing" && ready ? (
							<button className="primary" onClick={() => void start()}>
								<Mic size={15} />
								Start dictation
							</button>
						) : null}
						{busy && (
							<button onClick={cancel}>
								<X size={14} />
								Cancel
							</button>
						)}
						{text && !busy && (
							<>
								<button onClick={() => void insert()}>
									<ArrowUpRight size={14} />
									Insert
								</button>
								<button
									onClick={() =>
										void writeText(text)
											.then(() => setError(""))
											.catch((e) => setError(String(e)))
									}
								>
									<Copy size={14} />
									Copy
								</button>
							</>
						)}
						{!ready && (
							<button disabled={installing} onClick={() => void install()}>
								<Download size={15} />
								{installing ? "Downloading…" : "Set up local voice · 150 MB"}
							</button>
						)}
					</div>
					<small className="voice-hint">
						{shortcut === "off"
							? "Shortcut disabled"
							: `${shortcut === "ctrl-z" ? "Ctrl+Z" : "Ctrl+Alt+Space"}: tap for hands-free · hold to talk`}
					</small>
					{target && (
						<small className="voice-target" title={target}>
							Writing to: {target}
						</small>
					)}
				</>
			)}
			{tab === "history" && (
				<div className="voice-history">
					<div>
						<strong>Local history</strong>
						<button
							onClick={() => {
								setHistory([]);
								void save("bloom-voice-history", "[]");
							}}
						>
							Clear
						</button>
					</div>
					{history.length === 0 && <p>No saved dictations.</p>}
					{history.map((entry, i) => (
						<button
							key={`${entry.at}-${i}`}
							onClick={() => {
								setText(entry.text);
								setTab("record");
								change("ready");
							}}
						>
							<small>{new Date(entry.at).toLocaleString()}</small>
							<span>{entry.text}</span>
						</button>
					))}
				</div>
			)}
			{tab === "settings" && (
				<div className="voice-settings">
					<label>
						Shortcut
						<select
							aria-label="Voice shortcut"
							disabled={busy}
							value={shortcut}
							onChange={(e) => {
								setShortcut(e.target.value);
								void save("bloom-voice-shortcut", e.target.value);
							}}
						>
							<option value="ctrl-z">Ctrl+Z · replaces Undo while enabled</option>
							<option value="ctrl-alt-space">Ctrl+Alt+Space</option>
							<option value="off">Off · keep normal Undo</option>
						</select>
					</label>
					<label>
						Language
						<select
							value={language}
							disabled={busy}
							onChange={(e) => {
								setLanguage(e.target.value);
								void save("bloom-voice-language", e.target.value);
							}}
						>
							{[
								["auto", "Auto detect"],
								["en", "English"],
								["bg", "Bulgarian"],
								["uk", "Ukrainian"],
								["ru", "Russian"],
								["nl", "Dutch"],
								["de", "German"],
								["fr", "French"],
								["es", "Spanish"]
							].map(([v, l]) => (
								<option key={v} value={v}>
									{l}
								</option>
							))}
						</select>
					</label>
					<label className="voice-check">
						<input
							type="checkbox"
							checked={clean}
							onChange={(e) => {
								setClean(e.target.checked);
								void save("bloom-voice-clean", String(e.target.checked));
							}}
						/>
						Remove fillers and apply spoken new lines
					</label>
					<label className="voice-check">
						<input
							type="checkbox"
							checked={saveHistory}
							onChange={(e) => {
								setSaveHistory(e.target.checked);
								void save("bloom-voice-history-enabled", String(e.target.checked));
							}}
						/>
						Save dictation history on this PC
					</label>
					<label>
						Dictionary &amp; snippets
						<textarea
							aria-label="Voice dictionary and snippets"
							placeholder={"bloom app => Bloom\nmy signature => Best regards, Alex"}
							value={rules}
							maxLength={12000}
							onChange={(e) => setRules(e.target.value)}
							onBlur={() => void save("bloom-voice-rules", rules)}
						/>
					</label>
					<small>
						One spoken phrase =&gt; replacement per line. Audio is discarded after transcription. No
						subscription or cloud upload.
					</small>
				</div>
			)}
			{error && (
				<p className="voice-error" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}
