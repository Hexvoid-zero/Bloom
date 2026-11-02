import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(import.meta.url),{chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const b=await chromium.connectOverCDP('http://127.0.0.1:49333');
const d=b.contexts().flatMap(c=>c.pages()).find(p=>p.url().endsWith('/dock.html'));if(!d)throw Error('Bloom dock missing');
await d.evaluate(()=>window.__TAURI_INTERNALS__.invoke('quit_bloom')).catch(e=>{if(!/closed|destroyed/i.test(String(e)))throw e;});
await b.close().catch(()=>{});console.log('Requested graceful Bloom exit');
