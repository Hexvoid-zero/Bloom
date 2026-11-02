// Save the user's current layout unchanged, then verify it after a real process restart.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
let browser;for(let i=0;i<20;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:49333');break;}catch(e){if(i===19)throw e;await new Promise(r=>setTimeout(r,500));}}
try{
 let dock;for(let i=0;i<30;i++){dock=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/dock.html'));if(dock)break;await new Promise(r=>setTimeout(r,500));}
 const invoke=(cmd,args)=>dock.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[cmd,args]);
 const out=process.env.BLOOM_EVIDENCE;
 const pins=await invoke('load_pinned_apps');const ids=pins.map(p=>[p.path,p.name]);
 const disk=path.join(process.env.USERPROFILE,'.bloom-macdock/pinned_apps.json');
 if(process.argv[2]==='record'){
  await invoke('save_pinned_apps',{apps:pins});
  const stored=JSON.parse(await fs.readFile(disk,'utf8'));assert.deepEqual(stored.map(p=>[p.path,p.name]),ids);
  await fs.writeFile(path.join(out,'native-persistence-baseline.json'),JSON.stringify({ids,pins:pins.length},null,2));
  console.log(`Recorded ${pins.length} pins in their current order, without changing the layout`);
 }else{
  const before=JSON.parse(await fs.readFile(path.join(out,'native-persistence-baseline.json'),'utf8'));
  assert.deepEqual(ids,before.ids,'The new process must restore the same ordered layout');
  assert(await fs.stat(path.join(process.env.USERPROFILE,'.bloom-macdock/pinned_apps.backup.json')));
  await dock.reload();await dock.locator('.dock-reorder-group').waitFor();await dock.waitForTimeout(1600);
  assert.equal(await dock.locator('.dock-reorder-group > div').count(),pins.length);
  await dock.locator('.dock').screenshot({path:path.join(out,'native-pins-after-restart.png'),omitBackground:true});
  await fs.writeFile(path.join(out,'native-persistence-results.json'),JSON.stringify({passed:true,pins:pins.length,orderRestored:true,backupExists:true,userLayoutUnchanged:true,source:'Real installed app save + process restart + disk and rendered count check',path:disk},null,2));
  console.log(`PASS ${pins.length} pins and exact order restored in a fresh app process`);
 }
}finally{await browser.close();}
