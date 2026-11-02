import {useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {AppWindow,ClipboardList,Trash2,Bell,HardDrive,FolderSearch,Monitor,Sun,Volume2,Power,Search,CircleArrowOutUpRight,LockKeyhole,Moon,RotateCcw} from "lucide-react";
import {listen} from "@tauri-apps/api/event";
import {LauncherIcon} from "./components/LauncherIcon";
import type {LauncherApp} from "./startPreferences";
import "./MacStart.css";
interface Props {
 apps:LauncherApp[]; pins:LauncherApp[]; recent:LauncherApp[]; loading:boolean; error:string;
 query:string; setQuery:(q:string)=>void; launch:(a:LauncherApp)=>Promise<void>;
 action:(command:string,args?:Record<string,unknown>)=>Promise<void>; agents:ReactNode;
}
export function MacStart({apps,pins,recent,loading,error,query,setQuery,launch,action,agents}:Props){
 const [tab,setTab]=useState("apps"),[power,setPower]=useState(false),[compact,setCompact]=useState(false);
 const search=useRef<HTMLInputElement>(null);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.ctrlKey&&e.key.toLowerCase()==="f"){e.preventDefault();search.current?.focus();}};window.addEventListener("keydown",key);const shown=listen("bloom-start-opened",()=>{setTab("apps");setPower(false);search.current?.focus();});return()=>{window.removeEventListener("keydown",key);shown.then(f=>f());};},[]);
 const list=useMemo(()=>(tab==="pinned"?pins:tab==="recent"?recent:apps).filter(a=>a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(),[apps,pins,recent,tab,query]);
 const choose=(next:string)=>{setTab(next);setQuery("");setPower(false);};
 const open=(path:string)=>void action("open_app",{appName:path});
 return <main className={`mac-start ${compact?"mac-start-compact":""}`} aria-label="MacOS Start">
  <header className="mac-titlebar" data-tauri-drag-region><div className="mac-traffic-controls"><button className="red" aria-label="Close Start" onClick={()=>action("hide_bloom_start")}/><button className="amber" aria-label="Hide Start" onClick={()=>action("hide_bloom_start")}/><button className={compact?"green":"pale"} aria-label="Toggle compact applications" aria-pressed={compact} onClick={()=>setCompact(!compact)}/></div><span>Bloom Start Menu</span></header>
  <aside className="mac-sidebar" aria-label="Start shortcuts">
   <div>{[["pinned","Pinned Applications",ClipboardList],["apps","All Applications",AppWindow]].map(([id,label,Icon])=>{const I=Icon as typeof AppWindow;return <button key={String(id)} title={String(label)} aria-label={String(label)} aria-pressed={tab===id} className={tab===id?"selected":""} onClick={()=>choose(String(id))}><>{id==="apps"?<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 3 15 17M13 3 4 17M3 12h14"/></svg>:<I size={16}/>}</></button>;})}
    <button title="Recycle Bin" aria-label="Recycle Bin" onClick={()=>open("shell:RecycleBinFolder")}><Trash2 size={16}/></button>
    <button title="AI agent activity" aria-label="AI agent activity" aria-pressed={tab==="agents"} className={tab==="agents"?"selected":""} onClick={()=>choose("agents")}><Bell size={16}/></button>
    <button title="This PC" aria-label="This PC" onClick={()=>open("shell:MyComputerFolder")}><HardDrive size={16}/></button>
    <button title="Documents" aria-label="Documents" onClick={()=>open("shell:Personal")}><FolderSearch size={16}/></button>
   </div>
   <div className="mac-sidebar-bottom"><button title="Recent Applications" aria-label="Recent Applications" aria-pressed={tab==="recent"} onClick={()=>choose("recent")}><AppWindow size={15}/></button><button title="Display and brightness" aria-label="Display and brightness" onClick={()=>open("ms-settings:display")}><Sun size={16}/></button><button title="Sound settings" aria-label="Sound settings" onClick={()=>open("ms-settings:sound")}><Volume2 size={16}/></button><button title="Bloom settings" aria-label="Bloom settings" onClick={()=>action("open_settings_window")}><Monitor size={16}/></button><button title="Power options" aria-label="Power options" aria-expanded={power} onClick={()=>setPower(!power)}><Power size={17}/></button></div>
  </aside>
  <div className="mac-content"><div className="mac-heading"><h1>{tab==="pinned"?"Pinned Applications":tab==="recent"?"Recent Applications":tab==="agents"?"AI Agents":"All Applications"}</h1><label className="mac-search"><Search size={15}/><input ref={search} autoFocus aria-label="Application name" placeholder="Application name" value={query} onChange={e=>{setQuery(e.target.value);if(tab==="agents")setTab("apps");}}/></label></div>
   {error&&<p className="mac-error" role="alert">{error}</p>}
   <div className="mac-applications" role="region" aria-label="Applications">{tab==="agents"?<div className="mac-agents">{agents}</div>:<>{list.map(a=><button className="mac-app-row" key={a.path} onClick={()=>void launch(a)} title={a.name}><LauncherIcon app={a}/><span>{a.name}</span><CircleArrowOutUpRight size={14}/></button>)}{loading&&<p className="mac-empty">Loading applications…</p>}{!loading&&!list.length&&<p className="mac-empty">No applications found.</p>}</>}</div>
  </div>
  {power&&<div className="mac-power" role="menu" aria-label="Power options">{[["lock","Lock",LockKeyhole],["sleep","Sleep",Moon],["shutdown","Shut down",Power],["restart","Restart",RotateCcw]].map(([id,label,Icon])=>{const I=Icon as typeof Power;return <button key={String(id)} role="menuitem" onClick={()=>{setPower(false);void action("power_action",{action:id});}}><I size={15}/>{String(label)}</button>;})}</div>}
 </main>;
}
