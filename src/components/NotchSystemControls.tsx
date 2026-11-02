import {useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {Plane,Monitor,MonitorUp,Sun,Radio,Headphones,Bell,Accessibility,Battery,Moon,Shield,Settings,ArrowUpRight} from "lucide-react";
const controls=[
 ["airplane-mode","Airplane mode",Plane],["display","Displays",Monitor],["projection","Project screen",MonitorUp],
 ["night-light","Night light",Sun],["hotspot","Mobile hotspot",Radio],["sound","Sound devices",Headphones],
 ["notifications","Notifications",Bell],["accessibility","Accessibility",Accessibility],["power-settings","Power & battery",Battery],
 ["focus","Focus",Moon],["vpn","VPN",Shield],["settings","Windows settings",Settings]
] as const;
export function NotchSystemControls(){
 const [error,setError]=useState("");
 const open=async(action:string)=>{setError("");try{await invoke("start_system_action",{action});}catch(e){setError(String(e));}};
 return <section className="notch-system-controls" aria-label="Windows quick controls"><div className="notch-controls-heading">More controls <span>Opens Windows controls</span></div><div className="notch-controls-grid">{controls.map(([action,label,Icon])=><button key={action} onClick={()=>void open(action)} title={`Open ${label}`}><Icon size={14}/><span>{label}</span><ArrowUpRight size={10}/></button>)}</div>{error&&<p role="alert">{error}</p>}</section>;
}
