/** A rounded-glass boundary bends the background at the rim, leaving its center clear. */
export function lensDisplacement(x:number,y:number,width:number,height:number,radius:number):[number,number]{
 if(![x,y,width,height,radius].every(Number.isFinite)||width<=0||height<=0)return[0,0];
 const r=Math.min(Math.max(radius,1),width/2,height/2);
 const distance=(px:number,py:number)=>{const qx=Math.abs(px-width/2)-(width/2-r),qy=Math.abs(py-height/2)-(height/2-r);return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;};
 const d=distance(x,y),rim=Math.min(12,height*.28);if(d>0||d<-rim)return[0,0];
 const nx=distance(x+.5,y)-distance(x-.5,y),ny=distance(x,y+.5)-distance(x,y-.5),length=Math.hypot(nx,ny)||1;
 const amount=Math.sin((1+d/rim)*Math.PI/2)**2*Math.min(14,height*.25);
 return[nx/length*amount,ny/length*amount];
}
export function lensMap(width:number,height:number,radius:number,padding=0){
 const canvas=document.createElement("canvas"),ratio=Math.min(1,512/Math.max(width+padding*2,1));canvas.width=Math.max(2,Math.round((width+padding*2)*ratio));canvas.height=Math.max(2,Math.round((height+padding*2)*ratio));
 const ctx=canvas.getContext("2d");if(!ctx)return"";const pixels=ctx.createImageData(canvas.width,canvas.height);
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const [dx,dy]=lensDisplacement(x/ratio-padding,y/ratio-padding,width,height,radius),i=(y*canvas.width+x)*4;pixels.data[i]=Math.round(127.5+dx/40*255);pixels.data[i+1]=Math.round(127.5+dy/40*255);pixels.data[i+2]=128;pixels.data[i+3]=255;}
 ctx.putImageData(pixels,0,0);return canvas.toDataURL();
}
