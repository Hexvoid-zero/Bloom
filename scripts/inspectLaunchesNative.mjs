import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const b=await chromium.connectOverCDP('http://127.0.0.1:49333');try{
const pages=b.contexts().flatMap(c=>c.pages()),d=pages.find(p=>p.url().endsWith('/dock.html'));
const invoke=(c,a)=>d.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
const catalog=await invoke('get_installed_apps'),running=await invoke('get_active_windows'),pins=await invoke('load_pinned_apps');
await fs.writeFile('G:/My Drive/Bloom/evidence/oct27-native/live-app-identities.json',JSON.stringify({catalog:catalog.filter(x=>/FPL|Craft/.test(x.name)),running,pins:pins.map(({icon,...a})=>a)},null,2));
console.log(JSON.stringify({catalog:catalog.filter(x=>/FPL/.test(x.name)),running:running.map(({icon,...x})=>x),dock:await d.locator('.dock').evaluate(e=>({width:e.getBoundingClientRect().width,children:e.querySelectorAll('img').length})),settings:await invoke('load_settings')},null,2));
}finally{await b.close();}
