// An isolated, blank desktop window for photographing the native overlay.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const stop=path.join(process.env.LOCALAPPDATA,'bloom-build','close-native-canvas.flag');
await fs.rm(stop,{force:true});
const browser=await chromium.launch({channel:'chrome',headless:false,args:['--start-maximized']});
const context=await browser.newContext({viewport:null});
const page=await context.newPage();
await page.setContent('<!doctype html><title>Bloom desktop verification</title><style>body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 25% 20%,#294dd7,#12245f);color:#dce3ff;font:14px Segoe UI;display:grid;place-items:center}p{opacity:.7}</style><p>Bloom native overlay verification</p>');
console.log('Native desktop canvas ready');
while(!(await fs.stat(stop).catch(()=>null))) await new Promise(resolve=>setTimeout(resolve,500));
await browser.close();
await fs.rm(stop,{force:true});
