import * as THREE from 'three';
import type { Quality } from '../settings';
import { transportShader, volumeRenderShader, volumeVertex, pigmentSourceShader } from './atmosphereShaders';
import { makeVolumeDetailData } from './volumeDetail';

export const GAS_GRID = { x: 96, y: 72, z: 48, columns: 8, rows: 6 } as const;
export const GAS_STEP = 1/60;
export const GAS_MAX_SPEED = .085;
export const atmosphereQuality = {
  eco: { pixels: 320_000, steps: 32 },
  balanced: { pixels: 980_000, steps: 64 },
  high: { pixels: 1_400_000, steps: 80 },
} as const;

export function volumeImageSize(width: number, height: number, quality: Quality, adaptive = 1) {
  const scale = Math.min(1,Math.sqrt(atmosphereQuality[quality].pixels/Math.max(1,width*height)))*adaptive;
  return { width: Math.max(1,Math.round(width*scale)), height: Math.max(1,Math.round(height*scale)) };
}

/** Keep the legacy Liquid/Texture shader byte-for-byte intact. Only the
 * Atmosphere contribution is replaced; pure other styles skip the new sampler. */
export function withVolumetricAtmosphere(legacy: string) {
  return legacy.replace('void main() {', `
uniform sampler2D uAtmosphereVolume;
uniform float uVolumeEnabled;
void main() {
  if(uVolumeEnabled>.5 && uStyle.x>.995) {
    gl_FragColor=texture2D(uAtmosphereVolume,vUv); return;
  }
`)
    .replace('gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);', `
gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
if(uVolumeEnabled>.5 && uStyle.x>.001) {
  gl_FragColor.rgb=mix(gl_FragColor.rgb,texture2D(uAtmosphereVolume,vUv).rgb,uStyle.x);
}
`);
}

type Uniforms = Record<string,THREE.IUniform>;

/** A 3D gas, not a stack of animated images. MRT atlas fields retain XYZ
 * velocity, humidity reservoir, density, material coordinates and RGB dye. Fixed-step
 * limited MacCormack transport is followed by ambient/acoustic body forces.
 * All readbacks are confined to the separate GPU validation harness. */
export class AtmosphereVolume {
  readonly supported: boolean;
  private states: THREE.WebGLRenderTarget[] = [];
  private image: THREE.WebGLRenderTarget | null = null;
  private historyImage: THREE.WebGLRenderTarget | null = null;
  private historyReady = false;
  private renderFrame = 0;
  private lastDrawTime = 0;
  private geometry: THREE.PlaneGeometry | null = null;
  private transport: THREE.ShaderMaterial | null = null;
  private shading: THREE.ShaderMaterial | null = null;
  private detail: THREE.Data3DTexture | null = null;
  private pigmentSource: THREE.WebGLRenderTarget | null = null;
  private seedPigment: THREE.ShaderMaterial | null = null;
  private transportScene = new THREE.Scene();
  private imageScene = new THREE.Scene();
  private camera = new THREE.Camera();
  private index = 0;
  private initialized = false;
  private accumulator = 0;
  private simulationTime = 0;
  private width = 1;
  private height = 1;
  private quality: Quality = 'balanced';
  private adaptive = 1;
  private timingSeconds = 0;
  private timingFrames = 0;
  private goodSeconds = 0;
  private disposed = false;

  constructor(private renderer: THREE.WebGLRenderer,private acoustic: Uniforms) {
    this.supported = renderer.extensions.has('EXT_color_buffer_float');
  }
  get texture() { return this.image?.texture ?? null; }
  get seconds() { return this.simulationTime; }
  get debug() {
    if(!this.supported) return 'Atmosphere: volumen FP16 no disponible; material anterior';
    return `Atmosphere: gas 96×72×48 · transporte 60 Hz · ${atmosphereQuality[this.quality].steps} pasos · ${this.image?.width ?? 0}×${this.image?.height ?? 0} · ${this.simulationTime.toFixed(1)} s`;
  }

  configure(width: number,height: number,quality: Quality) {
    this.width=width; this.height=height; this.quality=quality;
    const size=volumeImageSize(width,height,quality,this.adaptive);
    if(this.image && (this.image.width!==size.width || this.image.height!==size.height)) {
      this.image.setSize(size.width,size.height); this.historyImage?.setSize(size.width,size.height);
      this.historyReady=false;
    }
    this.shading?.uniforms.uResolution.value.set(width,height);
    if(this.shading) this.shading.uniforms.uSteps.value=atmosphereQuality[quality].steps;
  }

