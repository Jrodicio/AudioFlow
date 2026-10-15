import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
// A validation run must keep its loaded modules even if documentation or other
// files are edited concurrently; HMR would silently invalidate seeded replay.
const server=await createServer({server:{host:'127.0.0.1',port:5174,strictPort:true,hmr:false,watch:null}});
await server.listen();
const require=createRequire(import.meta.url),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const temporal=process.argv.includes('--temporal')||process.argv.includes('--plumes');
const child=spawn(require('electron'),[temporal ? 'scripts/atmosphere-temporal.cjs' : 'scripts/atmosphere-gpu.cjs',...process.argv.slice(2).filter(arg=>['--plumes','--definition'].includes(arg))],{env,windowsHide:true,stdio:'inherit'});
let closing=false;
async function close(code=1){if(closing)return;closing=true;child.kill();await server.close();process.exitCode=code;}
child.on('exit',code=>void close(code??1));child.on('error',error=>{console.error(error);void close();});
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
