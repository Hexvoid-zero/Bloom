// Real packaged IPC + installed metadata relay. No agent prompts or tools are run.
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.BLOOM_TEST_TOOLS,'playwright'));
const browser=await chromium.connectOverCDP('http://127.0.0.1:49333');
const pages=browser.contexts().flatMap(c=>c.pages());
const dock=pages.find(p=>p.url().endsWith('/dock.html'));
const start=pages.find(p=>p.url().endsWith('/start.html'));
const invoke=(command,args)=>dock.evaluate(([c,a])=>window.__TAURI_INTERNALS__.invoke(c,a),[command,args]);
const helper=path.join(process.env.LOCALAPPDATA,'BloomMacDock/bin/bloom-agent-hook.exe');
const fixtures=[];const results=[];
const hash=value=>{let h=0xcbf29ce484222325n;for(const b of Buffer.from(value))h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);return h.toString(16).padStart(16,'0');};
try{
 const before=await invoke('get_agent_hook_integrations');
 for(const item of before.filter(p=>p.detected)){
  const connected=await invoke('connect_agent_hooks',{provider:item.provider});assert(connected.connected);
  results.push(connected);
 }
 assert(results.length>0,'At least one detected native integration connected');
 const info=await invoke('agent_bridge_info');
 for(const [provider,begin,end] of [['antigravity','PreInvocation','Stop'],['cursor','beforeSubmitPrompt','stop'],['gemini','BeforeAgent','AfterAgent']]){
  const session=`bloom-adapter-verification-${Date.now()}-${provider}`;
  const id=`${provider}:${session}`;
  const fixture=path.join(info.event_directory,`native-${hash(id)}.jsonl`);fixtures.push(fixture);
  const payload={session_id:session,conversationId:session,workspace_roots:[process.cwd()],cwd:process.cwd(),prompt:'PRIVATE TEST CONTENT MUST NOT BE STORED',tool_input:{secret:'PRIVATE TOOL INPUT'}};
  const run=event=>{const child=spawnSync(helper,['--agent-hook',provider,event],{input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(child.status,0);assert.equal(child.stdout,provider==='cursor'?'':'{}');assert.equal(child.stderr,'');};
  const wait=async status=>{for(let i=0;i<40;i++){const sessions=await invoke('get_agent_sessions');if(sessions.some(s=>s.id===`hook:${id}`&&s.status===status))return;await new Promise(r=>setTimeout(r,500));}throw Error(`${provider} relay never reached ${status}`);};
  run(begin);await wait('working');run(end);await wait('completed');
  const journal=await fs.readFile(fixture,'utf8');assert(!journal.includes('PRIVATE'));assert(!journal.includes('tool_input'));assert.equal(journal.trim().split('\n').length,2);
 }
 await invoke('open_app',{appName:'start'});await start.getByRole('button',{name:'Agents',exact:true}).click();
 await start.getByLabel('Agent integration help',{exact:true}).click();await start.getByText('Live connections',{exact:true}).waitFor();
 await start.waitForTimeout(600);await start.screenshot({path:path.join(process.env.BLOOM_EVIDENCE,'native-live-connections.png'),omitBackground:true});
 await fs.writeFile(path.join(process.env.BLOOM_EVIDENCE,'native-hook-results.json'),JSON.stringify({passed:true,connected:results,relayProvidersVerified:['Antigravity','Cursor','Gemini'],transitions:['working','completed'],privatePayloadExcluded:true,source:'Installed relay stdin + packaged native IPC; synthetic metadata only'},null,2));
 console.log('PASS native integration merges, installed relay for 3 providers, working/completed transitions and private payload exclusion');
}finally{
 for(const fixture of fixtures)await fs.rm(fixture,{force:true});
 await invoke('hide_bloom_start').catch(()=>{});await browser.close();
}
