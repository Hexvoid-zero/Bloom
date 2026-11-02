// One shared optical surface for the entire dock. Icons are separate DOM content.
const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
in vec2 uv;out vec4 color;
uniform sampler2D scene;
uniform vec2 size;
uniform vec2 pointer;
uniform float pressed;
float sdf(vec2 p){float r=min(23.,size.y*.5);vec2 q=abs(p-size*.5)-(size*.5-r);return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
vec3 sampleScene(vec2 p){return texture(scene,clamp((p+12.)/(size+24.),vec2(0.),vec2(1.))).rgb;}
void main(){
 vec2 p=vec2(uv.x,1.-uv.y)*size;float d=sdf(p);if(d>1.)discard;
 vec2 n=normalize(vec2(sdf(p+vec2(.5,0.))-sdf(p-vec2(.5,0.)),sdf(p+vec2(0.,.5))-sdf(p-vec2(0.,.5)))+vec2(.00001));
 float rim=1.-smoothstep(0.,min(13.,size.y*.32),-d);
 float bend=pow(rim,1.65)*(10.+pressed*2.);
 vec2 q=mix(size*.5,p,vec2(.994,.975))-n*bend;
 // Slight spectral separation and diffuse transmission, strongest at the meniscus.
 float dispersion=rim*.65;
 vec3 refracted=vec3(sampleScene(q-n*dispersion).r,sampleScene(q).g,sampleScene(q+n*dispersion).b);
 float blur=.65+rim*1.45;
 vec3 diffuse=(sampleScene(q+vec2(blur,0.))+sampleScene(q-vec2(blur,0.))+sampleScene(q+vec2(0.,blur))+sampleScene(q-vec2(0.,blur)))*.25;
 vec3 transmitted=mix(refracted,diffuse,.32);
 float luma=dot(transmitted,vec3(.2126,.7152,.0722));transmitted=mix(vec3(luma),transmitted,1.12);
 float proximity=exp(-pow(length((p-pointer)/vec2(110.,65.)),2.));
 float topLight=pow(max(dot(n,normalize(vec2(-.5,-1.))),0.),3.);
 float highlight=pow(rim,5.)*(.1+topLight*.3+proximity*.32)+proximity*.018;
 vec3 reflected=sampleScene(p+n*9.);
 vec3 glass=mix(transmitted,reflected,.065*rim)+highlight;
 glass=mix(glass,vec3(.83,.93,1.),rim*.018);
 float coverage=1.-smoothstep(-.75,.75,d);
 color=vec4(clamp(glass,0.,1.),coverage*(.55+.37*rim));
}`;
export class DockGlassRenderer {
 readonly canvas=document.createElement("canvas");
 private gl:WebGL2RenderingContext;
 private program:WebGLProgram;
 private texture:WebGLTexture;
 private ready=false;
 private gone=false;
 private pendingImage:HTMLImageElement|null=null;
 private point:[number,number]=[-1000,-1000];
 private down=0;
 constructor(private host:HTMLElement){
  this.canvas.className="dock-optical-canvas";this.canvas.setAttribute("aria-hidden","true");
  const gl=this.canvas.getContext("webgl2",{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:false});if(!gl)throw Error("WebGL2 unavailable");this.gl=gl;
  const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(error||"Glass shader failed");}return shader;};
  const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error("Glass program failed");this.program=program;
  this.texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  // Texture row zero is the top of a captured Windows scene.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  this.canvas.addEventListener("webglcontextlost",this.lost);
  host.appendChild(this.canvas);
 }
 private lost=(e:Event)=>{e.preventDefault();this.ready=false;this.gone=true;delete this.host.dataset.opticalRenderer;};
 setScene(url:string){if(this.gone)return;const image=new Image();this.pendingImage=image;image.onload=()=>{if(this.gone||this.pendingImage!==image)return;const g=this.gl;g.bindTexture(g.TEXTURE_2D,this.texture);try{g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,image);this.ready=true;this.host.dataset.opticalRenderer="webgl2";}catch{this.clear();}this.pendingImage=null;};image.onerror=()=>this.clear();image.src=url;}
 clear(){if(this.gone)return;this.ready=false;delete this.host.dataset.opticalRenderer;this.gl.clearColor(0,0,0,0);this.gl.clear(this.gl.COLOR_BUFFER_BIT);}
 pointer(x:number,y:number,down=false){this.point=[x,y];this.down=down?1:0;}
 draw(){if(this.gone||!this.ready||this.gl.isContextLost())return;const r=this.host.getBoundingClientRect();if(r.width<2||r.height<2||r.top>=innerHeight||r.bottom<=0)return;const ratio=Math.min(devicePixelRatio||1,2),w=Math.round(r.width*ratio),h=Math.round(r.height*ratio),g=this.gl;if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}g.viewport(0,0,w,h);g.useProgram(this.program);g.uniform2f(g.getUniformLocation(this.program,"size"),r.width,r.height);g.uniform2f(g.getUniformLocation(this.program,"pointer"),...this.point);g.uniform1f(g.getUniformLocation(this.program,"pressed"),this.down);g.uniform1i(g.getUniformLocation(this.program,"scene"),0);g.drawArrays(g.TRIANGLES,0,3);}
 destroy(){this.gone=true;this.pendingImage=null;delete this.host.dataset.opticalRenderer;this.canvas.removeEventListener("webglcontextlost",this.lost);this.gl.deleteTexture(this.texture);this.gl.deleteProgram(this.program);this.gl.getExtension("WEBGL_lose_context")?.loseContext();this.canvas.remove();}
}
