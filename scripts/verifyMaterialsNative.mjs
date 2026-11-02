import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
const pages=browser.contexts().flatMap(c=>c.pages());
const dock=pages.find(p=>p.url().endsWith('/dock.html'));
const settings=pages.find(p=>p.url().endsWith('/settings.html'));
const start=pages.find(p=>p.url().endsWith('/start.html'));
const notch=pages.find(p=>p.url()==='http://tauri.localhost/');
const invoke=(cmd,args)=>dock.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[cmd,args]);
const emit=(event,payload)=>invoke('plugin:event|emit',{event,payload});
const original=await invoke('load_settings');
try {
 await emit('dock-edge-hover',true);await dock.waitForTimeout(900);
 assert.equal(await dock.locator('.dock-backdrop').count(),0);
 const material=await dock.locator('.dock-glass').evaluate(e=>({color:getComputedStyle(e).backgroundColor,filter:getComputedStyle(e).backdropFilter}));
 assert.equal(material.color,'rgba(0, 0, 0, 0)');
 assert((await invoke('liquid_glass_status')).backend.includes('Transparent dock'));
 if(process.argv[2]==='background') {
  const rect=await dock.locator('.dock').boundingBox();assert(rect);
  const active=await invoke('get_active_app_appearance');
  let scene;for(let n=0;n<8;n++){scene=await invoke('dock_refraction_scene',{rect:{...rect,radius:18,flat_top:false}});if(scene?.image)break;await dock.waitForTimeout(500);}
  assert(scene?.image,'The controlled colored app should supply a real refraction strip');
  const stats=await dock.evaluate(async image=>{const img=new Image();img.src=image;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<p.length;i+=32)colors.add(`${p[i]>>4},${p[i+1]>>4},${p[i+2]>>4}`);return {width:c.width,height:c.height,colors:colors.size};},scene.image);
  assert(stats.colors>=6,JSON.stringify(stats));
  const gaps=await dock.locator('.dock-reorder-group .dock-icon-wrapper').evaluateAll(elements=>{const r=elements.map(e=>e.getBoundingClientRect());return r.slice(1).map((b,i)=>({x:(r[i].right+b.left)/2,y:b.top+b.height/2}));});
  await fs.writeFile(path.join(out,'native-refraction-scene.png'),Buffer.from(scene.image.split(',')[1],'base64'));
  await fs.writeFile(path.join(out,'native-material-sample-points.json'),JSON.stringify({rect,gaps,active,stats,material},null,2));
  await dock.screenshot({path:path.join(out,'native-clear-dock-renderer.png'),omitBackground:true});
  console.log('PASS actual foreground-app strip supplies the refractive rim',stats);
 } else {
  await invoke('open_settings_window');await settings.getByRole('button',{name:'Appearance',exact:true}).click();
  assert.equal(await settings.getByRole('checkbox',{name:'macOS window buttons',exact:true}).count(),0);
  assert.equal(await settings.getByRole('checkbox',{name:'Start menu Liquid Glass',exact:true}).count(),0);
  const toggle=settings.getByRole('checkbox',{name:'Notch Liquid Glass',exact:true});
  if(!await toggle.isChecked())await toggle.locator('..').click();
  let saved;for(let i=0;i<50;i++){saved=await invoke('load_settings');if(saved['bloom-liquid-glass-notch']==='true')break;await settings.waitForTimeout(100);}
  assert.equal(saved['bloom-liquid-glass-notch'],'true');
  await settings.screenshot({path:path.join(out,'native-material-settings.png')});
  await notch.waitForFunction(()=>document.body.dataset.liquidGlass==='notch');
  await notch.getByLabel('Open agent activity',{exact:true}).click();
  await notch.getByRole('navigation',{name:'Notch panels'}).waitFor();await notch.waitForTimeout(650);
  await notch.getByRole('region',{name:'Bloom top notch'}).screenshot({path:path.join(out,'native-glass-notch.png'),omitBackground:true});
  const collapse=notch.getByLabel('Collapse notch',{exact:true});if(await collapse.count())await collapse.click({timeout:1200}).catch(()=>{});
  await invoke('open_app',{appName:'start'});
  await start.waitForFunction(()=>document.body.dataset.glassmorphism==='start'&&!document.body.dataset.liquidGlass);
  await start.locator('.start-main').waitFor();await start.locator('.start-scroll').evaluate(e=>e.scrollTop=0);await start.waitForTimeout(1600);
  const frost=await start.locator('.start-main').evaluate(e=>getComputedStyle(e).backdropFilter);
  assert(frost.includes('blur(30px)')&&!frost.includes('url('));
  await start.screenshot({path:path.join(out,'native-glassmorphism-start.png'),omitBackground:true});
  await invoke('hide_bloom_start');
  await settings.getByRole('button',{name:'Close Settings',exact:true}).click();
  await fs.writeFile(path.join(out,'native-material-results.json'),JSON.stringify({passed:true,dockAlwaysClear:true,material,notchSettingPersists:true,startStyle:'frosted glassmorphism without refraction',trafficLightsRemoved:true,source:'Installed app and real native IPC; renderer interactions'},null,2));
  console.log('PASS clear dock, frosted Start, optional notch and removed traffic lights');
 }
} finally {
 await emit('dock-edge-hover',false).catch(()=>{});
 if(process.argv[2]!=='background')await invoke('save_setting',{key:'bloom-liquid-glass-notch',value:original['bloom-liquid-glass-notch']??'false'}).catch(()=>{});
 if(process.argv[2]!=='background')await invoke('hide_bloom_start').catch(()=>{});
 await browser.close();
}
