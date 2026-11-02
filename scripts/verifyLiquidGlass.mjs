// Isolated browser fixtures. Native commands are mocked; no user app is launched.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1120,height:790}});
const errors=[];
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
function setup(label){
 const icon=(name,c)=>'data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="12" fill="${c}"/><text x="24" y="32" fill="white" font-family="Arial" font-size="25" text-anchor="middle">${name[0]}</text></svg>`);
 const names=['Chrome','Microsoft Word','Visual Studio Code','Claude','Codex','Cursor','Settings','Photos','Notepad','Calculator','Spotify','Phone Link','File Explorer','Outlook','Terminal','Paint','Firefox','Gemini CLI','OneNote','PowerPoint'];
 const apps=names.map((name,i)=>({name,path:`app-${i}`,icon:icon(name,['#537abc','#b7638a','#6c59b1','#bb7958','#548f86'][i%5])}));
 const sessions=[{id:'a',agent:'Codex',project:'Bloom',status:'working',detail:'Running a tool',updated_at:Date.now()/1000,path:'C:\\Projects\\Bloom'},{id:'b',agent:'Claude Code',project:'Website',status:'needs-attention',detail:'Permission request',updated_at:Date.now()/1000,path:'C:\\Projects\\Website'},{id:'c',agent:'Cursor',project:'Mobile app',status:'completed',detail:'Turn completed',updated_at:Date.now()/1000,path:'C:\\Projects\\Mobile'},{id:'d',agent:'Antigravity',project:'Antigravity',status:'app-open',source:'process',detail:'App running; activity unavailable',updated_at:Date.now()/1000,path:''}];
 const settings={'bloom-liquid-glass-dock':'true','bloom-liquid-glass-notch':'true','bloom-liquid-glass-start':'true','bloom-notch-mode':'overlay','bloom-scale':'1','bloom-dock-enabled':'false','bloom-first-run':'done','bloom-app-version':'3.10.0','bloom-weather-enabled':'false','bloom-corners-enabled':'false','bloom-start-preferences':localStorage.getItem('bloom-start-preferences')||''};
 Object.entries(settings).forEach(([k,v])=>localStorage.setItem(k,v));localStorage.setItem('bloom-announcement-cache-at',String(Date.now()));
 let id=0;const callbacks=new Map(),listeners=new Map();
 window.__fixture={calls:[],settings,sessions,emit(event,payload){for(const [key,l]of listeners)if(l.event===event)callbacks.get(l.handler)?.({event,payload,id:key});}};
 window.__TAURI_INTERNALS__={metadata:{currentWindow:{label},currentWebview:{label}},transformCallback(cb){callbacks.set(++id,cb);return id;},unregisterCallback(k){callbacks.delete(k);},async invoke(cmd,args={}){
  window.__fixture.calls.push({cmd,args});
  if(cmd==='load_settings')return settings;
  if(['get_active_windows','get_tray_apps','get_dock_extras'].includes(cmd))return [];
  if(cmd==='get_custom_icons')return {};
  if(cmd==='get_app_icon')return apps.find(a=>a.path===args.path)?.icon||null;
  if(cmd==='save_setting'){settings[args.key]=args.value;localStorage.setItem(args.key,args.value);window.__fixture.emit('settings-changed',{key:args.key,value:args.value});return;}
  if(cmd==='plugin:event|listen'){listeners.set(++id,args);return id;}
  if(cmd==='plugin:event|unlisten')return listeners.delete(args.eventId);
  if(cmd==='get_installed_apps')return window.__fixture.catalogPending?[]:apps;
  if(cmd==='load_pinned_apps')return apps.slice(0,16);
  if(cmd==='get_agent_sessions')return window.__fixture.sessions;
  if(cmd==='get_wifi_status')return {enabled:window.__fixture.wifiEnabled??true,connected:window.__fixture.wifiEnabled!==false,ssid:'Fixture Home'};
  if(cmd==='wifi_list_networks')return {location_denied:false,networks:[{ssid:'Fixture Home',signal:92,security:'wpa2',connected:true,saved:true},{ssid:'Fixture Guest',signal:70,security:'wpa2',connected:false,saved:false}]};
  if(cmd==='set_wifi_state'){if(window.__fixture.failWifiToggle)throw Error('Controlled radio failure');window.__fixture.wifiEnabled=args.enabled;return;}
  if(cmd==='wifi_scan'){window.__fixture.emit('wifi-changed',null);return;}
  if(cmd==='wifi_connect'||cmd==='wifi_disconnect'||cmd==='wifi_forget'){window.__fixture.emit('wifi-changed',null);return;}
  if(cmd==='get_agent_hook_integrations')return [];
  if(cmd==='get_start_context')return {username:'Workspace owner'};
  if(cmd==='get_phone_link_status')return {installed:true,status:'available',phones:[{name:'Redmi Note 13 5G',connected:true,battery:null}],detail:'Bluetooth connected. Open Phone Link for messages, calls and notifications.'};
  if(cmd==='get_audio_sessions')return [{pid:1,name:'Music',volume:.5,is_muted:false}];
  if(cmd==='plugin:window|is_visible')return true;
  if(cmd==='plugin:app|version')return '3.10.0';
  if(cmd==='plugin:app|identifier')return 'com.sehaz.bloom.macdock';
  if(cmd==='get_volume_state')return {volume:.5,is_muted:false};
  if(cmd==='get_brightness')return 60;
  if(cmd==='get_network_speed')return [0,0];
  if(cmd==='get_cpu_usage'||cmd==='get_ram_usage'||cmd==='get_disk_space')return 20;
  if(cmd==='load_shelf_items'||cmd==='get_bluetooth_devices'||cmd==='get_connected_bluetooth_devices'||cmd==='plugin:window|get_all_windows')return [];
  return null;
 }};
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
}

