import {expect,test} from "bun:test";
import {createPinWriter} from "../src/dockPersistence";
import type {AppInfo} from "../src/dockApps";
const app=(name:string):AppInfo=>({name,path:`C:\\${name}.lnk`,icon:null,is_running:false});
test("slow previous writes cannot overwrite the final drag order",async()=>{
 const saved:string[][]=[];let release!:()=>void;
 const gate=new Promise<void>(r=>release=r);
 const write=createPinWriter(async apps=>{if(!saved.length)await gate;saved.push(apps.map(a=>a.name));});
 const first=write([app('A'),app('B')]);const last=write([app('B'),app('A')]);
 await Promise.resolve();expect(saved).toEqual([]);release();await Promise.all([first,last]);
 expect(saved).toEqual([['A','B'],['B','A']]);
});
test("each save captures its own snapshot and permits an empty dock",async()=>{
 const saved:AppInfo[][]=[];const write=createPinWriter(async apps=>{saved.push(apps);});
 const apps=[app('PWA one'),app('PWA two')];const first=write(apps);apps.reverse();apps[0].name='changed';
 await first;await write([]);expect(saved[0].map(a=>a.name)).toEqual(['PWA one','PWA two']);expect(saved[1]).toEqual([]);
});
test("a failed save is reported and does not block the next layout",async()=>{
 let attempts=0;const saved:string[][]=[];const write=createPinWriter(async apps=>{if(++attempts===1)throw Error('disk unavailable');saved.push(apps.map(a=>a.name));});
 await expect(write([app('A')])).rejects.toThrow('disk unavailable');await write([app('B')]);expect(saved).toEqual([['B']]);
});
