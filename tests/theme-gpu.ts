import * as THREE from 'three';
import { AtmosphereVolume, GAS_GRID } from '../src/visual/AtmosphereVolume';
import { AtmosphereAcoustics } from '../src/visual/atmosphereAcoustics';
import { MaterialResponse } from '../src/visual/response';
import { fragmentShader, vertexShader } from '../src/visual/shaders';
import { ThemeGPU, withThemeSurface } from '../src/themes/gpu';
import { COLD_AND_FIRE } from '../src/themes';
import { duplicateTheme, withColors } from '../src/themes/library';

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas')!, antialias: false, powerPreference: 'high-performance' });
renderer.setSize(960, 540, false);
const errors: string[] = [];
renderer.debug.onShaderError = (gl, _p, v, f) => errors.push(`${gl.getShaderInfoLog(v)} ${gl.getShaderInfoLog(f)}`);
const camera = new THREE.Camera(), geometry = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene();
const response = new MaterialResponse(), acoustics = new AtmosphereAcoustics(), referenceAcoustics = new AtmosphereAcoustics();
const uniforms = { uBands: { value: acoustics.bands }, uSustained: { value: acoustics.sustained }, uSalience: { value: acoustics.salience }, uAcousticGain: acoustics.gain,
  uEvents: { value: response.events }, uEventBands: { value: response.eventBands }, uTension: { value: response.tension }, uContext: { value: new THREE.Vector4() } };
const volume = new AtmosphereVolume(renderer, uniforms, acoustics);
volume.configure(960, 540, 'balanced');
const reference = new AtmosphereVolume(renderer, uniforms, referenceAcoustics);
reference.configure(960, 540, 'balanced');
type Inspect = { shading: THREE.ShaderMaterial; transport: THREE.ShaderMaterial; states: THREE.WebGLRenderTarget[]; index: number; theme: ThemeGPU; renderFrame: number; initialized: boolean };
const state = volume as unknown as Inspect, baseline = reference as unknown as Inspect;
const display = new THREE.ShaderMaterial({ vertexShader, fragmentShader: 'varying vec2 vUv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vUv);}', uniforms: { image: { value: null } }, depthTest: false });
const quad = new THREE.Mesh(geometry, display); scene.add(quad);
function present() { display.uniforms.image.value = volume.texture; renderer.setRenderTarget(null); renderer.render(scene, camera); }
function pixels(v: AtmosphereVolume) {
  const s = v as unknown as Inspect; s.renderFrame = 0; v.draw(false);
  const target = (v as unknown as { image: THREE.WebGLRenderTarget }).image;
  const data = new Uint8Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data); return data;
}
function field(v: AtmosphereVolume, attachment: number) {
  const s = v as unknown as Inspect, target = s.states[s.index];
  const data = new Uint16Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data, 0, attachment); return data;
}
function difference(a: ArrayLike<number>, b: ArrayLike<number>) {
  if(a.length!==b.length)throw new Error('Comparison requires equal render sizes');
  let sum = 0, max = 0, changed = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); max = Math.max(max, d); sum += d * d; if (d > 4) changed++; }
  return { max, rms: Math.sqrt(sum / a.length) / 255, changedFraction: changed / a.length };
}
function colorCounts(data: Uint8Array) {
  let red = 0, yellow = 0, blue = 0, turquoise = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    if (r > .2 && r > g * 1.7 && r > b * 1.5) red++;
    if (r > .25 && g > .22 && b < Math.min(r, g) * .6 && g > r * .67) yellow++;
    if (b > r * 1.5 && b > g * 1.1 && b > .12) blue++;
    if (g > r * 1.4 && b > r * 1.4 && g > .12) turquoise++;
  }
  const n = data.length / 4; return { red: red / n, yellow: yellow / n, blue: blue / n, turquoise: turquoise / n };
}
const copy = duplicateTheme(COLD_AND_FIRE);
const red = { id: 'new-red', name: 'Rojo', role: 'pigment' as const, encoding: 'srgb' as const, rgb: [1, .015, .01] as const, characteristics: { presence: 1 } };
const yellow = { ...red, id: 'new-yellow', name: 'Amarillo', rgb: [1, .92, .005] as const };
const themes = { original: COLD_AND_FIRE, duplicate: copy, red: withColors(copy, [...copy.colors, red]), yellow: withColors(copy, [...copy.colors, yellow]), both: withColors(copy, [...copy.colors, red, yellow]),
  combined: withColors(copy, [...copy.colors.map((c,i)=>i ? c : {...c,rgb:[1,0,0] as const}),red,yellow]),
  edited: withColors(copy, copy.colors.map((c, i) => i ? c : { ...c, rgb: [1, 0, 0] })) };
