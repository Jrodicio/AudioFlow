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
// Curl of a smooth vector potential; three axes and scales coexist. It supplies
// forces, not replacement animation coordinates for the density.
vec3 curlForce(vec3 p,vec3 k,vec3 phase) {
  vec3 s=sin(p*k+phase), c=cos(p*k+phase);
  return vec3(-k.y*s.x*s.y-k.z*c.z*c.x,
              -k.z*s.y*s.z-k.x*c.x*c.y,
              -k.x*s.z*s.x-k.y*c.y*c.z)/max(k.x,max(k.y,k.z));
}
`;

export const transportShader = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location=0) out vec4 outVelocity;
layout(location=1) out vec4 outMatter;
uniform sampler2D uVelocity;
uniform sampler2D uMatter;
uniform sampler2D uTransportVelocity;
uniform sampler2D uTransportMatter;
uniform int uPass; // 0 seed once; 1 forward transport; 2 limited correction/forces
uniform float uDt;
uniform float uSimulationTime;
uniform float uIntensity;
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
    outMatter=matter; return;
  }
  vec4 originalVelocity=volumeSample(uVelocity,p);
  vec3 midpoint=p-originalVelocity.xyz*uDt*.5;
  vec3 velocityAtMidpoint=volumeSample(uVelocity,midpoint).xyz;
  vec3 departure=p-velocityAtMidpoint*uDt;
  if(uPass==1) {
    outVelocity=volumeSample(uVelocity,departure);
    outMatter=volumeSample(uMatter,departure);
    outMatter.rgb+=departure-p; return;
  }
  vec4 transported=volumeSample(uTransportMatter,p);
  vec4 original=volumeSample(uMatter,p);
  vec4 reversed=volumeSample(uTransportMatter,p+originalVelocity.xyz*uDt);
  reversed.rgb+=originalVelocity.xyz*uDt;
  vec4 corrected=transported+.5*(original-reversed);
  // Monotonic MacCormack correction: preserve wisps without ringing, negative
  // density, unchecked sharpening or the diffusion of plain repeated bilerp.
  vec4 lo=volumeSample(uMatter,departure);
  lo.rgb+=departure-p;
  vec4 hi=lo;
  for(int axis=0;axis<3;axis++) {
    vec3 offset=vec3(0); offset[axis]=cell[axis];
    vec4 a=volumeSample(uMatter,departure+offset),b=volumeSample(uMatter,departure-offset);
    a.rgb+=departure+offset-p; b.rgb+=departure-offset-p;
    lo=min(lo,min(a,b)); hi=max(hi,max(a,b));
  }
  lo.rgb=min(lo.rgb,transported.rgb);
  hi.rgb=max(hi.rgb,transported.rgb);
  corrected=clamp(corrected,lo,hi);
  vec4 v=volumeSample(uTransportVelocity,p);
  float t=uSimulationTime;
  vec3 force=curlForce(p,vec3(4.1,5.3,3.7),vec3(t*.045,t*-.032,t*.038))*.0055;
  force+=curlForce(p,vec3(11.7,9.1,13.3),vec3(2.3-t*.09,4.7+t*.07,t*.05))*.002;
  force+=curlForce(p,vec3(27.3,24.1,22.7),vec3(t*.15,3.1-t*.12,7.9+t*.13))*.0006;
  force.y+=(corrected.a-.16)*.0014;
  for(int i=0;i<7;i++) {
    float band=float(i);
    vec3 center=vec3(.5+.3*sin(band*2.399)+uContext.y*.10,
      .5+.29*cos(band*1.73),.23+fract(band*.371)*.54);
    vec3 d=p-center;
    float mask=exp(-dot(d,d)*(i<2 ? 9.0 : (i<5 ? 24.0 : 48.0)));
    float level=(uBands[i]*.25+uSustained[i]*.65+uSalience[i]*.35)*uIntensity;
    vec3 axis=normalize(vec3(sin(band*1.7)+.2,1.0,cos(band*2.1)));
    if(i<2) {
      force+=(cross(axis,d)*.011+d*.004*uSalience[i])*mask*level;
    } else if(i<5) {
      force+=cross(axis,d)*mask*level*.032;
    } else {
      force+=curlForce(p-center,vec3(42,37,46),vec3(t*.6,band,-t*.5))*mask*level*.005;
    }
  }
  for(int i=0;i<12;i++) {
    vec4 e=uEvents[i];
    if(e.z>5.0 || e.w<.005) continue;
    vec3 center=vec3(e.xy,.22+fract(uEventBands[i]*.173)*.56);
    vec3 d=p-center;
    float r=length(d),radius=e.z*(.12+uEventBands[i]*.006);
    float shell=exp(-pow((r-radius)*12.0,2.0));
    float impulse=e.w*exp(-e.z*1.5)*shell*uIntensity;
    force+=d/max(r,.025)*impulse*.035;
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
  corrected.a=mix(corrected.a,originalVelocity.w,1.0-exp(-uDt*.045));
  outVelocity=vec4(v.xyz,originalVelocity.w);
  // Fine structures have a finite lifetime: continuously relax material strain
  // instead of resetting UVW maps or letting old coordinates fold into aliases.
  outMatter=vec4(clamp(corrected.rgb*exp(-uDt*.08),-1.0,1.0),clamp(corrected.a,0.0,1.0));
}
`;

export const volumeRenderShader = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uMatter;
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
  float erosion=.28-(detail-.5)*.8;
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
    vec3 pigment=textureLod(uDetail,(p+matter.rgb)*.65+vec3(.27,.11,.43),2.0).rgb;
    vec3 albedo=mix(vec3(.025,.17,.27),vec3(.12,.62,.57),smoothstep(.18,.78,pigment.r));
    albedo=mix(albedo,vec3(.70,.84,.75),smoothstep(.32,.70,pigment.g)*.70);
    albedo=mix(albedo,vec3(.55,.39,.17),smoothstep(.66,.90,pigment.b)*.45);
    vec3 scatter=albedo*(.27+light*1.70)+vec3(.15,.29,.27)*edge*light*.35;
    float depth=clamp((distance-near)/(far-near),0.0,1.0);
    scatter=mix(scatter,vec3(.045,.16,.21),depth*.3);
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