  /** Resolution responds slowly to missed frames only while Atmosphere is
   * visible. The density grid and all simulation state survive resizing. */
  observeFrame(dt: number) {
    this.timingSeconds+=dt; this.timingFrames++;
    if(this.timingSeconds<1.5) return;
    const mean=this.timingSeconds/this.timingFrames;
    if(mean>1/49 && this.adaptive>.62) {
      this.adaptive=Math.max(.62,this.adaptive*.88); this.goodSeconds=0;
      this.configure(this.width,this.height,this.quality);
    } else if(mean<1/58) {
      this.goodSeconds+=this.timingSeconds;
      if(this.goodSeconds>8 && this.adaptive<1) {
        this.adaptive=Math.min(1,this.adaptive*1.05); this.goodSeconds=0;
        this.configure(this.width,this.height,this.quality);
      }
    } else this.goodSeconds=0;
    this.timingSeconds=0; this.timingFrames=0;
  }

  private allocate() {
    if(this.states.length) return;
    const grid={value:new THREE.Vector3(GAS_GRID.x,GAS_GRID.y,GAS_GRID.z)};
    const tiles={value:new THREE.Vector2(GAS_GRID.columns,GAS_GRID.rows)};
    this.states=[0,1,2].map(()=>new THREE.WebGLRenderTarget(GAS_GRID.x*GAS_GRID.columns,GAS_GRID.y*GAS_GRID.rows,{
      count:3,type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
      depthBuffer:false,stencilBuffer:false,generateMipmaps:false,
    }));
    this.pigmentSource=new THREE.WebGLRenderTarget(GAS_GRID.x*GAS_GRID.columns,GAS_GRID.y*GAS_GRID.rows,{
      type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
      depthBuffer:false,stencilBuffer:false,generateMipmaps:false,
    });
    this.seedPigment=new THREE.ShaderMaterial({vertexShader:volumeVertex,fragmentShader:pigmentSourceShader,
      glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,uniforms:{uGrid:grid,uTiles:tiles}});
    const size=volumeImageSize(this.width,this.height,this.quality,this.adaptive);
    this.image=new THREE.WebGLRenderTarget(size.width,size.height,{
      type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
      depthBuffer:false,stencilBuffer:false,generateMipmaps:false,
    });
    this.historyImage=this.image.clone();
    this.geometry=new THREE.PlaneGeometry(2,2);
    this.detail=new THREE.Data3DTexture(makeVolumeDetailData(),64,64,64);
    this.detail.format=THREE.RGBAFormat;
    this.detail.type=THREE.UnsignedByteType;
    this.detail.wrapS=this.detail.wrapT=this.detail.wrapR=THREE.RepeatWrapping;
    this.detail.minFilter=THREE.LinearMipmapLinearFilter; this.detail.magFilter=THREE.LinearFilter;
    this.detail.generateMipmaps=true; this.detail.needsUpdate=true;
    this.transport=new THREE.ShaderMaterial({ vertexShader:volumeVertex,fragmentShader:transportShader,
      glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,uniforms:{
        uGrid:grid,uTiles:tiles,uPass:{value:0},uDt:{value:GAS_STEP},uSimulationTime:{value:0},uIntensity:{value:0},
        uAcousticGain:this.acoustic.uAcousticGain ?? {value:1},uDiagnostic:{value:0},
        uVelocity:{value:this.states[1].textures[0]},uMatter:{value:this.states[1].textures[1]},
        uPigment:{value:this.states[1].textures[2]},uTransportPigment:{value:this.states[2].textures[2]},
        uPigmentSource:{value:this.pigmentSource.texture},
        uTransportVelocity:{value:this.states[2].textures[0]},uTransportMatter:{value:this.states[2].textures[1]},
        uBands:this.acoustic.uBands,uSustained:this.acoustic.uSustained,uSalience:this.acoustic.uSalience,
        uEvents:this.acoustic.uEvents,uEventBands:this.acoustic.uEventBands,uContext:this.acoustic.uContext,
      } });
    this.shading=new THREE.ShaderMaterial({vertexShader:volumeVertex,fragmentShader:volumeRenderShader,
      glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,uniforms:{
        uGrid:grid,uTiles:tiles,uMatter:{value:this.states[0].textures[1]},
        uPigment:{value:this.states[0].textures[2]},
        uDetail:{value:this.detail},
        uDepthWindow:{value:new THREE.Vector2(0,1)},
        uHistory:{value:this.historyImage.texture},uHistoryWeight:{value:0},uFrame:{value:0},
        uResolution:{value:new THREE.Vector2(this.width,this.height)},uSteps:{value:atmosphereQuality[this.quality].steps},
      }});
    for(const [scene,material] of [[this.transportScene,this.transport],[this.imageScene,this.shading]] as const) {
      const mesh=new THREE.Mesh(this.geometry,material); mesh.frustumCulled=false; scene.add(mesh);
    }
  }

