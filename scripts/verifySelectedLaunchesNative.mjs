import {createRequire} from 'node:module';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE,b=await chromium.connectOverCDP('http://127.0.0.1:49333');
try{
const d=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/dock.html'));const invoke=(c,a)=>d.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
const pins=await invoke('load_pinned_apps'),audit=await invoke('audit_pinned_launches');assert(audit.every(p=>p.ready),JSON.stringify(audit.filter(p=>!p.ready)));await fs.writeFile(path.join(out,'native-pin-launch-audit.json'),JSON.stringify(audit,null,2));

const selected=['VectorCraft','FigCraft','FilmCraft',pins.find(p=>p.name.includes('YouTube Studio'))?.name].filter(Boolean),results=[];
for(const name of selected){
 const pin=pins.find(p=>p.name===name);assert(pin);const before=await invoke('get_active_windows');
 if(before.some(a=>a.name.toLowerCase().includes(name.toLowerCase())||(pin.app_id&&pin.app_id===a.app_id)||a.executable?.toLowerCase()===name.toLowerCase()+'.exe')){results.push({name,alreadyOpen:true,opened:true});continue;}
 await d.locator('.dock').hover({force:true});await d.waitForTimeout(500);
 const item=d.locator('.dock-reorder-group > div').nth(pins.findIndex(p=>p.name===name));
 assert.equal(await item.count(),1,`Unique dock item ${name}`);await item.locator('.dock-icon').click({force:true});
 await d.waitForTimeout(2200);assert.equal(await d.locator('.dock-toast').count(),0);
 let running=[];for(let i=0;i<60;i++){running=await invoke('get_active_windows');if(running.some(a=>a.name.toLowerCase().includes(name.toLowerCase())||(pin.app_id&&pin.app_id===a.app_id)||a.executable?.toLowerCase()===name.toLowerCase()+'.exe'))break;await d.waitForTimeout(600);}
 const opened=running.some(a=>a.name.toLowerCase().includes(name.toLowerCase())||(pin.app_id&&pin.app_id===a.app_id)||a.executable?.toLowerCase()===name.toLowerCase()+'.exe');results.push({name,opened,launchSuccess:true});assert(opened,`${name} should create a window`);
}
await fs.writeFile(path.join(out,'native-selected-launch-results.json'),JSON.stringify({passed:true,source:'Dock renderer clicks + live window enumeration; physical OS input not automated',results},null,2));console.log(JSON.stringify(results,null,2));
}finally{const d=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/dock.html'));await d?.evaluate(()=>{if(window.__testOriginalInvoke)window.__TAURI_INTERNALS__.invoke=window.__testOriginalInvoke;}).catch(()=>{});await b.close();}
