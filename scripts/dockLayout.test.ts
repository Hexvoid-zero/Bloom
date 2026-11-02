import { describe, expect, test } from "bun:test";
import { dockLayout, dockLens } from "../src/dockLayout";

describe("65-app dock capacity", () => {
	for (const width of [1280, 1366, 1920, 2560, 3840]) {
		for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
			test(`${width}px at ${scale}x stays within the viewport`, () => {
				const layout = dockLayout(66, width, scale, 2);
				expect((layout.maxWidth + 32) * scale).toBeLessThanOrEqual(width);
				expect(layout.icon).toBeGreaterThanOrEqual(16);
				expect(layout.icon).toBeLessThanOrEqual(40);
				// When icons cannot fit legibly, every item remains in a scrollable row.
				if (66 * layout.icon > layout.maxWidth) expect(layout.scroll).toBe(true);
			});
		}
	}
	test("a normal collection keeps full-size icons", () => {
		expect(dockLayout(12, 1920, 1).icon).toBe(40);
	});
	test("lens is symmetric and settles outside its range", () => {
		expect(dockLens(0, 40).scale).toBeCloseTo(1.22);
		expect(dockLens(48, 40).scale).toBe(1);
		expect(dockLens(-30, 40).scale).toBe(dockLens(30, 40).scale);
		expect(dockLens(500, 40).scale).toBe(1);
	});
});
