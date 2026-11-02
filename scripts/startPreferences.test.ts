import { expect, test } from "bun:test";
import { parseStartPreferences, appCategory, START_DEFAULTS } from "../src/startPreferences";
test("invalid saved customization restores usable defaults",()=>{
 for(const value of ["broken","null","17",null])expect(parseStartPreferences(value)).toEqual(START_DEFAULTS);
});
test("customization rejects invalid types and caps independent Start pins",()=>{
 const p=parseStartPreferences(JSON.stringify({enabled:"false",density:"giant",accent:"invisible",greeting:"x".repeat(100),sections:["all","all","unknown","agents"],pins:Array.from({length:80},(_,i)=>({path:`app-${i}`,name:`App ${i}`})),hidden:["app-1",2]}));
 expect(p.enabled).toBe(true);expect(p.density).toBe("comfortable");expect(p.accent).toBe("violet");expect(p.greeting.length).toBe(80);expect(p.sections).toEqual(["all","agents"]);expect(p.pins?.length).toBe(65);expect(p.hidden).toEqual(["app-1"]);
});
test("empty customization is intentional rather than replaced by defaults",()=>{
 const p=parseStartPreferences({enabled:false,sections:[],pins:[],phone:false,agentNotch:false,companion:false});
 expect(p.enabled).toBe(false);expect(p.sections).toEqual([]);expect(p.pins).toEqual([]);expect(p.phone).toBe(false);expect(p.agentNotch).toBe(false);
});
test("app categories are based on catalog labels",()=>{
 expect(appCategory({name:"Visual Studio Code",path:"code"})).toBe("Development");expect(appCategory({name:"Microsoft Word",path:"word"})).toBe("Productivity");expect(appCategory({name:"Chrome",path:"chrome"})).toBe("Browsers");
});

test("MacOS Start style persists and legacy preferences retain Bloom Start",()=>{
 expect(parseStartPreferences({style:"macos"}).style).toBe("macos");
 expect(parseStartPreferences({style:"unknown"}).style).toBe("bloom");
 expect(parseStartPreferences({enabled:true}).style).toBe("bloom");
});
