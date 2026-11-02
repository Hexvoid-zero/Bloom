export interface VoiceRule {
	from: string;
	to: string;
}
export function parseVoiceRules(text: string): VoiceRule[] {
	return text
		.split("\n")
		.slice(0, 100)
		.flatMap((line) => {
			const at = line.indexOf("=>");
			return at > 0 && line.slice(0, at).trim()
				? [
						{
							from: line.slice(0, at).trim().slice(0, 100),
							to: line
								.slice(at + 2)
								.trim()
								.slice(0, 2000)
						}
					]
				: [];
		});
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function formatDictation(raw: string, clean: boolean, rules: VoiceRule[]): string {
	let text = raw.trim();
	if (clean) {
		text = text
			.replace(/\b(?:um|uh|erm)\b[, ]*/gi, "")
			.replace(/\bnew paragraph\b[.,]?/gi, "\n\n")
			.replace(/\bnew line\b[.,]?/gi, "\n")
			.replace(/[ \t]+/g, " ")
			.replace(/ *\n */g, "\n")
			.trim();
	}
	for (const r of rules) {
		text = text.replace(
			new RegExp(`(?<![\\p{L}\\p{N}_])${escape(r.from)}(?![\\p{L}\\p{N}_])`, "giu"),
			() => r.to
		);
	}
	return text;
}
export function pcmWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
	const size = chunks.reduce((sum, c) => sum + c.length, 0);
	const input = new Float32Array(size);
	let cursor = 0;
	for (const c of chunks) {
		input.set(c, cursor);
		cursor += c.length;
	}
	const length = Math.floor((size * 16000) / sampleRate);
	const bytes = new Uint8Array(44 + length * 2),
		view = new DataView(bytes.buffer);
	const tag = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
	};
	tag(0, "RIFF");
	view.setUint32(4, 36 + length * 2, true);
	tag(8, "WAVE");
	tag(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 16000, true);
	view.setUint32(28, 32000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	tag(36, "data");
	view.setUint32(40, length * 2, true);
	for (let i = 0; i < length; i++) {
		const start = Math.floor((i * sampleRate) / 16000),
			end = Math.max(start + 1, Math.floor(((i + 1) * sampleRate) / 16000));
		let sum = 0;
		for (let j = start; j < end && j < input.length; j++) sum += input[j];
		const value = Math.max(-1, Math.min(1, sum / (end - start)));
		view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
	}
	return bytes;
}
export function audioBase64(bytes: Uint8Array): string {
	let text = "";
	for (let i = 0; i < bytes.length; i += 16384)
		text += String.fromCharCode(...bytes.subarray(i, i + 16384));
	return btoa(text);
}
