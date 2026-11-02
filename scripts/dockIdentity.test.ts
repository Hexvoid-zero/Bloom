import {test,expect} from "bun:test";
import {isSameApp,itemKey} from "../src/dockIdentity";
import type {AppInfo} from "../src/dockApps";
const app=(name:string,id:string,path="C:\\Chrome\\chrome.exe"):AppInfo=>({name,app_id:id,path,icon:null,is_running:false,executable:"chrome.exe"});
test("same-named Chrome apps in different profiles never share running indicators",()=>{
 const a=app("Dashboard","Chrome._crx_short");const b=app("Dashboard","Chrome._crx_short.UserData.Profile1");
 expect(isSameApp(a,b)).toBe(false);expect(itemKey(a)).not.toBe(itemKey(b));
});
test("shortcut and window match by exact shell id even if their titles differ",()=>{
 const pin=app("Gmail","Chrome._crx_gmail","C:\\Taskbar\\Gmail.lnk");const window=app("Inbox (3)","Chrome._crx_gmail");
 expect(isSameApp(pin,window)).toBe(true);expect(itemKey(pin)).toBe(itemKey(window));
});
test("a regular browser window never makes a closed web app look open",()=>{
 expect(isSameApp(app("Chrome","Chrome"),app("Gmail","Chrome._crx_gmail"))).toBe(false);
 const unknown=app("Gmail","");delete unknown.app_id;
 expect(isSameApp(unknown,app("Gmail","Chrome._crx_gmail"))).toBe(false);
});
