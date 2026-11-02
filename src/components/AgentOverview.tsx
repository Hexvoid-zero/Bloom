import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, ArrowUpRight, RefreshCw, CircleHelp } from "lucide-react";
import "./AgentOverview.css";

export interface AgentSession {
 id: string; agent: string; project: string; status: string; detail: string;
 updated_at: number; path: string; source?: string;
}
interface HookIntegration {provider:string;detected:boolean;connected:boolean;detail:string;config_path:string;backup_path:string|null}
function AgentConnections(){
 const [items,setItems]=useState<HookIntegration[]>([]);
 const [busy,setBusy]=useState("");
 const [error,setError]=useState("");
 useEffect(()=>{let alive=true;invoke<HookIntegration[]>("get_agent_hook_integrations").then(value=>{if(alive)setItems(value);}).catch(()=>{if(alive)setError("Live connections are temporarily unavailable.");});return()=>{alive=false;};},[]);
 const change=async(item:HookIntegration)=>{setBusy(item.provider);setError("");try{const updated=await invoke<HookIntegration>(item.connected?"disconnect_agent_hooks":"connect_agent_hooks",{provider:item.provider});setItems(previous=>previous.map(p=>p.provider===updated.provider?updated:p));}catch(e){setError(String(e));}finally{setBusy("");}};
 return <div className="agent-connections"><strong>Live connections</strong><p>Connect native hooks for precise activity. Bloom preserves existing hooks and saves a backup before changes. Restart the agent after connecting.</p>{items.map(item=><div className="agent-connection" key={item.provider}><div><b>{item.provider}</b><small>{item.detail}</small>{item.backup_path&&<small title={item.backup_path}>Backup saved</small>}</div><button disabled={!!busy} onClick={()=>void change(item)}>{busy===item.provider?"Updating…":item.connected?"Disconnect":"Connect"}</button></div>)}{error&&<p role="alert">{error}</p>}</div>;
}
export function useAgentSessions(enabled = true) {
 const [sessions,setSessions]=useState<AgentSession[]>([]);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!enabled){setSessions([]);return;}
  let alive=true, busy=false;
  const refresh=async()=>{if(busy)return;busy=true;try{const s=await invoke<AgentSession[]>("get_agent_sessions");if(alive){setSessions(s.map(x=>({...x,status:x.status==="needs-attention"?"waiting":x.status})));setError("");}}catch{if(alive)setError("Agent activity is temporarily unavailable.");}finally{busy=false;}};
  void refresh();const timer=setInterval(refresh,4000);return()=>{alive=false;clearInterval(timer);};
 },[enabled]);
 return {sessions,error};
}
export function AgentCompanion({active=false}: {active?:boolean}) {
 return <span className={`agent-companion ${active?"awake":""}`} aria-hidden="true"><img src="/bloom-mark.svg" alt=""/></span>;
}
export function agentStatusLabel(s: string) { return ({working:"Working",running:"Working",waiting:"Needs attention",completed:"Finished",idle:"Idle",stale:"No recent update",unknown:"Status unavailable","app-open":"App open"} as Record<string,string>)[s] || s; }
export function AgentOverview({sessions,error="",compact=false}:{sessions:AgentSession[];error?:string;compact?:boolean}) {
 const [selected,setSelected]=useState<string|null>(null);
 const [help,setHelp]=useState(false);
 const [showAll,setShowAll]=useState(false);
 const [coverage,setCoverage]=useState<{provider:string;detected_locally:boolean;running:boolean;activity_source:string}[]>([]);
 useEffect(()=>{if(!help)return;let alive=true;invoke<{provider_coverage?:typeof coverage}>("agent_bridge_info").then(info=>{if(alive)setCoverage(info?.provider_coverage??[]);}).catch(()=>{});return()=>{alive=false;};},[help]);
 const [actionError,setActionError]=useState("");
 const working=sessions.filter(s=>s.status==="working"||s.status==="running").length;
 const waiting=sessions.filter(s=>s.status==="waiting").length;
 const appsOpen=sessions.filter(s=>s.status==="app-open").length;
 return <div className={`agent-overview ${compact?"compact":""}`}>
  <div className="agent-section-heading"><div><span className="eyebrow">LIVE WORKSPACE</span><h3>Agent activity <span>{sessions.length}</span></h3></div><button className="agent-help" aria-label="Agent integration help" onClick={()=>setHelp(!help)}><CircleHelp size={17}/></button></div>
  <div className="agent-summary"><span><i className="status-dot working"/>{working} working</span><span><i className="status-dot waiting"/>{waiting} need you</span>{appsOpen>0&&<span><i className="status-dot app-open"/>{appsOpen} apps open</span>}<span>Local · refreshes every 4s</span></div>
  {help && <div className="agent-help-text">Supported local logs report session activity; running AI tools without a readable session show “App open”. Any tool can report exact activity through Bloom’s local hook file. A running app alone never counts as a working agent. <AgentConnections/><button onClick={()=>invoke("open_agent_integration_folder").catch(()=>setActionError("Could not open the integration folder."))}>Open hook guide <ArrowUpRight size={12}/></button>{coverage.length>0&&<div className="agent-coverage"><strong>Agent detection coverage</strong>{coverage.map(p=><div key={p.provider}><span>{p.provider}</span><small>{p.running?"Running":p.detected_locally?"Local data detected":"Not detected"}</small><em>{p.activity_source}</em></div>)}</div>}</div>}
  {error && <p role="alert">{error}</p>}{actionError&&<p role="alert">{actionError}</p>}
  {!sessions.length&&!error&&<div className="agent-empty"><Bot size={26}/><strong>Ready when your agents are.</strong><p>Start a Codex or Claude Code session. Its activity will appear here automatically.</p></div>}
  <div className="agent-session-list">{(compact&&!showAll?sessions.slice(0,6):sessions).map(s=><div className={`agent-session ${selected===s.id?"selected":""}`} key={s.id}>
   <button className="agent-session-main" onClick={()=>setSelected(selected===s.id?null:s.id)} aria-expanded={selected===s.id}>
    <span className={`agent-avatar ${s.agent.toLowerCase().split(" ")[0]}`}><Bot size={18}/></span>
    <span className="agent-session-text"><strong>{s.project || "Workspace"}</strong><span>{s.agent} <b>·</b> {s.detail || agentStatusLabel(s.status)}</span></span>
    <span className={`agent-state ${s.status}`}><i className={`status-dot ${s.status}`}/>{agentStatusLabel(s.status)}</span>
   </button>
   {selected===s.id&&<div className="agent-session-detail"><p>{s.detail}</p><small>{s.source === "process" ? "Detected running app. Working state is unavailable." : `Source: ${s.source || "local session event"}`}</small><br/><small>Last update {new Date(s.updated_at < 1e12 ? s.updated_at*1000:s.updated_at).toLocaleString()}</small><code>{s.path}</code>{s.path&&<button onClick={()=>invoke("open_agent_session",{sessionId:s.id}).catch(()=>setActionError("Could not open this session’s workspace."))}>Open workspace <ArrowUpRight size={13}/></button>}</div>}
  </div>)}</div>
  {compact&&sessions.length>6&&<button className="agent-show-all" onClick={()=>setShowAll(!showAll)}>{showAll?"Show fewer sessions":`Show all ${sessions.length} sessions`}</button>}
  <div className="agent-footnote"><RefreshCw size={11}/> Status reflects the latest local event; inactive sessions fade to idle.</div>
 </div>;
}
