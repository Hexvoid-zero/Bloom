import {createRequire} from 'node:module';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;await fs.mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
try{
const pages=browser.contexts().flatMap(c=>c.pages()); const dock=pages.find(p=>p.url().endsWith('/dock.html')),start=pages.find(p=>p.url().endsWith('/start.html'));
assert(dock&&start);const invoke=(c,a)=>dock.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
const checks=await invoke('audit_pinned_launches');await fs.writeFile(path.join(out,'native-pin-launch-audit.json'),JSON.stringify(checks,null,2));
console.log(JSON.stringify({pins:checks.length,ready:checks.filter(x=>x.ready).length,failed:checks.filter(x=>!x.ready)},null,2));
await invoke('open_app',{appName:'start'});await start.getByRole('button',{name:'Power options',exact:true}).click();await start.getByRole('menu',{name:'Power options'}).waitFor();
assert.deepEqual(await start.getByRole('menuitem').allTextContents(),['Lock','Sleep','Shut down','Restart']);
await start.screenshot({path:path.join(out,'native-start-power.png'),omitBackground:true});await start.getByRole('button',{name:'Power options',exact:true}).click();await invoke('hide_bloom_start');
await dock.locator('.dock').screenshot({path:path.join(out,'native-dock-identities.png'),omitBackground:true});
console.log('Native power menu captured without executing system power actions');
}finally{await browser.close();}
