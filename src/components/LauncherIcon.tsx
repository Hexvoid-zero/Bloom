import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LauncherApp } from "../startPreferences";

const isBloom=(path:string)=>/(?:^|[\\/])(?:bloom|bloom-macdock)\.exe$/i.test(path)||path==="com.sehaz.bloom.macdock";
const requests = new Map<string, Promise<string | null>>();
// Resolve only visible tiles and reuse in-flight work. Browser hosts need the
// application name as part of their identity to preserve each installed PWA logo.
export function LauncherIcon({app}:{app:LauncherApp}) {
 const [icon,setIcon]=useState(isBloom(app.path)?"/bloom.png":app.icon||null);
 const [failed,setFailed]=useState(false);
 const host=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  setFailed(false);if(isBloom(app.path)){setIcon("/bloom.png");return;}setIcon(app.icon||null);
  if(app.icon)return;
  let alive=true;
  const load=()=>{
   const key=`${app.path}\0${app.name}`;
   let request=requests.get(key);
   if(!request){request=invoke<string|null>("get_app_icon",{path:app.path,name:app.name,hwnd:null}).catch(()=>null);requests.set(key,request);}
   request.then(value=>{if(alive)setIcon(value);});
  };
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load();}},{rootMargin:"100px"});
  if(host.current)observer.observe(host.current);
  return()=>{alive=false;observer.disconnect();};
 },[app.path,app.name,app.icon]);
 return <span ref={host} className="launcher-icon" aria-hidden="true">{icon&&!failed?<img src={icon} alt="" onError={()=>setFailed(true)}/>:<span className="start-app-fallback">{app.name.slice(0,1)}</span>}</span>;
}
