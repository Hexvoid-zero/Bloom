import { useEffect, useState } from "react";
import { Wifi, SlidersHorizontal, Volume2, BatteryMedium } from "lucide-react";
import type { ActiveApp } from "../hooks/useActiveApp";
import "./MacMenuBar.css";

interface Props {
	active: ActiveApp | null;
	battery: number;
	scale: number;
	onCalendar: () => void;
	onControls: () => void;
	onMusic: () => void;
	onSettings: () => void;
	onHover: (hovered: boolean) => void;
}

export function MacMenuBar({
	active,
	battery,
	scale,
	onCalendar,
	onControls,
	onMusic,
	onSettings,
	onHover
}: Props) {
	const [date, setDate] = useState(() => new Date());
	useEffect(() => {
		const interval = setInterval(() => setDate(new Date()), 10000);
		return () => clearInterval(interval);
	}, []);
	return (
		<nav
			className="mac-menu-bar"
			style={{ height: 32 * scale, fontSize: 12 * scale }}
			aria-label="Bloom menu bar"
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
		>
			<div className="mac-menu-group">
				<button className="mac-brand" aria-label="Bloom settings" onClick={onSettings}>
					<img src="/bloom.png" alt="" />
				</button>
				<span className="mac-front-app">{active?.name || "Desktop"}</span>
				<button className="mac-menu-label" onClick={onCalendar}>
					Calendar
				</button>
				<button className="mac-menu-label" onClick={onMusic}>
					Music
				</button>
			</div>
			<div className="mac-menu-group mac-menu-status">
				<button aria-label="Network and controls" onClick={onControls}>
					<Wifi size={15} />
				</button>
				<button aria-label="Volume and controls" onClick={onControls}>
					<Volume2 size={15} />
				</button>
				<button aria-label={`Battery ${battery}%`} onClick={onControls}>
					<BatteryMedium size={19} />
					<span>{battery}%</span>
				</button>
				<button aria-label="Control Center" onClick={onControls}>
					<SlidersHorizontal size={15} />
				</button>
				<button className="mac-clock" onClick={onCalendar}>
					{date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
					<span>{date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
				</button>
			</div>
		</nav>
	);
}
