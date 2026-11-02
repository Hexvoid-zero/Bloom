import { test, expect } from "bun:test";
import { formatDictation, parseVoiceRules, pcmWav } from "../src/voiceProcessing";
import {
	parseSidebarPreferences,
	parseWorkspace,
	sidebarShouldHide
} from "../src/sidebarPreferences";
test("dictation preserves Unicode, applies literal phrase rules and spoken paragraphs", () => {
	const rules = parseVoiceRules(
		"codex app => Codex\nmy signature => Best regards, Alex\n[a] => value\nbad line"
	);
	expect(formatDictation("Um, codex app new paragraph my signature", true, rules)).toBe(
		"Codex\n\nBest regards, Alex"
	);
	expect(formatDictation("Привет, мир. [a]", false, rules)).toBe("Привет, мир. value");
	expect(formatDictation("humble umbrella", true, [])).toBe("humble umbrella");
	expect(formatDictation("a codex application", false, rules)).toBe("a codex application");
	expect(formatDictation("uh hello", false, [])).toBe("uh hello");
});
test("PCM encoder resamples to bounded mono 16kHz 16bit WAV", () => {
	const wav = pcmWav([new Float32Array(48000).fill(0.5)], 48000);
	const v = new DataView(wav.buffer);
	expect(wav.length).toBe(32044);
	expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
	expect(v.getUint32(24, true)).toBe(16000);
	expect(v.getUint16(22, true)).toBe(1);
	expect(v.getUint16(34, true)).toBe(16);
	expect(v.getInt16(44, true)).toBe(16384);
});
test("sidebar migration validates placement and behavior without changing other settings", () => {
	expect(parseSidebarPreferences("{bad")).toEqual({
		enabled: true,
		side: "left",
		mode: "smart",
		expanded: false,
		night: false
	});
	expect(
		parseSidebarPreferences({
			enabled: false,
			side: "right",
			mode: "auto",
			expanded: true,
			night: true
		})
	).toEqual({ enabled: false, side: "right", mode: "auto", expanded: true, night: true });
	expect(parseSidebarPreferences({ side: "top", mode: "bad" }).side).toBe("left");
});
test("smart visibility hides only on overlap and retains controls while engaged", () => {
	expect(sidebarShouldHide("smart", true, false)).toBe(true);
	expect(sidebarShouldHide("smart", false, false)).toBe(false);
	expect(sidebarShouldHide("smart", true, true)).toBe(false);
	expect(sidebarShouldHide("always", true, false)).toBe(false);
	expect(sidebarShouldHide("auto", false, false)).toBe(true);
	expect(sidebarShouldHide("auto", false, true)).toBe(false);
});
test("workspace rejects malformed or unsafe persisted records", () => {
	const parsed = parseWorkspace({
		tasks: [null, { id: "1", title: "Work", due: "", done: false }],
		projects: [{ id: "p", name: "Bloom", path: "C:\\Bloom", color: "bad" }],
		expenses: [
			{ id: "1", title: "Coffee", cents: 399, currency: "EUR", at: 1 },
			{ id: "2", title: "bad", cents: NaN, currency: "EUR", at: 1 }
		]
	});
	expect(parsed.tasks).toHaveLength(1);
	expect(parsed.projects[0].color).toBe("#37cda9");
	expect(parsed.expenses).toHaveLength(1);
	expect(parseWorkspace(null)).toEqual({ tasks: [], projects: [], expenses: [] });
});
