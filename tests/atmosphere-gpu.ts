import * as THREE from 'three';
import { AtmosphereVolume, GAS_GRID } from '../src/visual/AtmosphereVolume';
import { withVolumetricAtmosphere } from '../src/visual/AtmosphereVolume';
import { fragmentShader, vertexShader } from '../src/visual/shaders';
import { MaterialResponse } from '../src/visual/response';
import { FeatureExtractor, emptyFeatures } from '../src/audio/features';
import { AtmosphereAcoustics } from '../src/visual/atmosphereAcoustics';
import { transportShader } from '../src/visual/atmosphereShaders';
import { forcesBefore } from './fixtures/atmosphere-forces-before';

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
let volume=new AtmosphereVolume(renderer,shared),control=new AtmosphereVolume(renderer,controlShared);
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
  const velocity=read(volume,0),matter=read(volume,1);
  const pigment=read(volume,2),referenceMatter=withControl ? read(control,1) : null,referencePigment=withControl ? read(control,2) : null;
  const reference=withControl ? read(control,0) : null;
  let maxSpeed=0,kinetic=0,delta=0,density=0,density2=0,minDensity=Infinity,maxDensity=0,invalid=0,change=0,densityDelta=0,pigmentDelta=0,saturated=0;
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
  volume=new AtmosphereVolume(renderer,shared);control=new AtmosphereVolume(renderer,controlShared);
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
    'outVelocity=vec4(ambientForce,0);outMatter=vec4(force-ambientForce,0);outPigment=vec4(0);return;\n'+
    transportShader.slice(transportShader.indexOf('  // Velocity is advected'));
  const legacyUniforms={...s.transport.uniforms,uBands:{value:response.bands},uSustained:{value:response.sustained},uSalience:{value:response.salience}};
  const legacy=s.transport.clone();legacy.fragmentShader=before;legacy.uniforms=legacyUniforms;
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
function dispose() {volume.dispose();control.dispose();display.dispose();geometry.dispose();return {...renderer.info.memory};}
Object.assign(window,{gpuTest:{ready:volume.supported,hardware,reset,paired,temporalPair,imageMetrics,show,realtime,advance,stats,compareLegacy,resizeCheck,stopControl,depthWindow,dispose,errors}});
volume.advance(0,0);control.advance(0,0);draw();
