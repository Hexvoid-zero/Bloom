// Restore the user's original pin collection into the separate variant after testing.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const original=path.join(process.env.APPDATA,'com.sehaz.bloom');
const pins=JSON.parse(await fs.readFile(path.join(original,'pinned_apps.json'),'utf8'));
const settings=JSON.parse(await fs.readFile(path.join(original,'settings.json'),'utf8'));
Object.assign(settings,{'bloom-dock-enabled':'true','bloom-dock-mode':'fixed','bloom-dock-icon-only':'true','bloom-auto-update':'false'});
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/dock.html'));
await page.evaluate(async ({pins,settings})=>{
	await window.__TAURI_INTERNALS__.invoke('save_pinned_apps',{apps:pins});
	for(const [key,value] of Object.entries(settings)) await window.__TAURI_INTERNALS__.invoke('save_setting',{key,value});
},{pins,settings});
await page.reload();
await page.locator('.dock-expanded').waitFor();
await page.waitForTimeout(1800);
assert.equal(await page.locator('.dock-reorder-group > div').count(),pins.length);
await page.locator('.dock').screenshot({path:path.join(process.env.BLOOM_EVIDENCE,'native-normal.png'),omitBackground:true});
console.log(`Restored ${pins.length} original pins into isolated variant. Original profile unchanged.`);
// A graceful exit exercises Bloom's taskbar and AppBar cleanup before the production launch.
await page.evaluate(()=>{window.__TAURI_INTERNALS__.invoke('quit_bloom');}).catch(()=>{});
await browser.close().catch(()=>{});
