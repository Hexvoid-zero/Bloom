import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const out=process.env.BLOOM_EVIDENCE;await fs.mkdir(out,{recursive:true});
// Reuse the isolated, explicit native fixture used by the full Start verifier.
const source=await fs.readFile(new URL('./verifyStart.mjs',import.meta.url),'utf8');
const setup=source.slice(source.indexOf('function setup(label){'),source.indexOf('\nconst page=await context.newPage();'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const reports=[];
for(const [width,scale,kind='dense']of [[1920,1],[1280,1],[1280,1.5],[820,1.5],[1280,1,'sparse'],[820,1.5,'sparse']]){
 const page=await browser.newPage({viewport:{width,height:Math.ceil(480*scale)}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const prefs=kind==='dense'?{left:['cpu','ram','net'],right:['battery','disk']}:{left:[],right:['battery']};
 await page.addInitScript({content:`(${setup})('main'); __fixture.settings['bloom-scale']='${scale}'; localStorage.setItem('bloom-scale','${scale}'); __fixture.settings['bloom-status-widgets']=${JSON.stringify(JSON.stringify(prefs))}; localStorage.setItem('bloom-status-widgets',__fixture.settings['bloom-status-widgets']);`});
 await page.goto('http://127.0.0.1:4173/');await page.waitForTimeout(500);await page.evaluate(()=>__fixture.emit('splash-done',null));await page.waitForTimeout(2800);
 const notch=page.getByRole('region',{name:'Bloom top notch'});await notch.hover();
 const measure=()=>page.evaluate(()=>{
  const row=[...document.querySelectorAll('.main-row-inner')].find(e=>getComputedStyle(e).visibility!=='hidden');
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  if(!row)return null;
  const clock=rect(row.querySelector('.time-center')),left=rect(row.querySelector('.side-content.left')),right=rect(row.querySelector('.side-content.right'));
  const items=[...row.querySelectorAll('.notch-companion-button,.passive-feature,.notch-agent-indicator')].map(e=>{
   const own=rect(e),clip=rect(e.closest('.side-content'));
   return {className:e.className,...own,paintLeft:Math.max(own.left,clip.left),paintRight:Math.min(own.right,clip.right)};
  });
  return {clock,left,right,items};
 });
 // Inspect the expansion as well as its settled layout.
 for(let frame=0;frame<12;frame++){
  const r=await measure();assert(r);
  assert(r.left.right<=r.clock.left+1);assert(r.right.left>=r.clock.right-1);
  for(const item of r.items){if(item.paintRight<=item.paintLeft)continue;assert(item.paintRight<=r.clock.left+1||item.paintLeft>=r.clock.right-1,JSON.stringify(item));}
  await page.waitForTimeout(35);
 }
 await page.waitForTimeout(500);const result=await measure();
 assert.equal(result.items.filter(i=>i.className==='passive-feature').length,kind==='dense'?5:1);
 const box=await notch.boundingBox();assert(box.x>=-1&&box.x+box.width<=width+1);
 const shortcuts=await page.locator('.notch-quick-controls button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {left:r.left,right:r.right,scroll:b.scrollWidth,client:b.clientWidth};}));
 assert.equal(shortcuts.length,4);for(const [i,b]of shortcuts.entries()){assert(b.left>=box.x&&b.right<=box.x+box.width);assert(b.scroll<=b.client+1);if(i)assert(b.left>=shortcuts[i-1].right);}
 await notch.screenshot({path:path.join(out,`notch-no-overlap-${width}-${scale}${kind==='sparse'?'-sparse':''}.png`),omitBackground:true});
 // Tooltip must escape the scrolling track and remain beyond the notch.
 await page.evaluate(()=>{window.__tipEvents=[];for(const e of document.querySelectorAll('.passive-feature')){e.addEventListener('mouseenter',()=>__tipEvents.push('enter:'+e.textContent));e.addEventListener('mouseleave',()=>__tipEvents.push('leave:'+e.textContent));}});await page.locator('.passive-feature').first().hover();await page.waitForTimeout(650);console.log(JSON.stringify(await page.evaluate(()=>({tips:document.querySelectorAll('.status-tooltip').length,events:__tipEvents,errors:__fixture.calls.filter(c=>c.cmd==='set_notch_hovered').slice(-3)}))));
 const tooltip=page.locator('body > .status-tooltip');await tooltip.waitFor({state:'visible'});
 const tip=await tooltip.boundingBox();assert(tip.y>=box.y+box.height-1);
 await page.screenshot({path:path.join(out,`notch-tooltip-${width}-${scale}.png`),omitBackground:true});
 assert.deepEqual(errors,[]);reports.push({width,scale,kind,passed:true,expansionFrames:12,layout:result,shortcuts,tooltip:tip,errors});await page.close();
}
await fs.writeFile(path.join(out,'overlap-results.json'),JSON.stringify(reports,null,2));
await browser.close();console.log('PASS: no clock/companion/widget/badge overlap through expansion in 4 width/scale scenarios; tooltips preserved');
