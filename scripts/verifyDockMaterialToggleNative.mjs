import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;await fs.mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
const pages=browser.contexts().flatMap(c=>c.pages());
const dock=pages.find(p=>p.url().endsWith('/dock.html'));
const settings=pages.find(p=>p.url().endsWith('/settings.html'));
const invoke=(c,a)=>dock.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[c,a]);
const phase=process.argv[2]??'off';
try {
 await invoke('plugin:event|emit',{event:'dock-edge-hover',payload:true});
 await invoke('open_settings_window');
 await settings.getByRole('button',{name:'Appearance',exact:true}).click();
 const toggle=settings.getByRole('checkbox',{name:'Dock Liquid Glass',exact:true});
 if(phase==='off'){
  const original=(await invoke('load_settings'))['bloom-liquid-glass-dock']??'true';
  await fs.writeFile(path.join(out,'original-dock-material.json'),JSON.stringify({value:original}));
  if(!await toggle.isChecked())await toggle.locator('..').click();
  await dock.waitForFunction(()=>document.body.dataset.liquidGlass==='dock');
  await toggle.locator('..').click();
 }else{
  assert.equal(await toggle.isChecked(),false,'Off preference must survive a full app process restart');
 }
 await dock.waitForFunction(()=>!document.body.dataset.liquidGlass);
 assert.equal((await invoke('load_settings'))['bloom-liquid-glass-dock'],'false');
 assert.equal(await dock.locator('.liquid-glass-defs').count(),0);
 assert.equal(await dock.locator('.dock-glass').evaluate(e=>e.style.getPropertyValue('--glass-scene')),'');
 const standard=await dock.locator('.dock-glass').evaluate(e=>getComputedStyle(e).backgroundColor);
 assert.notEqual(standard,'rgba(0, 0, 0, 0)');
 await dock.waitForTimeout(700);
 await settings.screenshot({path:path.join(out,`settings-dock-glass-${phase}.png`)});
 await dock.screenshot({path:path.join(out,`dock-standard-${phase}.png`),omitBackground:true});
 if(phase==='restore'){
  await toggle.locator('..').click();
  await dock.waitForFunction(()=>document.body.dataset.liquidGlass==='dock');
  assert.equal((await invoke('load_settings'))['bloom-liquid-glass-dock'],'true');
  assert.equal(await dock.locator('.dock-glass').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  await settings.screenshot({path:path.join(out,'settings-dock-glass-on.png')});
  await dock.screenshot({path:path.join(out,'dock-liquid-glass-on.png'),omitBackground:true});
  const original=JSON.parse(await fs.readFile(path.join(out,'original-dock-material.json'),'utf8'));
  if(original.value!=='true')await toggle.locator('..').click();
  await fs.writeFile(path.join(out,'dock-toggle-results.json'),JSON.stringify({passed:true,offUsesStandardDock:true,offRemovesOpticalDefinitions:true,offClearsCapturedStrip:true,persistedAcrossProcessRestart:true,onRestoresTransparentGlass:true,originalPreferenceRestored:true},null,2));
 }
 await settings.getByRole('button',{name:'Close Settings',exact:true}).click();
 console.log(`PASS dock material toggle: ${phase}`);
}finally{
 await invoke('plugin:event|emit',{event:'dock-edge-hover',payload:false}).catch(()=>{});
 await browser.close();
}
