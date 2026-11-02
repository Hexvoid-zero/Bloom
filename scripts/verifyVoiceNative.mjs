// Calls Bloom's own local IPC surface. Native UI/screenshot verification uses Sky separately.
import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
try{
 const pages=browser.contexts().flatMap(c=>c.pages());let main;
 for(const page of pages){try{const label=await page.evaluate(()=>window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label);if(label==='main'){main=page;break;}}catch{}}
 assert(main,'Native notch IPC target missing');
 const call=(cmd,args={})=>main.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
 const mode=process.argv[2]||'transcribe';
 if(mode==='transcribe'){
  assert((await call('voice_status')).ready,'Local engine is not provisioned in the installed profile');
  const target=await call('begin_voice_session');assert.match(target.title,/Bloom voice writing verification/);
  const bytes=await fs.readFile(path.join(out,'jfk.wav'));
  const text=await call('transcribe_voice',{session:target.session,audio:bytes.toString('base64'),language:'en',prompt:'Bloom'});assert.match(text,/country can do for you/i);
  await call('insert_voice_text',{session:target.session,text});
  const pins=await call('load_pinned_apps');
  await fs.writeFile(path.join(out,'native-ipc-results.json'),JSON.stringify({passed:true,localEngineReady:true,actualNativeTranscription:true,originalWritingTarget:true,nativeInsertionCommandSucceeded:true,transcript:text,pins:pins.length},null,2));
  console.log('PASS installed native speech engine, transcription and writing-target insertion');
 }else if(mode==='devices'){const fake=await main.evaluate(async()=>(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput').some(d=>/fake/i.test(d.label)));console.log(JSON.stringify({fakeAudioDevice:fake}));if(!fake)throw new Error('Controlled fake microphone was not detected');
 }else if(mode==='left'||mode==='right'){
  await call('save_setting',{key:'bloom-sidebar-preferences',value:JSON.stringify({enabled:true,side:mode,mode:'always',expanded:true,night:false})});console.log('Sidebar placement set for native screenshot:',mode);
 }else if(mode==='settings'){
  await call('open_settings_window');console.log('Native Settings opened');
 }else if(mode==='voice'){
  await call('show_voice_panel');console.log('Native Voice opened without recording');
 }else if(mode==='restore'){
  const before=JSON.parse(await fs.readFile(path.join(out,'before.json'),'utf8'));
  await call('save_setting',{key:'bloom-sidebar-preferences',value:JSON.stringify({enabled:true,side:'left',mode:'smart',expanded:false,night:false})});
  await call('save_setting',{key:'bloom-voice-shortcut',value:'ctrl-z'});
  if(before.settings['bloom-notch-last-panel'])await call('save_setting',{key:'bloom-notch-last-panel',value:before.settings['bloom-notch-last-panel']});
  const current=await call('load_pinned_apps');assert.deepEqual(current.map(a=>a.path),before.pins.map(a=>a.path));
  console.log('PASS ordered pins preserved and test display preferences restored');
 }else if(mode==='quit'){
  await call('quit_bloom').catch(()=>{});console.log('Graceful Bloom shutdown requested');
 }else throw new Error('Unknown native verification mode');
}finally{await browser.close().catch(()=>{});}
