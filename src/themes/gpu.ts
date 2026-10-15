import * as THREE from 'three';
import { COLD_AND_FIRE } from './coldAndFire';
import { shaderRGB } from './colors';
import type { ThemePreset } from './model';

export const MAX_ACTIVE_PIGMENTS = 128;
export const PALETTE_WIDTH = 8192;
const bases = COLD_AND_FIRE.colors;
const cold = bases.slice(0, 8);
export function assertRenderable(theme: ThemePreset) {
  const count = theme.colors.filter(c => c.role === 'pigment' && (c.characteristics?.presence ?? 1) !== 0).length;
  if (count > MAX_ACTIVE_PIGMENTS) throw new Error(`Este equipo admite hasta ${MAX_ACTIVE_PIGMENTS} pigmentos activos por tema. Conservá los demás con presencia 0.`);
}
export function compileTheme(theme: ThemePreset, width = PALETTE_WIDTH) {
  assertRenderable(theme);
  const pigments = theme.colors.filter(c => c.role === 'pigment');
  const totalPresence = pigments.reduce((sum,c)=>sum+Number(c.characteristics?.presence ?? 1),0);
  const average = [0, 1, 2].map(i => pigments.reduce((sum, c) => sum + shaderRGB(c)[i]*Number(c.characteristics?.presence ?? 1), 0) / Math.max(.00001, totalPresence));
  const colors = bases.map(base => {
    const c = theme.colors.find(c => c.id === base.id && c.role === base.role) ?? theme.colors.find(c => c.role === base.role && base.role !== 'pigment');
    let rgb = c ? [...shaderRGB(c)] : base.role === 'pigment' ? average : [...base.rgb];
    const additions = theme.colors.filter(entry => entry.role === base.role && entry.role !== 'pigment' && !bases.some(b => b.id === entry.id));
    if (additions.length) rgb = rgb.map((v, i) => (v + additions.reduce((sum, entry) => sum + shaderRGB(entry)[i], 0)) / (1 + additions.length));
    return rgb;
  });
  const deltas = cold.map((base, i) => colors[i].map((v, j) => v - base.rgb[j]));
  const extra = pigments.filter(c => !bases.some(b => b.id === c.id && b.role === c.role) && Number(c.characteristics?.presence ?? 1) > 0);
  const data = new Float32Array(width * 4);
  if (extra.length) {
    const baseWeight = pigments.filter(c => !extra.includes(c)).reduce((s, c) => s + Number(c.characteristics?.presence ?? 1), 0);
    const extraWeight = extra.reduce((s, c) => s + Number(c.characteristics?.presence ?? 1), 0);
    // Reserve eight texels for every active entry, even at tiny presence.
    const budget = width - extra.length * 8;
    let accumulated = 0;
    const gap = baseWeight / extra.length / 2;
    extra.forEach((c, index) => {
      accumulated += gap;
      const start = Math.floor(budget * accumulated / (baseWeight + extraWeight)) + index * 8;
      accumulated += Number(c.characteristics?.presence ?? 1);
      const end = Math.floor(budget * accumulated / (baseWeight + extraWeight)) + (index + 1) * 8;
      const rgb = shaderRGB(c);
      for (let x = start; x < end; x++) {
        const feather = Math.min((end - start) * .32, width * .045);
        const edge = Math.min(1, (x - start + .5) / feather, (end - x - .5) / feather);
        data.set([rgb[0], rgb[1], rgb[2], edge], x * 4);
      }
      accumulated += gap;
    });
  }
  const presence = bases.slice(0, 9).map(b => Number(theme.colors.find(c => c.id === b.id && c.role === b.role)?.characteristics?.presence ?? (theme.colors.some(c => c.id === b.id) ? 1 : 0)));
  return { colors, deltas, extra: data, presence };
}

