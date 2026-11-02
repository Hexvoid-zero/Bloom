// Three stages around a packaged WebView keyboard check on a real unsaved network. Network changes are blocked.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
const main=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost')&&p.url().endsWith('/'));
try{
 const mode=process.argv[2];assert(['prepare','check','finish','all'].includes(mode));
 if(mode==='prepare'||mode==='all'){
  const candidate=await main.evaluate(async()=>{const networks=await window.__TAURI_INTERNALS__.invoke('wifi_list_networks');return networks.networks.find(n=>!n.saved&&!n.connected&&['wpa','wpa2','wpa3'].includes(n.security));});
  assert(candidate,'A visible unsaved personal network is required for this non-connecting check');
  const before=await main.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_wifi_status'));
  await main.evaluate(()=>{
   if(window.__bloomWifiRealInvoke)throw Error('Keyboard fixture already installed');
   window.__bloomWifiRealInvoke=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=(cmd,args)=>{
    if(['wifi_connect','wifi_disconnect','wifi_forget','set_wifi_state'].includes(cmd))return Promise.reject('Network changes are blocked during keyboard verification');
    return window.__bloomWifiRealInvoke(cmd,args);
   };
  });
  await main.evaluate(value=>window.__bloomWifiKeyboardBeforeStatus=value,before);
  await main.getByLabel('Open agent activity',{exact:true}).click();await main.getByRole('button',{name:'Controls',exact:true}).click();await main.waitForTimeout(700);await main.getByRole('button',{name:'Wi-Fi',exact:true}).click();
  await main.getByText(candidate.ssid,{exact:true}).click();
  await main.getByLabel('Wi-Fi password',{exact:true}).waitFor();await main.waitForTimeout(500);
  assert(await main.evaluate(()=>document.hasFocus()),'Native notch takes focus for the password');
  console.log('READY: real unsaved network; password field focused; network changes blocked');
 }
 if(mode==='all')await main.keyboard.type('bloom-keyboard-check');
 if(mode==='check'||mode==='all'){
  assert.equal(await main.getByLabel('Wi-Fi password',{exact:true}).inputValue(),'bloom-keyboard-check');
  await main.getByRole('region',{name:'Bloom top notch'}).screenshot({path:path.join(process.env.BLOOM_EVIDENCE,'native-wifi-keyboard.png'),omitBackground:true});
  console.log('PASS renderer keyboard events reached packaged password field; no connection attempted');
 }
 if(mode==='all')await main.keyboard.press('Escape');
 if(mode==='finish'||mode==='all'){
  try{
   assert.equal(await main.getByLabel('Wi-Fi password',{exact:true}).count(),0,'Escape closes password entry');
   const unchanged=await main.evaluate(async()=>JSON.stringify(await window.__bloomWifiRealInvoke('get_wifi_status'))===JSON.stringify(window.__bloomWifiKeyboardBeforeStatus));assert(unchanged,'Radio and current connection unchanged');
   await fs.writeFile(path.join(process.env.BLOOM_EVIDENCE,'native-wifi-keyboard-results.json'),JSON.stringify({passed:true,source:'Packaged WebView2 + renderer keyboard events; real unsaved network, mutations blocked. Computer Use could not target the overlay window.',physicalTyping:false,typingReceived:true,escapeClosesInput:true,focusRestoration:'Not independently verified: CDP can emulate document focus',noNetworkChanges:true},null,2));
   console.log('PASS password entry and Escape cleanup; current Wi-Fi connection unchanged');
  }finally{
   await main.evaluate(async()=>{const real=window.__bloomWifiRealInvoke;if(real){await real('set_notch_keyboard_input',{enabled:false});window.__TAURI_INTERNALS__.invoke=real;delete window.__bloomWifiRealInvoke;}});
   await main.reload();
  }
 }
}finally{await browser.close();}
