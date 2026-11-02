import { test, expect } from "bun:test";
import { activateDockApp } from "../src/dockActivation";
import type { AppInfo } from "../src/dockApps";
const app: AppInfo = {name:"Browser app",path:"C:/Apps/Web.lnk",icon:null,is_running:true,hwnd:123};
for (const result of [true,false,undefined]) {
 test(`focusing an open app never launches another tab (result ${result})`,async()=>{
  const calls:string[]=[];
  await activateDockApp(app,async c=>{calls.push(c);return result;});
  expect(calls).toEqual(["focus_window"]);
 });
}
test("failed focus never falls back to a launch",async()=>{
 const calls:string[]=[];
 await expect(activateDockApp(app,async c=>{calls.push(c);throw Error("focus denied");})).rejects.toThrow();
 expect(calls).toEqual(["focus_window"]);
});
test("a single all_hwnds entry focuses even without the primary HWND",async()=>{
 const calls:unknown[]=[];
 await activateDockApp({...app,hwnd:undefined,all_hwnds:[[456,"Window"]]},async(c,a)=>{calls.push([c,a]);});
 expect(calls).toEqual([["focus_window",{hwnd:456}]]);
});
test("closed app launches once and multiple windows only cycle",async()=>{
 const calls:string[]=[];
 await activateDockApp({...app,hwnd:undefined,is_running:false},async c=>{calls.push(c);});
 await activateDockApp({...app,all_hwnds:[[123,"One"],[456,"Two"]]},async c=>{calls.push(c);});
 expect(calls).toEqual(["open_app","focus_app_windows"]);
});