/** Fixed textures/uniforms, exponential relaxation. No shader/target recreation. */
export class ThemeGPU {
  private current: ReturnType<typeof compileTheme>;
  private target: ReturnType<typeof compileTheme>;
  private texture: THREE.DataTexture;
  readonly width: number;
  readonly uniforms: Record<string, THREE.IUniform>;
  constructor(maxTextureSize = PALETTE_WIDTH) {
    this.width = Math.min(PALETTE_WIDTH, maxTextureSize);
    this.current = compileTheme(COLD_AND_FIRE, this.width); this.target = this.current;
    this.texture = new THREE.DataTexture(this.current.extra, this.width, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uThemeColors: { value: this.current.colors.map(c => new THREE.Vector3(...c)) },
      uThemeDelta: { value: this.current.deltas.map(c => new THREE.Vector3(...c)) },
      uThemeOffset: { value: bases.map(() => new THREE.Vector3()) },
      uThemePresenceEdited: { value: 0 }, uThemePresence: { value: [...this.current.presence] }, uThemeEdited: { value: 0 }, uThemeExtra: { value: this.texture }, uThemeHasExtra: { value: 0 },
    };
  }
  setTheme(theme: ThemePreset) { this.target = compileTheme(theme, this.width); }
  advance(dt: number) {
    const amount = 1 - Math.exp(-Math.max(0, dt) / .42);
    let edited = false, extra = false, dirty = false;
    for (let i = 0; i < this.current.colors.length; i++) {
      const v = this.uniforms.uThemeColors.value[i] as THREE.Vector3;
      const target = this.target.colors[i];
      for (let j = 0; j < 3; j++) {
        const difference = target[j] - v.getComponent(j);
        v.setComponent(j, Math.abs(difference) < .000001 ? target[j] : v.getComponent(j) + difference * amount);
      }
      this.uniforms.uThemeOffset.value[i].set(v.x-bases[i].rgb[0],v.y-bases[i].rgb[1],v.z-bases[i].rgb[2]);
      if (i < 8) {
        const delta = this.uniforms.uThemeDelta.value[i] as THREE.Vector3;
        delta.set(v.x - bases[i].rgb[0], v.y - bases[i].rgb[1], v.z - bases[i].rgb[2]);
        edited ||= delta.lengthSq() > 1e-12;
      }
    }
    let presenceEdited=false;
    for (let i=0;i<9;i++) {
      const p=this.uniforms.uThemePresence.value as number[];
      const delta=this.target.presence[i]-p[i];
      p[i]=Math.abs(delta)<.000001 ? this.target.presence[i] : p[i]+delta*amount;
      edited ||= p[i]!==1; presenceEdited ||= p[i]!==1;
    }
    const data = this.current.extra;
    for (let i = 0; i < data.length; i++) {
      const difference = this.target.extra[i] - data[i];
      if (difference !== 0) { data[i] = Math.abs(difference) < .000001 ? this.target.extra[i] : data[i] + difference * amount; dirty = true; }
      if (i % 4 === 3 && data[i] > .000001) extra = true;
    }
    this.uniforms.uThemePresenceEdited.value=presenceEdited ? 1 : 0;
    this.uniforms.uThemeEdited.value = edited ? 1 : 0;
    this.uniforms.uThemeHasExtra.value = extra ? 1 : 0;
    if (dirty) this.texture.needsUpdate = true;
  }
  dispose() { this.texture.dispose(); }
}

export const themeUniformGLSL = /* glsl */ `
uniform vec3 uThemeColors[13];
uniform vec3 uThemeOffset[13];
uniform vec3 uThemeDelta[8];
uniform float uThemePresence[9];
uniform float uThemePresenceEdited;
uniform float uThemeEdited;
uniform sampler2D uThemeExtra;
uniform float uThemeHasExtra;
vec3 themeMap(vec3 dye,float includeDelta) {
  vec3 shift=vec3(0),standard=vec3(0),weighted=vec3(0); float total=0.0,weightTotal=0.0;
  ${cold.map((c, i) => `{ vec3 d=dye-vec3(${c.rgb.join(',')}); float w=1.0/pow(.0001+dot(d,d),2.0); shift+=uThemeDelta[${i}]*w; total+=w; standard+=uThemeColors[${i}]*w; weighted+=uThemeColors[${i}]*w*uThemePresence[${i}]; weightTotal+=w*uThemePresence[${i}]; }`).join('\n')}
  if(weightTotal<.00001) return vec3(0);
  return clamp(dye+includeDelta*shift/total+weighted/weightTotal-standard/total,0.0,1.0);
}
vec3 themeCold(vec3 dye) { return uThemeEdited<.5 ? dye : themeMap(dye,1.0); }
vec3 themeExtra(vec3 color,float coordinate) {
  if(uThemeHasExtra<.5) return color;
  vec4 dye=texture2D(uThemeExtra,vec2(clamp(coordinate,0.0,1.0),.5));
  return mix(color,dye.rgb,dye.a*.94);
}
`;

const chromaticSeedGLSL = `
vec2 chromaticSeed(vec3 p) {
  float label=fract(p.x*1.7+p.y*.8+p.z*.6+noise3(p*5.9+vec3(42,17,83))*.7);
  float phase=label*6.28318530718;
  return .5+.45*vec2(cos(phase),sin(phase));
}
`;

/** Add a shared spectral coordinate, transported by exactly the existing
 * departure points and limiter. It never contributes forces or density. */
