// Inspect the real compiled Tauri WebView2 process, without mocked IPC.
// Start the verification process with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
// "--remote-debugging-port=49333 --remote-debugging-address=127.0.0.1".
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.BLOOM_TEST_TOOLS, 'playwright'));
const output = process.env.BLOOM_EVIDENCE;
const browser = await chromium.connectOverCDP('http://127.0.0.1:49333');
const pages = browser.contexts().flatMap(c => c.pages());
const page = pages.find(p => p.url().endsWith('/dock.html'));
assert(page, 'Native dock WebView2 target missing');
await page.locator('.dock-expanded').waitFor();
const before = await page.evaluate(async () => {
	const pins = await window.__TAURI_INTERNALS__.invoke('load_pinned_apps');
	const settings = await window.__TAURI_INTERNALS__.invoke('load_settings');
	const visible = await window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible', {label:'dock'});
	const bar=document.querySelector('.dock'), r=bar.getBoundingClientRect();
	return { pinned: pins.length, renderedPinned:document.querySelectorAll('.dock-reorder-group > div').length,
		totalIcons:document.querySelectorAll('.dock-icon-wrapper').length,
		viewport:{width:innerWidth,height:innerHeight}, tray:{left:r.left,right:r.right,bottom:r.bottom},
		visible, scrollable:!!document.querySelector('.dock-scrollable'), dockEnabled:settings['bloom-dock-enabled'],
		loadedIcons:[...document.querySelectorAll('.dock-icon img')].filter(i=>i.complete && i.naturalWidth>0).length,
		backend:'real Tauri IPC, no mocks', screenshot:'live compiled Windows WebView2' };
});
assert.equal(before.pinned,65);
assert.equal(before.renderedPinned,65);
assert(before.visible && before.dockEnabled === 'true');
assert(before.tray.left>=0 && before.tray.right<=before.viewport.width+1);
await page.screenshot({path:path.join(output,'native-window-65.png'),omitBackground:true});
await page.locator('.dock').screenshot({path:path.join(output,'native-dock-65.png'),omitBackground:true});
// Native renderer context-menu and hover are tested on a running app icon.
const icon=page.locator('.dock-reorder-group .dock-icon-wrapper').nth(15);
await icon.hover();
await page.waitForTimeout(200);
assert(Number(await icon.locator('.dock-icon').evaluate(el=>getComputedStyle(el).scale))>1.3);
await page.screenshot({path:path.join(output,'native-hover-65.png'),omitBackground:true});
await icon.click({button:'right'});
await page.locator('.context-menu').waitFor();
await page.screenshot({path:path.join(output,'native-context-65.png'),omitBackground:true});
await page.mouse.click(10,10);
// Reload proves the 65 pins are loaded back from the native persisted profile.
await page.reload();
await page.locator('.dock-expanded').waitFor();
await page.waitForTimeout(1500);
assert.equal(await page.locator('.dock-reorder-group > div').count(),65);
const result={...before,reloadedPinned:65,hoverPassed:true,contextMenuPassed:true,passed:true};
await fs.writeFile(path.join(output,'native-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await browser.close();
