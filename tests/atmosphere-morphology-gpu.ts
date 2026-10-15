import * as THREE from 'three';
import { AtmosphereVolume } from '../src/visual/AtmosphereVolume';
import { AtmosphereAcoustics } from '../src/visual/atmosphereAcoustics';
import { MaterialResponse } from '../src/visual/response';
import { FeatureExtractor } from '../src/audio/features';
import { pigmentSourceShader, transportShader, volumeRenderShader } from '../src/visual/atmosphereShaders';
import { withThemeSource, withThemeTransport, withThemeVolume, ThemeGPU } from '../src/themes/gpu';
import { COLD_AND_FIRE, type ThemePreset } from '../src/themes';
import { duplicateTheme, withColors } from '../src/themes/library';
import { SignalWindow, makeSignal, type TemporalCase } from './fixtures/atmosphere-signals';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')!,antialias:false,powerPreference:'high-performance'});
renderer.setSize(960,540,false);
const errors:string[]=[];
renderer.debug.onShaderError=(gl,_p,v,f)=>errors.push(`${gl.getShaderInfoLog(v)} ${gl.getShaderInfoLog(f)}`);
type Inspect={transport:THREE.ShaderMaterial;shading:THREE.ShaderMaterial;seedPigment:THREE.ShaderMaterial;states:THREE.WebGLRenderTarget[];index:number;image:THREE.WebGLRenderTarget;theme:ThemeGPU;renderFrame:number};
const acoustics=[new AtmosphereAcoustics(),new AtmosphereAcoustics()];
const responses=[new MaterialResponse(),new MaterialResponse()];
const shared=acoustics.map((a,i)=>({uBands:{value:a.bands},uSustained:{value:a.sustained},uSalience:{value:a.salience},uAcousticGain:a.gain,
  uEvents:{value:responses[i].events},uEventBands:{value:responses[i].eventBands},uContext:{value:new THREE.Vector4()}}));
const volumes=shared.map((u,i)=>new AtmosphereVolume(renderer,u,acoustics[i]));
volumes.forEach(v=>{v.configure(960,540,'balanced');v.advance(0,.8);});
const inspect=volumes.map(v=>v as unknown as Inspect);
// Prompt 7 production shaders: identical theme and physics architecture, with
// the previous density/reservoir/render shaping. No old screenshots as controls.
inspect[0].transport.fragmentShader=withThemeTransport(transportShader);
inspect[0].shading.fragmentShader=withThemeVolume(volumeRenderShader);
inspect[0].seedPigment.fragmentShader=withThemeSource(pigmentSourceShader);
for(const m of [inspect[0].transport,inspect[0].shading,inspect[0].seedPigment])m.needsUpdate=true;
volumes[0].restore();volumes[0].advance(0,.8);
const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
const display=new THREE.ShaderMaterial({vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}',fragmentShader:'varying vec2 vUv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vUv);}',uniforms:{image:{value:null}},depthTest:false});
const mesh=new THREE.Mesh(geometry,display);scene.add(mesh);
const extractor=new FeatureExtractor(2048,48000);
let frame=0,signalName:TemporalCase='G-silence',signal=new SignalWindow(makeSignal(signalName));
function advance(seconds:number,name:TemporalCase='G-silence') {
  if(name!==signalName){signalName=name;signal=new SignalWindow(makeSignal(name));}
  for(let i=0;i<Math.round(seconds*60);i++) {
    signal.at((frame++%360+1)/60);
    const f=extractor.update(signal.wave,signal.spectrum,1/60,1.2,.7);
    for(let side=0;side<2;side++) {
      responses[side].update(f,1/60,false,.7);acoustics[side].update(f,1/60);
      shared[side].uContext.value.set(responses[side].structure,responses[side].balance,responses[side].width,responses[side].noise);
      volumes[side].advance(1/60,.8);
    }
  }
  return {seconds:volumes[1].seconds,applied:acoustics.map(a=>a.applied),errors};
}
function raw(side:number,phase=0) {
  inspect[side].renderFrame=phase;volumes[side].draw(false);
  const target=inspect[side].image,data=new Uint8Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,data);return data;
}
function show(side:number) {
  const target=inspect[side].image,sum=new Uint16Array(target.width*target.height*4);
  // Matched frozen-field antialiasing, rather than favoring one jitter phase.
  for(let phase=0;phase<8;phase++){const data=raw(side,phase);for(let i=0;i<data.length;i++)sum[i]+=data[i];}
  const data=Uint8Array.from(sum,v=>Math.round(v/8));
  const texture=new THREE.DataTexture(data,target.width,target.height,THREE.RGBAFormat);texture.needsUpdate=true;
  display.uniforms.image.value=texture;renderer.setRenderTarget(null);renderer.render(scene,camera);
  const png=renderer.domElement.toDataURL('image/png').split(',')[1];texture.dispose();return png;
}
const opacityMaterials=inspect.map(s=>new THREE.ShaderMaterial({vertexShader:s.shading.vertexShader,
  fragmentShader:s.shading.fragmentShader.replace('outColor=vec4(clamp(color,0.0,1.0),1.0);','outColor=vec4(vec3(1.0-transmission),1.0);'),
  glslVersion:THREE.GLSL3,uniforms:s.shading.uniforms,depthTest:false,depthWrite:false}));
