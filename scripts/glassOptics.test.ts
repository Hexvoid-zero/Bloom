import{test,expect}from"bun:test";
import{lensDisplacement}from"../src/glassOptics";
test("clear glass leaves the central app content undistorted",()=>{expect(lensDisplacement(500,28,1000,56,20)).toEqual([0,0]);});
test("opposite rims refract in opposite directions",()=>{const a=lensDisplacement(1,28,1000,56,20),b=lensDisplacement(999,28,1000,56,20);expect(a[0]).toBeLessThan(0);expect(b[0]).toBeGreaterThan(0);expect(Math.abs(a[0]+b[0])).toBeLessThan(.01);});
test("refraction stays bounded on rounded corners",()=>{for(let y=0;y<56;y++)for(let x=0;x<56;x++){const d=lensDisplacement(x,y,1000,56,20);if(d.some(v=>!Number.isFinite(v))||Math.hypot(...d)>14.001)throw Error("Unbounded lens");}});
test("invalid geometry cannot generate optical offsets",()=>{expect(lensDisplacement(NaN,0,0,0,0)).toEqual([0,0]);});
