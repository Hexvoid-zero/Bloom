// Visual regression harness for the production dock. IPC is mocked; no apps are launched.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.BLOOM_TEST_TOOLS, "playwright"));
const output = process.env.BLOOM_EVIDENCE || path.resolve("../evidence/screenshots");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const wallpaper = await fs.readFile("website/src/assets/wallpaper-3.jpg");
const results = [];
const names = [
	"Explorer",
	"Chrome",
	"Edge",
	"Firefox",
	"Outlook",
	"Teams",
	"Word",
	"Excel",
	"PowerPoint",
	"OneNote",
	"Notepad",
	"Calculator",
	"Photos",
	"Camera",
	"Clock",
	"Calendar",
	"Mail",
	"Settings",
	"Terminal",
	"PowerShell",
	"VS Code",
	"Visual Studio",
	"GitHub",
	"Git",
	"Docker",
	"Postman",
	"Figma",
	"Slack",
	"Discord",
	"Zoom",
	"Spotify",
	"Apple Music",
	"VLC",
	"OBS",
	"Steam",
	"Epic Games",
	"Xbox",
	"Blender",
	"Photoshop",
	"Illustrator",
	"Lightroom",
	"Premiere",
	"After Effects",
	"DaVinci Resolve",
	"Audacity",
	"HandBrake",
	"7-Zip",
	"Everything",
	"PowerToys",
	"QuickLook",
	"ShareX",
	"Snipping Tool",
	"Paint",
	"Canva",
	"Notion",
	"Obsidian",
	"Todoist",
	"Trello",
	"Linear",
	"WhatsApp",
	"Telegram",
	"Signal",
	"Dropbox",
	"Google Drive",
	"OneDrive"
];
for (const scenario of [
	{ name: "normal", count: 12, width: 1920, height: 1080, scale: 1 },
	{ name: "65-apps-1920", count: 65, width: 1920, height: 1080, scale: 1 },
	{ name: "65-apps-1366", count: 65, width: 1366, height: 768, scale: 1 },
	{ name: "65-apps-1280-scale150", count: 65, width: 1280, height: 720, scale: 1.5 },
	{ name: "light", count: 12, width: 1920, height: 1080, scale: 1, light: true },
	{
		name: "active-dark-app",
		count: 12,
		width: 1920,
		height: 1080,
		scale: 1,
		activeColor: [32, 35, 42]
	},
	{
		name: "active-light-app",
		count: 12,
		width: 1920,
		height: 1080,
		scale: 1,
		activeColor: [244, 244, 245]
	},
	{ name: "reduced-motion", count: 65, width: 1920, height: 1080, scale: 1, reduced: true }
]) {
	const page = await browser.newPage({
		viewport: { width: scenario.width, height: scenario.height },
		reducedMotion: scenario.reduced ? "reduce" : "no-preference"
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(
		({ scenario, names }) => {
			const settings = {
				"bloom-dock-mode": "fixed",
				"bloom-scale": String(scenario.scale),
				"bloom-dock-preview-enabled": "false",
				"bloom-theme-mode": scenario.light ? "light" : "dark"
			};
			Object.entries(settings).forEach(([k, v]) => localStorage.setItem(k, v));
			let id = 0;
			const callbacks = new Map();
			const installed = names.map((name, i) => ({
				name,
				path: `C:/BloomVisualFixture/app-${i}.exe`,
				is_running: false,
				is_pinned: false,
				icon:
					"data:image/svg+xml," +
					encodeURIComponent(
						`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="hsl(${(i * 47) % 360} 78% 70%)"/><stop offset="1" stop-color="hsl(${(i * 47) % 360} 70% 42%)"/></linearGradient></defs><rect x="2" y="2" width="76" height="76" rx="18" fill="url(#g)"/><text x="40" y="51" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="32" font-weight="600" fill="white">${name[0]}</text></svg>`
					)
			}));
			const apps = installed.slice(0, scenario.count);
			window.__fixture = { apps, calls: [] };
			window.__TAURI_INTERNALS__ = {
				metadata: { currentWindow: { label: "dock" }, currentWebview: { label: "dock" } },
				transformCallback(cb) {
					callbacks.set(++id, cb);
					return id;
				},
				unregisterCallback(i) {
					callbacks.delete(i);
				},
				async invoke(cmd, args = {}) {
					window.__fixture.calls.push({ cmd, args });
					if (cmd === "load_settings") return settings;
					if (cmd === "get_active_app_appearance")
						return scenario.activeColor
							? { name: "Active app", hwnd: 100, color: scenario.activeColor }
							: null;
					if (cmd === "load_pinned_apps") return JSON.parse(localStorage.getItem('fixture-saved-pins')||'null') ?? apps;
					if (cmd === "save_pinned_apps") {localStorage.setItem('fixture-saved-pins',JSON.stringify(args.apps));return;}
					if (cmd === "get_installed_apps") return installed;
					if (cmd === "get_active_windows")
						return apps.slice(0, 4).map((a, i) => ({
							...a,
							is_running: true,
							hwnd: i + 100,
							all_hwnds: [[i + 100, a.name]]
						}));
					if (cmd === "get_tray_apps" || cmd === "get_dock_extras") return [];
					if (cmd === "get_custom_icons") return {};
					if (cmd === "get_app_icon")
						return installed.find((a) => a.path === args.path)?.icon || null;
					if (cmd === "plugin:window|is_visible") return true;
					if (cmd === "plugin:event|listen") return ++id;
					return null;
				}
			};
			window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
		},
		{ scenario, names }
	);
	await page.goto("http://127.0.0.1:4173/dock.html");
	await page.addStyleTag({
		content: `body{background:url(data:image/jpeg;base64,${wallpaper.toString("base64")}) center/cover fixed!important;}`
	});
	await page.locator(".dock-expanded").waitFor();
	await page.waitForTimeout(1800); // Wait for Bloom's one-time startup sequence to settle.
	assert.equal(await page.locator(".dock-icon-wrapper").count(), scenario.count + 1);
	// A false focus result models Windows delaying/rejecting activation.
    // The running pin must never issue a launch as a fallback.
    const beforeClick = await page.evaluate(() => window.__fixture.calls.length);
    await page.locator(".dock-icon-wrapper").nth(1).click();
    const clickCalls = await page.evaluate(n => window.__fixture.calls.slice(n), beforeClick);
    assert(clickCalls.some(c => c.cmd === "focus_window"));
    assert(!clickCalls.some(c => c.cmd === "open_app" || c.cmd === "launch_new_instance"), "Focusing an open app launched a duplicate");
	const geometry = await page.locator(".dock").evaluate((el) => {
		const r = el.getBoundingClientRect(),
			row = el.querySelector(".dock-reorder-container");
		return {
			left: r.left,
			right: r.right,
			bottom: r.bottom,
			width: r.width,
			scrollWidth: row.scrollWidth,
			clientWidth: row.clientWidth,
			scrollable: row.classList.contains("dock-scrollable")
		};
	});
	assert(geometry.left >= 0 && geometry.right <= scenario.width + 1, JSON.stringify(geometry));
	assert(geometry.bottom <= scenario.height - 7, "Floating gap missing");
	await page.screenshot({ path: path.join(output, scenario.name + ".png") });
	assert.equal(await page.locator(".dock-backdrop").count(), 0, "The surrounding app-color strip must stay removed");

	if (geometry.scrollable) {
		await page.locator(".dock-reorder-container").hover();
		await page.mouse.wheel(0, 1800);
		await page.waitForTimeout(200);
		const last = page.locator(".dock-icon-wrapper").last();
		const lastBox = await last.boundingBox();
		assert(
			lastBox.x >= 0 && lastBox.x + lastBox.width <= scenario.width,
			"Last app unreachable by wheel"
		);
		await page.screenshot({ path: path.join(output, scenario.name + "-last-app.png") });
	}
	if (scenario.name === "normal") {
		const icon = page.locator(".dock-icon-wrapper").nth(6);
		await icon.hover();
		await page.waitForTimeout(180);
		assert(
			Number(await icon.locator(".dock-icon").evaluate((el) => getComputedStyle(el).scale)) > 1.15
		);
		assert(
			Number(
				await page
					.locator(".dock-icon-wrapper")
					.nth(5)
					.locator(".dock-icon")
					.evaluate((el) => getComputedStyle(el).scale)
			) <= 1.05
		);
		assert(
			Number(
				await page
					.locator(".dock-icon-wrapper")
					.nth(7)
					.locator(".dock-icon")
					.evaluate((el) => getComputedStyle(el).scale)
			) <= 1.05
		);
		await page.screenshot({ path: path.join(output, "normal-hover.png") });
		await icon.click({ button: "right" });
		await page.locator(".context-menu").waitFor();
		await page.screenshot({ path: path.join(output, "context-menu.png") });
		await page.keyboard.press("Escape");
		await page.mouse.click(10, 10);
		await page.locator(".dock-icon-wrapper").nth(2).click();
		assert(
			await page.evaluate(() =>
				window.__fixture.calls.some((c) =>
					["launch_app", "activate_window", "focus_window", "toggle_window"].includes(c.cmd)
				)
			)
		);
		await page.locator(".dock-icon-wrapper").nth(6).click({ button: "right" });
		await page.getByText("Add App to Dock...", { exact: true }).click();
		await page.locator(".popup-search-input").fill("Slack");
		await page.locator(".popup-app-row").filter({ hasText: "Slack" }).click();
		await page.waitForFunction(() => document.querySelectorAll(".dock-icon-wrapper").length === 14);
		assert(
			await page.evaluate(() =>
				window.__fixture.calls.some(
					(c) => c.cmd === "save_pinned_apps" && c.args.apps.length === 13
				)
			)
		);
		await page.screenshot({ path: path.join(output, "add-app.png") });
		const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-saved-pins')).map(a=>a.path));
		const first=await page.locator('.dock-reorder-group > div').first().boundingBox(),third=await page.locator('.dock-reorder-group > div').nth(2).boundingBox();
		await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(third.x+third.width,third.y+third.height/2,{steps:24});await page.mouse.up();await page.waitForTimeout(700);
		const reordered=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-saved-pins')));assert.notDeepEqual(reordered.map(a=>a.path),original,'Drag must persist its new order');
		await page.locator('.dock').screenshot({path:path.join(output,'persisted-order-before.png'),omitBackground:true});
		await page.reload();await page.waitForTimeout(1800);
		const restoredNames=await page.locator('.dock-reorder-group > div').evaluateAll(els=>els.map(e=>e.querySelector('.dock-icon img')?.getAttribute('alt')));assert.deepEqual(restoredNames,reordered.map(a=>a.name));
		await page.locator('.dock').screenshot({path:path.join(output,'persisted-order-after-reload.png'),omitBackground:true});
		await fs.writeFile(path.join(output,'persistence-results.json'),JSON.stringify({passed:true,source:'Browser fixture disk mock',pinAdded:true,reorderSaved:true,reloadRestoredOrder:true,pins:reordered.length},null,2));
	}
	if (scenario.count === 65) {
		for (const index of [1, 16, 32, 48, 65]) {
			const target = page.locator('.dock-icon-wrapper').nth(index);
			await target.scrollIntoViewIfNeeded();
			const before = await page.evaluate(() => window.__fixture.calls.filter(c => ['open_app','focus_app_windows','activate_tray_icon','launch_app','activate_window','focus_window','toggle_window'].includes(c.cmd)).length);
			await target.click();
			const after = await page.evaluate(() => window.__fixture.calls.filter(c => ['open_app','focus_app_windows','activate_tray_icon','launch_app','activate_window','focus_window','toggle_window'].includes(c.cmd)).length);
			assert(after > before, `Dock app ${index} did not respond in ${scenario.name}`);
		}
	}
	if (scenario.reduced) {
		const icon = page.locator(".dock-icon-wrapper").nth(6);
		await icon.hover();
		assert.equal(
			await icon.locator(".dock-icon").evaluate((el) => getComputedStyle(el).scale),
			"1"
		);
	}
	assert.deepEqual(errors, []);
	results.push({ ...scenario, geometry, errors, passed: true });
	await page.close();
}
await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
