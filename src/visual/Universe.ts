import * as THREE from 'three';
import { damp, emptyFeatures, type AudioFeatures } from '../audio/features';
import type { Settings, Style } from '../settings';
import { fragmentShader, fluidShader, vertexShader } from './shaders';
import { MaterialResponse } from './response';
import { BAND_NAMES } from '../audio/features';
import { AtmosphereVolume, withVolumetricAtmosphere } from './AtmosphereVolume';

export interface VisualStats { fps: number; scale: number; style: Style; debug?: string; }
const styles: Style[] = ['atmosphere', 'liquid', 'texture'];
const quality = {
  eco: { pixels: 750_000, dpr: 1, octaves: 4, fps: 60 },
  balanced: { pixels: 1_650_000, dpr: 1.25, octaves: 5, fps: 60 },
  high: { pixels: 3_000_000, dpr: 1.5, octaves: 6, fps: 144 },
};

export class Universe {
  private renderer: THREE.WebGLRenderer;
  private material: THREE.ShaderMaterial;
  private geometry = new THREE.PlaneGeometry(2, 2);
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private observer: ResizeObserver;
  private animation = 0;
  private disposed = false;
  private lost = false;
  private last = 0;
  private accumulator = 0;
  private pendingTime = 0;
  private elapsed = 0;
  private time = 6.8;
  private palette = 0;
  private frameCount = 0;
  private frameSeconds = 0;
  private scale = 1;
  private currentStyle: Style;
  private autoSeconds = 0;
  private target = new THREE.Vector3();
  private blended = emptyFeatures();
  private response = new MaterialResponse();
  private fluidMaterial: THREE.ShaderMaterial;
  private fluidScene = new THREE.Scene();
  private fluidTargets: THREE.WebGLRenderTarget[];
  private fluidIndex = 0;
  private fluidReady = false;
  private atmosphere: AtmosphereVolume;

