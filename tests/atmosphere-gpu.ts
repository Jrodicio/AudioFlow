import * as THREE from 'three';
import { AtmosphereVolume, GAS_GRID } from '../src/visual/AtmosphereVolume';
import { withVolumetricAtmosphere } from '../src/visual/AtmosphereVolume';
import { fragmentShader, vertexShader } from '../src/visual/shaders';
import { MaterialResponse } from '../src/visual/response';
import { FeatureExtractor, emptyFeatures } from '../src/audio/features';
import { AtmosphereAcoustics } from '../src/visual/atmosphereAcoustics';
import { transportShader } from '../src/visual/atmosphereShaders';
import { forcesBefore } from './fixtures/atmosphere-forces-before';
import { makeSignal, SignalWindow, eventTimes, type TemporalCase } from './fixtures/atmosphere-signals';
import { volumeVertex } from '../src/visual/atmosphereShaders';
import type { AtmospherePlumes } from '../src/visual/atmospherePlumes';
import { renderBefore } from './fixtures/atmosphere-render-before';

type Mode = 'silence'|'soft'|'bass'|'mids'|'highs'|'transient'|'intense'|'release';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas')!,antialias:false,powerPreference:'high-performance'});
renderer.setSize(1920,1080,false);
const errors:string[]=[];
renderer.debug.onShaderError=(gl,_program,vs,fs)=>errors.push(`${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`);
let response=new MaterialResponse(), controlResponse=new MaterialResponse();
let acoustics=new AtmosphereAcoustics(),controlAcoustics=new AtmosphereAcoustics();
function uniforms(r:MaterialResponse,a:AtmosphereAcoustics) {return {
  uBands:{value:a.bands},uSustained:{value:a.sustained},uSalience:{value:a.salience},uAcousticGain:a.gain,
  uEvents:{value:r.events},uEventBands:{value:r.eventBands},uTension:{value:r.tension},uContext:{value:new THREE.Vector4()},
};}
let shared=uniforms(response,acoustics),controlShared=uniforms(controlResponse,controlAcoustics);
let volume=new AtmosphereVolume(renderer,shared,acoustics),control=new AtmosphereVolume(renderer,controlShared,controlAcoustics);
volume.configure(1920,1080,'balanced');control.configure(1920,1080,'balanced');
const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene(),camera=new THREE.Camera();
const display=new THREE.ShaderMaterial({vertexShader,fragmentShader:`varying vec2 vUv;uniform sampler2D image;uniform sampler2D reference;uniform float difference;void main(){vec3 c=texture2D(image,vUv).rgb;if(difference>.5)c=abs(c-texture2D(reference,vUv).rgb)*4.0;gl_FragColor=vec4(c,1);}`,uniforms:{image:{value:null},reference:{value:null},difference:{value:0}},depthTest:false});
const quad=new THREE.Mesh(geometry,display);quad.frustumCulled=false;scene.add(quad);
let extractor=new FeatureExtractor(2048,48000);
const wave=new Float32Array(4096),fft=new Float32Array(2048);
const zero=emptyFeatures();
let time=0,modeTime=0,lastMode:Mode='silence',withControl=true;
function simulate(dt:number,mode:Mode) {
  if(mode!==lastMode){modeTime=0;lastMode=mode;}modeTime+=dt;
  time+=dt; wave.fill(0);fft.fill(-Infinity);
  if(mode!=='silence'&&mode!=='release') {
    const pulse=mode==='intense' ? Math.pow(.5+.5*Math.sin(time*9),14) : 0;
    const amplitudes=mode==='soft' ? [.003,.012,.002] : mode==='bass' ? [.20,0,0] : mode==='mids' ? [0,.14,0] : mode==='highs' ? [0,0,.12] : mode==='transient' ? [0,modeTime<=.10 ? .4 : 0,0] : [.18+pulse*.35,.07,.025+pulse*.10];
    for(let band=0;band<3;band++) {
      const bin=[10,86,683][band],amplitude=amplitudes[band];
      fft[bin]=20*Math.log10(amplitude/2);
      for(let i=0;i<wave.length;i++) wave[i]+=amplitude*Math.sin(i*2*Math.PI*bin/wave.length);
    }
  }
  const f=extractor.update(wave,fft,dt,1.2,.7);
  response.update(f,dt,false,.7);
  acoustics.update(f,dt);
  shared.uContext.value.set(response.structure,response.balance,response.width,response.noise);
  volume.advance(dt,.8);
  if(withControl){controlResponse.update(zero,dt,false,.7);control.advance(dt,.8);}
}
function draw(useHistory = true) {
  display.uniforms.difference.value=0;
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
  const error=renderer.getContext().getError();if(error)errors.push('WebGL error '+error);
  const velocity=read(volume,0),matter=read(volume,1);
  const pigment=read(volume,2),referenceMatter=withControl ? read(control,1) : null,referencePigment=withControl ? read(control,2) : null;
  const reference=withControl ? read(control,0) : null;
  let maxSpeed=0,kinetic=0,delta=0,density=0,density2=0,minDensity=Infinity,maxDensity=0,invalid=0,change=0,densityDelta=0,pigmentDelta=0,saturated=0,reactive=0,reactiveExcess=0;
  const depth=[{speed:0,density:0,count:0},{speed:0,density:0,count:0},{speed:0,density:0,count:0}];
  const currentDensity=new Float32Array(matter.length/4);
  const dyeSum=[0,0,0],dyeSquare=[0,0,0];let minPigment=1,maxPigment=0;
  for(let i=0;i<matter.length;i+=4) {
    const components=[0,1,2].map(c=>THREE.DataUtils.fromHalfFloat(velocity[i+c]));
    const speed=Math.hypot(...components);maxSpeed=Math.max(maxSpeed,speed);kinetic+=speed*speed;
    if(speed>.084)saturated++;
    for(let c=0;c<4;c++) if((matter[i+c]&0x7c00)===0x7c00||(velocity[i+c]&0x7c00)===0x7c00||(pigment[i+c]&0x7c00)===0x7c00)invalid++;
    if(reference)for(let c=0;c<3;c++)delta+=Math.pow(components[c]-THREE.DataUtils.fromHalfFloat(reference[i+c]),2);
    const d=THREE.DataUtils.fromHalfFloat(matter[i+3]);currentDensity[i/4]=d;
    const r=THREE.DataUtils.fromHalfFloat(velocity[i+3]);reactive+=r;reactiveExcess=Math.max(reactiveExcess,r-d,-r);
    if(referenceMatter)densityDelta+=Math.pow(d-THREE.DataUtils.fromHalfFloat(referenceMatter[i+3]),2);
    if(referencePigment)for(let c=0;c<3;c++)pigmentDelta+=Math.pow(THREE.DataUtils.fromHalfFloat(pigment[i+c])-THREE.DataUtils.fromHalfFloat(referencePigment[i+c]),2);
    for(let c=0;c<3;c++) {
      const dye=THREE.DataUtils.fromHalfFloat(pigment[i+c]);dyeSum[c]+=dye;dyeSquare[c]+=dye*dye;
      minPigment=Math.min(minPigment,dye);maxPigment=Math.max(maxPigment,dye);
    }
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
    densityDelta:Math.sqrt(densityDelta/n),pigmentDelta:Math.sqrt(pigmentDelta/(n*3)),saturatedFraction:saturated/n,
    pigmentMean:dyeSum.map(v=>v/n),pigmentVariance:dyeSum.map((v,i)=>dyeSquare[i]/n-(v/n)**2),minPigment,maxPigment,
    depth:depth.map(d=>({speed:d.speed/d.count,density:d.density/d.count})),
    reactiveMean:reactive/n,reactiveExcess,
    plumesBorn:(volume as unknown as {plumes:AtmospherePlumes}).plumes.born,
    activeEmitters:(volume as unknown as {plumes:AtmospherePlumes}).plumes.active,
    memory:{...renderer.info.memory},debug:volume.debug,errors:[...errors]};
}
async function realtime(mode:Mode,seconds:number) {
  let last=performance.now(),elapsed=0,accumulator=0,pendingTime=0,frames=0;
  const started=last;
  const gl=renderer.getContext() as WebGL2RenderingContext;
  const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const queries:WebGLQuery[]=[],gpuMs:number[]=[];
  await new Promise<void>(resolve=>{
    function frame(now:number) {
      const dt=Math.min(.1,(now-last)/1000);last=now;elapsed+=dt;accumulator+=dt;pendingTime+=dt;
      if(accumulator+1e-6>=1/60){
        const query=timer ? gl.createQuery() : null;
        if(query)gl.beginQuery(timer.TIME_ELAPSED_EXT,query);
        simulate(Math.min(.1,pendingTime),mode);pendingTime=0;
        accumulator=Math.max(0,accumulator-1/60)%(1/60);draw();frames++;
        if(query){gl.endQuery(timer.TIME_ELAPSED_EXT);queries.push(query);}
        while(queries.length&&gl.getQueryParameter(queries[0],gl.QUERY_RESULT_AVAILABLE)) {
          const q=queries.shift()!;
          if(!gl.getParameter(timer.GPU_DISJOINT_EXT))gpuMs.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
          gl.deleteQuery(q);
        }
      }
      if(elapsed<seconds)requestAnimationFrame(frame);else resolve();
    }
    requestAnimationFrame(frame);
  });
  queries.forEach(q=>gl.deleteQuery(q));gpuMs.sort((a,b)=>a-b);
  return {fps:frames/((performance.now()-started)/1000),gpuTiming:gpuMs.length ? {samples:gpuMs.length,medianMs:gpuMs[Math.floor(gpuMs.length*.5)],p95Ms:gpuMs[Math.floor(gpuMs.length*.95)]} : null,...stats()};
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
function reset() {
  volume.dispose();control.dispose();
  response=new MaterialResponse();controlResponse=new MaterialResponse();
  acoustics=new AtmosphereAcoustics();controlAcoustics=new AtmosphereAcoustics();
  shared=uniforms(response,acoustics);controlShared=uniforms(controlResponse,controlAcoustics);
  volume=new AtmosphereVolume(renderer,shared,acoustics);control=new AtmosphereVolume(renderer,controlShared,controlAcoustics);
  volume.configure(1920,1080,'balanced');control.configure(1920,1080,'balanced');
  extractor=new FeatureExtractor(2048,48000);time=0;modeTime=0;lastMode='silence';withControl=true;lastDensity=null;
  volume.advance(0,0);control.advance(0,0);draw(false);
}
type Inspection = {states:THREE.WebGLRenderTarget[];index:number;transport:THREE.ShaderMaterial;transportScene:THREE.Scene;camera:THREE.Camera;renderFrame:number;image:THREE.WebGLRenderTarget};
function rawImage(v:AtmosphereVolume) {
  const s=v as unknown as Inspection;s.renderFrame=0;v.draw(false);
  return readImage(v);
}
function readImage(v:AtmosphereVolume) {
  const s=v as unknown as Inspection;
  const target=s.image,data=new Uint8Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,data);
  return data;
}
function imageMetrics(useExisting=false) {
  const a=useExisting ? readImage(volume) : rawImage(volume);
  const b=withControl ? (useExisting ? readImage(control) : rawImage(control)) : a;
  let square=0,absolute=0,changed=0,blue=0,teal=0,gold=0,luminance=0;
  const tiles=new Float64Array(16*9),counts=new Uint32Array(tiles.length);
  const target=(volume as unknown as Inspection).image;
  for(let i=0;i<a.length;i+=4) {
    let max=0;
    const pixel=i/4,x=pixel%target.width,y=Math.floor(pixel/target.width);
    const tile=Math.floor(y/target.height*9)*16+Math.floor(x/target.width*16);
    for(let c=0;c<3;c++) {
      const delta=Math.abs(a[i+c]-b[i+c])/255;
      square+=delta*delta;absolute+=delta;max=Math.max(max,delta);tiles[tile]+=delta;counts[tile]++;
    }
    if(max>4/255)changed++;
    const [r,g,bl]=[a[i],a[i+1],a[i+2]];
    luminance+=(r*.2126+g*.7152+bl*.0722)/255;
    if(bl>g*1.18 && bl>r*1.3 && bl>32)blue++;
    if(g>r*1.4 && g>bl*.88 && g>40)teal++;
    if(r>g*1.10 && g>bl*1.15 && r>45)gold++;
  }
  const n=a.length/4;
  return {rms:Math.sqrt(square/(n*3)),mae:absolute/(n*3),changedFraction:changed/n,
    tileMAE:Array.from(tiles,(v,i)=>v/counts[i]),color:{blue:blue/n,teal:teal/n,gold:gold/n,luminance:luminance/n}};
}
function show(which:'audio'|'control'|'difference') {
  display.uniforms.image.value=which==='control' ? control.texture : volume.texture;
  display.uniforms.reference.value=control.texture;display.uniforms.difference.value=which==='difference' ? 1 : 0;
  renderer.setRenderTarget(null);renderer.render(scene,camera);
}
function forceMetrics() {
  const s=volume as unknown as Inspection;
  const target=s.states[2].clone();
  const before=transportShader.slice(0,transportShader.indexOf('  vec3 force=curlForce'))+
    forcesBefore.replace('  for(int i=0;i<7;i++)','  vec3 ambientForce=force;\n  for(int i=0;i<7;i++)')+
    'outVelocity=vec4(ambientForce,0);outMatter=vec4(force-ambientForce,0);outPigment=vec4(0);return;\nvec3 kick=vec3(0);float bornDensity=0.0;vec4 bornPigment=vec4(0);\n'+
    transportShader.slice(transportShader.indexOf('  // Velocity is advected'));
  const legacyUniforms={...s.transport.uniforms,uBands:{value:response.bands},uSustained:{value:response.sustained},uSalience:{value:response.salience}};
  const legacy=s.transport.clone();legacy.fragmentShader=before.replace('void main() {','layout(location=3) out vec4 outExtra;\nvoid main() {').replace('outVelocity=vec4(ambientForce,0);','outExtra=vec4(0);outVelocity=vec4(ambientForce,0);');legacy.uniforms=legacyUniforms;
  const mesh=s.transportScene.children[0] as THREE.Mesh;
  const result:Record<string,unknown>={};
  s.transport.uniforms.uDiagnostic.value=1;
  for(const [label,material] of [['before',legacy],['after',s.transport]] as const) {
    mesh.material=material;renderer.setRenderTarget(target);renderer.render(s.transportScene,s.camera);
    const buffers=[0,1].map(attachment=>{
      const data=new Uint16Array(target.width*target.height*4);
      renderer.readRenderTargetPixels(target,0,0,target.width,target.height,data,0,attachment);return data;
    });
    const fields=buffers.map(data=>{
      let square=0,max=0,gradient=0,active=0;
      for(let i=0;i<data.length;i+=4) {
        let energy=0;
        for(let c=0;c<3;c++) {
          const f=THREE.DataUtils.fromHalfFloat(data[i+c]);energy+=f*f;
          if((i/4)%GAS_GRID.x<GAS_GRID.x-1)gradient+=Math.pow(f-THREE.DataUtils.fromHalfFloat(data[i+4+c]),2);
        }
        square+=energy;max=Math.max(max,Math.sqrt(energy));if(energy>1e-6)active++;
      }
      const n=data.length/4;
      return {rms:Math.sqrt(square/n),max,gradientRatio:Math.sqrt(gradient/Math.max(1e-12,square)),activeFraction:active/n};
    });
    result[label]={ambient:fields[0],acoustic:fields[1],ratio:fields[1].rms/fields[0].rms,deltaVelocityPerStep:fields[1].rms/60};
  }
  mesh.material=s.transport;s.transport.uniforms.uDiagnostic.value=0;
  target.dispose();legacy.dispose();renderer.setRenderTarget(null);
  result.uniforms={bands:Array.from(acoustics.bands),sustained:Array.from(acoustics.sustained),salience:Array.from(acoustics.salience),gain:acoustics.gain.value,
    previousBands:Array.from(response.bands),previousSustained:Array.from(response.sustained),previousSalience:Array.from(response.salience),events:Array.from(response.events),rms:extractor.value.rms};
  return result;
}
function paired(mode:Mode,seconds:number) {
  for(let i=0;i<Math.round(seconds*60);i++)simulate(1/60,mode);
  const result={...stats(),image:imageMetrics(),forces:forceMetrics()};show('audio');return result;
}
function temporalPair(seconds:number) {
  let previous:Uint8Array|null=null;const changes:number[]=[];
  for(let i=0;i<Math.round(seconds*60);i++) {
    simulate(1/60,'soft');volume.draw();control.draw();
    const current=readImage(volume);
    if(previous){let square=0;for(let j=0;j<current.length;j+=4)for(let c=0;c<3;c++)square+=((current[j+c]-previous[j+c])/255)**2;changes.push(Math.sqrt(square/(current.length*.75)));}
    previous=current;
  }
  const image=imageMetrics(true);show('audio');changes.sort((a,b)=>a-b);
  return {image,frameChange:{median:changes[Math.floor(changes.length*.5)],p95:changes[Math.floor(changes.length*.95)],max:changes.at(-1)}};
}
const gl=renderer.getContext(),gpuInfo=gl.getExtension('WEBGL_debug_renderer_info');
const hardware=gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
function dispose() {volume.dispose();control.dispose();display.dispose();copyMaterial.dispose();copyScene.clear();geometry.dispose();return {...renderer.info.memory};}
// Event counterfactual: fork the CURRENT gas before each known PCM onset. Both
// branches then receive identical sustained features; only the new kicks differ.
const copyMaterial=new THREE.ShaderMaterial({vertexShader:volumeVertex,glslVersion:THREE.GLSL3,
  fragmentShader:`in vec2 vUv;uniform sampler2D a;uniform sampler2D b;uniform sampler2D c;uniform sampler2D d;
  layout(location=0) out vec4 x;layout(location=1) out vec4 y;layout(location=2) out vec4 z;layout(location=3) out vec4 w;
  void main(){x=texture(a,vUv);y=texture(b,vUv);z=texture(c,vUv);w=texture(d,vUv);}`,
  uniforms:{a:{value:null},b:{value:null},c:{value:null},d:{value:null}},depthTest:false});
