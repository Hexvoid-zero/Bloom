import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open as chooseFolder } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
	Search,
	ChevronLeft,
	ChevronRight,
	Command as Grid2X2,
	Zap,
	Wallet,
	CalendarDays,
	MessageCircle,
	Layers,
	ChartNoAxesColumn,
	Settings,
	Sun,
	Moon,
	UserRound,
	Plus,
	X,
	Trash2,
	FolderOpen,
	ArrowUpRight,
	Mic
} from "lucide-react";
import { AgentOverview, useAgentSessions } from "./components/AgentOverview";
import { LauncherIcon } from "./components/LauncherIcon";
import {
	useSidebarPreferences,
	parseWorkspace,
	sidebarShouldHide,
	type WorkspaceData
} from "./sidebarPreferences";
import { useSettingsSync } from "./hooks/useSettingsSync";
import type { LauncherApp } from "./startPreferences";
import "./Sidebar.css";
type Page =
	| "dashboard"
	| "activity"
	| "wallet"
	| "schedule"
	| "messages"
	| "projects"
	| "reports"
	| "profile";
const nav = [
	{ id: "dashboard", label: "Dashboard", icon: Grid2X2 },
	{ id: "activity", label: "Activity", icon: Zap },
	{ id: "wallet", label: "Wallet", icon: Wallet },
	{ id: "schedule", label: "Schedule", icon: CalendarDays },
	{ id: "messages", label: "Messages", icon: MessageCircle },
	{ id: "projects", label: "Projects", icon: Layers },
	{ id: "reports", label: "Reports", icon: ChartNoAxesColumn }
] as const;
export function Sidebar() {
	const { preferences: p, save, loaded, error: prefError } = useSidebarPreferences();
	const { sessions, error: agentError } = useAgentSessions(true);
	const [page, setPage] = useState<Page | null>(null),
		[query, setQuery] = useState(""),
		[apps, setApps] = useState<LauncherApp[]>([]),
		[username, setUsername] = useState("Your account"),
		[data, setData] = useState<WorkspaceData>({ tasks: [], projects: [], expenses: [] }),
		[dataLoaded, setDataLoaded] = useState(false),
		[error, setError] = useState(""),
		[notice, setNotice] = useState(""),
		[hover, setHover] = useState(false),
		[edge, setEdge] = useState(false),
		[overlap, setOverlap] = useState(false),
		[editing, setEditing] = useState(false),
		[branches, setBranches] = useState(true),
		[tooltip, setTooltip] = useState<{ text: string; y: number } | null>(null),
		[taskTitle, setTaskTitle] = useState(""),
		[due, setDue] = useState(""),
		[expenseTitle, setExpenseTitle] = useState(""),
		[amount, setAmount] = useState(""),
		[currency, setCurrency] = useState("EUR"),
		[projectName, setProjectName] = useState(""),
		[phone, setPhone] = useState<{
			status: string;
			detail: string;
			phones: { name: string; connected: boolean; battery: number | null }[];
		} | null>(null);
	const search = useRef<HTMLInputElement>(null),
		content = useRef<HTMLDivElement>(null),
		pendingSave = useRef(false),
		edgeSince = useRef(0),
		drawerRef = useRef<HTMLElement>(null);
	const [hoveredItem, setHoveredItem] = useState<string | null>(null);
	const collapsed = !p.expanded;
	const engaged = hover || edge || editing || page !== null;
	const hidden = sidebarShouldHide(p.mode, overlap, engaged);
	const pending = sessions.filter((s) => s.status === "waiting").length;
	useEffect(() => {
		const blur = () => {
			setEditing(false);
			setPage(null);
			setQuery("");
		};
		window.addEventListener("blur", blur);
		return () => window.removeEventListener("blur", blur);
	}, []);
	const taskCount = data.tasks.filter((t) => !t.done).length;
	useSettingsSync({
		"bloom-sidebar-workspace": (v) => {
			if (!pendingSave.current) setData(parseWorkspace(v));
		}
	});
	useEffect(() => {
		let alive = true;
		void Promise.allSettled([
			invoke<LauncherApp[]>("get_installed_apps"),
			invoke<{ username: string }>("get_start_context"),
			invoke<Record<string, string>>("load_settings")
		]).then((r) => {
			if (!alive) return;
			if (r[0].status === "fulfilled") setApps(r[0].value);
			else setError(String(r[0].reason));
			if (r[1].status === "fulfilled") setUsername(r[1].value.username);
			if (r[2].status === "fulfilled") {
				setData(parseWorkspace(r[2].value["bloom-sidebar-workspace"]));
				setDataLoaded(true);
			} else setError(String(r[2].reason));
		});
		return () => {
			alive = false;
		};
	}, []);
	useEffect(() => {
		let stopped = false,
			pending = false;
		const poll = async () => {
			if (pending) return;
			pending = true;
			try {
				const env = await invoke<{ overlap: boolean; edge: boolean; own_focus: boolean }>(
					"sidebar_environment",
					{ right: p.side === "right", panelWidth: collapsed ? 80 : 306 }
				);
				if (stopped) return;
				if (!env.own_focus) {
					setOverlap(env.overlap);
				}
				if (env.edge) {
					if (!edgeSince.current) edgeSince.current = Date.now();
					if (Date.now() - edgeSince.current > 180) setEdge(true);
				} else {
					edgeSince.current = 0;
					setEdge(false);
				}
			} catch (e) {
				if (!stopped) setError(String(e));
			} finally {
				pending = false;
			}
		};
		void poll();
		const timer = setInterval(() => void poll(), 120);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [p.side, p.enabled, collapsed]);
	useEffect(() => {
		let id = 0,
			previous = "",
			nativeAt = 0;
		const measure = (now: number) => {
			if (now - nativeAt > 75) {
				nativeAt = now;
				const box = (el: HTMLElement, padding: number) => {
					const r = el.getBoundingClientRect();
					const x = Math.max(0, Math.floor(r.x - padding));
					const y = Math.max(0, Math.floor(r.y - padding));
					return {
						x,
						y,
						width: Math.max(0, Math.ceil(Math.min(innerWidth, r.right + padding)) - x),
						height: Math.max(0, Math.ceil(Math.min(innerHeight, r.bottom + padding)) - y)
					};
				};
				const rects = Array.from(
					document.querySelectorAll<HTMLElement>(
						".sidebar-nav,.sidebar-drawer,.sidebar-tooltip,.sidebar-expand"
					)
				)
					.filter((el) => getComputedStyle(el).display !== "none")
					.map((el) => box(el, el.matches(".sidebar-expand") ? 8 : 4))
					.filter((r) => r.width > 0 && r.height > 0);
				const key = JSON.stringify(rects);
				if (key !== previous) {
					previous = key;
					void invoke("set_window_region", { rects }).catch(() => {});
				}
				// Material bounds are separate from hit targets. In particular, the
				// edge detector and protruding arrow must never become blur panels.
				const material =
					hidden || !p.enabled
						? []
						: Array.from(document.querySelectorAll<HTMLElement>(".sidebar-nav,.sidebar-drawer"))
								.map((el) => ({
									...box(el, 0),
									radius: el.matches(".sidebar-nav") && collapsed ? 34 : 28,
									flat_top: false
								}))
								.filter((r) => r.width > 1 && r.height > 1);
				void invoke("set_liquid_glass_surfaces", { rects: material }).catch(() => {});
			}
			id = requestAnimationFrame(measure);
		};
		id = requestAnimationFrame(measure);
		return () => {
			cancelAnimationFrame(id);
			void invoke("set_liquid_glass_surfaces", { rects: [] }).catch(() => {});
		};
	}, [hidden, p.enabled, page, collapsed]);
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setPage(null);
				setQuery("");
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				if (collapsed) {
					void save({ ...p, expanded: true }).then(() =>
						setTimeout(() => search.current?.focus(), 80)
					);
				} else search.current?.focus();
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [page, collapsed, p.side]);
	useEffect(() => {
		if (page !== "messages") return;
		let alive = true;
		void invoke<typeof phone>("get_phone_link_status")
			.then((v) => {
				if (alive) setPhone(v);
			})
			.catch((e) => setError(String(e)));
		return () => {
			alive = false;
		};
	}, [page]);
	useEffect(() => {
		if (page) drawerRef.current?.focus();
	}, [page]);
	const commit = async (next: WorkspaceData) => {
		if (pendingSave.current || !dataLoaded) return;
		pendingSave.current = true;
		setError("");
		try {
			await invoke("save_setting", { key: "bloom-sidebar-workspace", value: JSON.stringify(next) });
			setData(next);
		} catch (e) {
			setError(String(e));
		} finally {
			pendingSave.current = false;
		}
	};
	const action = async (command: string, args: Record<string, unknown> = {}) => {
		setError("");
		try {
			await invoke(command, args);
		} catch (e) {
			setError(String(e));
		}
	};
	const openPage = (id: Page) => {
		setPage(id);
		setQuery("");
		setTooltip(null);
		setNotice("");
	};
	const launch = (a: LauncherApp) => action("open_app", { appName: a.path, displayName: a.name });
	const addProject = async () => {
		try {
			const path = await chooseFolder({
				directory: true,
				multiple: false,
				title: "Choose a project folder"
			});
			if (typeof path === "string")
				await commit({
					...data,
					projects: [
						...data.projects,
						{
							id: crypto.randomUUID(),
							name: projectName.trim() || path.split(/[\\/]/).pop() || "Project",
							path,
							color: ["#37cda9", "#f27b5b", "#ad77ed"][data.projects.length % 3]
						}
					]
				});
			setProjectName("");
		} catch (e) {
			setError(String(e));
		}
	};
	const matches = apps.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));
	const hoverItem = (label: string, e: React.MouseEvent) => {
		if (collapsed) {
			const r = e.currentTarget.getBoundingClientRect();
			setTooltip({ text: label, y: r.y + r.height / 2 });
		}
	};
	const navButton = (item: (typeof nav)[number]) => {
		const Icon = item.icon;
		const count = item.id === "activity" ? pending : item.id === "schedule" ? taskCount : 0;
		return (
			<button
				key={item.id}
				className={`sidebar-item ${page === item.id ? "selected" : ""}`}
				title={collapsed ? item.label : undefined}
				aria-label={item.label}
				aria-pressed={page === item.id}
				onMouseEnter={(e) => {
					setHoveredItem(item.id);
					hoverItem(item.label, e);
				}}
				onMouseLeave={() => {
					setHoveredItem(null);
					setTooltip(null);
				}}
				onClick={() => openPage(item.id)}
			>
				{hoveredItem === item.id && (
					<motion.span
						className="sidebar-hover-lens"
						layoutId="sidebar-hover-lens"
						transition={{ type: "spring", stiffness: 420, damping: 32 }}
					/>
				)}
				<Icon size={20} />
				<span className="sidebar-label">{item.label}</span>
				{count > 0 && (
					<b className={`sidebar-badge ${item.id === "activity" ? "coral" : ""}`}>
						{collapsed ? "" : count}
					</b>
				)}
				{item.id === "projects" && p.expanded && (
					<span
						className="sidebar-branch-toggle"
						role="button"
						tabIndex={0}
						aria-label="Toggle project branches"
						onClick={(e) => {
							e.stopPropagation();
							setBranches(!branches);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								e.stopPropagation();
								setBranches(!branches);
							}
						}}
					>
						<ChevronRight
							size={15}
							style={{ transform: branches ? "rotate(-90deg)" : "rotate(90deg)" }}
						/>
					</span>
				)}
			</button>
		);
	};
	return (
		<main
			ref={content}
			className={`sidebar-root side-${p.side} ${collapsed ? "collapsed" : "expanded"} ${hidden ? "is-hidden" : ""} ${p.night ? "night" : ""} ${!p.enabled ? "disabled" : ""}`}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => {
				setHover(false);
				setTooltip(null);
			}}
			onFocusCapture={(e) => setEditing((e.target as HTMLElement).matches("input,textarea,select"))}
			onBlurCapture={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditing(false);
			}}
		>
			<div className="sidebar-edge" aria-hidden="true" />
			{loaded && p.enabled && (
				<>
					<aside className="sidebar-nav" aria-label="Bloom workspace navigation">
						<header className="sidebar-brand">
							<button
								className="sidebar-logo"
								title="Bloom dashboard"
								aria-label="Bloom dashboard"
								onClick={() => openPage("dashboard")}
							>
								<img src="/bloom-mark.svg" alt="" />
							</button>
							<span className="sidebar-label">
								<strong>Bloom</strong>
								<small>Your workspace</small>
							</span>
							<button
								className="sidebar-expand"
								aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
								onClick={() => {
									setPage(null);
									setQuery("");
									void save({ ...p, expanded: !p.expanded });
								}}
							>
								{(p.side === "left") === collapsed ? (
									<ChevronRight size={17} />
								) : (
									<ChevronLeft size={17} />
								)}
							</button>
						</header>
						<label
							className="sidebar-search"
							title="Search pages and apps"
							onClick={() => {
								if (collapsed) {
									void save({ ...p, expanded: true }).then(() =>
										setTimeout(() => search.current?.focus(), 50)
									);
								}
							}}
						>
							<Search size={18} />
							<input
								ref={search}
								aria-label="Search pages and apps"
								placeholder="Search pages"
								value={query}
								onFocus={() => {
									if (collapsed) void save({ ...p, expanded: true });
								}}
								onChange={(e) => {
									setQuery(e.target.value);
									setPage("dashboard");
								}}
							/>
							{!collapsed && <kbd>⌃K</kbd>}
						</label>
						<div className="sidebar-scroll">
							<p className="sidebar-section-label">MAIN</p>
							{nav.slice(0, 4).map(navButton)}
							<p className="sidebar-section-label">WORKSPACE</p>
							{nav.slice(4, 6).map((item) => (
								<div key={item.id}>
									{navButton(item)}
									{item.id === "projects" && p.expanded && branches && (
										<div className="sidebar-project-tree">
											{data.projects.slice(0, 4).map((project) => (
												<button
													key={project.id}
													title={project.path}
													onClick={() =>
														void action("open_app", {
															appName: project.path,
															displayName: project.name
														})
													}
												>
													<i style={{ background: project.color }} />
													{project.name}
												</button>
											))}
											{data.projects.length === 0 && (
												<button onClick={() => openPage("projects")}>
													<Plus size={13} />
													Add project
												</button>
											)}
										</div>
									)}
								</div>
							))}
							{navButton(nav[6])}
							<button
								className="sidebar-item"
								aria-label="Settings"
								title="Settings"
								onClick={() => void action("open_settings_window")}
								onMouseEnter={(e) => hoverItem("Settings", e)}
								onMouseLeave={() => setTooltip(null)}
							>
								<Settings size={20} />
								<span className="sidebar-label">Settings</span>
							</button>
						</div>
						<footer>
							<button
								className="sidebar-item sidebar-night"
								aria-label="Night mode"
								aria-pressed={p.night}
								onClick={() => void save({ ...p, night: !p.night })}
							>
								{p.night ? <Moon size={20} /> : <Sun size={20} />}
								<span className="sidebar-label">Night mode</span>
								<span className={`sidebar-switch ${p.night ? "on" : ""}`} />
							</button>
							<button
								className="sidebar-profile"
								aria-label="Your profile"
								onClick={() => openPage("profile")}
							>
								<span className="sidebar-avatar">
									<UserRound size={22} />
									<i />
								</span>
								<span className="sidebar-label">
									<strong>{username}</strong>
									<small>Local account</small>
								</span>
								<ChevronRight className="sidebar-label" size={15} />
							</button>
						</footer>
					</aside>
					{tooltip && !page && (
						<div
							className="sidebar-tooltip"
							role="tooltip"
							style={{ top: Math.max(16, Math.min(innerHeight - 42, tooltip.y - 15)) }}
						>
							{tooltip.text}
						</div>
					)}
					{page && (
						<section
							className="sidebar-drawer"
							ref={drawerRef}
							tabIndex={-1}
							aria-label={`${page} workspace`}
						>
							<header>
								<div>
									<small>YOUR WORKSPACE</small>
									<h2>
										{page === "profile" ? "Your account" : nav.find((n) => n.id === page)?.label}
									</h2>
								</div>
								<button
									aria-label="Close workspace panel"
									onClick={() => {
										setPage(null);
										setQuery("");
									}}
								>
									<X size={18} />
								</button>
							</header>
							{(error || prefError) && (
								<p role="alert" className="sidebar-error">
									{error || prefError}
								</p>
							)}
							{notice && <p role="status">{notice}</p>}
							{page === "dashboard" && (
								<>
									<label className="workspace-search">
										<Search size={17} />
										<input
											aria-label="Find an application"
											placeholder="Find an application…"
											value={query}
											onChange={(e) => setQuery(e.target.value)}
										/>
									</label>
									{!query && (
										<div className="workspace-summary">
											<button onClick={() => openPage("activity")}>
												<strong>{sessions.length}</strong>Agent sessions
											</button>
											<button onClick={() => openPage("schedule")}>
												<strong>{taskCount}</strong>Tasks to do
											</button>
											<button onClick={() => void action("show_voice_panel")}>
												<Mic size={23} />
												Dictate
											</button>
										</div>
									)}
									<div className="workspace-page-results">
										{query &&
											nav
												.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
												.map((n) => (
													<button
														className="workspace-action"
														key={n.id}
														onClick={() => openPage(n.id)}
													>
														{n.label}
														<ArrowUpRight size={14} />
													</button>
												))}
									</div>
									<div className="sidebar-apps">
										{matches.slice(0, 60).map((a) => (
											<button key={a.path} onClick={() => void launch(a)} title={a.name}>
												<LauncherIcon app={a} />
												<span>{a.name}</span>
											</button>
										))}
									</div>
									{matches.length === 0 && <p>No matching applications.</p>}
								</>
							)}
							{page === "activity" && <AgentOverview sessions={sessions} error={agentError} />}
							{page === "schedule" && (
								<>
									<p>Tasks and dates stay on this PC.</p>
									<form
										onSubmit={(e) => {
											e.preventDefault();
											if (!taskTitle.trim()) return;
											void commit({
												...data,
												tasks: [
													...data.tasks,
													{ id: crypto.randomUUID(), title: taskTitle.trim(), due, done: false }
												]
											}).then(() => {
												setTaskTitle("");
												setDue("");
											});
										}}
									>
										<input
											required
											aria-label="Task title"
											placeholder="What needs doing?"
											maxLength={160}
											value={taskTitle}
											onChange={(e) => setTaskTitle(e.target.value)}
										/>
										<input
											aria-label="Task due date"
											type="datetime-local"
											value={due}
											onChange={(e) => setDue(e.target.value)}
										/>
										<button type="submit">
											<Plus size={15} />
											Add task
										</button>
									</form>
									<div className="workspace-list">
										{data.tasks.map((t) => (
											<div key={t.id}>
												<input
													type="checkbox"
													aria-label={`Complete ${t.title}`}
													checked={t.done}
													onChange={(e) =>
														void commit({
															...data,
															tasks: data.tasks.map((x) =>
																x.id === t.id ? { ...x, done: e.target.checked } : x
															)
														})
													}
												/>
												<span>
													<strong style={{ textDecoration: t.done ? "line-through" : undefined }}>
														{t.title}
													</strong>
													<small>{t.due ? new Date(t.due).toLocaleString() : "No due date"}</small>
												</span>
												<button
													aria-label={`Remove ${t.title}`}
													onClick={() =>
														void commit({ ...data, tasks: data.tasks.filter((x) => x.id !== t.id) })
													}
												>
													<Trash2 size={14} />
												</button>
											</div>
										))}
									</div>
								</>
							)}
							{page === "projects" && (
								<>
									<p>Keep real project folders one click away.</p>
									<form
										onSubmit={(e) => {
											e.preventDefault();
											void addProject();
										}}
									>
										<input
											aria-label="Project name"
											placeholder="Project name (optional)"
											value={projectName}
											maxLength={80}
											onChange={(e) => setProjectName(e.target.value)}
										/>
										<button type="submit">
											<FolderOpen size={15} />
											Choose folder
										</button>
									</form>
									<div className="workspace-list">
										{data.projects.map((project) => (
											<div key={project.id}>
												<i className="project-dot" style={{ background: project.color }} />
												<button
													className="project-open"
													title={project.path}
													onClick={() =>
														void action("open_app", {
															appName: project.path,
															displayName: project.name
														})
													}
												>
													<strong>{project.name}</strong>
													<small>{project.path}</small>
												</button>
												<button
													aria-label={`Remove project ${project.name}`}
													onClick={() =>
														void commit({
															...data,
															projects: data.projects.filter((x) => x.id !== project.id)
														})
													}
												>
													<X size={14} />
												</button>
											</div>
										))}
									</div>
								</>
							)}
							{page === "wallet" && (
								<>
									<p>A local expense ledger. Add and review your own entries.</p>
									<form
										onSubmit={(e) => {
											e.preventDefault();
											const cents = Math.round(Number(amount) * 100);
											if (!expenseTitle.trim() || !Number.isSafeInteger(cents) || cents <= 0)
												return;
											void commit({
												...data,
												expenses: [
													{
														id: crypto.randomUUID(),
														title: expenseTitle.trim(),
														cents,
														currency,
														at: Date.now()
													},
													...data.expenses
												]
											}).then(() => {
												setExpenseTitle("");
												setAmount("");
											});
										}}
									>
										<input
											required
											maxLength={100}
											aria-label="Expense description"
											placeholder="Description"
											value={expenseTitle}
											onChange={(e) => setExpenseTitle(e.target.value)}
										/>
										<div className="workspace-form-row">
											<input
												required
												type="number"
												min="0.01"
												max="99999999"
												step="0.01"
												aria-label="Expense amount"
												placeholder="0.00"
												value={amount}
												onChange={(e) => setAmount(e.target.value)}
											/>
											<select
												aria-label="Expense currency"
												value={currency}
												onChange={(e) => setCurrency(e.target.value)}
											>
												{["EUR", "USD", "BGN", "UAH", "GBP"].map((c) => (
													<option key={c}>{c}</option>
												))}
											</select>
											<button type="submit">
												<Plus size={15} />
												Add
											</button>
										</div>
									</form>
									<div className="workspace-list">
										{data.expenses.map((e) => (
											<div key={e.id}>
												<span>
													<strong>{e.title}</strong>
													<small>{new Date(e.at).toLocaleDateString()}</small>
												</span>
												<b>
													{new Intl.NumberFormat(undefined, {
														style: "currency",
														currency: e.currency
													}).format(e.cents / 100)}
												</b>
												<button
													aria-label={`Remove expense ${e.title}`}
													onClick={() =>
														void commit({
															...data,
															expenses: data.expenses.filter((x) => x.id !== e.id)
														})
													}
												>
													<Trash2 size={14} />
												</button>
											</div>
										))}
									</div>
								</>
							)}
							{page === "messages" && (
								<>
									<p>
										{phone?.detail || "Open Phone Link to view your messages and paired phone."}
									</p>
									{phone?.phones.map((device, i) => (
										<div className="workspace-phone" key={i}>
											<strong>{device.name}</strong>
											<span>
												{device.connected ? "Connected" : "Not connected"}
												{device.battery !== null ? ` · ${device.battery}%` : ""}
											</span>
										</div>
									))}
									{["open", "messages", "calls", "photos", "files"].map((a) => (
										<button
											className="workspace-action"
											key={a}
											onClick={() => void action("phone_link_action", { action: a })}
										>
											{a === "open" ? "Open Phone Link" : a[0].toUpperCase() + a.slice(1)}
											<ArrowUpRight size={15} />
										</button>
									))}
								</>
							)}
							{page === "reports" && (
								<>
									<p>Based on your saved local workspace.</p>
									<dl className="workspace-report">
										<dt>Projects</dt>
										<dd>{data.projects.length}</dd>
										<dt>Tasks completed</dt>
										<dd>
											{data.tasks.filter((t) => t.done).length} / {data.tasks.length}
										</dd>
										<dt>Agent sessions</dt>
										<dd>{sessions.length}</dd>
										{[...new Set(data.expenses.map((e) => e.currency))].map((c) => (
											<div key={c}>
												<dt>Expenses · {c}</dt>
												<dd>
													{new Intl.NumberFormat(undefined, {
														style: "currency",
														currency: c
													}).format(
														data.expenses
															.filter((e) => e.currency === c)
															.reduce((s, e) => s + e.cents, 0) / 100
													)}
												</dd>
											</div>
										))}
									</dl>
									<button
										className="workspace-action"
										onClick={() =>
											void writeText(JSON.stringify(data, null, 2))
												.then(() => setNotice("Workspace JSON copied."))
												.catch((e) => setError(String(e)))
										}
									>
										<CopyLabel />
										Copy workspace report
									</button>
								</>
							)}
							{page === "profile" && (
								<>
									<div className="workspace-profile">
										<UserRound size={36} />
										<h3>{username}</h3>
										<p>Your Windows account · local workspace</p>
									</div>
									<button
										className="workspace-action"
										onClick={() =>
											void action("open_app", {
												appName: "ms-settings:yourinfo",
												displayName: "Windows account settings"
											})
										}
									>
										Windows account settings
										<ArrowUpRight size={15} />
									</button>
									<button
										className="workspace-action"
										onClick={() => void action("open_settings_window")}
									>
										Customize Bloom
										<Settings size={15} />
									</button>
									<button
										className="workspace-action"
										onClick={() => void action("show_voice_panel")}
									>
										Bloom Voice
										<Mic size={15} />
									</button>
								</>
							)}
						</section>
					)}
				</>
			)}
		</main>
	);
}
function CopyLabel() {
	return <ChartNoAxesColumn size={15} />;
}
createRoot(document.getElementById("root")!).render(<Sidebar />);
