import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
try{
 const main=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost')&&p.url().endsWith('/'));
 await main.getByLabel('Open agent activity',{exact:true}).waitFor();await main.getByLabel('Open agent activity',{exact:true}).click();
 await main.getByRole('button',{name:'Controls',exact:true}).click();
 const controls=main.getByRole('region',{name:'Windows quick controls'});await controls.scrollIntoViewIfNeeded();
 assert.equal(await controls.locator('button').count(),12);
 await main.waitForTimeout(350);
 await main.getByRole('region',{name:'Bloom top notch'}).screenshot({path:path.join(process.env.BLOOM_EVIDENCE,'native-system-controls.png'),omitBackground:true});
 const fits=await controls.evaluate(section=>{const p=section.closest('.command-center-content-minimal').getBoundingClientRect();return [...section.querySelectorAll('button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;});});assert(fits);
 await main.getByLabel('Collapse notch',{exact:true}).click();await main.getByRole('region',{name:'Bloom top notch'}).hover();await main.waitForTimeout(600);
 const fit=await main.getByRole('region',{name:'Bloom top notch'}).evaluate(pill=>{const p=pill.getBoundingClientRect();const rows=[...pill.querySelectorAll('.notch-quick-controls button')].map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,scroll:b.scrollWidth,client:b.clientWidth};});return {left:p.left,right:p.right,rows};});
 assert(fit.rows.length>=3);for(const b of fit.rows){assert(b.left>=fit.left&&b.right<=fit.right);assert(b.scroll<=b.client+1);}
 await main.getByRole('region',{name:'Bloom top notch'}).screenshot({path:path.join(process.env.BLOOM_EVIDENCE,'native-hover-controls-fit.png'),omitBackground:true});
 await main.screenshot({path:path.join(process.env.BLOOM_EVIDENCE,'native-transparent-surface.png'),omitBackground:true});
 await fs.writeFile(path.join(process.env.BLOOM_EVIDENCE,'native-controls-results.json'),JSON.stringify({passed:true,controls:12,horizontalFit:true,hoverButtonsFit:true,transparentDocument:await main.evaluate(()=>getComputedStyle(document.body).backgroundColor),source:'Packaged WebView2, real controls UI; no OS setting changes'},null,2));
 await main.mouse.move(10,460);
 console.log('PASS native quick controls and hover shortcut bounds');
}finally{await browser.close();}
