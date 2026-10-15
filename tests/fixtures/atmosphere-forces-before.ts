// Frozen pre-calibration forces, used only for measured GPU comparisons.
export const forcesBefore = /* glsl */ `
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
`;
