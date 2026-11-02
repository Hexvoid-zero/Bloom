import {DockGlassRenderer} from "./glassRenderer";
import {lensMap} from "./glassOptics";
import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {useSettingsSync} from "./hooks/useSettingsSync";
import "./LiquidGlass.css";
export type GlassSurface="dock"|"notch"|"start";
export function useLiquidGlass(surface:GlassSurface){
 const key=`bloom-liquid-glass-${surface}`;
 const [enabled,setEnabled]=useState(()=>surface==="start"||(surface==="dock"?localStorage.getItem(key)!=="false":localStorage.getItem(key)==="true"));
 useSettingsSync({[key]:(value)=>setEnabled(surface==="start"||Boolean(value))});
 useEffect(()=>{let alive=true;invoke<Record<string,string>>("load_settings").then(s=>{if(alive)setEnabled(surface==="start"||(surface==="dock"?s[key]!=="false":s[key]==="true"));}).catch(()=>{});return()=>{alive=false;};},[key,surface]);
 useEffect(()=>{
  if(!enabled){delete document.body.dataset.liquidGlass;delete document.body.dataset.glassmorphism;void invoke("set_liquid_glass_surfaces",{rects:[]}).catch(()=>{});return;}
  if(surface==="start")document.body.dataset.glassmorphism="start";else document.body.dataset.liquidGlass=surface;
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("class","liquid-glass-defs");svg.setAttribute("aria-hidden","true");
  svg.innerHTML='<defs><filter id="bloom-liquid-refraction" x="-15%" y="-30%" width="130%" height="160%" color-interpolation-filters="sRGB"><feImage id="bloom-liquid-map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="lens"/><feDisplacementMap in="SourceGraphic" in2="lens" scale="40" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
  document.body.appendChild(svg);
  let last="",sent=0,frame=0,stopped=false,mapKey="",pending=false,lastScene=0;
  let optical:DockGlassRenderer|null=null,opticalAttempted=false;
  const makeOptical=()=>{if(surface!=="dock"||optical||opticalAttempted)return;const host=document.querySelector<HTMLElement>(".dock-glass");if(host)try{opticalAttempted=true;optical=new DockGlassRenderer(host);}catch{/* Transparent CSS fallback if GPU rendering is unavailable. */}};
  const selector=surface==="dock"?".dock":surface==="notch"?".bloom":".start-main,.start-phone,.mac-start";
  const measure=(now:number)=>{
   if(stopped)return;makeOptical();optical?.draw();
   if(now-sent>65){
    const rects=[...document.querySelectorAll<HTMLElement>(selector)].flatMap(e=>{const r=e.getBoundingClientRect(),style=getComputedStyle(e);
     if(r.width<2||r.height<2||r.top>=innerHeight||r.bottom<=0||Number(style.opacity)<.02||style.visibility==="hidden")return [];
     return [{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),radius:surface==="dock"?Math.min(r.height/2,24):surface==="notch"?18:22,flat_top:surface==="notch"}];
    });const text=JSON.stringify(rects);
    if(surface!=="start"&&rects[0]){const r=rects[0],key=`${r.width}:${r.height}`;if(key!==mapKey){mapKey=key;const map=lensMap(r.width,r.height,r.radius,surface==="dock"?12:0);svg.querySelector("feImage")?.setAttribute("href",map);}}
    if(surface==="dock"&&rects[0]&&!pending&&now-lastScene>180){pending=true;lastScene=now;const target=document.querySelector<HTMLElement>(".dock-glass");void invoke<{image:string}|null>("dock_refraction_scene",{rect:rects[0]}).then(scene=>{if(stopped||!target)return;if(scene?.image){target.style.setProperty("--glass-scene",`url("${scene.image}")`);optical?.setScene(scene.image);}else{target.style.removeProperty("--glass-scene");optical?.clear();}}).catch(()=>{}).finally(()=>{pending=false;});}
    if(text!==last||now-sent>1800){last=text;sent=now;void invoke("set_liquid_glass_surfaces",{rects}).catch(()=>{});}
   }
   frame=requestAnimationFrame(measure);
  };frame=requestAnimationFrame(measure);
  const pointer=(event:MouseEvent)=>{const target=(event.target as Element)?.closest<HTMLElement>(selector);if(!target){optical?.pointer(-1000,-1000);return;}const r=target.getBoundingClientRect();optical?.pointer(event.clientX-r.left,event.clientY-r.top,event.buttons===1);target.style.setProperty("--glass-pointer-x",`${Math.round((event.clientX-r.left)/r.width*100)}%`);};
  document.addEventListener("mousemove",pointer,{passive:true});document.addEventListener("mousedown",pointer,{passive:true});document.addEventListener("mouseup",pointer,{passive:true});
  return()=>{stopped=true;cancelAnimationFrame(frame);document.removeEventListener("mousemove",pointer);document.removeEventListener("mousedown",pointer);document.removeEventListener("mouseup",pointer);svg.remove();optical?.destroy();document.querySelector<HTMLElement>(".dock-glass")?.style.removeProperty("--glass-scene");delete document.body.dataset.liquidGlass;delete document.body.dataset.glassmorphism;void invoke("set_liquid_glass_surfaces",{rects:[]}).catch(()=>{});};
 },[surface,enabled]);
 return enabled;
}