const wallpaper=await fs.readFile('website/src/assets/wallpaper-3.jpg');
const background=async(page)=>{await page.addStyleTag({content:`html,body{background:transparent}body{background-image:url(data:image/jpeg;base64,${wallpaper.toString('base64')});background-size:cover;background-position:center}`});};
const results=[];
for(const [label,url,width,height] of [['dock','/dock.html',1600,600],['start','/start.html',1120,790],['main','/',1600,480]]){
 const page=await context.newPage();await page.addInitScript(setup,label);await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:4173'+url);await page.waitForTimeout(700);await background(page);await page.waitForTimeout(label==='main'?4000:1500);
 if(label==='main'){await page.evaluate(()=>window.__fixture.emit('splash-done',null));await page.waitForTimeout(1200);}
 const surface=label==='main'?'notch':label;await page.waitForFunction(surface=>(surface==='start'?document.body.dataset.glassmorphism:document.body.dataset.liquidGlass)===surface,surface,{timeout:7000}).catch(async e=>{console.log(JSON.stringify({label,surface,dataset:await page.evaluate(()=>({...document.body.dataset})),errors,calls:await page.evaluate(()=>window.__fixture?.calls.slice(-8))},null,2));throw e;});
 if(label==='dock'){assert.equal(await page.locator('.dock-backdrop').count(),0);await page.locator('.dock').hover();await page.waitForTimeout(500);}
 const selector=label==='dock'?'.dock-glass':label==='main'?'.bloom':'.start-main';
 const optical=await page.locator(selector).evaluate((e,label)=>{const c=getComputedStyle(e,label==='main'?'::before':null);return {background:c.background,backdrop:c.backdropFilter,shadow:c.boxShadow};},label);
 assert(optical.backdrop.includes('blur'),JSON.stringify(optical));
 await page.screenshot({path:path.join(out,`liquid-glass-${surface}-fixture.png`)});
 if(label==='dock'){
  await page.evaluate(()=>window.__fixture.emit('settings-changed',{key:'bloom-liquid-glass-dock',value:'false'}));
  await page.waitForFunction(()=>!document.body.dataset.liquidGlass);
  assert.equal(await page.locator('.liquid-glass-defs').count(),0);
  assert.equal(await page.locator('.dock-glass').evaluate(e=>e.style.getPropertyValue('--glass-scene')),'');
  const stoppedCount=await page.evaluate(()=>window.__fixture.calls.filter(c=>c.cmd==='dock_refraction_scene').length);
  await page.waitForTimeout(650);
  assert.equal(await page.evaluate(()=>window.__fixture.calls.filter(c=>c.cmd==='dock_refraction_scene').length),stoppedCount);
  const bg=await page.locator('.dock-glass').evaluate(e=>getComputedStyle(e).backgroundColor);assert.notEqual(bg,'rgba(0, 0, 0, 0)');
  await page.screenshot({path:path.join(out,'standard-dock-fixture.png')});
  await page.evaluate(()=>window.__fixture.emit('settings-external-changed',{key:'bloom-liquid-glass-dock',value:'true'}));
  await page.waitForFunction(()=>document.body.dataset.liquidGlass==='dock');
  assert.equal(await page.locator('.dock-glass').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 }
 if(label==='main'){await page.getByLabel('Open agent activity',{exact:true}).click();await page.getByRole('navigation',{name:'Notch panels'}).waitFor();await page.waitForTimeout(450);await page.screenshot({path:path.join(out,'liquid-glass-notch-expanded-fixture.png')});}
 const calls=await page.evaluate(()=>window.__fixture.calls.filter(c=>c.cmd==='set_liquid_glass_surfaces'));
 assert(calls.some(c=>c.args.rects?.length>0));results.push({surface,desktopMaterialBoundsReported:true,fullWidthBackdropRemoved:label==='dock'?true:undefined,optical});await page.close();
}
const settings=await context.newPage();await settings.addInitScript(setup,'settings');await settings.goto('http://127.0.0.1:4173/settings.html');await settings.getByRole('button',{name:'Appearance',exact:true}).click();
for(const [name,key]of [['Dock Liquid Glass','bloom-liquid-glass-dock'],['Notch Liquid Glass','bloom-liquid-glass-notch']]){const toggle=settings.getByRole('checkbox',{name,exact:true});assert(await toggle.isChecked());await toggle.locator("..").click();assert.equal(await settings.evaluate(k=>window.__fixture.settings[k],key),'false');await toggle.locator("..").click();assert.equal(await settings.evaluate(k=>window.__fixture.settings[k],key),'true');}
assert.equal(await settings.getByRole('checkbox',{name:'Start menu Liquid Glass',exact:true}).count(),0);
assert.equal(await settings.getByRole('checkbox',{name:'macOS window buttons',exact:true}).count(),0);

await settings.screenshot({path:path.join(out,'liquid-glass-settings-fixture.png')});assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({passed:true,source:'Production UI; native IPC mocked; wallpaper fixture behind surfaces',results,dockToggleStopsRefraction:true,dockToggleRestoresGlass:true,notchTogglePersists:true,startMaterial:"glassmorphism",trafficLightsRemoved:true,errors},null,2));await browser.close();console.log('PASS clear Liquid Glass dock, optional notch, frosted Start, no added window buttons or surrounding backdrop');