  advance(dt: number,intensity: number) {
    if(!this.supported || this.disposed) return;
    this.allocate();
    const renderer=this.renderer,uniforms=this.transport!.uniforms;
    const previousTarget=renderer.getRenderTarget();
    try {
      if(!this.initialized) {
        const mesh=this.transportScene.children[0] as THREE.Mesh;
        mesh.material=this.seedPigment!;
        renderer.setRenderTarget(this.pigmentSource); renderer.render(this.transportScene,this.camera);
        mesh.material=this.transport!;
        uniforms.uPass.value=0;
        uniforms.uVelocity.value=this.states[1].textures[0]; uniforms.uMatter.value=this.states[1].textures[1];
        uniforms.uPigment.value=this.states[1].textures[2]; uniforms.uTransportPigment.value=this.states[2].textures[2];
        uniforms.uTransportVelocity.value=this.states[2].textures[0]; uniforms.uTransportMatter.value=this.states[2].textures[1];
        renderer.setRenderTarget(this.states[0]); renderer.render(this.transportScene,this.camera);
        this.index=0; this.initialized=true;
      }
      this.accumulator=Math.min(4*GAS_STEP,this.accumulator+Math.max(0,Math.min(.1,dt)));
      uniforms.uIntensity.value=Math.max(0,Math.min(1.5,intensity));
      while(this.accumulator+1e-8>=GAS_STEP) {
        const previous=this.states[this.index],next=this.states[1-this.index],scratch=this.states[2];
        uniforms.uVelocity.value=previous.textures[0]; uniforms.uMatter.value=previous.textures[1];
        uniforms.uPigment.value=previous.textures[2]; uniforms.uTransportPigment.value=previous.textures[2];
        uniforms.uTransportVelocity.value=previous.textures[0]; uniforms.uTransportMatter.value=previous.textures[1];
        uniforms.uPass.value=1;
        renderer.setRenderTarget(scratch); renderer.render(this.transportScene,this.camera);
        uniforms.uTransportVelocity.value=scratch.textures[0]; uniforms.uTransportMatter.value=scratch.textures[1];
        uniforms.uTransportPigment.value=scratch.textures[2];
        uniforms.uPass.value=2; uniforms.uSimulationTime.value=this.simulationTime;
        renderer.setRenderTarget(next); renderer.render(this.transportScene,this.camera);
        this.index=1-this.index; this.accumulator=Math.max(0,this.accumulator-GAS_STEP);
        this.simulationTime+=GAS_STEP;
      }
    } finally { renderer.setRenderTarget(previousTarget); }
  }

  draw(useHistory = true) {
    if(!this.initialized || !this.shading || !this.image || !this.historyImage) return;
    const previousTarget=this.renderer.getRenderTarget();
    try {
      const previous=this.image; this.image=this.historyImage; this.historyImage=previous;
      this.shading.uniforms.uMatter.value=this.states[this.index].textures[1];
      this.shading.uniforms.uPigment.value=this.states[this.index].textures[2];
      this.shading.uniforms.uHistory.value=this.historyImage.texture;
      const frameAge=Math.max(1/120,this.simulationTime-this.lastDrawTime);
      // Reduce latency during excitation without modulating density or light.
      // Even in silence 45 ms suffices to integrate the interleaved ray samples.
      let excitation=0;
      for(let i=0;i<7;i++)excitation=Math.max(excitation,this.acoustic.uSalience.value[i],this.acoustic.uBands.value[i]);
      excitation=Math.min(1,excitation);
      const historySeconds=.045-.020*excitation;
      this.shading.uniforms.uHistoryWeight.value=this.historyReady && useHistory ? Math.exp(-frameAge/historySeconds) : 0;
      this.shading.uniforms.uFrame.value=this.renderFrame++;
      this.renderer.setRenderTarget(this.image); this.renderer.render(this.imageScene,this.camera);
      this.historyReady=true;
      this.lastDrawTime=this.simulationTime;
    } finally { this.renderer.setRenderTarget(previousTarget); }
  }

  /** Used only after actual context loss, never for audio or ordinary resize. */
  restore() {
    this.initialized=false; this.accumulator=0; this.historyReady=false;
    this.simulationTime=0; this.lastDrawTime=0; this.renderFrame=0;
  }

  dispose() {
    if(this.disposed) return; this.disposed=true;
    this.states.forEach(target=>target.dispose()); this.states=[];
    this.image?.dispose(); this.image=null;
    this.historyImage?.dispose(); this.historyImage=null;
    this.geometry?.dispose(); this.transport?.dispose(); this.shading?.dispose();
    this.detail?.dispose(); this.detail=null;
    this.pigmentSource?.dispose();this.pigmentSource=null;this.seedPigment?.dispose();this.seedPigment=null;
    this.transportScene.clear(); this.imageScene.clear();
  }
}
