import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Test-only debugging port, on loopback. The shipping application never enables it.
const executable=path.resolve('release/win-unpacked/AudioFlow.exe');
const profile=path.resolve('.cache/package-smoke-profile');
await mkdir(profile,{recursive:true});
const env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(executable,['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9333',`--user-data-dir=${profile}`],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let nativeLog='';
for (const output of [child.stdout,child.stderr]) output.on('data',chunk=>{nativeLog=(nativeLog+String(chunk)).slice(-64000);});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
const pending=new Map();
let nextId=0;
function call(method,params={}) {
  return new Promise((resolve,reject)=>{
    const id=++nextId;
    const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`));},10000);
    pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject});
    socket.send(JSON.stringify({id,method,params}));
  });
}
try {
  let target;
  for(let i=0;i<80;i++) {
    try {
      const targets=await (await fetch('http://127.0.0.1:9333/json/list')).json();
      target=targets.find(t=>t.type==='page'&&t.url.startsWith('audioflow://app/'));
      if(target)break;
    } catch {}
    await delay(150);
  }
  if(!target)throw new Error('Packaged application did not expose its local page');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    const request=pending.get(message.id);
    if(request){pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}
  });
  // Wait for the app, not just a navigation target. Cold GPU/process startup may
  // take longer than two seconds on Windows, especially after packaging.
  for (let i=0;i<80;i++) {
    const ready=await call('Runtime.evaluate',{expression:`!!document.querySelector('canvas')&&!!window.audioflow`,returnByValue:true});
    if(ready.result.value)break;
    await delay(200);
  }
  await delay(1000);
  const {result}=await call('Runtime.evaluate',{expression:`({title:document.title,canvas:!!document.querySelector('canvas'),debugHidden:!document.querySelector('.acoustic-debug'),error:document.querySelector('[role="alert"]')?.textContent||'',fps:document.querySelector('.scene-meta')?.textContent,status:document.querySelector('.source-badge')?.textContent,bridge:!!window.audioflow})`,returnByValue:true});
  const report=result.value;
  if(!report.canvas||report.error||!report.bridge)throw new Error(`Packaged rendering failed: ${JSON.stringify(report)}`);
  if(!report.debugHidden)throw new Error('Packaged diagnostics should start hidden');
  // F3 must work even with a slider focused.
  await call('Runtime.evaluate',{expression:`document.querySelector('input[type="range"]').focus()`});
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  await delay(900);
  const debug=await call('Runtime.evaluate',{expression:`document.querySelector('.acoustic-debug')?.textContent||''`,returnByValue:true});
  report.debug=debug.result.value;
  if(!report.debug.includes('RMS')||!/FP16|RGBA8/.test(report.debug))throw new Error('Packaged F3 diagnostic failed');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  const screenshot=await call('Page.captureScreenshot',{format:'png'});
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/packaged.png',Buffer.from(screenshot.data,'base64'));
  await call('Runtime.evaluate',{expression:`document.querySelectorAll('.style-selector button')[0].click()`});
  await delay(18000);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  await delay(800);
  const atmosphere=await call('Runtime.evaluate',{expression:`({error:document.querySelector('[role="alert"]')?.textContent||'',debug:document.querySelector('.acoustic-debug')?.textContent||'',fps:document.querySelector('.scene-meta')?.textContent})`,returnByValue:true});
  report.atmosphere=atmosphere.result.value;
  if(report.atmosphere.error||!report.atmosphere.debug.includes('gas 96×72×48')||report.atmosphere.debug.includes('0×0'))throw new Error('Packaged Atmosphere failed');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'F3',code:'F3',windowsVirtualKeyCode:114});
  const atmosphereScreenshot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile('artifacts/packaged-atmosphere.png',Buffer.from(atmosphereScreenshot.data,'base64'));
  await writeFile('artifacts/package-result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await call('Browser.close').catch(()=>{});
} catch(error) {
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/package-failure.json',JSON.stringify({error:String(error),nativeLog},null,2));
  throw error;
} finally {
  socket?.close();
  child.kill();
}
