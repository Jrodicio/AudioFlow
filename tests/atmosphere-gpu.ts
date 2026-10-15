import * as THREE from 'three';
import { AtmosphereVolume, GAS_GRID } from '../src/visual/AtmosphereVolume';
import { withVolumetricAtmosphere } from '../src/visual/AtmosphereVolume';
import { fragmentShader, vertexShader } from '../src/visual/shaders';
import { MaterialResponse } from '../src/visual/response';
import { FeatureExtractor, emptyFeatures } from '../src/audio/features';

type Mode = 'silence'|'soft'|'intense'|'release';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')!,antialias:false,powerPreference:'high-performance'});
renderer.setSize(1920,1080,false);
const errors:string[]=[];
renderer.debug.onShaderError=(gl,_program,vs,fs)=>errors.push(`${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`);
const response=new MaterialResponse(), controlResponse=new MaterialResponse();
function uniforms(r:MaterialResponse) {return {
  uBands:{value:r.bands},uSustained:{value:r.sustained},uSalience:{value:r.salience},
  uEvents:{value:r.events},uEventBands:{value:r.eventBands},uTension:{value:r.tension},uContext:{value:new THREE.Vector4()},
};}
const shared=uniforms(response),controlShared=uniforms(controlResponse);
const volume=new AtmosphereVolume(renderer,shared),control=new AtmosphereVolume(renderer,controlShared);
volume.configure(1920,1080,'balanced');control.configure(1920,1080,'balanced');
const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
const display=new THREE.ShaderMaterial({vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vUv);}`,uniforms:{image:{value:null}},depthTest:false});
const quad=new THREE.Mesh(geometry,display);quad.frustumCulled=false;scene.add(quad);
const extractor=new FeatureExtractor(2048,48000);
const wave=new Float32Array(4096),fft=new Float32Array(2048);
const zero=emptyFeatures();
let time=0,withControl=true;
function simulate(dt:number,mode:Mode) {
  time+=dt; wave.fill(0);fft.fill(-Infinity);
  if(mode==='soft'||mode==='intense') {
    const pulse=mode==='intense' ? Math.pow(.5+.5*Math.sin(time*9),14) : 0;
    const amplitudes=mode==='soft' ? [.003,.012,.002] : [.18+pulse*.35,.07,.025+pulse*.10];
    for(let band=0;band<3;band++) {
      const bin=[10,86,683][band],amplitude=amplitudes[band];
      fft[bin]=20*Math.log10(amplitude/2);
      for(let i=0;i<wave.length;i++) wave[i]+=amplitude*Math.sin(i*2*Math.PI*bin/wave.length);
    }
  }
  const f=extractor.update(wave,fft,dt,1.2,.7);
  response.update(f,dt,false,.7);
  shared.uContext.value.set(response.structure,response.balance,response.width,response.noise);
  volume.advance(dt,.8);
  if(withControl){controlResponse.update(zero,dt,false,.7);control.advance(dt,.8);}
}
function draw(useHistory = true) {
  volume.draw(useHistory);display.uniforms.image.value=volume.texture;
  renderer.setRenderTarget(null);renderer.render(scene,camera);
}
// Inspection is test-only; production has no GPU -> CPU path.
function read(v:AtmosphereVolume,attachment:number) {
  const state=v as unknown as {states:THREE.WebGLRenderTarget[];index:number};
  const target=state.states[state.index];
  const result=new Uint16Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,result,0,attachment);
  return result;
}
let lastDensity:Float32Array|null=null;
function stats() {
  const velocity=read(volume,0),matter=read(volume,1);
  const reference=withControl ? read(control,0) : null;
  let maxSpeed=0,kinetic=0,delta=0,density=0,density2=0,minDensity=Infinity,maxDensity=0,invalid=0,change=0;
  const depth=[{speed:0,density:0,count:0},{speed:0,density:0,count:0},{speed:0,density:0,count:0}];
  const currentDensity=new Float32Array(matter.length/4);
  for(let i=0;i<matter.length;i+=4) {
    const components=[0,1,2].map(c=>THREE.DataUtils.fromHalfFloat(velocity[i+c]));
    const speed=Math.hypot(...components);maxSpeed=Math.max(maxSpeed,speed);kinetic+=speed*speed;
    for(let c=0;c<4;c++) if((matter[i+c]&0x7c00)===0x7c00||(velocity[i+c]&0x7c00)===0x7c00)invalid++;
    if(reference)for(let c=0;c<3;c++)delta+=Math.pow(components[c]-THREE.DataUtils.fromHalfFloat(reference[i+c]),2);
    const d=THREE.DataUtils.fromHalfFloat(matter[i+3]);currentDensity[i/4]=d;
    density+=d;density2+=d*d;minDensity=Math.min(minDensity,d);maxDensity=Math.max(maxDensity,d);
    if(lastDensity)change+=Math.abs(d-lastDensity[i/4]);
    const pixel=i/4,x=pixel%(GAS_GRID.x*GAS_GRID.columns),y=Math.floor(pixel/(GAS_GRID.x*GAS_GRID.columns));
    const slice=Math.floor(y/GAS_GRID.y)*GAS_GRID.columns+Math.floor(x/GAS_GRID.x);
    const slab=Math.min(2,Math.floor(slice/(GAS_GRID.z/3)));
    depth[slab].speed+=speed;depth[slab].density+=d;depth[slab].count++;
  }
  const n=matter.length/4;
  lastDensity=currentDensity;
  return {seconds:volume.seconds,invalid,maxSpeed,rmsSpeed:Math.sqrt(kinetic/n),velocityDelta:Math.sqrt(delta/n),
    density:density/n,densityVariance:density2/n-Math.pow(density/n,2),minDensity,maxDensity,densityChange:change/n,
    depth:depth.map(d=>({speed:d.speed/d.count,density:d.density/d.count})),
    memory:{...renderer.info.memory},debug:volume.debug,errors:[...errors]};
}
async function realtime(mode:Mode,seconds:number) {
  let last=performance.now(),elapsed=0,accumulator=0,pendingTime=0,frames=0;
  const started=last;
  await new Promise<void>(resolve=>{
    function frame(now:number) {
      const dt=Math.min(.1,(now-last)/1000);last=now;elapsed+=dt;accumulator+=dt;pendingTime+=dt;
      if(accumulator+1e-6>=1/60){
        simulate(Math.min(.1,pendingTime),mode);pendingTime=0;
        accumulator=Math.max(0,accumulator-1/60)%(1/60);draw();frames++;
      }
      if(elapsed<seconds)requestAnimationFrame(frame);else resolve();
    }
    requestAnimationFrame(frame);
  });
  return {fps:frames/((performance.now()-started)/1000),...stats()};
}
function advance(seconds:number,mode:Mode) {for(let i=0;i<Math.round(seconds*60);i++)simulate(1/60,mode);draw();}
function compareLegacy() {
  const target=new THREE.WebGLRenderTarget(160,90,{depthBuffer:false});
  const data=new Uint8Array(64*64*4);
  for(let i=0;i<data.length;i+=4){data[i]=128;data[i+1]=128;data[i+2]=(i/4)%256;data[i+3]=255-((i/4)%256);}
  const fluid=new THREE.DataTexture(data,64,64);fluid.needsUpdate=true;
  const u={...shared,uFluid:{value:fluid},uFluidQuantized:{value:0},uTime:{value:8.2},uPalette:{value:.5},
    uResolution:{value:new THREE.Vector2(160,90)},uStyle:{value:new THREE.Vector3(0,1,0)},uAudio:{value:new THREE.Vector4(.4,.3,.2,.1)},
    uMotion:{value:new THREE.Vector4(.3,.4,.1,.8)},uOctaves:{value:5},uAtmosphereVolume:{value:volume.texture},uVolumeEnabled:{value:1}};
  const original=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:u});
  const composed=new THREE.ShaderMaterial({vertexShader,fragmentShader:withVolumetricAtmosphere(fragmentShader),uniforms:u});
  const results:Record<string,number>={};
  for(const style of ['liquid','texture']) {
    u.uStyle.value.set(0,style==='liquid'?1:0,style==='texture'?1:0);
    quad.material=original;renderer.setRenderTarget(target);renderer.render(scene,camera);
    const before=new Uint8Array(160*90*4);renderer.readRenderTargetPixels(target,0,0,160,90,before);
    quad.material=composed;renderer.render(scene,camera);
    const after=new Uint8Array(before.length);renderer.readRenderTargetPixels(target,0,0,160,90,after);
    let max=0;for(let i=0;i<before.length;i++)max=Math.max(max,Math.abs(before[i]-after[i]));
    results[style]=max;
  }
  quad.material=display;target.dispose();fluid.dispose();original.dispose();composed.dispose();renderer.setRenderTarget(null);draw();
  return results;
}
function resizeCheck() {
  const before=volume.seconds;
  volume.configure(1280,720,'eco');volume.draw();
  volume.configure(1920,1080,'balanced');volume.draw();
  return {before,after:volume.seconds,memory:{...renderer.info.memory}};
}
function stopControl() {withControl=false;control.dispose();return {...renderer.info.memory};}
function depthWindow(near:number,far:number) {
  const state=volume as unknown as {shading:THREE.ShaderMaterial};
  state.shading.uniforms.uDepthWindow.value.set(near,far);draw(false);
}
function dispose() {volume.dispose();control.dispose();display.dispose();geometry.dispose();return {...renderer.info.memory};}
Object.assign(window,{gpuTest:{ready:volume.supported,realtime,advance,stats,compareLegacy,resizeCheck,stopControl,depthWindow,dispose,errors}});
volume.advance(0,0);control.advance(0,0);draw();