export function withThemeTransport(shader: string) {
  return shader.replace('void main() {', chromaticSeedGLSL+'\nvoid main() {').replace('uniform int uPass;', `
layout(location=3) out vec4 outChromatic;
uniform sampler2D uChromatic;
uniform sampler2D uTransportChromatic;
uniform int uPass;`)
    .replace('outMatter=matter; return;', `outMatter=matter;
    outChromatic=vec4(chromaticSeed(p),0,0); return;`)
    .replace('outMatter.rgb+=departure-p; return;', `outMatter.rgb+=departure-p;
    outChromatic=volumeSample(uChromatic,departure); return;`)
    .replace('vec4 dyeLo=', `vec4 chromatic=volumeSample(uTransportChromatic,p)+.5*(volumeSample(uChromatic,p)-volumeSample(uTransportChromatic,p+originalVelocity.xyz*uDt));
  vec4 chromaLo=volumeSample(uChromatic,departure),chromaHi=chromaLo;
  vec4 dyeLo=`)
    .replace('dyeLo=min(dyeLo,min(ca,cb));', `vec4 qa=volumeSample(uChromatic,departure+offset),qb=volumeSample(uChromatic,departure-offset);
    chromaLo=min(chromaLo,min(qa,qb)); chromaHi=max(chromaHi,max(qa,qb));
    dyeLo=min(dyeLo,min(ca,cb));`)
    .replace('dye=clamp(dye,dyeLo,dyeHi);', 'dye=clamp(dye,dyeLo,dyeHi); chromatic=clamp(chromatic,chromaLo,chromaHi);')
    .replace('vec4 bornPigment=vec4(0);', 'vec4 bornPigment=vec4(0); vec2 bornChromatic=vec2(0);')
    .replace('bornPigment+=vec4(cool,warm)*addition;', 'bornPigment+=vec4(cool,warm)*addition; float chromaPhase=fract(seed*.6180339)*6.28318530718; bornChromatic+=(.5+.45*vec2(cos(chromaPhase),sin(chromaPhase)))*addition;')
    .replace('outPigment=vec4(kick,bornDensity); return;', 'outChromatic=chromatic; outPigment=vec4(kick,bornDensity); return;')
    .replace('outPigment=clamp(dye,', `if(bornDensity>0.0) chromatic.rg=mix(chromatic.rg,bornChromatic/max(.000001,bornDensity),bornDensity/max(.000001,corrected.a));
  chromatic.rg=mix(chromatic.rg,volumeSample(uHumiditySource,p).gb,dyeFeed);
  outChromatic=clamp(chromatic,0.0,1.0);
  outPigment=clamp(dye,`);
}

export function withThemeSource(shader: string) {
  return shader.replace('void main() {', chromaticSeedGLSL+'\nvoid main() {').replace('outHumidity=vec4(initialMatter(p).a,0,0,0);', 'outHumidity=vec4(initialMatter(p).a,chromaticSeed(p),0);');
}

export function withThemeVolume(shader: string) {
  return shader.replace('vec3 rayFootprint;', themeUniformGLSL.replaceAll('texture2D(', 'texture(') + '\nuniform sampler2D uChromatic;\nvec3 rayFootprint;')
    .replace('mix(vec3(.006,.020,.052),vec3(.014,.052,.087),vUv.y)', 'mix(uThemeColors[9],uThemeColors[10],vUv.y)')
    .replace('mix(pigment.rgb,vec3(.88,.43,.12),', 'mix(themeCold(pigment.rgb),uThemeColors[8],')
    .replace('smoothstep(.04,.30,pigment.a)', 'clamp(smoothstep(.04,.30,pigment.a)*uThemePresence[8],0.0,1.0)')
    .replace('// Colored ambient scattering', 'if(uThemeHasExtra>.5) { vec2 phase=volumeSample(uChromatic,p).rg-.5; vec3 tinted=themeExtra(albedo,fract(atan(phase.y,phase.x)/6.28318530718+1.0)); albedo=mix(albedo,tinted,smoothstep(.004,.025,length(phase))); }\n    // Colored ambient scattering')
    .replace('vec3(.15,.29,.32)*edge', 'uThemeColors[11]*edge')
    .replace('mix(scatter,vec3(.045,.12,.21),', 'mix(scatter,uThemeColors[12],');
}

export function withThemeSurface(shader: string) {
  // Delta interpretation retains each surface's original six material colors.
  const map: [string, number][] = [['.009,.033,.085',0],['.015,.14,.29',1],['.025,.43,.43',2],['.43,.78,.72',3],['.78,.52,.19',8],['.83,.86,.69',4]];
  let result = shader.replace('vec3 pigment(float', themeUniformGLSL + '\nvec3 pigment(float');
  for (const [rgb, i] of map) result = result.replace(`= vec3(${rgb});`, `= clamp(vec3(${rgb})+uThemeOffset[${i}],0.0,1.0);`);
  result = result.replace('gold*.72', 'clamp(gold*.72*uThemePresence[8],0.0,1.0)');
  result = result.replace('return mix(c,c*vec3', 'c+=uThemeOffset[5]*(1.0-smoothstep(-.6,0.0,x))*.45+uThemeOffset[6]*(1.0-abs(clamp(x,-1.0,1.0)))*.4+uThemeOffset[7]*smoothstep(0.0,.6,x)*.45;\n  if(uThemePresenceEdited>.5) c=themeMap(c,0.0);\n  c=themeExtra(c,smoothstep(-.65,.65,x));\n  return mix(c,c*vec3');
  result = result.replace('vec3(.56,.76,.67)*spec', `(vec3(.56,.76,.67)+uThemeOffset[11])*spec`);
  result = result.replace('vec3 color=pigment(colorField,gold,air);', `vec3 color=pigment(colorField,gold,air);
  color+=uThemeOffset[9]*(1.0-smoothstep(-.8,-.45,colorField))*.25;
  color+=uThemeOffset[10]*smoothstep(.2,.8,colorField)*.2;
  color+=uThemeOffset[12]*(1.0-smoothstep(-.4,.3,colorField))*.25;`);
  return result;
}