function opacity(side:number) {
  const imageScene=(volumes[side] as unknown as {imageScene:THREE.Scene}).imageScene;
  const quad=imageScene.children[0] as THREE.Mesh,previous=quad.material;
  quad.material=opacityMaterials[side];const data=raw(side);quad.material=previous;return data;
}
function metrics(side:number) {
  const data=opacity(side),width=inspect[side].image.width,height=inspect[side].image.height;
  let empty=0,covered=0,alpha=0,perimeter=0;
  const mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++){const a=data[i*4]/255;alpha+=a;if(a<.05)empty++;if(a>.20){covered++;mask[i]=1;}}
  const visited=new Uint8Array(mask.length),areas:number[]=[];
  for(let i=0;i<mask.length;i++)if(mask[i]&&!visited[i]) {
    const stack=[i];visited[i]=1;let area=0;
    while(stack.length) {const j=stack.pop()!;area++;const x=j%width,y=Math.floor(j/width);
      for(const k of [x>0?j-1:-1,x<width-1?j+1:-1,y>0?j-width:-1,y<height-1?j+width:-1]) {
        if(k<0||!mask[k])perimeter++;else if(!visited[k]){visited[k]=1;stack.push(k);}
      }
    }
    if(area>40)areas.push(area);
  }
  areas.sort((a,b)=>b-a);
  const distance=new Uint16Array(mask.length);distance.fill(width+height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x;distance[i]=mask[i] ? Math.min(x?distance[i-1]+1:1,y?distance[i-width]+1:1) : 0;
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--) {
    const i=y*width+x;if(mask[i])distance[i]=Math.min(distance[i],x<width-1?distance[i+1]+1:1,y<height-1?distance[i+width]+1:1);
  }
  let thin=0;for(let i=0;i<mask.length;i++)if(mask[i]&&distance[i]<=3)thin++;
  return {emptyFraction:empty/mask.length,coverage:covered/mask.length,meanOpacity:alpha/mask.length,components:areas.length,largestBodyFraction:(areas[0]??0)/mask.length,thinOccupiedFraction:thin/Math.max(1,covered),
    edgePerOccupiedPixel:perimeter/Math.max(1,covered),areas:areas.slice(0,12)};
}
function compare(){return {before:metrics(0),after:metrics(1),seconds:volumes[1].seconds,errors,glError:renderer.getContext().getError()};}
function theme(custom:boolean) {
  const copy=duplicateTheme(COLD_AND_FIRE);
  const preset:ThemePreset=custom ? withColors(copy,[...copy.colors,{id:'red',name:'Rojo',role:'pigment',encoding:'srgb',rgb:[1,.015,.01]},{id:'yellow',name:'Amarillo',role:'pigment',encoding:'srgb',rgb:[1,.92,.005]}]) : COLD_AND_FIRE;
  for(let i=0;i<2;i++){volumes[i].setTheme(preset);inspect[i].theme.advance(12);}
}
function depth(side:number,near:number,far:number){inspect[side].shading.uniforms.uDepthWindow.value.set(near,far);const png=show(side);const m=metrics(side);inspect[side].shading.uniforms.uDepthWindow.value.set(0,1);return {png,...m};}
function emptyVolume() {
  const zero=new THREE.DataTexture(new Float32Array(4),1,1,THREE.RGBAFormat,THREE.FloatType);zero.needsUpdate=true;
  const result=volumes.map((_v,i)=>{const old=inspect[i].shading.uniforms.uMatter.value;
    const imageScene=(volumes[i] as unknown as {imageScene:THREE.Scene}).imageScene;
    const quad=imageScene.children[0] as THREE.Mesh,previous=quad.material;
    // draw updates the real field sampler, so bind zero on a separate diagnostic material.
    const material=opacityMaterials[i];quad.material=material;
    material.onBeforeRender=()=>{material.uniforms.uMatter.value=zero;material.uniformsNeedUpdate=true;};
    const d=raw(i);quad.material=previous;material.onBeforeRender=()=>{};inspect[i].shading.uniforms.uMatter.value=old;
    let sum=0;for(let p=0;p<d.length;p+=4)sum+=d[p]/255;return sum/(d.length/4);});zero.dispose();return result;
}
function state(side:number) {
  const v=volumes[side],s=inspect[side],target=s.states[s.index];
  let invalid=0,density=0,occupied=0,maxDensity=0,maxSpeed=0;
  const field=new Uint16Array(target.width*target.height*4);
  for(let attachment=0;attachment<4;attachment++) {
    renderer.readRenderTargetPixels(target,0,0,target.width,target.height,field,0,attachment);
    for(let i=0;i<field.length;i+=4) {
      for(let c=0;c<4;c++)if((field[i+c]&0x7c00)===0x7c00)invalid++;
      if(attachment===1){const d=THREE.DataUtils.fromHalfFloat(field[i+3]);density+=d;maxDensity=Math.max(maxDensity,d);if(d>.1)occupied++;}
      if(attachment===0)maxSpeed=Math.max(maxSpeed,Math.hypot(...[0,1,2].map(c=>THREE.DataUtils.fromHalfFloat(field[i+c]))));
    }
  }
  return {seconds:v.seconds,invalid,density:density/(field.length/4),occupied:occupied/(field.length/4),maxDensity,maxSpeed,applied:acoustics[side].applied};
}
function colors(side:number) {
  const data=raw(side);let red=0,yellow=0,blue=0,teal=0;
  for(let i=0;i<data.length;i+=4){const [r,g,b]=[data[i],data[i+1],data[i+2]];
    if(r>60&&r>g*2.8&&r>b*2)red++;
    if(r>60&&g>50&&g>r*.78&&b<Math.min(r,g)*.5)yellow++;
    if(b>40&&b>r*1.5&&b>g*1.1)blue++;
    if(g>40&&g>r*1.4&&b>r*1.3)teal++;
  }const n=data.length/4;return {red:red/n,yellow:yellow/n,blue:blue/n,teal:teal/n};
}
async function performanceRun(side:number) {
  volumes[side].configure(1920,1080,'balanced');renderer.setSize(1920,1080,false);
  const gl=renderer.getContext() as WebGL2RenderingContext,timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending:WebGLQuery[]=[],times:number[]=[];let last=performance.now(),start=last,frames=0;
  shared[side].uBands.value[0]=.4;shared[side].uSustained.value[3]=.3;
  await new Promise<void>(resolve=>{
    function tick(now:number) {
      const dt=Math.min(.1,(now-last)/1000);last=now;
      const q=timer?gl.createQuery():null;if(q)gl.beginQuery(timer.TIME_ELAPSED_EXT,q);
      volumes[side].advance(dt,.8);volumes[side].draw();display.uniforms.image.value=volumes[side].texture;
      renderer.setRenderTarget(null);renderer.render(scene,camera);frames++;
      if(q){gl.endQuery(timer.TIME_ELAPSED_EXT);pending.push(q);}
      while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){
        const query=pending.shift()!;if(!gl.getParameter(timer.GPU_DISJOINT_EXT))times.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);
      }
      if(now-start>=4000)resolve();else requestAnimationFrame(tick);
    }requestAnimationFrame(tick);
  });
  pending.forEach(q=>gl.deleteQuery(q));times.sort((a,b)=>a-b);
  return {fps:frames/((performance.now()-start)/1000),medianMs:times[Math.floor(times.length*.5)]??null,p95Ms:times[Math.floor(times.length*.95)]??null,image:[inspect[side].image.width,inspect[side].image.height]};
}
const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
Object.assign(window,{morphologyTest:{ready:volumes[1].supported,hardware:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),advance,show,compare,theme,depth,emptyVolume,
  state,colors,performanceRun,memory:()=>({...renderer.info.memory}),dispose(){volumes.forEach(v=>v.dispose());opacityMaterials.forEach(m=>m.dispose());display.dispose();geometry.dispose();return {...renderer.info.memory};}}});
show(1);
