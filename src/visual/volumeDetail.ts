/** Seeded periodic 3D detail, created once. The GPU samples it through advected
 * material coordinates, so small structures travel/stretch with the gas. */
export function makeVolumeDetailData(size = 64): Uint8Array {
  if(size<8 || size>128 || (size&(size-1))!==0) throw new Error('Volume detail size must be a power of two from 8 to 128');
  const data=new Uint8Array(size*size*size*4);
  const hash=(x:number,y:number,z:number,n:number,seed:number)=>{
    let h=Math.imul((x%n+n)%n,73856093)^Math.imul((y%n+n)%n,19349663)^Math.imul((z%n+n)%n,83492791)^seed;
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
  };
  const noise=(x:number,y:number,z:number,n:number,seed:number)=>{
    x*=n;y*=n;z*=n;const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
    x-=ix;y-=iy;z-=iz;
    x=x*x*x*(x*(x*6-15)+10);y=y*y*y*(y*(y*6-15)+10);z=z*z*z*(z*(z*6-15)+10);
    const a=hash(ix,iy,iz,n,seed),b=hash(ix+1,iy,iz,n,seed),c=hash(ix,iy+1,iz,n,seed),d=hash(ix+1,iy+1,iz,n,seed);
    const e=hash(ix,iy,iz+1,n,seed),f=hash(ix+1,iy,iz+1,n,seed),g=hash(ix,iy+1,iz+1,n,seed),h=hash(ix+1,iy+1,iz+1,n,seed);
    const low=(a+(b-a)*x)*(1-y)+(c+(d-c)*x)*y;
    const high=(e+(f-e)*x)*(1-y)+(g+(h-g)*x)*y;
    return low+(high-low)*z;
  };
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const u=(x+.5)/size,v=(y+.5)/size,w=(z+.5)/size;
    const a=noise(u,v,w,4,17),b=noise(u,v,w,8,31),c=noise(u,v,w,16,59),d=noise(u,v,w,32,71);
    const i=((z*size+y)*size+x)*4;
    data[i]=Math.round((a*.54+b*.3+c*.16)*255);
    data[i+1]=Math.round((b*.5+c*.32+d*.18)*255);
    data[i+2]=Math.round(noise(u,v,w,4,113)*255);data[i+3]=255;
  }
  return data;
}
