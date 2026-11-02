import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const b=await chromium.connectOverCDP('http://127.0.0.1:49333');try{
const d=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/dock.html'));const invoke=(c,a)=>d.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
const pins=await invoke('load_pinned_apps'),checks=[];
for(const pin of pins.filter(p=>p.app_id?.includes('_crx_')||p.executable==='chrome.exe')){
 const icon=await invoke('get_app_icon',{path:pin.path,name:pin.name,appId:pin.app_id??null});
 checks.push({name:pin.name,app_id:pin.app_id,loaded:!!icon,sha256:icon?crypto.createHash('sha256').update(icon).digest('hex'):null});
}
await fs.writeFile('G:/My Drive/Bloom/evidence/oct27-native/chrome-icon-audit.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
await d.locator('.dock').hover({force:true});await d.waitForTimeout(1100);await d.screenshot({path:'G:/My Drive/Bloom/evidence/oct27-native/native-dock-full.png',omitBackground:true});
}finally{await b.close();}
