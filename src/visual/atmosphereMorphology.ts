/** Shape only: the approved palette, acoustic forces and plume budget remain
 * in atmosphereShaders.ts. These adapters compose with the existing theme bindings. */
export const formationDensityGLSL = /* glsl */ `
vec4 initialMatter(vec3 p) {
  vec3 warp=vec3(noise3(p*5.1+4.7),noise3(p*5.1+17.3),noise3(p*5.1+39.1))-.5;
  float density=0.0;
  // Six finite, bent smoke courses at different depths. They are seeded in
  // world space once, then advected as actual density, never screen masks.
  for(int i=0;i<6;i++) {
    float id=float(i);
    vec3 center;
    float angle,width,span;
    if(i==0) {center=vec3(.29,.34,.22);angle=.48;width=.115;span=.34;}
    else if(i==1) {center=vec3(.68,.69,.31);angle=-.63;width=.095;span=.31;}
    else if(i==2) {center=vec3(.27,.73,.52);angle=1.13;width=.070;span=.26;}
    else if(i==3) {center=vec3(.72,.28,.60);angle=.85;width=.065;span=.29;}
    else if(i==4) {center=vec3(.49,.54,.78);angle=-.42;width=.039;span=.30;}
    else {center=vec3(.18,.46,.87);angle=1.17;width=.029;span=.22;}
    vec3 axis=normalize(vec3(cos(angle),sin(angle),.16*sin(id*2.4)));
    vec3 side=vec3(-sin(angle),cos(angle),0),across=cross(axis,side);
    vec3 d=p-center;
    float along=dot(d,axis);
    float lateral=dot(d,side)+sin(along*8.0+id*2.1)*width*.70;
    float deep=dot(d,across)+cos(along*6.0+id)*width*.38;
    lateral+=dot(warp,side)*width*2.6;
    deep+=dot(warp,across)*width*1.8;
    float taper=.64+.36*cos(clamp(along/span,-1.0,1.0)*2.2+id*.4);
    vec2 radial=vec2(lateral/(width*taper),deep/(width*1.2));
    float radius=length(radial);
    float envelope=(1.0-smoothstep(span*.60,span,abs(along)))*(1.0-smoothstep(.8,1.7,radius));
    float billow=cloudNoise(p*11.0+warp*1.5+id*7.3);
    float islands=smoothstep(.30,.64,billow+.065*sin(along*30.0+id));
    float body=exp(-dot(radial,radial)*.95)*(.18+islands*1.15);
    if(i>=4) {
      // Foreground carriers split into resolvable, peeling threads rather than
      // another smooth capsule. The same transport carries their full density.
      float threads=0.0;
      for(int j=0;j<3;j++) {
        float strand=float(j)-1.0;
        vec2 r=vec2((lateral+strand*width*.58+sin(along*16.0+id+strand*2.1)*width*.45)/(width*.52),
          (deep+cos(along*12.0+strand*2.4)*width*.45)/(width*.64));
        threads+=exp(-dot(r,r)*1.2);
      }
      body=threads*(.16+islands*.70);
    }
    density+=body*envelope;
  }
  float boundary=smoothstep(0.0,.045,p.z)*smoothstep(0.0,.045,1.0-p.z);
  return vec4(0,0,0,(1.0-exp(-density*1.35))*boundary);
}
`;

/** Cached ambient reservoir and initial state must use the same morphology. */
export function withFormationDensity(shader: string) {
  return shader.replace(/vec4 initialMatter\(vec3 p\) \{[\s\S]*?\n\}/, formationDensityGLSL.trim());
}

export function withFormationTransport(shader: string) {
  return withFormationDensity(shader).replace('volumeSample(uHumiditySource,p).r',
    'volumeSample(uHumiditySource,clamp(p+corrected.rgb,0.0,1.0)).r')
    .replace('volumeSample(uPigmentSource,p)', 'volumeSample(uPigmentSource,clamp(p+corrected.rgb,0.0,1.0))')
    .replace('volumeSample(uHumiditySource,p).gb', 'volumeSample(uHumiditySource,clamp(p+corrected.rgb,0.0,1.0)).gb');
}

export const formationRenderDensityGLSL = /* glsl */ `
float densityAt(vec3 p,vec4 matter) {
  // A filtered atlas lookup at a volume boundary must not extend smoke outside
  // its bounds, and detail must never create matter in a physically empty cell.
  if(matter.a<=.0001 || any(lessThan(p,vec3(0))) || any(greaterThan(p,vec3(1)))) return 0.0;
  vec3 material=p+matter.rgb;
  vec3 broadScale=vec3(3.8,3.8,3.2);
  float broadLod=clamp(log2(max(.001,length(rayFootprint*broadScale)*64.0*.32)),.5,3.0);
  vec2 broad=textureLod(uDetail,material*broadScale,broadLod).rg;
  // Oblique and anisotropic material-space folds. Nearby wisps are finer;
  // distant ones stay broad enough to survive the same ray/sample budget.
  vec3 folded=vec3(material.x*.83+material.y*.55,-material.x*.55+material.y*.83,material.z);
  vec3 scale=mix(vec3(7.5,1.4,4.5),vec3(12.0,1.8,5.0),smoothstep(.4,.9,p.z));
  float fineLod=clamp(log2(max(.001,length(rayFootprint*scale)*64.0*.40)),.65,4.0);
  float fine=textureLod(uDetail,folded*scale+vec3(broad.g*.35,broad.r*.22,broad.g*.18),fineLod).g;
  float ribbon=pow(max(0.0,1.0-abs(fine*2.0-1.0)),5.0);
  float fray=smoothstep(.28,.68,fine+(broad.r-.5)*.30);
  float mass=smoothstep(.16,.62,matter.a);
  float structure=mix(ribbon*.95,.25+fray*.90,mass);
  float support=smoothstep(.005,.12,matter.a);
  return matter.a*support*structure*2.6;
}
`;

export function withFormationRender(shader: string) {
  return shader.replace(/float densityAt\(vec3 p,vec4 matter\) \{[\s\S]*?\n\}/, formationRenderDensityGLSL.trim());
}
