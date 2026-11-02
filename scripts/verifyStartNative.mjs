// Packaged WebView2 and real IPC. Hook fixture is task-owned and removed in finally.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;await fs.mkdir(out,{recursive:true});
let browser;for(let n=0;n<20;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:49333');break;}catch(e){if(n===19)throw e;await new Promise(r=>setTimeout(r,500));}}
let pages=[];
for(let n=0;n<30;n++){pages=browser.contexts().flatMap(c=>c.pages());if(pages.filter(p=>p.url().includes("tauri.localhost")).length===5)break;await new Promise(r=>setTimeout(r,500));}
const dock=pages.find(p=>p.url().endsWith('/dock.html'));
const start=pages.find(p=>p.url().endsWith('/start.html'));
const main=pages.find(p=>p.url().includes('tauri.localhost')&&p.url().endsWith('/'));
const settings=pages.find(p=>p.url().endsWith('/settings.html'));
assert(dock&&start&&main&&settings,'All packaged pages exist');
const invoke=(cmd,args)=>dock.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[cmd,args]);
const errors=[];for(const p of [dock,start,main,settings])p.on('pageerror',e=>errors.push(e.message));
let fixture;
try{
 await invoke('hide_bloom_start');await invoke('open_app',{appName:'start'});
 await start.getByRole('heading',{name:'Pinned apps'}).waitFor();await start.waitForTimeout(2200);
 let catalog=[];for(let n=0;n<20;n++){catalog=await invoke('get_installed_apps');if(catalog.length)break;await start.waitForTimeout(500);}
 const pins=await invoke('load_pinned_apps'),sessions=await invoke('get_agent_sessions'),phone=await invoke('get_phone_link_status');
 assert(Array.isArray(catalog)&&catalog.length>0);assert(Array.isArray(sessions));
 await start.waitForFunction(()=>[...document.querySelectorAll('.start-app-grid .launcher-icon img')].filter(i=>i.complete&&i.naturalWidth>0).length>=8);
 await start.screenshot({path:path.join(out,'native-start-overview.png'),omitBackground:true});
 await start.getByRole('button',{name:'Pinned',exact:true}).click();await start.waitForTimeout(500);
 const savedSettings=await invoke('load_settings');let independentPins;try{independentPins=JSON.parse(savedSettings['bloom-start-preferences']||'{}').pins;}catch{}
 assert.equal(await start.locator('.start-app-tile').count(),Array.isArray(independentPins)?independentPins.length:pins.length);
 await start.screenshot({path:path.join(out,'native-start-pinned-full.png'),omitBackground:true});
 await start.getByRole('button',{name:'Agents',exact:true}).click();await start.waitForTimeout(500);
 await start.screenshot({path:path.join(out,'native-start-agents-real.png'),omitBackground:true});
 const info=await invoke('agent_bridge_info');assert(info.provider_coverage.length>=15);for(const name of ['Codex','Claude Code','Antigravity'])assert(info.provider_coverage.some(p=>p.provider===name));
 await start.getByLabel('Agent integration help',{exact:true}).click();await start.waitForTimeout(600);await start.screenshot({path:path.join(out,'native-agent-coverage.png'),omitBackground:true});await start.getByLabel('Agent integration help',{exact:true}).click();
 fixture=path.join(info.event_directory,`bloom-verification-${Date.now()}.jsonl`);await fs.mkdir(info.event_directory,{recursive:true});
 const id=`bloom-verification-${Date.now()}`;
 const event=(status)=>({schema_version:1,id,provider:'Bloom verification',project:'Controlled local event',status,activity:status==='working'?'Running verification':status==='needs-attention'?'Waiting for review':'Verification finished',path:process.cwd(),updated_at:Math.floor(Date.now()/1000)});
 await fs.writeFile(fixture,JSON.stringify(event('working'))+'\n');
 const waitFor=async(status)=>{for(let n=0;n<35;n++){const s=await invoke('get_agent_sessions');if(s.some(x=>x.id===`hook:${id}`&&x.status===status))return;await new Promise(r=>setTimeout(r,500));}throw Error(`Agent fixture did not reach ${status}`);};
 await waitFor('working');await fs.appendFile(fixture,JSON.stringify(event('needs-attention'))+'\n');await waitFor('needs-attention');
 await start.getByText('Controlled local event',{exact:true}).waitFor();await start.waitForTimeout(500);
 await start.screenshot({path:path.join(out,'native-start-hook-event.png'),omitBackground:true});
 await fs.appendFile(fixture,JSON.stringify(event('completed'))+'\n');await waitFor('completed');
 await start.getByRole('button',{name:'All apps',exact:true}).click();
 const sample=catalog.find(a=>a.name.toLowerCase().includes('chrome'))??catalog[0];
 await start.getByLabel('Search apps',{exact:true}).fill(sample.name);
 await start.waitForTimeout(400);assert(await start.locator('.start-app-tile').count()>0);
 await start.screenshot({path:path.join(out,'native-start-search.png'),omitBackground:true});
 await invoke('hide_bloom_start');await invoke('open_settings_window');
 await settings.getByRole('button',{name:'Start menu',exact:true}).click();await settings.waitForTimeout(500);
 await settings.locator('.settings-content').evaluate(e=>e.scrollTop=0);
 await settings.screenshot({path:path.join(out,'native-start-settings.png'),omitBackground:true});
 await settings.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|hide',{label:'settings'}));
 await main.getByLabel('Open agent activity',{exact:true}).click();await main.waitForTimeout(600);
 await main.screenshot({path:path.join(out,'native-notch-agents.png'),omitBackground:true});
 await main.getByRole('button',{name:'Wi-Fi',exact:true}).click();await main.getByRole('switch',{name:'Wi-Fi',exact:true}).waitFor();await main.waitForTimeout(700);
 const wifiLayout=await main.locator('.qp').boundingBox();const wifiNav=await main.getByRole('navigation',{name:'Notch panels'}).boundingBox();assert(wifiLayout.y>=wifiNav.y+wifiNav.height);assert(wifiLayout.y+wifiLayout.height<=480);
 await main.getByRole('region',{name:'Bloom top notch'}).screenshot({path:path.join(out,'native-notch-wifi.png'),omitBackground:true});
 const wifi=await invoke('get_wifi_status');let wifiNetworks;try{const value=await invoke('wifi_list_networks');wifiNetworks={count:value.networks.length,locationDenied:value.location_denied};}catch(e){wifiNetworks={error:String(e)};}
 await fs.writeFile(path.join(out,'native-wifi-results.json'),JSON.stringify({passed:true,source:'Packaged native status/list IPC and direct notch tab; radio and connection left unchanged',enabled:wifi.enabled,connected:wifi.connected,networks:wifiNetworks,panel:wifiLayout},null,2));
 if(!await main.getByRole('navigation',{name:'Notch panels'}).count())await main.getByLabel('Open agent activity',{exact:true}).click();
 await main.getByRole('button',{name:'Calendar / Timer',exact:true}).click();await main.waitForTimeout(500);
 await main.screenshot({path:path.join(out,'native-notch-calendar.png'),omitBackground:true});
 await main.getByRole('button',{name:'Controls',exact:true}).click();await main.getByLabel('Master volume',{exact:true}).waitFor();await main.waitForTimeout(500);
 await main.screenshot({path:path.join(out,'native-notch-controls.png'),omitBackground:true});
 await main.getByRole('button',{name:'App volumes',exact:true}).click();await main.waitForTimeout(500);
 const box=await main.getByRole('region',{name:'Bloom top notch'}).boundingBox();assert(box.y+box.height<=480);
 await main.screenshot({path:path.join(out,'native-notch-mixer.png'),omitBackground:true});
 await main.getByRole('button',{name:'Shelf',exact:true}).click();await main.waitForTimeout(400);
 await main.screenshot({path:path.join(out,'native-notch-shelf.png'),omitBackground:true});
 await main.getByLabel('Collapse notch',{exact:true}).click();await main.mouse.move(10,400);await main.waitForTimeout(1000);
 await main.screenshot({path:path.join(out,'native-notch-compact.png'),omitBackground:true});
 await main.getByRole('region',{name:'Bloom top notch'}).hover();await main.waitForTimeout(700);
 const layout=await main.locator('.main-row-inner').evaluate(row=>{const r=e=>{const q=e.getBoundingClientRect();return {left:q.left,right:q.right};};return {left:r(row.querySelector('.side-content.left')),clock:r(row.querySelector('.time-center')),right:r(row.querySelector('.side-content.right'))};});
 assert(layout.left.right<=layout.clock.left);assert(layout.right.left>=layout.clock.right);
 const hover=await main.getByRole('region',{name:'Bloom top notch'}).boundingBox();await main.screenshot({path:path.join(out,'native-notch-no-overlap.png'),clip:{x:Math.max(0,hover.x-24),y:0,width:hover.width+48,height:hover.height+35},omitBackground:true});
 assert(await main.locator('.agent-companion img').getAttribute('src')==='/bloom-mark.svg');
 await main.mouse.move(10,400);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'native-results.json'),JSON.stringify({passed:true,source:'packaged WebView2 real IPC; renderer interactions',installedApps:catalog.length,savedDockPins:pins.length,realSessions:sessions.length,providerCoverage:info.provider_coverage,overlapFree:true,newFoldLogo:true,phoneStatus:phone.status,phones:phone.phones.map(p=>({name:p.name,connected:p.connected})),hookTransitions:['working','needs-attention','completed'],searchSample:sample.name,notchMixerFits:box,errors},null,2));
 console.log('PASS packaged Start/catalog/search/settings, real sessions, local hook status transitions and preserved notch panels');
}finally{
 if(fixture)await fs.rm(fixture,{force:true});
 await invoke('hide_bloom_start').catch(()=>{});
 await browser.close();
}