const copyScene=new THREE.Scene();copyScene.add(new THREE.Mesh(geometry,copyMaterial));
function forkCurrent() {
  type Fork=Inspection & {simulationTime:number;accumulator:number;lastDrawTime:number;historyReady:boolean;historyImage:THREE.WebGLRenderTarget;plumes:AtmospherePlumes};
  const a=volume as unknown as Fork,b=control as unknown as Fork;
  const src=a.states[a.index],dst=b.states[b.index];
  [copyMaterial.uniforms.a.value,copyMaterial.uniforms.b.value,copyMaterial.uniforms.c.value,copyMaterial.uniforms.d.value]=src.textures;
  renderer.setRenderTarget(dst);renderer.render(copyScene,camera);renderer.setRenderTarget(null);
  renderer.copyTextureToTexture(a.image.texture,b.image.texture);
  renderer.copyTextureToTexture(a.image.texture,b.historyImage.texture);
  b.simulationTime=a.simulationTime;b.accumulator=a.accumulator;b.lastDrawTime=a.lastDrawTime;
  b.historyReady=a.historyReady;b.renderFrame=a.renderFrame;
  b.plumes.copyFrom(a.plumes);
}
let temporalWindow:SignalWindow,temporalName:TemporalCase,temporalFrameNumber=0,temporalEvent=-1;
function impulseMetrics() {
  const s=volume as unknown as Inspection,u=s.transport.uniforms,src=s.states[s.index],target=s.states[2];
  u.uVelocity.value=u.uTransportVelocity.value=src.textures[0];
  u.uMatter.value=u.uTransportMatter.value=src.textures[1];
  u.uPigment.value=u.uTransportPigment.value=src.textures[2];
  u.uChromatic.value=u.uTransportChromatic.value=src.textures[3];
  u.uPass.value=2;u.uDiagnostic.value=1;
  renderer.setRenderTarget(target);renderer.render(s.transportScene,s.camera);
  const data=new Uint16Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,data,0,2);
  u.uDiagnostic.value=0;renderer.setRenderTarget(null);
  let square=0,gradient=0,active=0,max=0,densityMean=0,densityMax=0;
  for(let i=0;i<data.length;i+=4) {
    let energy=0;
    for(let c=0;c<3;c++) {
      const x=THREE.DataUtils.fromHalfFloat(data[i+c]);energy+=x*x;
      if((i/4)%GAS_GRID.x<GAS_GRID.x-1)gradient+=(x-THREE.DataUtils.fromHalfFloat(data[i+4+c]))**2;
    }
    const density=THREE.DataUtils.fromHalfFloat(data[i+3]);densityMean+=density;densityMax=Math.max(densityMax,density);
    square+=energy;max=Math.max(max,Math.sqrt(energy));if(density>.0005)active++;
  }
  return {rms:Math.sqrt(square/(data.length/4)),max,activeFraction:active/(data.length/4),gradientRatio:Math.sqrt(gradient/Math.max(square,1e-12)),densityMean:densityMean/(data.length/4),densityMax};
}
function temporalStart(name:TemporalCase) {
  reset();temporalName=name;temporalFrameNumber=0;temporalEvent=-1;
  previousEventDelta=null;previousTemporalEvent=-1;
  temporalWindow=new SignalWindow(makeSignal(name));
  volume.configure(640,360,'balanced');control.configure(640,360,'balanced');
  volume.draw(false);control.draw(false);forkCurrent();
  renderer.setSize(640,360,false);
  const pcm=temporalWindow.pcm,buffer=new ArrayBuffer(44+pcm.length*2),view=new DataView(buffer);
  const str=(p:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(p+i,s.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);str(8,'WAVEfmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,pcm.length*2,true);
  for(let i=0;i<pcm.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),true);
  const bytes=new Uint8Array(buffer);let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {onsets:eventTimes(name),wav:btoa(binary)};
}
let previousEventDelta:Float32Array|null=null,previousTemporalEvent=-1;
function reactiveMass() {
  const a=read(volume,0),b=read(control,0);let sum=0,reference=0,max=0;
  for(let i=3;i<a.length;i+=4) {
    const x=THREE.DataUtils.fromHalfFloat(a[i]);sum+=x;reference+=THREE.DataUtils.fromHalfFloat(b[i]);max=Math.max(max,x);
  }
  return {mean:sum/(a.length/4),delta:(sum-reference)/(a.length/4),max};
}
function temporalFrame() {
  const dt=1/60,t=++temporalFrameNumber/60,onsets=eventTimes(temporalName);
  const upcoming=onsets.findIndex((onset,i)=>i>temporalEvent && t>=onset-1e-8);
  if(upcoming>=0){forkCurrent();temporalEvent=upcoming;}
  temporalWindow.at(t);
  const sensitivity=temporalName==='F-max' ? 3 : 1.2,intensity=temporalName==='F-max' ? 1.5 : .8;
  const f=extractor.update(temporalWindow.wave,temporalWindow.spectrum,dt,sensitivity,.7);
  response.update(f,dt,false,.7);acoustics.update(f,dt,false,sensitivity);controlAcoustics.update(f,dt,false,sensitivity);
  controlAcoustics.consumeImpulses();
  const pending=acoustics.pending,bands=Array.from(acoustics.impulseBands).slice(0,pending);
  const strengths=Array.from({length:pending},(_,i)=>acoustics.impulses[i*4+3]);
  shared.uContext.value.set(response.structure,response.balance,response.width,response.noise);
  controlShared.uContext.value.copy(shared.uContext.value);
  // Test-only delta-velocity readback BEFORE consumption, with correct physical
  // units. It is distinct from the sustained acceleration diagnostic.
  volume.advance(dt,intensity);control.advance(dt,intensity);
  const plumeState=(volume as unknown as {plumes:AtmospherePlumes}).plumes;
  const impulse=plumeState.active ? impulseMetrics() : null;
  volume.draw();control.draw();
  const reactive=temporalFrameNumber%3===0 || pending>0 ? reactiveMass() : null;
  const a=readImage(volume),b=readImage(control),tiles=new Float64Array(144);let square=0,changed=0,stepSquare=0;
  if(!previousEventDelta || previousTemporalEvent!==temporalEvent)previousEventDelta=new Float32Array(a.length);
  previousTemporalEvent=temporalEvent;
  for(let i=0;i<a.length;i+=4) {
    let max=0;const pixel=i/4,tile=Math.floor(Math.floor(pixel/640)/360*9)*16+Math.floor(pixel%640/640*16);
    for(let c=0;c<3;c++){
      const signed=(a[i+c]-b[i+c])/255,d=Math.abs(signed);
      square+=d*d;max=Math.max(max,d);tiles[tile]+=d;
      stepSquare+=(signed-previousEventDelta[i+c])**2;previousEventDelta[i+c]=signed;
    }
    if(max>4/255)changed++;
  }
  show('audio');
  return {time:t,event:temporalEvent,rms:f.rms,signal:f.signal,pending,bands,strengths,impulse,reactive,
    plumesBorn:plumeState.born,emitters:plumeState.active,emissionDose:plumeState.phases.reduce((sum,v,i)=>sum+(i%4===2 ? v : 0),0),
    eventFrameChangeRms:Math.sqrt(stepSquare/(640*360*3)),
    applied:acoustics.applied,rapid:acoustics.rapid,sustained:acoustics.sustainedLevel,
    imageRms:Math.sqrt(square/(640*360*3)),changedFraction:changed/(640*360),
    maxTileMAE:Math.max(...tiles)/(640*360*3/144)};
}
function temporalSnapshot(difference:boolean|'control'=false) {
  show(difference==='control' ? 'control' : difference ? 'difference' : 'audio');
  return renderer.domElement.toDataURL('image/png').split(',')[1];
}
function temporalQueueCheck() {
  reset();const f=emptyFeatures();
  f.events.push({id:1,time:0,band:3,strength:.8,rms:.1});
  acoustics.update(f,1/120);volume.advance(1/120,.8);
  const waiting={pending:acoustics.pending,applied:acoustics.applied};
  acoustics.update(f,1/120);volume.advance(1/120,.8);
  const consumed={pending:acoustics.pending,applied:acoustics.applied};
  const p=(volume as unknown as {plumes:AtmospherePlumes}).plumes;
  const firstDose=p.phases[2];
  volume.advance(3/60,.8);
  return {waiting,consumed,catchUp:{pending:acoustics.pending,applied:acoustics.applied},emittersBorn:p.born,firstDose};
}

function releasePlumes(seconds:number) {
  const before=reactiveMass();
  wave.fill(0);fft.fill(-Infinity);
  for(let frame=0;frame<Math.round(seconds*60);frame++) {
    const f=extractor.update(wave,fft,1/60,1.2,.7);
    acoustics.update(f,1/60);controlAcoustics.update(f,1/60);
    volume.advance(1/60,.8);control.advance(1/60,.8);
  }
  draw();return {before,after:reactiveMass(),state:stats()};
}

function definitionComparison() {
  reset();advance(4,'silence');
  const s=volume as unknown as {shading:THREE.ShaderMaterial};
  // Preserve exact render-target samplers: Three's cloneUniforms nulls them.
  const make=(fragmentShader:string)=>new THREE.ShaderMaterial({vertexShader:volumeVertex,fragmentShader,
    glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
    uniforms:Object.fromEntries(Object.entries(s.shading.uniforms).map(([key,u])=>[key,{value:u.value}]))});
  const before=make(renderBefore),after=make(s.shading.fragmentShader);
  before.uniforms.uSteps.value=64;after.uniforms.uSteps.value=72;
  const plane=new THREE.Mesh(geometry,before),sc=new THREE.Scene();sc.add(plane);
  const composed=new THREE.WebGLRenderTarget(1920,1080,{depthBuffer:false});
  const results:Record<string,unknown>={};renderer.setSize(1920,1080,false);
  for(const [label,material,budget] of [['before',before,980000],['after',after,1150000]] as const) {
    material.uniforms.uFrame.value=0;material.uniforms.uHistoryWeight.value=0;
    material.uniforms.uResolution.value.set(1920,1080);
    const scale=Math.sqrt(budget/(1920*1080));
    const target=new THREE.WebGLRenderTarget(Math.round(1920*scale),Math.round(1080*scale),{depthBuffer:false});
    plane.material=material;
    const data=new Uint8Array(1920*1080*4),sum=new Float32Array(data.length);
    // Average all jitter phases on a frozen field. More high-frequency noise
    // must not be mistaken for improved material definition.
    for(let phase=0;phase<8;phase++) {
      material.uniforms.uFrame.value=phase;
      renderer.setRenderTarget(target);renderer.render(sc,camera);
      display.uniforms.image.value=target.texture;display.uniforms.difference.value=0;
      renderer.setRenderTarget(composed);renderer.render(scene,camera);
      renderer.readRenderTargetPixels(composed,0,0,1920,1080,data);
      for(let i=0;i<data.length;i++)sum[i]+=data[i];
    }
    for(let i=0;i<data.length;i++)data[i]=Math.round(sum[i]/8);
    let luminance=0,gradient=0,laplacian=0,clipped=0;
    const luma=(i:number)=>(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)/255;
    for(let y=1;y<1079;y++)for(let x=1;x<1919;x++) {
      const i=(y*1920+x)*4,l=luma(i),dx=luma(i+4)-luma(i-4),dy=luma(i+1920*4)-luma(i-1920*4);
      luminance+=l;gradient+=Math.hypot(dx,dy)*.5;
      laplacian+=Math.abs(luma(i+4)+luma(i-4)+luma(i+1920*4)+luma(i-1920*4)-4*l);
      if(Math.max(data[i],data[i+1],data[i+2])>=254)clipped++;
    }
    const n=1918*1078;
    const averaged=new THREE.DataTexture(data,1920,1080,THREE.RGBAFormat);averaged.needsUpdate=true;
    display.uniforms.image.value=averaged;
    renderer.setRenderTarget(null);renderer.render(scene,camera);
    results[label]={luminance:luminance/n,gradient:gradient/n,laplacian:laplacian/n,clippedFraction:clipped/n,
      png:renderer.domElement.toDataURL('image/png').split(',')[1]};
    averaged.dispose();target.dispose();
  }
  before.dispose();after.dispose();composed.dispose();draw();return results;
}
Object.assign(window,{gpuTest:{ready:volume.supported,hardware,reset,paired,temporalPair,imageMetrics,show,realtime,advance,stats,compareLegacy,resizeCheck,stopControl,depthWindow,dispose,errors,
  temporalStart,temporalFrame,temporalSnapshot,temporalQueueCheck,definitionComparison,releasePlumes}});
volume.advance(0,0);control.advance(0,0);draw();
