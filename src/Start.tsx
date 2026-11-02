import {MacStart} from "./MacStart";
import {useLiquidGlass} from "./liquidGlass";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, X, Settings, ArrowUpRight, Grid2X2, Pin, PinOff, Smartphone, MessageSquare, Phone, Image, Send, Bluetooth, Battery, FolderOpen, Monitor, LockKeyhole, Moon, ChevronRight, Bot, SlidersHorizontal, Clock3,Power,RotateCcw } from "lucide-react";
import { useStartPreferences, appCategory, type LauncherApp, type StartSection } from "./startPreferences";
import { AgentCompanion, AgentOverview, useAgentSessions } from "./components/AgentOverview";
import "./Start.css";
import { LauncherIcon } from "./components/LauncherIcon";

interface PhoneStatus { installed: boolean; status: string; phones:{name:string;connected:boolean;battery:number|null}[]; detail:string }
const sectionNames:Record<StartSection,string>={pinned:"Pinned apps",agents:"Agent activity",recent:"Recently opened",all:"All apps"};
export function StartMenu() {
 useLiquidGlass("start");
 const {preferences:p,save,saving,error}=useStartPreferences();
 useEffect(()=>{void invoke("layout_bloom_start").catch(()=>{});},[p.style]);
 const [apps,setApps]=useState<LauncherApp[]>([]),[dockPins,setDockPins]=useState<LauncherApp[]>([]);
 const [query,setQuery]=useState(""),[category,setCategory]=useState("All"),[view,setView]=useState("home");
 const [recent,setRecent]=useState<LauncherApp[]>([]),[username,setUsername]=useState("Your workspace");
 const [phone,setPhone]=useState<PhoneStatus|null>(null),[actionError,setActionError]=useState("");
 const [loading,setLoading]=useState(true),[power,setPower]=useState(false);
 const search=useRef<HTMLInputElement>(null);
 const {sessions,error:agentError}=useAgentSessions();
 const action=async(command:string,args?:Record<string,unknown>)=>{setActionError("");try{await invoke(command,args);}catch(e){setActionError(String(e));}};
 const refresh=async()=>{
  setLoading(true);
  const results=await Promise.allSettled([invoke<LauncherApp[]>("get_installed_apps"),invoke<LauncherApp[]>("load_pinned_apps"),invoke<Record<string,string>>("load_settings"),invoke<{username:string}>("get_start_context")]);
  if(results[0].status==="fulfilled")setApps(results[0].value);else setActionError("Could not load the app catalog. Reopen Start to retry.");
  if(results[1].status==="fulfilled")setDockPins(results[1].value);
  if(results[2].status==="fulfilled"){try{const r=JSON.parse(results[2].value["bloom-start-recent"]||"[]");if(Array.isArray(r))setRecent(r.filter(a=>typeof a?.name==="string"&&typeof a?.path==="string").slice(0,8));}catch{/* ignore corrupt history */}}
  if(results[3].status==="fulfilled")setUsername(results[3].value.username);
  setLoading(false);
 };
 useEffect(()=>{
  void refresh();
  const shown=listen("bloom-start-opened",()=>{setQuery("");setView("home");setPower(false);void refresh();setTimeout(()=>search.current?.focus(),100);});
  const catalogUpdated=listen("installed-apps-updated",()=>void refresh());
  const key=(e:KeyboardEvent)=>{if(e.key==="Escape")void action("hide_bloom_start");if(e.ctrlKey&&e.key.toLowerCase()==="f"){e.preventDefault();search.current?.focus();}};
  window.addEventListener("keydown",key);return()=>{shown.then(f=>f());catalogUpdated.then(f=>f());window.removeEventListener("keydown",key);};
 },[]);
 useEffect(()=>{if(!p.phone)return;let alive=true;const refreshPhone=()=>invoke<PhoneStatus>("get_phone_link_status").then(s=>{if(alive)setPhone(s);}).catch(()=>{if(alive)setPhone(null);});void refreshPhone();const t=setInterval(refreshPhone,30000);return()=>{alive=false;clearInterval(t);};},[p.phone]);
 const visibleApps=useMemo(()=>apps.filter(a=>!p.hidden.includes(a.path)),[apps,p.hidden]);
 const pins=(p.pins??dockPins).filter(a=>!p.hidden.includes(a.path)).map(a=>{
  const same=dockPins.filter(pin=>pin.name===a.name);
  return same.length===1?{...a,...same[0],name:a.name}:a;
 });
 const filtered=useMemo(()=>(view==="pinned"?pins:visibleApps).filter(a=>(category==="All"||appCategory(a)===category)&&a.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>view==="pinned"?0:a.name.localeCompare(b.name)),[visibleApps,query,category,view,pins]);
 const pin=async(a:LauncherApp)=>{const list=pins.some(x=>x.path===a.path)?pins.filter(x=>x.path!==a.path):[...pins,a].slice(0,65);await save({...p,pins:list});};
 const launch=async(a:LauncherApp)=>{
  setActionError("");try{await invoke("open_app",{appName:a.path,displayName:a.name});const next=[a,...recent.filter(x=>x.path!==a.path)].slice(0,8);setRecent(next);await invoke("save_setting",{key:"bloom-start-recent",value:JSON.stringify(next)}).catch(()=>{});await invoke("hide_bloom_start");}catch(e){setActionError(`Could not open ${a.name}: ${String(e)}`);}
 };
 const cards=(list:LauncherApp[],pinControl=false)=><div className="start-app-grid">{list.map(a=><div className="start-app-tile" key={a.path}><button className="start-app-launch" onClick={()=>launch(a)} title={a.name}><LauncherIcon app={a}/><span>{a.name}</span></button>{pinControl&&<button className={`start-pin ${pins.some(x=>x.path===a.path)?"pinned":""}`} disabled={saving} title={pins.some(x=>x.path===a.path)?"Unpin app":"Pin app"} aria-label={`${pins.some(x=>x.path===a.path)?"Unpin":"Pin"} ${a.name}`} onClick={()=>pin(a)}>{pins.some(x=>x.path===a.path)?<PinOff size={12}/>:<Pin size={12}/>}</button>}</div>)}</div>;
 const phoneAction=(a:string)=>action("phone_link_action",{action:a});
 const section=(s:StartSection)=>{
  if(s==="agents")return <section className="start-section agent-card" key={s}><AgentOverview sessions={sessions} error={agentError} compact/></section>;
  const list=s==="pinned"?pins:s==="recent"?recent.filter(a=>!p.hidden.includes(a.path)):visibleApps.slice(0,16);
  return <section className="start-section" key={s}><div className="start-section-title"><h2>{sectionNames[s]} <small>{s==="all"?visibleApps.length:list.length}</small></h2>{s!=="recent"&&<button onClick={()=>{setView(s==="pinned"?"pinned":"apps");setCategory("All");}}>{s==="pinned"?"Show all":"Browse all"}<ChevronRight size={13}/></button>}</div>{list.length?cards(s==="pinned"?list.slice(0,p.density==="compact"?24:16):list,s==="pinned"):<p className="start-empty">{s==="recent"?"Apps you open from here will appear here.":"Choose your favorites from All apps or Settings → Start menu."}</p>}</section>;
 };
 if(p.style==="macos")return <MacStart apps={visibleApps} pins={pins} recent={recent} loading={loading} error={error||actionError} query={query} setQuery={setQuery} launch={launch} action={action} agents={<AgentOverview sessions={sessions} error={agentError} compact/>}/>;
 return <main className={`start-shell ${p.density} accent-${p.accent}`} style={{"--start-accent":({violet:"#b4a2f8",blue:"#83baff",mint:"#8bdbc1",rose:"#efa6bf"})[p.accent as "violet"]} as CSSProperties}>
  <div className="start-main"><header className="start-top"><div className="start-brand"><AgentCompanion active={sessions.some(s=>s.status==="working"||s.status==="running")}/><span>Bloom <b>/</b> workspace</span></div><button className="start-icon-button" aria-label="Close Start" onClick={()=>action("hide_bloom_start")}><X size={16}/></button></header>
   <div className="start-welcome"><div><span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span><h1>{p.greeting}</h1></div><button className="start-customize" onClick={()=>action("open_settings_window")}><SlidersHorizontal size={14}/> Customize</button></div>
   <div className="start-search"><Search size={18}/><input ref={search} autoFocus placeholder="Find an app in your workspace…" aria-label="Search apps" value={query} onChange={e=>{setQuery(e.target.value);setView("apps");}}/>{query?<button aria-label="Clear search" onClick={()=>setQuery("")}><X size={14}/></button>:<kbd>Ctrl F</kbd>}</div>
   <nav className="start-nav" aria-label="Start views">{[["home","Overview"],["pinned","Pinned"],["apps","All apps"],["agents","Agents"]].map(([v,n])=><button key={v} className={view===v?"active":""} onClick={()=>{setView(v);setQuery("");}}>{v==="home"?<Grid2X2 size={14}/>:v==="agents"?<Bot size={14}/>:<Monitor size={14}/>} {n}</button>)}<span>{visibleApps.length} apps</span></nav>
   {(error||actionError)&&<div className="start-error" role="alert">{error||actionError}</div>}
   <div className="start-scroll">{loading&&<div className="start-loading">Loading your apps…</div>}{view==="home"&&!query?p.sections.map(section):view==="agents"?<section className="start-section agent-card"><AgentOverview sessions={sessions} error={agentError}/></section>:<><div className="start-categories">{["All",...new Set(visibleApps.map(appCategory))].map(c=><button key={c} className={category===c?"active":""} onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="start-section-title"><h2>{query?`Results for “${query}”`:view==="pinned"?"Pinned apps":category==="All"?"All apps":category}<small>{filtered.length}</small></h2></div>{cards(filtered,true)}{!filtered.length&&!loading&&<p className="start-empty">No apps match this search.</p>}</>}
    {view==="home"&&<div className="start-shortcuts">{[["Files","shell:Personal"],["Downloads","shell:Downloads"],["Settings","ms-settings:"]].map(([n,path])=><button key={n} onClick={()=>action("open_app",{appName:path})}><FolderOpen size={15}/>{n}<ArrowUpRight size={12}/></button>)}</div>}
   </div>
   <footer className="start-footer"><div className="start-user"><span>{username[0]?.toUpperCase()}</span><div><strong>{username}</strong><small>Your local workspace</small></div></div><div className="start-footer-actions"><button title="Windows Start" onClick={()=>action("open_native_start")}><Grid2X2 size={16}/></button><button title="Bloom settings" onClick={()=>action("open_settings_window")}><Settings size={16}/></button><button aria-label="Power options" onClick={()=>setPower(!power)}><Power size={17}/></button></div>{power&&<div className="start-power" role="menu" aria-label="Power options">{[["lock","Lock",LockKeyhole],["sleep","Sleep",Moon],["shutdown","Shut down",Power],["restart","Restart",RotateCcw]].map(([key,label,Icon])=>{const I=Icon as typeof Power;return <button role="menuitem" key={String(key)} onClick={()=>{setPower(false);void action("power_action",{action:key});}}><I size={15}/>{String(label)}</button>;})}</div>}</footer>
  </div>
  {p.phone&&<aside className="start-phone"><div className="start-phone-heading"><Smartphone size={15}/><span>YOUR PHONE</span><Bluetooth size={13}/></div><div className="phone-art" aria-hidden="true"><div/><span/></div><h2>{phone?.phones[0]?.name||"A little closer."}</h2><p>{phone?.phones[0]?.connected?"Bluetooth connected":"Your phone, one click away."}</p>{phone?.phones[0]?.battery!=null&&<div className="phone-battery"><Battery size={15}/>{phone.phones[0].battery}%</div>}<button className="phone-open" onClick={()=>phoneAction("open")}>{phone?.installed?"Open Phone Link":"Set up Phone Link"}<ArrowUpRight size={14}/></button><div className="phone-actions">{[["messages","Messages",MessageSquare],["calls","Calls",Phone],["photos","Photos",Image],["files","Send files",Send]].map(([a,n,Icon])=>{const I=Icon as typeof Phone;return <button key={String(a)} onClick={()=>phoneAction(String(a))}><I size={17}/><span>{String(n)}<small>Open in Phone Link</small></span><ArrowUpRight size={13}/></button>;})}</div><div className="phone-note"><span className="eyebrow">CONNECTED THROUGH WINDOWS</span><p>{phone?.detail||"Open Phone Link to pair your Android or iPhone. Messages, photos and calls stay managed by Windows."}</p><button onClick={()=>phoneAction("settings")}>Manage devices <ChevronRight size={13}/></button></div><div className="phone-focus"><Clock3 size={16}/><span>One workspace.<br/><strong>Fewer interruptions.</strong></span></div></aside>}
 </main>;
}
createRoot(document.getElementById("root")!).render(<StartMenu/>);
