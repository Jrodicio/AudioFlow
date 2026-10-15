/** Atmosphere-only shaders. Persistent 3D fields are stored in a tiled atlas;
 * sampler interpolation is confined to each slice, then interpolated in Z. */
export const volumeVertex = /* glsl */ `
out vec2 vUv;
void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
`;

export const volumeCoordinates = /* glsl */ `
uniform vec3 uGrid;
uniform vec2 uTiles;
vec2 sliceUV(vec2 xy,float slice) {
  vec2 tile=vec2(mod(slice,uTiles.x),floor(slice/uTiles.x));
  vec2 cell=clamp(xy*uGrid.xy-.5,vec2(0),uGrid.xy-1.0);
  return (tile*uGrid.xy+cell+.5)/(uGrid.xy*uTiles);
}
vec4 volumeSample(sampler2D atlas,vec3 p) {
  float z=clamp(p.z*uGrid.z-.5,0.0,uGrid.z-1.0);
  float a=floor(z), b=min(a+1.0,uGrid.z-1.0);
  return mix(texture(atlas,sliceUV(p.xy,a)),texture(atlas,sliceUV(p.xy,b)),z-a);
}
vec3 voxelPosition() {
  vec2 pixel=gl_FragCoord.xy-.5;
  vec2 tile=floor(pixel/uGrid.xy);
  return (vec3(mod(pixel,uGrid.xy),tile.y*uTiles.x+tile.x)+.5)/uGrid;
}
`;

const noise = /* glsl */ `
float hash3(vec3 p) {
  p=fract(p*.1031); p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float noise3(vec3 p) {
  vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),
    mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),
    mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float cloudNoise(vec3 p) {
  float n=0.0,a=.54;
  for(int i=0;i<5;i++) {
    n+=a*noise3(p); p=p.yzx*2.03+vec3(11.7,5.3,8.9); a*=.47;
  }
  return n;
}
vec4 initialMatter(vec3 p) {
  vec3 q=vec3(p.x*1.2+p.z*.27,p.y,p.z*.68);
  vec3 warp=vec3(noise3(q*3.2),noise3(q*3.2+7.1),noise3(q*3.2+17.8));
  float body=cloudNoise(q*3.6+warp*1.3+vec3(4.7,1.2,8.3));
  float detail=cloudNoise(p*16.0+warp*2.0);
  float density=smoothstep(.48,.605,body+(detail-.47)*.27)*.96;
  density*=smoothstep(.31,.53,body);
  float envelope=smoothstep(0.0,.12,p.z)*smoothstep(0.0,.10,1.0-p.z);
  // RGB retains displacement of material coordinates, initially zero. Keeping
  // displacement rather than absolute UVW preserves small increments in FP16.
  return vec4(0,0,0,density*envelope);
}
// Independent broad dye bodies, seeded once. RGB is subsequently transported,
// not reconstructed from screen position, density, time or acoustic energy.
vec4 initialPigment(vec3 p) {
  vec3 warp=vec3(noise3(p*3.1+4.2),noise3(p*3.1+13.7),noise3(p*3.1+27.1));
  float body=noise3(p*5.3+warp*2.2+vec3(3,9,2));
  vec3 dye=mix(vec3(.025,.065,.40),vec3(.045,.24,.82),smoothstep(.24,.48,body));
  dye=mix(dye,vec3(.015,.67,.62),smoothstep(.46,.64,body));
  dye=mix(dye,vec3(.30,.86,.92),smoothstep(.65,.82,body));
  float pale=noise3(p*7.1+warp+31.7);
  dye=mix(dye,vec3(.82,.91,.94),smoothstep(.63,.84,pale)*.8);
  float gold=noise3(p*6.2+warp*1.7+73.4);
  // Store warm dye concentration separately in the spare channel. Direct RGB
  // averaging of copper and cyan otherwise neutralizes both over long runs.
  return vec4(dye,smoothstep(.63,.79,gold));
}
// Curl of a smooth vector potential; three axes and scales coexist. It supplies
// forces, not replacement animation coordinates for the density.
vec3 curlForce(vec3 p,vec3 k,vec3 phase) {
  vec3 s=sin(p*k+phase), c=cos(p*k+phase);
  return vec3(-k.y*s.x*s.y-k.z*c.z*c.x,
              -k.z*s.y*s.z-k.x*c.x*c.y,
              -k.x*s.z*s.x-k.y*c.y*c.z)/max(k.x,max(k.y,k.z));
}
`;

export const pigmentSourceShader = /* glsl */ `
precision highp float;
out vec4 outSource;
${volumeCoordinates}
${noise}
void main() { outSource=initialPigment(voxelPosition()); }
`;

