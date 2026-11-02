/** Leave room for the hover lens and native window margins at every UI scale. */
export function dockLayout(count: number, viewport: number, scale: number, dividers = 0) {
	const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
	const available = Math.max(100, (viewport - 32) / safeScale);
	const slots = Math.max(1, count);
	const gap = Math.max(2, Math.min(8, (available - slots * 40 - 80) / (slots + 4)));
	const icon = Math.max(
		16,
		Math.min(40, (available - 80 - dividers * 16 - (slots + 4) * gap) / slots)
	);
	const content = slots * icon + (slots + 4) * gap + dividers * 16;
	return { icon, gap, maxWidth: available - 32, scroll: content > available - 32 };
}

/** A smooth, bounded lens; transforms never change the pointer's layout anchors. */
export function dockLens(distance: number, size: number) {
	const radius = Math.max(20, size * 0.9);
	const proximity = Math.max(0, 1 - Math.abs(distance) / radius);
	const influence = proximity * proximity * (3 - 2 * proximity);
	return {
		scale: 1 + influence * 0.22,
		lift: -influence * 5,
		shift: Math.sign(distance) * Math.min(5, size * 0.12) * Math.min(1, Math.abs(distance) / radius)
	};
}
