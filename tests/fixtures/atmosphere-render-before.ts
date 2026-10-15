// Prompt 4 render, for matched-state definition comparisons.
import {volumeCoordinates} from '../../src/visual/atmosphereShaders';
export const renderBefore = /* glsl */ `
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
