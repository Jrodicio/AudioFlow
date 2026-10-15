export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const acousticUniforms = /* glsl */ `
uniform float uBands[7];
uniform float uSustained[7];
uniform float uSalience[7];
uniform float uTension[7];
uniform vec4 uEvents[12]; // UV position, age in seconds, strength
uniform float uEventBands[12];
uniform vec4 uContext; // structure, stereo balance, width, flatness
vec2 regionCenter(int i) {
  float b=float(i);
  return vec2(.5+.3*sin(b*2.399),.5+.29*cos(b*1.73));
}
`;

export const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPalette;
uniform vec3 uStyle;
uniform vec4 uAudio; // energy, bass, mids, treble
uniform vec4 uMotion; // slow energy, centroid, impulse, intensity
uniform int uOctaves;
uniform sampler2D uFluid;
uniform float uFluidQuantized;
${acousticUniforms}

// Analytic derivatives of continuous gradient noise provide a divergence-free
// curl field without extra noise evaluations or CPU simulation.
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return -1.0 + 2.0 * fract((p3.xx + p3.yz) * p3.zy);
}
vec3 noiseD(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  vec2 ga = hash22(i), gb = hash22(i+vec2(1,0));
  vec2 gc = hash22(i+vec2(0,1)), gd = hash22(i+vec2(1,1));
  float a = dot(ga,f), b = dot(gb,f-vec2(1,0));
  float c = dot(gc,f-vec2(0,1)), d = dot(gd,f-vec2(1,1));
  float value = mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
  vec2 derivative = mix(mix(ga,gb,u.x),mix(gc,gd,u.x),u.y)
    + du * vec2(mix(b-a,d-c,u.y),mix(c-a,d-b,u.x));
  return vec3(value,derivative);
}
const mat2 ROT = mat2(.80, -.60, .60, .80);
vec3 fbm(vec2 p) {
  float amplitude = .52;
  float frequency = 1.0;
  vec3 total = vec3(0);
  mat2 transform = mat2(1.0);
  for (int i=0; i<6; i++) {
    if (i >= uOctaves) break;
    vec3 n = noiseD(p);
    total.x += amplitude*n.x;
    total.yz += amplitude * frequency * (n.yz * transform);
    p = ROT*p*2.03 + vec2(13.7, 9.2);
    transform = ROT * transform;
    frequency *= 2.03;
    amplitude *= .44;
  }
  return total;
}
float field(vec2 p) { return fbm(p).x; }
vec3 pigment(float x, float gold, float air) {
  vec3 abyss = vec3(.009,.033,.085);
  vec3 cobalt = vec3(.015,.14,.29);
  vec3 teal = vec3(.025,.43,.43);
  vec3 foam = vec3(.43,.78,.72);
  vec3 ochre = vec3(.78,.52,.19);
  vec3 pearl = vec3(.83,.86,.69);
  vec3 c = mix(abyss,cobalt,smoothstep(-.65,-.12,x));
  c = mix(c,teal,smoothstep(-.25,.26,x));
  c = mix(c,foam,smoothstep(.22,.65,x));
  c = mix(c,ochre,gold*.72);
  c = mix(c,pearl,smoothstep(.62,1.0,x)*.6);
  return mix(c,c*vec3(.82,1.04,1.08),air*.45);
}
vec4 fluidSample(vec2 uv) {
  vec4 s=texture2D(uFluid,uv);
  return uFluidQuantized>.5 ? vec4(.5,.5,s.r+s.g/255.0,s.b+s.a/255.0) : s;
}
float fluidHeight(vec2 uv) {
  vec2 dye=fluidSample(uv).ba;
  return (dye.x-dye.y)*.5+sin((dye.x+dye.y)*13.0+(dye.x-dye.y)*7.0)*.025;
}
void main() {
  vec2 uv = vUv;
  vec2 p = (uv-.5)*vec2(uResolution.x/uResolution.y,1.0)*2.65;
  float air=uStyle.x, liquid=uStyle.y, rockStyle=uStyle.z;
  float energy=uAudio.x*uMotion.w;
  float bass=uAudio.y*uMotion.w;
  float treble=uAudio.w*uMotion.w;
  float mids=uAudio.z*uMotion.w;
  float slow=uMotion.x*uMotion.w;
  float impulse=uMotion.z*uMotion.w;
  float t=uTime;
  vec4 local=vec4(0);
  vec2 acoustic=vec2(0);
  float stress=0.0;
  for(int i=0;i<7;i++) {
    vec2 center=regionCenter(i)+vec2(uContext.y*.12,0);
    vec2 d=(uv-center)*vec2(uResolution.x/uResolution.y,1);
    float mask=exp(-dot(d,d)*(3.0+float(i)*.65)/(1.0+uContext.z*.4));
    float excitation=(uBands[i]*.55+uSustained[i]*.45)*uMotion.w;
    float accent=uSalience[i]*mask*uMotion.w;
    if(i<2) local.x+=excitation*mask;
    else if(i<5) local.y+=excitation*mask;
    else local.z+=excitation*mask;
    local.w+=accent;
    stress+=mask*uTension[i]*sin(p.x*(1.1+float(i)*.27)+p.y*.7+t*.16)*.16*uMotion.w;
    acoustic+=vec2(-d.y,d.x)*mask*(excitation*.12+accent*.18);
  }
  float pressure=0.0;
  for(int i=0;i<12;i++) {
    vec4 e=uEvents[i];
    if(e.z>5.0 || e.w<.01) continue;
    vec2 d=(uv-e.xy)*vec2(uResolution.x/uResolution.y,1);
    float radius=length(d);
    float travel=e.z*(.17+uEventBands[i]*.018);
    float wave=sin((radius-travel)*22.0)*exp(-pow((radius-travel)*5.0,2.0));
    float decay=exp(-e.z*1.05)*e.w*uMotion.w;
    acoustic+=d/max(radius,.04)*wave*decay*.12;
    pressure+=wave*decay;
  }
  // Excitations bend existing material locally, without changing the world clock.
  p+=acoustic*(.7+liquid*.3)+vec2(stress*.16,-stress*.1)*rockStyle;
  // A slow travelling domain, advected along the curl of a scalar potential.
  vec2 drift=vec2(t*.10,-t*.067);
  vec3 potential=noiseD(p*.55+drift*.55);
  vec2 curl=vec2(potential.z,-potential.y);
  curl /= 1.0+length(curl)*.6;
  p += curl*(.38+.25*liquid+.12*local.y);
  p *= 1.0 + .045*slow + .1*rockStyle;
  vec2 q = vec2(field(p*.7+drift),field(p*.7+vec2(5.2,1.3)-drift*.63));
  vec2 r = vec2(field(p+q*2.1+vec2(1.7,9.2)+drift*.31),
                field(p+q*2.3+vec2(8.3,2.8)-drift*.23));
  // The impulse bends the field; it never changes exposure or swaps a scene.
  float viscosity=1.0/(1.0+bass*.2);
  vec2 warped = p + q*(1.45+local.x*.22)*viscosity + r*(2.3+liquid*.8);
  warped += vec2(r.y,-r.x)*local.y*(.1+uContext.w*.08);
  float body=field(warped+drift*.16);
  float broad=field(p*.65+q*.6-drift*.25);
  float lace=field(warped*(2.4+local.z*.7+uMotion.y*uMotion.w*.3)+r+drift*.11);
  float striation=field(vec2(warped.x*1.8,warped.y*6.0)+drift*.17);
  float marble=sin(body*(15.0+liquid*8.0+rockStyle*9.0)+broad*5.0+lace*2.2);
  float vein=pow(1.0-abs(marble),7.0);
  float folds=smoothstep(-.35,.65,marble);
  float relief=mix(body*.5,body*.7+folds*.14+lace*.12,liquid+rockStyle);
  relief += rockStyle*(striation*.22+vein*.09);
  float colorField=body*2.6+broad*.7+r.x*.45;
  colorField += liquid*folds*.17+rockStyle*striation*.55;
  // Liquid pigment is transported in a persistent GPU field, not re-created by
  // a time warp. Its two concentrations also define a continuous surface.
  vec4 fluid=fluidSample(uv);
  float dye=fluid.b-fluid.a;
  float fluidFold=sin((fluid.b+fluid.a)*13.0+dye*7.0);
  float fluidRelief=dye*.5+fluidFold*.025;
  colorField=mix(colorField,dye*3.4+(fluid.b+fluid.a-.9)*.65+body*.15,liquid);
  relief=mix(relief,fluidRelief,liquid);
  // Anchored geological strata resist advection. Smooth ridges and restrained
  // derivative lighting replace the old noisy marble outlines.
  vec2 rock=p*vec2(.72,1.05)+vec2(stress*.6,stress*.85);
  vec3 massifNoise=fbm(rock*.7+vec2(12.4,4.7)+vec2(t*.012,-t*.009));
  float massif=massifNoise.x;
  vec2 massifGradient=massifNoise.yz*.7;
  float phase=rock.y*11.0+massif*9.0+rock.x*.8+stress*2.0;
  float strata=sin(phase);
  float ridge=sqrt(strata*strata+.08);
  vec3 rockDetail=noiseD(rock*3.1);
  float rockRelief=massif*.85+ridge*.16+rockDetail.x*.045+stress*.17+pressure*.025;
  vec2 rockGradient=(massifGradient*.85+strata*cos(phase)/ridge*
    (vec2(.8,11.0)+massifGradient*9.0)*.16+rockDetail.yz*.1395)*vec2(.72,1.05);
  float rockColor=massif*2.8+strata*.07+local.y*.07;
  relief=mix(relief,rockRelief,rockStyle);
  colorField=mix(colorField,rockColor,rockStyle);
  float mineral=field(p*.6+vec2(19.1,7.7)+r*.7+uPalette*.035);
  float gold=smoothstep(-.02,.25,mineral+broad*.4)*(.65+vein*.35);
  gold=mix(gold,smoothstep(.02,.28,fluid.a-fluid.b)*.75,liquid);
  float rockOre=noiseD(rock*.83+vec2(19.1,7.7)).x;
  gold=mix(gold,smoothstep(.04,.3,rockOre)*.6,rockStyle);
  vec3 color=pigment(colorField,gold,air);
  // Fine directional pigment, subdued in the gaseous material.
  color *= 1.0+lace*(.22*air+.05*liquid)+vein*.05*liquid;
  float seam=exp(-pow(strata*6.0,2.0));
  color+=vec3(.12,.23,.18)*seam*rockStyle*(local.z*.18+local.w*.22);
  // Local acoustic accents preserve the palette and evolve with band memory.
  color=mix(color,color*vec3(1.18,1.07,.87),clamp(local.w*.19,0.0,.22));
  color*=1.0+local.x*.035+local.z*.06+pressure*.035;
  float pixelScale = max(length(dFdx(p)),length(dFdy(p)));
  vec2 slope=vec2(dFdx(relief),dFdy(relief))/max(pixelScale,.0001);
  // Central differences across several fluid texels avoid FP16 terraces and
  // screen-derivative grid artifacts on a smooth viscous surface.
  vec2 h=vec2(2.0/512.0);
  vec2 fluidSlope=vec2(fluidHeight(uv+vec2(h.x,0))-fluidHeight(uv-vec2(h.x,0)),
    fluidHeight(uv+vec2(0,h.y))-fluidHeight(uv-vec2(0,h.y)))/(2.0*h*2.65);
  fluidSlope.x/=uResolution.x/uResolution.y;
  slope=mix(slope,fluidSlope,liquid);
  // Analytic mineral normals avoid finite-difference contour/pixel artifacts.
  slope=mix(slope,rockGradient,rockStyle);
  float reliefStrength=(.08*air+1.05*liquid+1.35*rockStyle)*(1.0+local.x*.25);
  vec3 normal=normalize(vec3(-slope*reliefStrength,1.0));
  vec3 light=normalize(vec3(-.55,.7,.9));
  float diffuse=max(dot(normal,light),0.0);
  float spec=pow(max(dot(reflect(-light,normal),vec3(0,0,1)),0.0),24.0);
  color *= .72+diffuse*.58;
  color += vec3(.56,.76,.67)*spec*(.22*liquid+.06*rockStyle)*(1.0+local.z*.7);
  // Volumetric haze is derived from the same domain as the sculpted surface.
  float haze=smoothstep(-.05,.55,body+broad*.7);
  color=mix(color,vec3(.25,.59,.58),haze*air*.32);
  float vignette=1.0-.23*dot(uv-.5,uv-.5);
  color*=vignette;
  float luminance=dot(color,vec3(.2126,.7152,.0722));
  color=mix(vec3(luminance),color,1.02+slow*.12+local.w*.08);
  color*=1.02+slow*.08;
  // Static subpixel dithering, never temporal flicker.
  float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;
  color += grain/320.0;
  color=pow(max(color,vec3(0)),vec3(.88));
  gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
}`;

/** Semi-Lagrangian transport: RG encodes velocity, BA two pigment densities.
 * Low-resolution ping-pong targets provide inertia without GPU readback. */
export const fluidShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrevious;
uniform vec2 uTexel;
uniform float uDt;
uniform float uTime;
uniform float uInitialize;
uniform float uIntensity;
uniform float uAspect;
uniform float uQuantized;
${acousticUniforms}
vec2 decode(vec2 v) { return (v-.5)*.25; }
vec4 readState(vec2 uv) {
  vec4 s=texture2D(uPrevious,uv);
  return uQuantized>.5 ? vec4(.5,.5,s.r+s.g/255.0,s.b+s.a/255.0) : s;
}
vec4 encode(vec2 velocity,vec2 pigment) {
  pigment=clamp(pigment,.02,.98);
  // Two 16-bit fixed-point pigment fields in RGBA8. A coherent velocity field
  // replaces stored velocity here, whose tiny increments would quantize away.
  if(uQuantized>.5) {
    vec2 scaled=pigment*255.0;
    return vec4(floor(scaled.x)/255.0,fract(scaled.x),floor(scaled.y)/255.0,fract(scaled.y));
  }
  return vec4(clamp(.5+velocity*4.0,.02,.98),pigment);
}
vec2 seed(vec2 p) {
  return vec2(.46+.21*sin(p.x*8.0+sin(p.y*7.0)*1.7)+.1*cos(p.y*15.0+p.x*3.0),
              .44+.2*cos(p.y*9.0+sin(p.x*6.0)*1.8)+.1*sin(p.x*14.0-p.y*4.0));
}
void main() {
  vec2 uv=vUv;
  if(uInitialize>.5) { gl_FragColor=encode(vec2(0),seed(uv)); return; }
  vec2 p=uv*vec2(uAspect,1.0);
  float t=uTime*.09;
  // Curl of a coherent stream function, including an ambient force in silence.
  vec2 force=vec2(cos(p.y*5.0-t)*sin(p.x*4.0+t*.7),
    -cos(p.x*4.0+t*.7)*sin(p.y*5.0-t))*.004;
  for(int i=0;i<7;i++) {
    vec2 d=(uv-regionCenter(i)-vec2(uContext.y*.12,0))*vec2(uAspect,1);
    float mask=exp(-dot(d,d)*(5.0+float(i)*1.4));
    float a=(uBands[i]*.4+uSustained[i]*.6+uSalience[i]*.35)*uIntensity;
    float turn=i<2 ? .007 : (i<5 ? .014 : .005);
    force+=vec2(-d.y,d.x)*mask*a*turn;
    if(i>4) force+=d*mask*a*.0015*sin(p.y*32.0+t);
  }
  for(int i=0;i<12;i++) {
    vec4 e=uEvents[i];
    if(e.z>3.5 || e.w<.01) continue;
    vec2 d=(uv-e.xy)*vec2(uAspect,1);
    float radius=length(d);
    float wave=exp(-pow((radius-e.z*.19)*9.0,2.0));
    force+=d/max(radius,.03)*wave*exp(-e.z*2.0)*e.w*uIntensity*.025;
  }
  vec2 velocity=uQuantized>.5 ? force*2.2 : decode(readState(uv).rg);
  vec2 midpoint=clamp(uv-velocity*uDt*.5,uTexel,1.0-uTexel);
  vec2 midVelocity=uQuantized>.5 ? velocity : decode(readState(midpoint).rg);
  vec2 back=clamp(uv-midVelocity*uDt,uTexel,1.0-uTexel);
  vec4 advected=readState(back);
  vec4 neighbors=(readState(back+vec2(uTexel.x,0))+
    readState(back-vec2(uTexel.x,0))+
    readState(back+vec2(0,uTexel.y))+
    readState(back-vec2(0,uTexel.y)))*.25;
  if(uQuantized<.5) {
    velocity=mix(decode(advected.rg),decode(neighbors.rg),min(.18,uDt*4.0));
    velocity=velocity*exp(-uDt*.45)+force*uDt;
  }
  // Soft impermeable boundaries; no wrapped seams.
  velocity*=smoothstep(vec2(0),uTexel*8.0,uv)*smoothstep(vec2(0),uTexel*8.0,1.0-uv);
  vec2 pigment=mix(advected.ba,neighbors.ba,min(.1,uDt*.7));
  pigment=mix(pigment,seed(uv+vec2(sin(t*.3),cos(t*.23))*.07),1.0-exp(-uDt*.018));
  gl_FragColor=encode(velocity,pigment);
}`;