export const transportShader = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location=0) out vec4 outVelocity;
layout(location=1) out vec4 outMatter;
layout(location=2) out vec4 outPigment;
uniform sampler2D uVelocity;
uniform sampler2D uMatter;
uniform sampler2D uTransportVelocity;
uniform sampler2D uTransportMatter;
uniform sampler2D uPigment;
uniform sampler2D uTransportPigment;
uniform sampler2D uPigmentSource;
uniform int uPass; // 0 seed once; 1 forward transport; 2 limited correction/forces
uniform float uDt;
uniform float uSimulationTime;
uniform float uIntensity;
uniform float uAcousticGain;
uniform int uDiagnostic; // Test-only force readback, never enabled in production.
uniform float uBands[7];
uniform float uSustained[7];
uniform float uSalience[7];
uniform vec4 uEvents[12];
uniform float uEventBands[12];
uniform vec4 uContext;
${volumeCoordinates}
${noise}
void main() {
  vec3 p=voxelPosition(),cell=1.0/uGrid;
  if(uPass==0) {
    vec4 matter=initialMatter(p);
    outVelocity=vec4(curlForce(p,vec3(4,5,3),vec3(1,2,3))*.008,matter.a);
    outPigment=initialPigment(p);
    outMatter=matter; return;
  }
  vec4 originalVelocity=volumeSample(uVelocity,p);
  vec3 midpoint=p-originalVelocity.xyz*uDt*.5;
  vec3 velocityAtMidpoint=volumeSample(uVelocity,midpoint).xyz;
  vec3 departure=p-velocityAtMidpoint*uDt;
  if(uPass==1) {
    outVelocity=volumeSample(uVelocity,departure);
    outMatter=volumeSample(uMatter,departure);
    outPigment=volumeSample(uPigment,departure);
    outMatter.rgb+=departure-p; return;
  }
  vec4 transported=volumeSample(uTransportMatter,p);
  vec4 original=volumeSample(uMatter,p);
  vec4 reversed=volumeSample(uTransportMatter,p+originalVelocity.xyz*uDt);
  reversed.rgb+=originalVelocity.xyz*uDt;
  vec4 corrected=transported+.5*(original-reversed);
  vec4 dye=volumeSample(uTransportPigment,p)+.5*(volumeSample(uPigment,p)
    -volumeSample(uTransportPigment,p+originalVelocity.xyz*uDt));
  // Monotonic MacCormack correction: preserve wisps without ringing, negative
  // density, unchecked sharpening or the diffusion of plain repeated bilerp.
  vec4 lo=volumeSample(uMatter,departure);
  lo.rgb+=departure-p;
  vec4 hi=lo;
  vec4 dyeLo=volumeSample(uPigment,departure),dyeHi=dyeLo;
  for(int axis=0;axis<3;axis++) {
    vec3 offset=vec3(0); offset[axis]=cell[axis];
    vec4 a=volumeSample(uMatter,departure+offset),b=volumeSample(uMatter,departure-offset);
    a.rgb+=departure+offset-p; b.rgb+=departure-offset-p;
    lo=min(lo,min(a,b)); hi=max(hi,max(a,b));
    vec4 ca=volumeSample(uPigment,departure+offset),cb=volumeSample(uPigment,departure-offset);
    dyeLo=min(dyeLo,min(ca,cb)); dyeHi=max(dyeHi,max(ca,cb));
  }
  lo.rgb=min(lo.rgb,transported.rgb);
  hi.rgb=max(hi.rgb,transported.rgb);
  corrected=clamp(corrected,lo,hi);
  dye=clamp(dye,dyeLo,dyeHi);
  vec4 v=volumeSample(uTransportVelocity,p);
  float t=uSimulationTime;
  vec3 force=curlForce(p,vec3(4.1,5.3,3.7),vec3(t*.045,t*-.032,t*.038))*.0055;
  force+=curlForce(p,vec3(11.7,9.1,13.3),vec3(2.3-t*.09,4.7+t*.07,t*.05))*.002;
  force+=curlForce(p,vec3(27.3,24.1,22.7),vec3(t*.15,3.1-t*.12,7.9+t*.13))*.0006;
  force.y+=(corrected.a-.16)*.0014;
  vec3 ambientForce=force;
  vec3 acousticForce=vec3(0);
  for(int i=0;i<7;i++) {
    float band=float(i);
    // Slow, incommensurate drift and existing material displacement avoid seven
    // stationary vortex stamps. The pressure field bends existing currents.
    vec3 center=vec3(.5+.26*sin(band*2.399+t*.073)+uContext.y*.08,
      .5+.25*cos(band*1.73-t*.061),.25+fract(band*.371)*.50);
    vec3 d=p-center;
    d+=corrected.rgb*.32;
    float radius=i<2 ? .38 : (i<5 ? .25 : .18);
    float mask=exp(-dot(d,d)/(radius*radius));
    float level=(uBands[i]*.60+uSustained[i]*.55+uSalience[i]*.40)*uIntensity*uAcousticGain;
    vec3 axis=normalize(vec3(sin(band*1.7)+.2,1.0,cos(band*2.1)));
    if(i<2) {
      // Units: normalized volume lengths/s². Normalize by influence radius;
      // the former raw cross(axis,d) silently attenuated the gain again.
      vec3 current=cross(axis,d)/radius;
      vec3 pressure=axis*.55+curlForce(p+corrected.rgb*.3,vec3(5,4,6),vec3(band,t*.11,2))*.45;
      acousticForce+=(current*.024+pressure*.028)*mask*level;
    } else if(i<5) {
      vec3 eddy=curlForce(d,vec3(15,19,13),vec3(band,t*.21,-t*.17));
      acousticForce+=(cross(axis,d)/radius*.045+eddy*.016)*mask*level;
    } else {
      // Resolve these eddies on the 48-slice grid; don't inject sub-voxel noise.
      float edge=.35+.65*(1.0-smoothstep(.15,.75,corrected.a));
      acousticForce+=curlForce(d,vec3(39,33,35),vec3(t*.6,band,-t*.5))*mask*level*.050*edge;
    }
  }
  for(int i=0;i<12;i++) {
    vec4 e=uEvents[i];
    if(e.z>5.0 || e.w<.005) continue;
    vec3 center=vec3(e.xy,.20+fract(uEventBands[i]*.173+dot(e.xy,vec2(.73,1.31)))*.60);
    vec3 d=p-center;
    float r=length(d),radius=.045+e.z*(.12+uEventBands[i]*.006);
    // Warped thick pressure front and tangential wake give a local impulse
    // lasting ~0.4 s, without drawing a spherical surface in the image.
    float warpedRadius=radius+.018*sin(dot(d,vec3(19,13,17)));
    float shell=exp(-pow((r-warpedRadius)*15.0,2.0));
    float impulse=e.w*exp(-e.z*2.4)*shell*uIntensity*uAcousticGain;
    vec3 axis=normalize(vec3(.4+sin(uEventBands[i]),1,.7));
    acousticForce+=(d/max(r,.04)*.24+cross(axis,d)*.20)*impulse;
  }
  force=ambientForce+acousticForce;
  if(uDiagnostic==1) {
    outVelocity=vec4(ambientForce,0); outMatter=vec4(acousticForce,0);
    outPigment=vec4(0); return;
  }
  // Velocity is advected, forced, then damped. It continues transporting matter
  // after the audio disappears; no audio variable sets position, scale or light.
  v.xyz=v.xyz*exp(-uDt*.26)+force*uDt;
  float speed=length(v.xyz);
  v.xyz*=min(1.0,.085/max(speed,.000001));
  vec3 boundary=smoothstep(cell*.5,cell*3.0,p)*smoothstep(cell*.5,cell*3.0,1.0-p);
  v.xyz*=boundary;
  // W retains the initial humidity reservoir, not transported pigment. Smooth
  // condensation/evaporation over 22 s counteracts transport loss without a reset
  // or exposing a static image. Existing density continues moving through it.
  float transportedDensity=corrected.a;
  corrected.a=mix(corrected.a,originalVelocity.w,1.0-exp(-uDt*.045));
  // Newly condensed matter carries dye from an independent, seeded reservoir.
  // A very slow dye feed prevents irreversible numerical homogenization over
  // minutes. Existing dye is still advected/stretching, never reset or recolored
  // by audio. The source is cached once rather than recomputing 3D noise/step.
  float fresh=max(0.0,corrected.a-transportedDensity)/max(.04,corrected.a);
  float dyeFeed=1.0-(1.0-fresh)*exp(-uDt*.025);
  dye=mix(dye,volumeSample(uPigmentSource,p),dyeFeed);
  outVelocity=vec4(v.xyz,originalVelocity.w);
  // Fine structures have a finite lifetime: continuously relax material strain
  // instead of resetting UVW maps or letting old coordinates fold into aliases.
  outMatter=vec4(clamp(corrected.rgb*exp(-uDt*.08),-1.0,1.0),clamp(corrected.a,0.0,1.0));
  outPigment=clamp(dye,0.0,1.0);
}
`;

export const volumeRenderShader = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uMatter;
uniform sampler2D uPigment;
uniform sampler3D uDetail;
uniform sampler2D uHistory;
uniform float uHistoryWeight;
uniform float uFrame;
uniform vec2 uResolution;
uniform int uSteps;
uniform vec2 uDepthWindow; // Full range in production; isolated slices in GPU tests.
${volumeCoordinates}
float rayFootprint;
float densityAt(vec3 p,vec4 matter) {
  vec3 material=p+matter.rgb;
  float broadLod=clamp(log2(max(.001,rayFootprint*64.0*4.2*.35)),.6,3.0);
  float fineLod=clamp(log2(max(.001,rayFootprint*64.0*13.1*.35)),1.0,4.0);
  vec2 broad=textureLod(uDetail,material*4.2,broadLod).rg;
  float fine=textureLod(uDetail,material*13.1,fineLod).g;
  float detail=broad.r*.50+broad.g*.25+fine*.25;
  float erosion=.24-(detail-.5)*.8;
  return max(0.0,matter.a-erosion)*2.2;
}
void main() {
  float aspect=uResolution.x/uResolution.y;
  vec3 extent=vec3(2.65*aspect,2.65,3.0);
  vec3 origin=vec3(0,0,7.2);
  vec3 ray=normalize(vec3((vUv-.5)*vec2(aspect,1.0)*1.7,-2.3));
  vec3 safeRay=mix(vec3(.00001),ray,greaterThan(abs(ray),vec3(.00001)));
  vec3 a=(-extent-origin)/safeRay,b=(extent-origin)/safeRay;
  vec3 nearPlane=min(a,b),farPlane=max(a,b);
  float near=max(0.0,max(nearPlane.x,max(nearPlane.y,nearPlane.z)));
  float far=min(farPlane.x,min(farPlane.y,farPlane.z));
  float span=far-near;
  far=near+span*uDepthWindow.y;
  near+=span*uDepthWindow.x;
  vec3 background=mix(vec3(.006,.020,.052),vec3(.014,.052,.087),vUv.y);
  if(far<=near) {outColor=vec4(background,1);return;}
  float stepLength=(far-near)/float(uSteps);
  rayFootprint=length(ray*stepLength/extent*.5);
  // Interleaved sampling removes coherent slice bands. Its subpixel noise is
  // integrated over successive frames instead of appearing as animated grain.
  float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy+mod(uFrame,8.0)*vec2(5.588,3.117),vec2(.06711056,.00583715))));
  float transmission=1.0;
  vec3 color=vec3(0);
  vec3 lightDirection=normalize(vec3(-.65,.8,.45));
  for(int i=0;i<80;i++) {
    if(i>=uSteps || transmission<.015) break;
    float distance=near+(float(i)+jitter)*stepLength;
    vec3 world=origin+ray*distance;
    vec3 p=world/extent*.5+.5;
    vec4 matter=volumeSample(uMatter,p);
    float density=densityAt(p,matter);
    if(density<.002) continue;
    vec3 lightNear=p+lightDirection*.055,lightFar=p+lightDirection*.15;
    float closeShadow=densityAt(lightNear,volumeSample(uMatter,lightNear));
    float farShadow=densityAt(lightFar,volumeSample(uMatter,lightFar));
    float light=exp(-(closeShadow*.8+farShadow*1.3)*2.2);
    float edge=clamp((density-closeShadow)*3.0+.35,0.0,1.0);
    vec4 pigment=volumeSample(uPigment,p);
    vec3 albedo=mix(pigment.rgb,vec3(.88,.43,.12),smoothstep(.04,.30,pigment.a));
    // Colored ambient scattering retains blue/teal identity inside occlusion;
    // directional attenuation still supplies internal shadows and thickness.
    vec3 scatter=albedo*(.42+light*1.45)+vec3(.15,.29,.32)*edge*light*.25;
    float depth=clamp((distance-near)/(far-near),0.0,1.0);
    scatter=mix(scatter,vec3(.045,.12,.21),depth*.16);
    float opacity=1.0-exp(-density*stepLength*1.4);
    color+=transmission*opacity*scatter;
    transmission*=1.0-opacity;
  }
  color+=background*transmission;
  color*=1.0-.10*dot(vUv-.5,vUv-.5);
  // Fixed, minute dither suppresses banding; no temporal noise or audio exposure.
  float dither=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;
  color=pow(max(color,vec3(0)),vec3(.88))+dither/1024.0;
  color=mix(color,texture(uHistory,vUv).rgb,uHistoryWeight);
  outColor=vec4(clamp(color,0.0,1.0),1.0);
}
`;