  constructor(private canvas: HTMLCanvasElement,
    private settings: () => Settings,
    private sample: (dt: number) => AudioFeatures,
    private isDemo: () => boolean,
    private onStats: (stats: VisualStats) => void,
    private onError: (message: string) => void) {
    this.currentStyle = settings().style;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
      console.error('Shader compilation failed', _gl.getShaderInfoLog(vertex), _gl.getShaderInfoLog(fragment));
      this.onError('No se pudo compilar el material GLSL. Actualizá el controlador de tu GPU y reiniciá AudioFlow.');
    };
    const initial = new THREE.Vector3();
    initial.setComponent(styles.indexOf(this.currentStyle), 1);
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader: withVolumetricAtmosphere(fragmentShader),
      depthTest: false, depthWrite: false,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: this.time }, uPalette: { value: 0 },
        uStyle: { value: initial }, uAudio: { value: new THREE.Vector4() },
        uMotion: { value: new THREE.Vector4() }, uOctaves: { value: 5 },
        uBands: { value: this.response.bands }, uSustained: { value: this.response.sustained },
        uSalience: { value: this.response.salience }, uTension: { value: this.response.tension },
        uEvents: { value: this.response.events }, uEventBands: { value: this.response.eventBands },
        uContext: { value: new THREE.Vector4() }, uFluid: { value: null },
        uAtmosphereVolume: { value: null }, uVolumeEnabled: { value: 0 },
      },
    });
    // WebGL2 floating-point color attachments where supported; RGBA8 remains a
    // functional fallback. No expensive readback or external simulation library.
    const type = this.renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const quantized = { value: type === THREE.UnsignedByteType ? 1 : 0 };
    this.material.uniforms.uFluidQuantized = quantized;
    this.fluidTargets = [0,1].map(() => new THREE.WebGLRenderTarget(512,512, {
      type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
      stencilBuffer: false, generateMipmaps: false,
    }));
    const shared = this.material.uniforms;
    this.fluidMaterial = new THREE.ShaderMaterial({ vertexShader, fragmentShader: fluidShader,
      depthTest: false, depthWrite: false, uniforms: {
        uPrevious: { value: this.fluidTargets[0].texture }, uTexel: { value: new THREE.Vector2(1/512,1/512) },
        uDt: { value: 1/60 }, uTime: shared.uTime, uInitialize: { value: 1 },
        uIntensity: { value: 1 }, uAspect: { value: 1 },
        uQuantized: quantized,
        uBands: shared.uBands, uSustained: shared.uSustained, uSalience: shared.uSalience,
        uTension: shared.uTension, uEvents: shared.uEvents, uEventBands: shared.uEventBands, uContext: shared.uContext,
      } });
    const fluidMesh = new THREE.Mesh(this.geometry,this.fluidMaterial);
    fluidMesh.frustumCulled = false;
    this.fluidScene.add(fluidMesh);
    this.atmosphere = new AtmosphereVolume(this.renderer,shared);
    shared.uVolumeEnabled.value = this.atmosphere.supported ? 1 : 0;
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    document.addEventListener('visibilitychange', this.visibility);
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.resize();
    this.animation = requestAnimationFrame(this.frame);
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const q = quality[this.settings().quality];
    this.scale = Math.min(window.devicePixelRatio || 1, q.dpr, Math.sqrt(q.pixels / Math.max(1, width * height)));
    const w = Math.max(1, Math.round(width * this.scale));
    const h = Math.max(1, Math.round(height * this.scale));
    this.renderer.setSize(w, h, false);
    this.material.uniforms.uResolution.value.set(w, h);
    this.material.uniforms.uOctaves.value = q.octaves;
    this.fluidMaterial.uniforms.uAspect.value = w/h;
    this.atmosphere.configure(w,h,this.settings().quality);
  }

  setStyle(style: Style) { this.currentStyle = style; this.autoSeconds = 0; }

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.animation);
    this.onError('Se perdió el contexto de la GPU. Esperando recuperación; si persiste, reiniciá la aplicación.');
  };
  private contextRestored = () => {
    this.lost = false;
    this.onError('');
    this.last = 0;
    this.fluidReady = false;
    this.atmosphere.restore();
    this.resize();
    if (!document.hidden && !this.disposed) this.animation = requestAnimationFrame(this.frame);
  };
  private visibility = () => {
    cancelAnimationFrame(this.animation);
    this.last = 0;
    this.accumulator = 0;
    this.pendingTime = 0;
    if (!document.hidden && !this.lost && !this.disposed) this.animation = requestAnimationFrame(this.frame);
  };

  private frame = (now: number) => {
    if (this.disposed || this.lost || document.hidden) return;
    this.animation = requestAnimationFrame(this.frame);
    const s = this.settings();
    const rawDt = this.last ? Math.min((now - this.last) / 1000, .1) : 1 / 60;
    this.last = now;
    this.accumulator += rawDt;
    this.pendingTime += rawDt;
    this.frameSeconds += rawDt;
    const interval = 1 / (this.currentStyle === 'atmosphere' ? 60 : quality[s.quality].fps);
    if (this.accumulator + .000001 < interval) return;
    const dt = Math.min(this.pendingTime, .1);
    this.pendingTime = 0;
    this.accumulator = Math.max(0, this.accumulator - interval) % interval;
    this.elapsed += dt;
    const real = this.sample(dt);
    const observed = this.response.update(real,dt,this.isDemo(),s.softness);
    const f = this.blended;
    f.energy = damp(f.energy,observed.energy,dt,.15);
    f.bass = damp(f.bass,observed.bass,dt,.12);
    f.mids = damp(f.mids,observed.mids,dt,.18);
    f.treble = damp(f.treble,observed.treble,dt,.2);
    f.atmosphere = this.response.structure;
    f.centroid = this.response.brightness;
    f.impulse = observed.impulse;
    this.time += dt*.18; // Autonomous clock: loudness never accelerates the universe.
    this.palette += dt*(.018+f.atmosphere*s.intensity*.035);
    this.autoSeconds += dt;
    if (s.auto && this.autoSeconds > 55) {
      this.currentStyle=styles[(styles.indexOf(this.currentStyle)+1)%3];
      this.autoSeconds=0;
    }
    this.target.set(0,0,0).setComponent(styles.indexOf(this.currentStyle),1);
    this.material.uniforms.uStyle.value.lerp(this.target,1-Math.exp(-dt/3.2));
    this.material.uniforms.uTime.value=this.time;
    this.material.uniforms.uPalette.value=this.palette;
    this.material.uniforms.uAudio.value.set(f.energy,f.bass,f.mids,f.treble);
    this.material.uniforms.uMotion.value.set(f.atmosphere,f.centroid,f.impulse,s.intensity);
    this.material.uniforms.uContext.value.set(this.response.structure,this.response.balance,this.response.width,this.response.noise);
    this.fluidMaterial.uniforms.uIntensity.value = s.intensity;
    const steps = Math.ceil(dt/(1/30));
    this.fluidMaterial.uniforms.uDt.value = dt/steps;
    // The liquid field remains alive across style changes and UI operations.
    for (let step=0;step<steps;step++) {
      const next = 1-this.fluidIndex;
      this.fluidMaterial.uniforms.uPrevious.value = this.fluidTargets[this.fluidIndex].texture;
      this.fluidMaterial.uniforms.uInitialize.value = this.fluidReady ? 0 : 1;
      this.renderer.setRenderTarget(this.fluidTargets[next]);
      this.renderer.render(this.fluidScene,this.camera);
      this.fluidIndex = next;
      this.fluidReady = true;
    }
    this.renderer.setRenderTarget(null);
    this.material.uniforms.uFluid.value = this.fluidTargets[this.fluidIndex].texture;
    if(this.material.uniforms.uStyle.value.x>.001 || this.currentStyle==='atmosphere') {
      this.atmosphere.observeFrame(dt);
      this.atmosphere.advance(dt,s.intensity);
      this.atmosphere.draw();
      this.material.uniforms.uAtmosphereVolume.value=this.atmosphere.texture;
    }
    this.renderer.render(this.scene,this.camera);
    this.frameCount++;
    if (this.frameSeconds > .7) {
      const fmt = (n: number) => n.toFixed(3);
      const debug = [this.isDemo() ? 'DEMO VISUAL · señales sintéticas' : real.signal ? 'PERCEPCIÓN · audio real' : 'PERCEPCIÓN · sin señal',
        `RMS ${fmt(real.rms)} · pico ${fmt(real.peak)} · cresta ${fmt(real.crest)}`,
        `E instantánea ${fmt(real.instantaneous)} · reciente ${fmt(real.shortEnergy)} · historial ${fmt(real.longEnergy)}`,
        `Sostenida ${fmt(real.sustained)} · relativa ${fmt(real.relative)} · saliencia ${fmt(real.salience)}`,
        `Centro ${Math.round(real.centroidHz)} Hz · rolloff ${Math.round(real.rolloffHz)} Hz`,
        `Flux ${fmt(real.flux)} · planitud ${fmt(real.flatness)} · cambio ${fmt(real.textureChange)}`,
        `Transitorios ${real.eventId} · impulso ${fmt(real.impulse)}`,
        real.stereo ? `Estéreo: balance ${fmt(real.balance)} · ancho ${fmt(real.width)} · correlación ${fmt(real.correlation)}` : 'Mono / estéreo no disponible',
        this.isDemo() ? 'Bandas sintéticas de DEMO (RMS y espectro reales arriba)' : 'Bandas del audio capturado',
        'Banda       potencia  rápida lenta salient evento | excitación tensión',
        ...observed.bands.map((b,i) => `${BAND_NAMES[i].padEnd(11)} ${b.energy.toExponential(1)} ${fmt(b.fast)} ${fmt(b.slow)} ${fmt(b.salience)} ${b.eventId} | ${fmt(this.response.bands[i])} ${fmt(this.response.tension[i])}`),
        `Estructura ${fmt(this.response.structure)} · brillo ${fmt(this.response.brightness)}`,
        `GPU: líquido ${typeLabel(this.fluidTargets[0].texture.type)} 512² · ${Math.round(this.frameCount/this.frameSeconds)} FPS`,
        this.atmosphere.debug,
      ].join('\n');
      this.onStats({ fps: Math.round(this.frameCount/this.frameSeconds), scale: this.scale, style: this.currentStyle, debug });
      this.frameCount=0;
      this.frameSeconds=0;
    }
  };

  dispose() {
    this.disposed=true;
    cancelAnimationFrame(this.animation);
    this.observer.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);
    this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    this.canvas.removeEventListener('webglcontextrestored',this.contextRestored);
    this.geometry.dispose();
    this.material.dispose();
    this.fluidMaterial.dispose();
    this.fluidTargets.forEach(target => target.dispose());
    this.atmosphere.dispose();
    this.renderer.dispose();
  }
}

function typeLabel(type: THREE.TextureDataType) { return type === THREE.HalfFloatType ? 'FP16' : 'RGBA8'; }
