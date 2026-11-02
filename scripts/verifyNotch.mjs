// Browser regression checks: real production UI with isolated mock native IPC.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.BLOOM_TEST_TOOLS, 'playwright'));
const output = process.env.BLOOM_EVIDENCE;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 480 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const setup = (label) => {
  const settings = {'bloom-notch-mode':'overlay','bloom-scale':'1','bloom-dock-enabled':'false','bloom-first-run':'done','bloom-app-version':'3.10.0','bloom-weather-enabled':'false','bloom-corners-enabled':'false'};
  Object.entries(settings).forEach(([key,value]) => localStorage.setItem(key,value));
  localStorage.setItem('bloom-announcement-cache-at',String(Date.now()));
  let id = 0;
  const callbacks = new Map(), listeners = new Map();
  window.__fixture = { calls: [], emit(event,payload) { for (const [key,listener] of listeners) if(listener.event===event) callbacks.get(listener.handler)?.({event,payload,id:key}); } };
  window.__TAURI_INTERNALS__ = {
    metadata: {currentWindow:{label},currentWebview:{label}},
    transformCallback(callback) { callbacks.set(++id,callback); return id; },
    unregisterCallback(key) { callbacks.delete(key); },
    async invoke(cmd,args={}) {
      window.__fixture.calls.push({cmd,args});
      if(cmd==='load_settings') return settings;
      if(cmd==='plugin:event|listen') { listeners.set(++id,args); return id; }
      if(cmd==='plugin:event|emit') { window.__fixture.emit(args.event,args.payload); return; }
      if(cmd==='plugin:event|unlisten') return listeners.delete(args.eventId);
      if(cmd==='plugin:window|is_visible') return true;
      if(cmd==='plugin:app|version') return '3.10.0';
      if(cmd==='plugin:app|identifier') return 'com.sehaz.bloom.macdock';
      if(cmd==='get_volume_state') return {volume:.5,is_muted:false};
      if(cmd==='get_brightness') return 60;
      if(cmd==='get_wifi_status') return {enabled:true,connected:true,ssid:'Test network'};
      if(cmd==='get_bluetooth_state') return true;
      if(cmd==='get_battery_saver_state') return false;
      if(cmd==='get_audio_sessions') return [{pid:100,name:'Chrome',volume:.5,is_muted:false},{pid:101,name:'Music',volume:.7,is_muted:false}];
      if(cmd==='get_network_speed') return [0,0];
      if(cmd==='get_cpu_usage'||cmd==='get_ram_usage'||cmd==='get_disk_space') return 25;
      if(cmd==='get_agent_sessions') return [];
      if(cmd==='load_shelf_items'||cmd==='get_bluetooth_devices'||cmd==='get_connected_bluetooth_devices'||cmd==='plugin:window|get_all_windows') return [];
      if(cmd==='save_setting') {settings[args.key]=args.value; return;}
      return null;
    }
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(){}};
};
await page.addInitScript(setup, 'main');
await page.goto('http://127.0.0.1:4173/');
await page.addStyleTag({content:'body { background: radial-gradient(ellipse at 25% 30%, #294dd7, #12245f); }'});
await page.waitForTimeout(1000);
await page.evaluate(()=>window.__fixture.emit('splash-done',null));
await page.waitForTimeout(2600);
const notch = page.getByRole('region',{name:'Bloom top notch'});
await notch.waitFor({state:'visible'});
let resting=await notch.boundingBox();
assert(resting.y>=-1 && resting.y<1,JSON.stringify(resting));
assert(resting.width>=130 && resting.height>=35);
assert.equal(await page.locator('.mac-menu-bar').count(),0);
await page.screenshot({path:path.join(output,'notch-resting.png'),omitBackground:true});
await notch.hover();
await page.getByRole('button',{name:'Open volume controls',exact:true}).click();
await page.waitForTimeout(700);
await page.getByLabel('Master volume',{exact:true}).press('ArrowRight');
await page.getByLabel('Display brightness',{exact:true}).press('ArrowRight');
await page.waitForTimeout(120);
let calls=await page.evaluate(()=>window.__fixture.calls);
assert(calls.some(c=>c.cmd==='set_volume'));
assert(calls.some(c=>c.cmd==='set_brightness'));
await page.screenshot({path:path.join(output,'notch-controls.png'),omitBackground:true});
await page.getByRole('button',{name:'App volumes',exact:true}).click();
await page.getByLabel('Chrome volume',{exact:true}).waitFor();
await page.getByLabel('Chrome volume',{exact:true}).press('ArrowRight');
await page.getByRole('button',{name:'Mute Music',exact:true}).click();
await page.waitForTimeout(150);
calls=await page.evaluate(()=>window.__fixture.calls);
assert(calls.some(c=>c.cmd==='set_app_volume' && c.args.pid===100));
assert(calls.some(c=>c.cmd==='set_app_mute' && c.args.pid===101 && c.args.muted));
const mixer=await notch.boundingBox();
assert(mixer.y<1 && mixer.y+mixer.height<=480);
await page.screenshot({path:path.join(output,'notch-app-mixer.png'),omitBackground:true});
await page.mouse.move(30,300);
await page.waitForTimeout(1600);
await page.evaluate(()=>window.__fixture.emit('volume-change',{volume:.42,is_muted:false}));
await page.getByLabel('Notch volume',{exact:true}).waitFor({state:'visible'});
await page.screenshot({path:path.join(output,'notch-volume-hud.png'),omitBackground:true});
await page.evaluate(()=>window.__fixture.emit('brightness-change',{brightness:72}));
await page.getByLabel('Notch brightness',{exact:true}).waitFor({state:'visible'});
await page.screenshot({path:path.join(output,'notch-brightness-hud.png'),omitBackground:true});
await page.waitForTimeout(2900);
await page.locator('.notch-system-hud').waitFor({state:'detached'});
await page.getByRole('region',{name:'Bloom top notch'}).waitFor({state:'visible'});
assert.deepEqual(errors,[]);
const overlay=await browser.newPage({viewport:{width:1920,height:1080}});
await overlay.addInitScript(setup,'overlay');
await overlay.goto('http://127.0.0.1:4173/overlay.html');
await overlay.waitForTimeout(500);
await overlay.evaluate(()=>{window.__fixture.emit('volume-change',{volume:.8,is_muted:false});window.__fixture.emit('brightness-change',{brightness:80});window.__fixture.emit('volume-edge-hover',true);window.__fixture.emit('brightness-edge-hover',true);});
await overlay.waitForTimeout(300);
assert.equal(await overlay.locator('.volume-notch-wrapper,.brightness-notch-wrapper').count(),0);
const regions=await overlay.evaluate(()=>window.__fixture.calls.filter(c=>c.cmd==='set_window_region'));
assert(regions.length && regions.at(-1).args.rects.length===0);
await fs.writeFile(path.join(output,'notch-browser-verification.json'),JSON.stringify({passed:true,resting,mixer,masterVolume:true,brightness:true,appVolume:true,appMute:true,volumeHud:true,brightnessHud:true,topBarRemoved:true,sidePanelsRemoved:true,errors},null,2));
await browser.close();
console.log('PASS: visible edge notch, master volume, brightness, app mixer/mute, key HUDs, no top bar or side panels');