let initial: Uint8Array;
function setTheme(name: keyof typeof themes, settle = true) {
  volume.setTheme(themes[name]);
  // Freeze physical fields to isolate color transformations reproducibly.
  if (settle) state.theme.advance(12); else state.theme.advance(1 / 60);
  const image = pixels(volume); present();
  return { ...difference(initial, image), colors: colorCounts(image), seconds: volume.seconds, memory: { ...renderer.info.memory } };
}
function setup(approved: { transportShader: string; volumeRenderShader: string; pigmentSourceShader: string }) {
  volume.advance(0, .8); reference.advance(0, .8);
  baseline.states.forEach(target=>target.dispose());
  baseline.states=[0,1,2].map(()=>new THREE.WebGLRenderTarget(GAS_GRID.x*GAS_GRID.columns,GAS_GRID.y*GAS_GRID.rows,{count:3,type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false,generateMipmaps:false}));
  baseline.transport.fragmentShader = approved.transportShader; baseline.transport.needsUpdate = true;
  baseline.shading.fragmentShader = approved.volumeRenderShader; baseline.shading.needsUpdate = true;
  const seed = (reference as unknown as { seedPigment: THREE.ShaderMaterial }).seedPigment;
  seed.fragmentShader = approved.pigmentSourceShader; seed.needsUpdate = true; reference.restore();
  reference.advance(0,.8);
  const seedDifference=[0,1,2].map(i=>difference(field(volume,i),field(reference,i)));
  for (let i = 0; i < 90; i++) { volume.advance(1 / 60, .8); reference.advance(1 / 60, .8); }
  initial = pixels(volume); const original = pixels(reference); present();
  return { seedDifference, volumeTime:volume.seconds, referenceTime:reference.seconds, image: difference(initial, original), physics: [0, 1, 2].map(i => difference(field(volume, i), field(reference, i))), colors: colorCounts(initial), errors,
    bytesAdded: GAS_GRID.x * GAS_GRID.y * GAS_GRID.z * 8 * 3 + 8192 * 4 * 4 * 2 };
}
function movingTransition() {
  volume.setTheme(themes.both);
  let largestStep = 0; let previous = pixels(volume);
  const before = volume.seconds;
  for (let i = 0; i < 120; i++) {
    // Same real acoustic driving for both simulations; only one has a custom theme.
    acoustics.bands[0] = .4; acoustics.sustained[3] = .3;
    volume.advance(1 / 60, .8); reference.advance(1 / 60, .8);
    if (i % 4 === 0) { const current = pixels(volume); largestStep = Math.max(largestStep, difference(current, previous).rms); previous = current; }
  }
  const physics = [0, 1, 2].map(i => difference(field(volume, i), field(reference, i)));
  const chromatic = field(volume, 3); let lo = 1, hi = 0, nonfinite = 0;
  for (let i = 0; i < chromatic.length; i += 4) { const v = THREE.DataUtils.fromHalfFloat(chromatic[i]); lo = Math.min(lo, v); hi = Math.max(hi, v); if (!Number.isFinite(v)) nonfinite++; }
  present(); return { before, after: volume.seconds, physics, largestStep, chromatic: { lo, hi, nonfinite } };
}
function restoredMoving() {
  setTheme('original');
  return { image: difference(pixels(volume), pixels(reference)), seconds: volume.seconds };
}
function reactiveBaseline() {
  setTheme('original');
  for(const events of [acoustics,referenceAcoustics]) {
    events.pending=3;
    for(let i=0;i<3;i++) {events.impulses.set([.3+i*.2,.5,.75,.8],i*4);events.impulseBands[i]=[0,3,6][i];}
  }
  const checks=[];
  for(let i=0;i<60;i++) {
    volume.advance(1/60,.8);reference.advance(1/60,.8);
    if([5,14,59].includes(i)) checks.push({frame:i+1,image:difference(pixels(volume),pixels(reference)),physics:[0,1,2].map(a=>difference(field(volume,a),field(reference,a)))});
  }
  present();return checks;
}
function surfaceCheck() {
  const gpu = new ThemeGPU();
  const data = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 128; data[i + 2] = (i / 4) % 256; data[i + 3] = 255 - ((i / 4) % 256); }
  const fluid = new THREE.DataTexture(data, 64, 64); fluid.needsUpdate = true;
  const u = { ...uniforms, ...gpu.uniforms, uFluid: { value: fluid }, uFluidQuantized: { value: 0 }, uTime: { value: 8.2 }, uPalette: { value: .5 },
    uResolution: { value: new THREE.Vector2(640, 360) }, uStyle: { value: new THREE.Vector3(0, 1, 0) }, uAudio: { value: new THREE.Vector4(.4, .3, .2, .1) },
    uMotion: { value: new THREE.Vector4(.3, .4, .1, .8) }, uOctaves: { value: 5 } };
  const original = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: u });
  const themed = new THREE.ShaderMaterial({ vertexShader, fragmentShader: withThemeSurface(fragmentShader), uniforms: u });
  const target = new THREE.WebGLRenderTarget(640, 360, { depthBuffer: false });
  const read = (material: THREE.ShaderMaterial) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera); const d = new Uint8Array(640 * 360 * 4); renderer.readRenderTargetPixels(target, 0, 0, 640, 360, d); return d; };
  const result: Record<string, unknown> = {};
  for (const style of ['liquid', 'texture']) {
    u.uStyle.value.set(0, style === 'liquid' ? 1 : 0, style === 'texture' ? 1 : 0);
    gpu.setTheme(COLD_AND_FIRE); gpu.advance(12);
    const base = read(original), official = read(themed);
    gpu.setTheme(themes.both); gpu.advance(12); const custom = read(themed);
    gpu.setTheme(themes.edited); gpu.advance(12); const edited = read(themed);
    result[style] = { official: difference(base, official), custom: difference(base, custom), edited: difference(base, edited) };
  }
  quad.material = display; target.dispose(); original.dispose(); themed.dispose(); fluid.dispose(); gpu.dispose(); present(); return result;
}
async function performanceCheck(name: keyof typeof themes, seconds = 5) {
  volume.setTheme(themes[name]);state.theme.advance(12);
  volume.configure(1920, 1080, 'balanced'); renderer.setSize(1920, 1080, false);
  const gl = renderer.getContext() as WebGL2RenderingContext, timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending: WebGLQuery[] = [], times: number[] = []; let frames = 0, last = performance.now(), start = last;
  await new Promise<void>(resolve => {
    function frame(now: number) {
      const dt = Math.min(.1, (now - last) / 1000); last = now;
      const query = timer ? gl.createQuery() : null; if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      volume.advance(dt, .8); volume.draw(); present(); frames++;
      if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push(query); }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift()!; if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
      }
      if ((now - start) / 1000 >= seconds) resolve(); else requestAnimationFrame(frame);
    } requestAnimationFrame(frame);
  });
  pending.forEach(q => gl.deleteQuery(q)); times.sort((a, b) => a - b);
  return { fps: frames / ((performance.now() - start) / 1000), medianMs: times[Math.floor(times.length * .5)] ?? null, p95Ms: times[Math.floor(times.length * .95)] ?? null, memory: { ...renderer.info.memory } };
}
const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
function longRun(seconds:number) {
  volume.setTheme(themes.both);
  for(let i=0;i<seconds*60;i++) volume.advance(1/60,.8);
  const image=pixels(volume);present();
  return {seconds:volume.seconds,colors:colorCounts(image),memory:{...renderer.info.memory}};
}
function restoreCheck() {
  volume.setTheme(COLD_AND_FIRE);state.theme.advance(12);
  volume.configure(960,540,'balanced');reference.configure(960,540,'balanced');renderer.setSize(960,540,false);
  volume.advance(1/60,.8); // Exercise restore with the other ping-pong index too.
  volume.restore();reference.restore();volume.advance(0,.8);reference.advance(0,.8);
  return {image:difference(pixels(volume),pixels(reference)),physics:[0,1,2].map(i=>difference(field(volume,i),field(reference,i))),glError:gl.getError()};
}
Object.assign(window, { gpuThemeTest: { ready: volume.supported, longRun, setup, setTheme, movingTransition, restoredMoving, surfaceCheck, reactiveBaseline, performanceCheck,
  hardware: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), errors, restoreCheck,
  dispose() { volume.dispose(); reference.dispose(); display.dispose(); geometry.dispose(); return { ...renderer.info.memory }; } } });
