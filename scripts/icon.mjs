// Reproducible local icon asset; no image service or native dependency.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
const size=256;
const raw=Buffer.alloc(size*(size*4+1));
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const i=y*(size*4+1)+1+x*4;
  const qx=Math.abs(x-127.5)-70,qy=Math.abs(y-127.5)-70;
  const edge=Math.hypot(Math.max(0,qx),Math.max(0,qy))+Math.min(0,Math.max(qx,qy))-57;
  const alpha=1-smooth(-.5,.5,edge);
  const gradient=(x+y)/510;
  const bg=[mix(22,6,gradient),mix(67,25,gradient),mix(75,35,gradient)];
  const ring=(1-smooth(.5,1.5,Math.abs(Math.hypot(x-128,y-128)-90)))*.3;
  const wave=15*Math.sin((x-64)*Math.PI/63);
  const range=smooth(58,66,x)*(1-smooth(190,198,x));
  const ink=(1-smooth(4.5,6,Math.min(Math.abs(y-109+wave),Math.abs(y-144+wave))))*range;
  const pigment=[mix(131,229,x/256),mix(211,219,x/256),mix(196,156,x/256)];
  for(let c=0;c<3;c++)raw[i+c]=Math.round(mix(mix(bg[c],pigment[c],ring),pigment[c],ink));
  raw[i+3]=Math.round(alpha*255);
}
function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type);const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([len,name,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(png.length,14);icoHeader.writeUInt32LE(22,18);
await mkdir(new URL('../assets/',import.meta.url),{recursive:true});
await writeFile(new URL('../assets/icon.png',import.meta.url),png);
await writeFile(new URL('../assets/icon.ico',import.meta.url),Buffer.concat([icoHeader,png]));
